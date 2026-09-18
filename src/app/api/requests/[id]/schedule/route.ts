import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";
import { findLengthViolations, PASS_MARK } from "@/lib/channel-post-format";

// Newsletter shares this same scheduled_content table and cron job (Decision
// #22/#48) but the cron handles it differently at fire time: LinkedIn/X get a
// reminder email to the workspace notification address, newsletter gets a real
// send to every active subscriber - see /api/cron/publish.
const bodySchema = z.object({
  channel: z.enum(["linkedin", "x", "newsletter"]),
  scheduledFor: z.string().datetime({ message: "Invalid date/time." }),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Ownership (migration 007). 404 not 403: telling someone a request exists
  // but is not theirs still leaks that it exists.
  if (!(await userCanModifyRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid schedule request." },
      { status: 400 }
    );
  }

  // Hard reject a past time at set-time, per the docs' own resolution of this exact
  // open question ("decide at set-time whether to reject, or fire immediately") -
  // silently accepting it and letting the cron job discover the problem later is
  // exactly the failure mode the docs warn against.
  const scheduledFor = new Date(parsed.data.scheduledFor);
  if (scheduledFor.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Scheduled time must be in the future." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: post } = await admin
    .from("channel_posts")
    .select("id, version, body")
    .eq("request_id", requestId)
    .eq("channel", parsed.data.channel)
    .eq("chosen", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (!post) {
    return NextResponse.json({ error: "No adapted content exists for this channel yet." }, { status: 409 });
  }

  // Hard platform limits are not a quality judgment the evaluator can weigh against
  // other criteria, they are a publishing fact: an over-length X post cannot be
  // posted at all. Blocked here rather than left to the score, because a post can
  // pass Pass 2 overall while still being unpublishable, and an edit re-scored
  // through Workflow E used to bypass the length check entirely.
  const violations = findLengthViolations(parsed.data.channel, post.body ?? "");
  if (violations.length > 0) {
    const detail = violations
      .map((v) => `${v.label} is ${v.length} characters, limit is ${v.limit}`)
      .join("; ");
    return NextResponse.json(
      {
        error: `This ${parsed.data.channel} post is over the platform limit and can't be scheduled until it's shortened. ${detail}.`,
      },
      { status: 409 }
    );
  }

  const { data: evaluation } = await admin
    .from("evaluation_results")
    .select("status, overall_score")
    .eq("request_id", requestId)
    .eq("channel", parsed.data.channel)
    .eq("pass", "pass_2_channel")
    .eq("content_version", post.version)
    .maybeSingle();

  // Same discipline as approving the article (Decision #36): can't schedule
  // something that hasn't actually passed evaluation, checked here at the API
  // level, not just hidden in the UI (week4-full-flow.md line 211's "hard rule,
  // server-enforced" applies just as much to publishing as to adaptation).
  // Both the label and the number. `status` is written by whoever evaluated last, and
  // Workflow E writes the model's own self-assessment rather than applying the gate,
  // so a post can arrive here saying "pass" at a score the gate would have refused.
  const passedGate =
    evaluation &&
    evaluation.status === "pass" &&
    typeof evaluation.overall_score === "number" &&
    evaluation.overall_score >= PASS_MARK;

  if (!passedGate) {
    return NextResponse.json(
      {
        error:
          typeof evaluation?.overall_score === "number" && evaluation.overall_score < PASS_MARK
            ? `This channel's current draft scored ${evaluation.overall_score}/100, below the ${PASS_MARK} needed to schedule.`
            : "This channel's current draft hasn't passed evaluation, so it can't be scheduled yet.",
      },
      { status: 409 }
    );
  }

  // Replace any existing not-yet-fired schedule for this channel rather than
  // stacking duplicates - one pending schedule per channel post at a time.
  await admin
    .from("scheduled_content")
    .delete()
    .eq("channel_post_id", post.id)
    .eq("status", "scheduled");

  const { error: insertError } = await admin.from("scheduled_content").insert({
    channel_post_id: post.id,
    channel: parsed.data.channel,
    scheduled_for: scheduledFor.toISOString(),
  });

  // 23505 means the partial unique index from migration 013 caught a concurrent
  // schedule of the same post: the delete above is check-then-act and two clicks
  // landing together both find nothing to delete, so without the index the queue
  // ended up with two rows and the newsletter would send twice. The loser of that
  // race still expresses the same intent, so it moves the surviving row to its time
  // rather than failing at the human.
  if (insertError) {
    if (insertError.code !== "23505") {
      return NextResponse.json({ error: "Couldn't save the schedule. Try again." }, { status: 500 });
    }
    const { error: updateError } = await admin
      .from("scheduled_content")
      .update({ scheduled_for: scheduledFor.toISOString() })
      .eq("channel_post_id", post.id)
      .eq("status", "scheduled");
    if (updateError) {
      return NextResponse.json({ error: "Couldn't save the schedule. Try again." }, { status: 500 });
    }
  }

  await logEvent({
    requestId,
    stage: "publish_job",
    status: "success",
    detail: `${parsed.data.channel} scheduled for ${scheduledFor.toISOString()}.`,
  });

  return NextResponse.json({ ok: true });
}
