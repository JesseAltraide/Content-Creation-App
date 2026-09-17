import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";

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
    .select("id, version")
    .eq("request_id", requestId)
    .eq("channel", parsed.data.channel)
    .eq("chosen", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (!post) {
    return NextResponse.json({ error: "No adapted content exists for this channel yet." }, { status: 409 });
  }

  const { data: evaluation } = await admin
    .from("evaluation_results")
    .select("status")
    .eq("request_id", requestId)
    .eq("channel", parsed.data.channel)
    .eq("pass", "pass_2_channel")
    .eq("content_version", post.version)
    .maybeSingle();

  // Same discipline as approving the article (Decision #36): can't schedule
  // something that hasn't actually passed evaluation, checked here at the API
  // level, not just hidden in the UI (week4-full-flow.md line 211's "hard rule,
  // server-enforced" applies just as much to publishing as to adaptation).
  if (!evaluation || evaluation.status !== "pass") {
    return NextResponse.json(
      { error: "This channel's current draft hasn't passed evaluation — it can't be scheduled yet." },
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

  if (insertError) {
    return NextResponse.json({ error: "Couldn't save the schedule — try again." }, { status: 500 });
  }

  await logEvent({
    requestId,
    stage: "publish_job",
    status: "success",
    detail: `${parsed.data.channel} scheduled for ${scheduledFor.toISOString()}.`,
  });

  return NextResponse.json({ ok: true });
}
