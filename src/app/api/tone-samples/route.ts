import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getManagerState, announceSettingsChange } from "@/lib/content-manager";
import { findLink, TONE_SAMPLE_LINK_MESSAGE } from "@/lib/find-link";

const bodySchema = z.object({
  channel: z.enum(["linkedin", "x", "newsletter"]),
  source: z.enum(["real_post", "described_target"]).default("real_post"),
  content: z.string().trim().min(20, "That's too short. Add more detail."),
}).superRefine((data, ctx) => {
  // Any link, not just a sample that is nothing but a link. Nothing fetches these:
  // the stored characters ARE what Tone is graded against, so a URL in the field
  // teaches the evaluator that a URL is the house voice.
  const link = findLink(data.content);
  if (link) {
    ctx.addIssue({
      code: "custom",
      message: `${TONE_SAMPLE_LINK_MESSAGE} Found: ${link}`,
      path: ["content"],
    });
  }
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
    .from("tone_samples")
    .insert({
      channel: parsed.data.channel,
      content: parsed.data.content,
      source: parsed.data.source,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to save tone sample." }, { status: 500 });
  }

  await announceSettingsChange({
    kind: "tone",
    summary: `A ${parsed.data.channel} tone sample was added, so future drafts will be written and graded against it.`,
    authorUserId: user.id,
    authorEmail: user.email,
  });

  return NextResponse.json({ sample: data }, { status: 201 });
}
