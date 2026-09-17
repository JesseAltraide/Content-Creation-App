import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";

// Workflow D's own gate transitions to ready_to_schedule automatically when every
// channel passes together in one run - but Workflow E deliberately never touches
// requests.status (it's a per-post edit action, independent of the request's
// pipeline stage). If a human fixes the one channel that was still failing via a
// direct edit, every channel can now individually pass without anything ever
// re-checking the request as a whole - this route is that re-check, triggered
// explicitly by the human rather than happening silently.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: req } = await admin.from("requests").select("channels, status").eq("id", requestId).single();
  if (!req || req.status !== "needs_human_attention") {
    return NextResponse.json(
      { error: "This request isn't in a state where this applies." },
      { status: 409 }
    );
  }

  for (const channel of req.channels as string[]) {
    if (channel === "newsletter" || channel === "linkedin" || channel === "x") {
      const { data: post } = await admin
        .from("channel_posts")
        .select("version")
        .eq("request_id", requestId)
        .eq("channel", channel)
        .eq("chosen", true)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!post) {
        return NextResponse.json({ error: `No adapted content exists yet for ${channel}.` }, { status: 409 });
      }

      const { data: evaluation } = await admin
        .from("evaluation_results")
        .select("status")
        .eq("request_id", requestId)
        .eq("channel", channel)
        .eq("pass", "pass_2_channel")
        .eq("content_version", post.version)
        .maybeSingle();

      if (!evaluation || evaluation.status !== "pass") {
        return NextResponse.json(
          { error: `${channel} still hasn't passed Pass 2 evaluation — nothing to mark ready.` },
          { status: 409 }
        );
      }
    }
  }

  const { data: updated } = await admin
    .from("requests")
    .update({ status: "ready_to_schedule" })
    .eq("id", requestId)
    .eq("status", "needs_human_attention")
    .select()
    .single();

  if (!updated) {
    return NextResponse.json(
      { error: "Someone else just acted on this request — refresh to see the latest." },
      { status: 409 }
    );
  }

  await logEvent({
    requestId,
    stage: "pass2_evaluation",
    status: "success",
    detail: "All channels now pass Pass 2 (after a manual edit fixed the last one) — marked ready to schedule.",
  });

  return NextResponse.json({ ok: true });
}
