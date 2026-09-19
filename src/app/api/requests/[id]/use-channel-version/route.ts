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
// The row id, not the version number. Version numbers restart at 1 every time
// adaptation is re-run, so a channel can hold two v3 posts and "switch to v3" has no
// single answer: it marked both chosen at once when the workflow did the same thing.
const Body = z.object({
  channel: z.enum(["linkedin", "x", "newsletter"]),
  postId: z.string().uuid(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { channel, postId } = parsed.data;

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

  const target = (posts ?? []).find((p) => p.id === postId);
  if (!target) {
    return NextResponse.json({ error: "That version no longer exists." }, { status: 404 });
  }
  if (target.chosen) {
    return NextResponse.json({ error: "That version is already the one in use." }, { status: 409 });
  }

  if ((posts ?? []).some((p) => p.locked)) {
    return NextResponse.json({ error: "This post is locked." }, { status: 409 });
  }

  // scheduled_content points at a channel_post_id and carries no request_id, so the
  // lookup goes through this channel's own posts.
  //
  // Only a PENDING send can conflict. A published row is history: the post already
  // went out, and switching versions now only affects what gets scheduled next.
  // Blocking on it meant one send yesterday froze the channel's version choice
  // forever, which is what happened live: X had a published row from the previous
  // day and every "Use this one" was refused with "already scheduled".
  const { data: scheduled } = await admin
    .from("scheduled_content")
    .select("id, scheduled_for")
    .in(
      "channel_post_id",
      (posts ?? []).map((p) => p.id)
    )
    .eq("status", "scheduled");

  // A pending send whose time has already come is the one case worth refusing: the
  // cron could fire it while the switch is in flight, and which version went out
  // would be a race. Anything still in the future is the author's to change.
  const due = (scheduled ?? []).filter((s) => new Date(s.scheduled_for) <= new Date());
  if (due.length > 0) {
    return NextResponse.json(
      {
        error:
          "This channel is due to send right now, so the version cannot be changed. Unschedule it first.",
      },
      { status: 409 }
    );
  }

  // The pending schedule points at the post being replaced, so it cannot simply be
  // carried across: it is cancelled and the author reschedules. Said in the response
  // rather than done silently, because a cancelled send that nobody mentions is how
  // something quietly never goes out.
  const cancelled = (scheduled ?? []).length;
  if (cancelled > 0) {
    const { error: cancelError } = await admin
      .from("scheduled_content")
      .delete()
      .in(
        "channel_post_id",
        (posts ?? []).map((p) => p.id)
      )
      .eq("status", "scheduled");
    if (cancelError) {
      return NextResponse.json({ error: "Could not switch version." }, { status: 500 });
    }
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
    detail:
      `Switched ${channel} to version ${target.version} by hand.` +
      (cancelled > 0 ? " The pending schedule pointed at the previous version and was cancelled." : ""),
  });

  return NextResponse.json({ ok: true, scheduleCancelled: cancelled > 0 });
}
