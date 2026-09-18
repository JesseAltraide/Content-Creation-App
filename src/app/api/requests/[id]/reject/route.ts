import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";

// Mandatory rejection reason (mirrors Week 3's rule) - feedback owed to whoever
// created the request, distinct from self-regeneration's required-comment rule.
const bodySchema = z.object({
  reason: z.string().trim().min(10, "A real reason is required (at least 10 characters)."),
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
      { error: parsed.error.issues[0]?.message ?? "A reason is required." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Allowed from needs_human_attention too, not just pending_approval - a Pass 2
  // cap-reached dead end (Workflow D) deserves the same "give up on this, with a
  // reason" escape hatch as a Pass 1 one always has.
  const { data: updatedRequest, error: transitionError } = await admin
    .from("requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .in("status", ["pending_approval", "needs_human_attention"])
    .select()
    .single();

  if (transitionError || !updatedRequest) {
    return NextResponse.json(
      { error: "This request is not awaiting review (already progressed, or refresh to see the latest)." },
      { status: 409 }
    );
  }

  // Closing the request has to close what it already put in motion. A post that was
  // scheduled before the rejection would otherwise still be sent by the publish cron,
  // which for the newsletter means real delivery to real subscribers of content the
  // author just rejected. Pending entries only: anything already published is history
  // and stays on the record.
  const { data: channelPosts } = await admin
    .from("channel_posts")
    .select("id")
    .eq("request_id", requestId);

  const postIds = (channelPosts ?? []).map((p) => p.id);
  let cancelled = 0;
  if (postIds.length > 0) {
    const { data: removed } = await admin
      .from("scheduled_content")
      .delete()
      .in("channel_post_id", postIds)
      .eq("status", "scheduled")
      .select();
    cancelled = removed?.length ?? 0;
  }

  await logEvent({
    requestId,
    stage: "approval",
    status: "failed",
    detail: `Rejected: ${parsed.data.reason}${cancelled ? ` (${cancelled} pending scheduled post(s) cancelled).` : ""}`,
  });

  return NextResponse.json({ ok: true });
}
