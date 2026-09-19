import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { triggerAdaptAndEvaluate } from "@/lib/n8n";
import { logEvent } from "@/lib/events";
import { REGENERATION_CAP, countHumanRegenerations } from "@/lib/regeneration";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

// Workflow D's own setup-failure handler reverts requests.status to 'approved' on
// any failure upstream of the Claude calls (same pattern as Workflow C/B's hardening)
// - this is the retry action from that state. Nothing in Supabase moved forward on
// the earlier failure, so retrying is just pinging the webhook again.
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

  const admin = createAdminClient();

  // Retrying adaptation was not capped at all, which is how one request ran it three
  // times in four minutes and ended up with nine LinkedIn posts. It costs a full
  // adaptation and two evaluation rounds, so it draws on the same budget as every
  // other way of asking for the work to be done again.
  const priorRetries = await countHumanRegenerations(requestId, "adaptation");
  if (priorRetries >= REGENERATION_CAP) {
    return NextResponse.json(
      {
        error: `Adaptation has already been retried ${priorRetries} times, which is the limit. If it still is not right, the article is usually the thing to change.`,
      },
      { status: 409 }
    );
  }

  const { data: updatedRequest, error: transitionError } = await admin
    .from("requests")
    .update({ status: "adapting" })
    .eq("id", requestId)
    .eq("status", "approved")
    .select()
    .single();

  if (transitionError || !updatedRequest) {
    return NextResponse.json(
      { error: "This request is not waiting to retry adaptation (already progressed, or refresh to see the latest)." },
      { status: 409 }
    );
  }

  await logEvent({
    requestId,
    stage: "adapt_and_evaluate_trigger",
    status: "success",
    detail: "Retried adaptation by user after a previous failure.",
  });

  // Not awaited - see approve/route.ts's comment on why.
  after(() => triggerAdaptAndEvaluate(requestId));

  return NextResponse.json({ ok: true });
}
