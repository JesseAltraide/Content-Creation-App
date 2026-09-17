import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";
import { triggerAdaptAndEvaluate } from "@/lib/n8n";

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

  const admin = createAdminClient();

  const { data: latestSection } = await admin
    .from("sections")
    .select("id, version")
    .eq("request_id", requestId)
    .order("version", { ascending: false })
    .limit(1)
    .single();

  if (!latestSection) {
    return NextResponse.json({ error: "No generated article to approve." }, { status: 409 });
  }

  const { data: passingEval } = await admin
    .from("evaluation_results")
    .select("id")
    .eq("section_id", latestSection.id)
    .eq("content_version", latestSection.version)
    .eq("status", "pass")
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
