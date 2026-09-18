import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";

// Workflow D's adaptation loop keeps revising a channel until the round budget runs
// out, and it does not compare the round it just produced against the round it is
// replacing. Caught live: X scored 62 at v1, 87 at v2 (a pass), and 62 again at v3,
// and v3 is what the loop marked chosen, so a post that had already cleared the gate
// became unschedulable. Decision #126 discards a lower-scoring automated rewrite, but
// that rule lives in this app's own revise route and the workflow's internal loop
// never passes through it.
//
// Fixing the loop means changing the workflow and reimporting it. This is the same
// correction applied where the app can reach: the human is shown that a better round
// exists and presses a button to go back to it. Deliberately not automatic, because
// the identical mechanism would otherwise revert a manual edit, which the author's
// own text must never be subject to.
const Body = z.object({
  channel: z.enum(["linkedin", "x", "newsletter"]),
  version: z.number().int().positive(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { channel, version } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!(await userCanModifyRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const admin = createAdminClient();

  const { data: posts } = await admin
    .from("channel_posts")
    .select("id, version, chosen, locked")
    .eq("request_id", requestId)
    .eq("channel", channel);

  const target = (posts ?? []).find((p) => p.version === version);
  if (!target) {
    return NextResponse.json({ error: "That version no longer exists." }, { status: 404 });
  }
  if (target.chosen) {
    return NextResponse.json({ error: "That version is already the one in use." }, { status: 409 });
  }

  // A post already scheduled or published is not something to swap underneath the
  // queue: the scheduled row points at a specific channel_post_id.
  // scheduled_content points at a channel_post_id and carries no request_id, so the
  // lookup goes through this channel's own posts.
  const { data: scheduled } = await admin
    .from("scheduled_content")
    .select("id")
    .in(
      "channel_post_id",
      (posts ?? []).map((p) => p.id)
    )
    .in("status", ["scheduled", "published"]);
  if ((scheduled ?? []).length > 0) {
    return NextResponse.json(
      { error: "This channel is already scheduled. Unschedule it first." },
      { status: 409 }
    );
  }
  if ((posts ?? []).some((p) => p.locked)) {
    return NextResponse.json({ error: "This post is locked." }, { status: 409 });
  }

  // Clear first, then set: the partial unique index allows exactly one chosen row per
  // channel, so doing it the other way round collides with the row being replaced.
  const { error: clearError } = await admin
    .from("channel_posts")
    .update({ chosen: false })
    .eq("request_id", requestId)
    .eq("channel", channel);
  if (clearError) {
    return NextResponse.json({ error: "Could not switch version." }, { status: 500 });
  }

  const { error: setError } = await admin
    .from("channel_posts")
    .update({ chosen: true })
    .eq("id", target.id);
  if (setError) {
    return NextResponse.json({ error: "Could not switch version." }, { status: 500 });
  }

  await logEvent({
    requestId,
    stage: "channel_revision",
    status: "success",
    detail: `Switched ${channel} back to version ${version} by hand, after a later revision round scored lower.`,
  });

  return NextResponse.json({ ok: true });
}
