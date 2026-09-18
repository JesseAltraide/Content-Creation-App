import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";

// Mirrors the Stage 3 angle-selection pattern: two candidates exist, the human
// picks which becomes canonical. The chosen flag flip is the only state change -
// the losing variant's row (and its evaluation) stays in place as history.
const bodySchema = z.object({
  channel: z.enum(["linkedin", "x", "newsletter"]),
  version: z.number().int().positive(),
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
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { channel, version } = parsed.data;

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("channel_posts")
    .select("id, chosen, tone_variant")
    .eq("request_id", requestId)
    .eq("channel", channel)
    .eq("version", version)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "That version doesn't exist." }, { status: 404 });
  }
  if (target.chosen) {
    return NextResponse.json({ ok: true });
  }

  const { data: current } = await admin
    .from("channel_posts")
    .select("id")
    .eq("request_id", requestId)
    .eq("channel", channel)
    .eq("chosen", true)
    .maybeSingle();

  if (current) {
    const { error: unchooseError } = await admin
      .from("channel_posts")
      .update({ chosen: false })
      .eq("id", current.id)
      .eq("chosen", true);
    if (unchooseError) {
      return NextResponse.json({ error: "Couldn't switch variants. Try again." }, { status: 500 });
    }
  }

  const { error: chooseError } = await admin
    .from("channel_posts")
    .update({ chosen: true })
    .eq("id", target.id)
    .eq("chosen", false);

  if (chooseError) {
    // Best-effort revert so we don't end up with zero chosen rows for this channel.
    if (current) await admin.from("channel_posts").update({ chosen: true }).eq("id", current.id);
    return NextResponse.json({ error: "Couldn't switch variants. Try again." }, { status: 500 });
  }

  await logEvent({
    requestId,
    stage: "alternate_tone",
    status: "success",
    detail: `${channel} switched to the ${target.tone_variant ?? "default"} tone variant (version ${version}).`,
  });

  return NextResponse.json({ ok: true });
}
