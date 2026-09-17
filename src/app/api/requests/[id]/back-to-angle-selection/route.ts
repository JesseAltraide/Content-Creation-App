import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";

// Recovery action for a genuine content-level dead end (needs_human_attention) - lets
// the human pick a different angle rather than the request being a permanent dead end.
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

  // A hard block at angle_proposal itself means Claude returned an empty angles
  // array (see workflow-a's prompt) - there is nothing to fall back to in that case,
  // only a real dead end. This route only makes sense when at least one angle
  // already exists from a successful proposal that later dead-ended downstream.
  const { count: angleCount } = await admin
    .from("angles")
    .select("id", { count: "exact", head: true })
    .eq("request_id", requestId);
  if (!angleCount) {
    return NextResponse.json(
      { error: "No angle exists for this request yet, so there's nothing to go back to. Try a different idea instead." },
      { status: 409 }
    );
  }

  const { data: updatedRequest, error: transitionError } = await admin
    .from("requests")
    .update({ status: "awaiting_angle_selection" })
    .eq("id", requestId)
    .eq("status", "needs_human_attention")
    .select()
    .single();

  if (transitionError || !updatedRequest) {
    return NextResponse.json(
      { error: "This request is not in a needs-attention state (already progressed, or refresh to see the latest)." },
      { status: 409 }
    );
  }

  await admin.from("angles").update({ chosen: false }).eq("request_id", requestId);

  await logEvent({
    requestId,
    stage: "angle_selection",
    status: "success",
    detail: "Returned to angle selection after a content-level dead end.",
  });

  return NextResponse.json({ ok: true });
}
