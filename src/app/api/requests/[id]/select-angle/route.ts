import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";
import { triggerGenerateAndEvaluate } from "@/lib/n8n";

const bodySchema = z.object({ angleId: z.string().uuid() });

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
    return NextResponse.json({ error: "Invalid angle." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Confirm the angle actually belongs to this request before touching anything.
  const { data: angle } = await admin
    .from("angles")
    .select("id")
    .eq("id", parsed.data.angleId)
    .eq("request_id", requestId)
    .single();

  if (!angle) {
    return NextResponse.json({ error: "Angle not found for this request." }, { status: 404 });
  }

  // Atomic conditional transition: only proceeds from awaiting_angle_selection.
  const { data: updatedRequest, error: transitionError } = await admin
    .from("requests")
    .update({ status: "generating" })
    .eq("id", requestId)
    .eq("status", "awaiting_angle_selection")
    .select()
    .single();

  if (transitionError || !updatedRequest) {
    return NextResponse.json(
      { error: "This request is not awaiting angle selection (already progressed, or refresh to see the latest)." },
      { status: 409 }
    );
  }

  await admin.from("angles").update({ chosen: true }).eq("id", parsed.data.angleId);

  await logEvent({
    requestId,
    stage: "angle_selection",
    status: "success",
    detail: "Angle selected; generating the main block.",
  });

  await triggerGenerateAndEvaluate(requestId, parsed.data.angleId);

  return NextResponse.json({ ok: true });
}
