import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanAccessRequest } from "@/lib/request-access";
import { triggerAdaptAndEvaluate } from "@/lib/n8n";
import { logEvent } from "@/lib/events";

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
  if (!(await userCanAccessRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const admin = createAdminClient();

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
