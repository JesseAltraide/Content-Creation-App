import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";
import { SAFE_STATE, STALLED_MANUAL_MS } from "@/lib/stalled-runs";

// A run that dies inside n8n without reaching one of its own failure handlers leaves
// the request in a working status with nothing logged. The status is the only thing
// the UI has to go on, so the request sits there claiming to be busy forever: caught
// live at 'adapting' for 112 minutes with no channel posts and no events after the
// trigger.
//
// 'researching' already had a Retry, because A1's failures do get logged. The other
// two working statuses had no recovery at all. This is the manual equivalent of the
// revert each workflow does for itself when it can.
//
// Deliberately does NOT re-trigger anything. Resetting and re-running are two separate
// decisions: if the original run is somehow still alive, firing a second one writes
// two sets of channel posts for the same request.

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!(await userCanModifyRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const admin = createAdminClient();

  const { data: current } = await admin
    .from("requests")
    .select("status, updated_at")
    .eq("id", requestId)
    .single();

  const target = current ? SAFE_STATE[current.status] : undefined;
  if (!current || !target) {
    return NextResponse.json(
      { error: "This request isn't stuck mid-run. Refresh to see where it got to." },
      { status: 409 }
    );
  }

  // The same threshold the banner uses before it stops claiming the work is running.
  // Without it this becomes a button that cancels a healthy run.
  const silentFor = Date.now() - new Date(current.updated_at).getTime();
  if (silentFor < STALLED_MANUAL_MS) {
    return NextResponse.json(
      { error: "This has only just started. Give it five minutes before resetting it." },
      { status: 409 }
    );
  }

  const { data: updated, error } = await admin
    .from("requests")
    .update({ status: target.to })
    .eq("id", requestId)
    .eq("status", current.status)
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: "Something else just moved this request on. Refresh to see the latest." },
      { status: 409 }
    );
  }

  if (target.unchooseAngles) {
    await admin.from("angles").update({ chosen: false }).eq("request_id", requestId);
  }

  await logEvent({
    requestId,
    stage: "pipeline_setup",
    status: "failed",
    detail: `Run stopped without reporting back and was reset by hand from ${current.status} to ${target.to} after ${Math.round(silentFor / 60000)} minutes of silence. Nothing was generated.`,
  });

  return NextResponse.json({ ok: true, status: target.to });
}
