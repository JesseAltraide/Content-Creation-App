import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";

// Mandatory rejection reason (mirrors Week 3's rule) - feedback owed to whoever
// created the request, distinct from self-regeneration's required-comment rule.
const bodySchema = z.object({
  reason: z.string().trim().min(10, "A real reason is required (at least 10 characters)."),
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
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "A reason is required." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Allowed from needs_human_attention too, not just pending_approval - a Pass 2
  // cap-reached dead end (Workflow D) deserves the same "give up on this, with a
  // reason" escape hatch as a Pass 1 one always has.
  const { data: updatedRequest, error: transitionError } = await admin
    .from("requests")
    .update({ status: "rejected" })
    .eq("id", requestId)
    .in("status", ["pending_approval", "needs_human_attention"])
    .select()
    .single();

  if (transitionError || !updatedRequest) {
    return NextResponse.json(
      { error: "This request is not awaiting review (already progressed, or refresh to see the latest)." },
      { status: 409 }
    );
  }

  await logEvent({
    requestId,
    stage: "approval",
    status: "failed",
    detail: `Rejected: ${parsed.data.reason}`,
  });

  return NextResponse.json({ ok: true });
}
