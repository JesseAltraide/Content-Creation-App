import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getManagerState, announceSettingsChange } from "@/lib/content-manager";
import { findLink, AUDIENCE_LINK_MESSAGE } from "@/lib/find-link";

// A profile of "everyone" / "professionals" / "people online" isn't a description
// of anyone - every idea scores as resonant against it, which defeats the whole
// point of the resonance gate and every downstream Audience Fit score (week4-data-
// quality.md section 3, explicitly "Block on save"). These are the words that carry
// no narrowing information, so they are subtracted before judging specificity in
// isVagueAudienceDescription below. Containing one of them is fine; a real
// description has an industry, a role, a company size or a behaviour on top.
const GENERIC_AUDIENCE_WORDS = new Set([
  "everyone", "everybody", "everything", "anybody", "anyone", "professionals",
  "people", "person", "folks", "individuals", "users", "audience", "consumers",
  "clients", "customers", "general", "public", "online", "internet", "world",
  "the", "a", "an", "and", "or", "of", "for",
]);

// "Everyone", "anyone interested in X", "all users everywhere": a description that
// opens with a universal quantifier is claiming the audience is unbounded, which
// is the opposite of a profile, no matter how specific the words after it are.
const UNIVERSAL_OPENERS = new Set(["everyone", "everybody", "anyone", "anybody", "all", "any"]);

function isVagueAudienceDescription(description: string): boolean {
  const words = description
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return true;
  if (UNIVERSAL_OPENERS.has(words[0])) return true;

  // Everything left after removing filler and generic crowd-nouns is what actually
  // narrows the audience. One such word ("business people", "our customers") is a
  // category, not an audience: the evaluator cannot grade Audience Fit against it
  // any better than against "everyone". Two is a low bar that every real profile
  // clears easily ("CTOs at fintech startups", "people who watch football").
  const specific = words.filter((w) => !GENERIC_AUDIENCE_WORDS.has(w));
  return specific.length < 2;
}

const bodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .refine((s) => !findLink(s), { message: AUDIENCE_LINK_MESSAGE }),
  description: z
    .string()
    .trim()
    .min(10, "Description must be a real description (at least 10 characters).")
    .refine((s) => s.split(/[.!?]+/).filter(Boolean).length <= 3, {
      message: "Keep it to 3 sentences or less.",
    })
    // Same reasoning as the tone samples: this text is never fetched, it is handed to
    // the resonance gate and to every Audience Fit score as the description of who the
    // reader is. A URL there describes nobody, and could not be followed anyway.
    .refine((s) => !findLink(s), {
      message: AUDIENCE_LINK_MESSAGE,
    })
    .refine((s) => !isVagueAudienceDescription(s), {
      message:
        "This isn't specific enough. \"Everyone\", \"anyone interested in X\" or \"our customers\" describes no one in particular, and the evaluator grades every draft's Audience Fit against this. Name an industry, role, company size, or behaviour.",
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
