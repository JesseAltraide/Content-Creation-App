import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";

// Recovery action for a genuine content-level dead end (needs_human_attention) — lets
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
