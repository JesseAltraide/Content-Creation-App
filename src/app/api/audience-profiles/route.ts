import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getManagerState, announceSettingsChange } from "@/lib/content-manager";

// A profile of "everyone" / "professionals" / "people online" isn't a description
// of anyone - every idea scores as resonant against it, which defeats the whole
// point of the resonance gate and every downstream Audience Fit score (week4-data-
// quality.md section 3, explicitly "Block on save"). Heuristic: if every
// non-trivial word in the description is drawn from this generic-audience denylist,
// there's nothing specific being described at all. A real description inevitably
// contains plenty of words outside this set (an industry, a role, a company size,
// a behavior), so this doesn't risk flagging genuine profiles that merely happen to
// use one of these words as part of a real, specific description.
const GENERIC_AUDIENCE_WORDS = new Set([
  "everyone", "everybody", "everything", "anybody", "anyone", "professionals",
  "people", "person", "folks", "individuals", "users", "audience", "consumers",
  "clients", "customers", "general", "public", "online", "internet", "world",
  "the", "a", "an", "and", "or", "of", "for",
]);

function isVagueAudienceDescription(description: string): boolean {
  const words = description
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return true;
  return words.every((w) => GENERIC_AUDIENCE_WORDS.has(w));
}

const bodySchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  description: z
    .string()
    .trim()
    .min(10, "Description must be a real description (at least 10 characters).")
    .refine((s) => s.split(/[.!?]+/).filter(Boolean).length <= 3, {
      message: "Keep it to 3 sentences or less.",
    })
    .refine((s) => !isVagueAudienceDescription(s), {
      message:
        "This isn't specific enough. \"everyone\" or \"professionals\" describes no one in particular. Name an industry, role, company size, or behavior.",
    }),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Settings belong to the content manager (migration 009). Enforced here, not just
  // hidden in the UI: these define what the evaluator grades every draft against.
  const manager = await getManagerState(user.id);
  if (!manager.canEditSettings) {
    return NextResponse.json(
      { error: "Only the content manager can change workspace settings." },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("audience_profiles")
    .insert({ name: parsed.data.name, description: parsed.data.description })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create audience profile." }, { status: 500 });
  }

  await announceSettingsChange({
    kind: "audience",
    summary: `Audience profile "${parsed.data.name}" was added.`,
    authorUserId: user.id,
    authorEmail: user.email,
  });

  return NextResponse.json({ profile: data }, { status: 201 });
}
