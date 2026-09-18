import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";

// Recovery action for a content-level dead end (needs_human_attention), and also an
// ordinary editorial choice from a draft awaiting approval (pending_approval).
//
// It was dead-end-only, which left a real gap: a draft that passes but takes the wrong
// treatment gave the human three options, all bad. Approve something they do not want,
// regenerate the same angle with a comment (the same angle, so the same shape of
// article), or reject the whole request and lose the research. Meanwhile a second
// proposed angle sat unused with no way to reach it. Caught live on exactly that.
//
// Picking a genuinely different angle stays free; re-picking the same one costs a
// regeneration, which select-angle already enforces.
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
    .in("status", ["needs_human_attention", "pending_approval"])
    .select()
    .single();

  if (transitionError || !updatedRequest) {
    return NextResponse.json(
      { error: "This request has moved past the point where a different angle can be chosen. Refresh to see where it got to." },
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
