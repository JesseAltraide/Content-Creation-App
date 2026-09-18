import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanAccessRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";

const bodySchema = z.object({
  channel: z.enum(["linkedin", "x", "newsletter"]),
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
  if (!(await userCanAccessRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: post } = await admin
    .from("channel_posts")
    .select("id")
    .eq("request_id", requestId)
    .eq("channel", parsed.data.channel)
    .eq("chosen", true)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (!post) {
    return NextResponse.json({ error: "Nothing to unschedule for this channel." }, { status: 409 });
  }

  // Only ever cancels a still-pending ('scheduled') item - once the cron job has
  // already flipped it to published/overdue/publish_failed, cancelling is no longer
  // a meaningful action (the reminder already fired or the window already passed).
  const { data: deleted } = await admin
    .from("scheduled_content")
    .delete()
    .eq("channel_post_id", post.id)
    .eq("status", "scheduled")
    .select();

  if (!deleted || deleted.length === 0) {
    return NextResponse.json({ error: "Nothing pending to unschedule for this channel." }, { status: 409 });
  }

  await logEvent({
    requestId,
    stage: "publish_job",
    status: "success",
    detail: `${parsed.data.channel} unscheduled.`,
  });

  return NextResponse.json({ ok: true });
}
