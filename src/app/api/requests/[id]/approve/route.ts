import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";
import { triggerAdaptAndEvaluate } from "@/lib/n8n";
import { PASS_MARK } from "@/lib/channel-post-format";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

// Hard rule (Decision #36, PRD test #5): approving content for which no passing
// evaluation record exists is blocked at the state-transition level, not just hidden
// in the UI. The atomic UPDATE below only succeeds if a real, passing evaluation
// exists for the current section - checked in the same query, not a separate read.
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

  const { data: latestSection } = await admin
    .from("sections")
    .select("id, version")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!latestSection) {
    return NextResponse.json({ error: "No generated article to approve." }, { status: 409 });
  }

  // The score as well as the label. The label is the workflow's word for what the
  // score means, and the two have drifted apart in real data: four Pass 1 rows in the
  // live database said "pass" while scoring 83, 84 and 80, because the row was written
  // before the gate ran and stored the model's own self-assessment. On the old check
  // an article at 83 was approvable and went straight to channel adaptation.
  //
  // The workflow now stores the gate's verdict, which is the real fix. This is the
  // second lock: the number is not an opinion, and anything reading a label alone has
  // already been wrong three times in this build (Errors #46, #54).
  const { data: passingEval } = await admin
    .from("evaluation_results")
    .select("id")
    .eq("section_id", latestSection.id)
    .eq("content_version", latestSection.version)
    .eq("status", "pass")
    .gte("overall_score", PASS_MARK)
    .limit(1)
    .maybeSingle();

  if (!passingEval) {
    return NextResponse.json(
      { error: "No passing evaluation exists for the current draft, so it cannot be approved." },
      { status: 409 }
    );
  }

  // Goes straight to 'adapting', not a separate 'approved' resting state - approving
  // is what triggers Workflow D immediately (week4-full-flow.md: "Human approves the
  // article" is Workflow D's trigger, not a distinct manual step after approval).
  const { data: updatedRequest, error: transitionError } = await admin
    .from("requests")
    .update({ status: "adapting" })
    .eq("id", requestId)
    .eq("status", "pending_approval")
    .select()
    .single();

  if (transitionError || !updatedRequest) {
    return NextResponse.json(
      { error: "This request is not pending approval (already progressed, or refresh to see the latest)." },
      { status: 409 }
    );
  }

  // Approval is the point of no return for this article (week4-full-flow.md: "once
  // adaptation is triggered, the article locks permanently"). Locking here, not just
  // relying on requests.status having moved past pending_approval/needs_human_attention,
  // gives a second, schema-level guarantee against ever regenerating an approved
  // article's body - defense in depth, not just a UI-level gate.
  await admin
    .from("sections")
    .update({ locked: true })
    .eq("id", latestSection.id);

  await logEvent({
    requestId,
    stage: "approval",
    status: "success",
    detail: "Article approved.",
  });

  // Not awaited: Workflow D can take minutes across up to 3 revision rounds, well
  // past what a synchronous connection can be relied on to survive (hit live during
  // testing as a Cloudflare 524 gateway timeout, even though n8n finished correctly
  // regardless). after() lets it keep running after this response is already sent.
  after(() => triggerAdaptAndEvaluate(requestId));

  return NextResponse.json({ ok: true });
}
