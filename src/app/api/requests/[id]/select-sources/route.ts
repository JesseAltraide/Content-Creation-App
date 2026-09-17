import { NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";
import { triggerScrapeAndProposeAngle } from "@/lib/n8n";

const bodySchema = z.object({
  selectedSourceIds: z.array(z.string().uuid()).min(1, "Select at least one source."),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    // Stage 2 hard block: proceeding having selected zero sources.
    return NextResponse.json(
      { error: "Select at least one source before continuing.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Atomic conditional transition: only proceeds from awaiting_source_selection.
  const { data: updatedRequest, error: transitionError } = await admin
    .from("requests")
    .update({ status: "researching" })
    .eq("id", requestId)
    .eq("status", "awaiting_source_selection")
    .select()
    .single();

  if (transitionError || !updatedRequest) {
    return NextResponse.json(
      { error: "This request is not awaiting source selection (already progressed, or refresh to see the latest)." },
      { status: 409 }
    );
  }

  const { error: selectError } = await admin
    .from("sources")
    .update({ status: "selected" })
    .eq("request_id", requestId)
    .in("id", parsed.data.selectedSourceIds);

  if (selectError) {
    await logEvent({
      requestId,
      stage: "source_selection",
      status: "failed",
      detail: selectError.message,
    });
    return NextResponse.json({ error: "Failed to record source selection." }, { status: 500 });
  }

  await admin
    .from("sources")
    .update({ status: "rejected" })
    .eq("request_id", requestId)
    .eq("status", "pending_selection");

  await logEvent({
    requestId,
    stage: "source_selection",
    status: "success",
    detail: `${parsed.data.selectedSourceIds.length} source(s) selected.`,
  });

  // Not awaited - see approve/route.ts's comment on why.
  after(() => triggerScrapeAndProposeAngle(requestId));

  return NextResponse.json({ ok: true });
}
