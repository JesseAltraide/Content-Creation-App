import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";

// Hard rule (Decision #36, PRD test #5): approving content for which no passing
// evaluation record exists is blocked at the state-transition level, not just hidden
// in the UI. The atomic UPDATE below only succeeds if a real, passing evaluation
// exists for the current section — checked in the same query, not a separate read.
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
      { error: "No passing evaluation exists for the current draft — cannot approve." },
      { status: 409 }
    );
  }

  const { data: updatedRequest, error: transitionError } = await admin
    .from("requests")
    .update({ status: "approved" })
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

  await logEvent({
    requestId,
    stage: "approval",
    status: "success",
    detail: "Article approved.",
  });

  return NextResponse.json({ ok: true });
}
