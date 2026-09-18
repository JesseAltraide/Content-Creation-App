import { NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";
import { triggerGenerateAndEvaluate } from "@/lib/n8n";
import { REGENERATION_CAP } from "@/lib/regeneration";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

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

  // The count is NOT written here. Same rule the regenerate route follows: an
  // attempt is only spent once Claude is actually reached, so an outage, a dead
  // n8n, or a run that dead-ends before generation (no scraped sources, no relevant
  // excerpts) costs the human nothing. Workflow B increments it itself, immediately
  // before the generate call, when spent_regeneration says this was a re-pick.
  //
  // The status guard below is still the concurrency control: two double-clicks
  // cannot both transition out of awaiting_angle_selection, so only one can ever
  // reach the workflow and therefore only one can ever charge.
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
      ? `Angle re-selected after a previous generation; generating the main block (would be regeneration attempt ${priorCount + 1}/${REGENERATION_CAP} if generation is reached).`
      : "Angle selected; generating the main block.",
  });

  // Not awaited - Workflow B's revision loop can run for minutes; see
  // approve/route.ts's comment for why this shouldn't block the response.
  after(() => triggerGenerateAndEvaluate(requestId, parsed.data.angleId, isRepick));

  return NextResponse.json({ ok: true });
}
