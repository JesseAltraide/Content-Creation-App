import { NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";
import { triggerGenerateAndEvaluate } from "@/lib/n8n";
import { REGENERATION_CAP } from "@/lib/regeneration";

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

  // Ownership (migration 007). 404 not 403: telling someone a request exists
  // but is not theirs still leaks that it exists.
  if (!(await userCanModifyRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
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
    .select("id, generation_count")
    .eq("id", parsed.data.angleId)
    .eq("request_id", requestId)
    .single();

  if (!angle) {
    return NextResponse.json({ error: "Angle not found for this request." }, { status: 404 });
  }

  // Re-picking an angle that has already been generated against is a regeneration
  // wearing a different hat: identical work, identical cost (Workflow B in full,
  // including its own 2 revision rounds and both Opus evaluations). Without this it
  // was an unbounded way around the 5-attempt cap - dead-end, go back to angle
  // selection, pick the same angle, repeat. Picking a genuinely different angle is a
  // real restart and still costs nothing.
  const isRepick = angle.generation_count > 0;

  const { data: currentRequest } = await admin
    .from("requests")
    .select("regeneration_count")
    .eq("id", requestId)
    .single();
  const priorCount = currentRequest?.regeneration_count ?? 0;

  if (isRepick && priorCount >= REGENERATION_CAP) {
    return NextResponse.json(
      {
        error: `Regeneration limit (${REGENERATION_CAP} attempts) reached for this article. Pick a different angle, or reject it and start again.`,
      },
      { status: 409 }
    );
  }

  // Atomic conditional transition: only proceeds from awaiting_angle_selection, and
  // on a re-pick only from the exact count we just read, so two double-clicks can't
  // both spend an attempt (or both skip spending one).
  const transition = admin
    .from("requests")
    .update({
      status: "generating",
      ...(isRepick ? { regeneration_count: priorCount + 1 } : {}),
    })
    .eq("id", requestId)
    .eq("status", "awaiting_angle_selection");

  const { data: updatedRequest, error: transitionError } = await (
    isRepick ? transition.eq("regeneration_count", priorCount) : transition
  )
    .select()
    .single();

  if (transitionError || !updatedRequest) {
    return NextResponse.json(
      { error: "This request is not awaiting angle selection (already progressed, or refresh to see the latest)." },
      { status: 409 }
    );
  }

  // Durable record that generation has run against this angle, so the NEXT pick of
  // it is recognised as a re-pick. chosen can't carry this: back-to-angle-selection
  // deliberately resets it so the angle can be picked again.
  await admin
    .from("angles")
    .update({ generation_count: angle.generation_count + 1 })
    .eq("id", angle.id)
    .eq("generation_count", angle.generation_count);

  await admin.from("angles").update({ chosen: true }).eq("id", parsed.data.angleId);

  await logEvent({
    requestId,
    stage: "angle_selection",
    status: "success",
    detail: isRepick
      ? `Angle re-selected after a previous generation; generating the main block (regeneration attempt ${priorCount + 1}/${REGENERATION_CAP}).`
      : "Angle selected; generating the main block.",
  });

  // Not awaited - Workflow B's revision loop can run for minutes; see
  // approve/route.ts's comment for why this shouldn't block the response.
  after(() => triggerGenerateAndEvaluate(requestId, parsed.data.angleId, isRepick));

  return NextResponse.json({ ok: true });
}
