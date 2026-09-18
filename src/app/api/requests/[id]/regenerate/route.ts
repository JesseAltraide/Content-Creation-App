import { NextResponse, after } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";
import { triggerRegenerate } from "@/lib/n8n";
import { REGENERATION_CAP } from "@/lib/regeneration";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

// Comment is mandatory (matches Decision #63's rule for every self-regeneration in
// this system, not just this one) - it's what gives the next generation something
// concrete to act on rather than blindly re-rolling.
const bodySchema = z.object({
  comment: z.string().trim().min(10, "A real comment is required (at least 10 characters)."),
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

  // Ownership (migration 007). 404 not 403: telling someone a request exists
  // but is not theirs still leaks that it exists.
  if (!(await userCanModifyRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "A comment is required." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Read the current status/count only to know what to revert to and what count to
  // write - the actual transition below is still a single atomic conditional write
  // guarded on both the exact status AND the exact prior count, so a concurrent
  // double-click can't both succeed (optimistic concurrency, not read-then-write).
  const { data: current } = await admin
    .from("requests")
    .select("status, regeneration_count")
    .eq("id", requestId)
    .single();

  if (!current || !["pending_approval", "needs_human_attention"].includes(current.status)) {
    return NextResponse.json(
      { error: "This request is not awaiting review (already progressed, or refresh to see the latest)." },
      { status: 409 }
    );
  }
  if (current.regeneration_count >= REGENERATION_CAP) {
    return NextResponse.json(
      {
        error:
          "Regeneration limit (5 attempts) reached for this article. Reject it or go back to angle selection instead.",
      },
      { status: 409 }
    );
  }

  const priorStatus = current.status;
  // The count that THIS attempt would become if Claude actually gets called - used
  // to tell the workflow whether a failure here should be the final one, and for the
  // log message below. NOT written yet: regeneration_count only actually advances
  // inside the n8n workflow itself, right before the Claude call. If nothing gets
  // that far (e.g. a bad credential on an earlier Supabase fetch, exactly what broke
  // during testing), no attempt should be consumed at all - the status-only revert
  // below already gives a free retry for that case.
  const wouldBeCount = current.regeneration_count + 1;

  // Atomic conditional write on status only - regeneration_count isn't touched here,
  // so this can't double-consume an attempt; it's purely the concurrency guard that
  // stops two double-clicks from both proceeding.
  const { data: updatedRequest, error: transitionError } = await admin
    .from("requests")
    .update({ status: "generating" })
    .eq("id", requestId)
    .eq("status", priorStatus)
    .select()
    .single();

  if (transitionError || !updatedRequest) {
    return NextResponse.json(
      { error: "Someone else just acted on this request. Refresh to see the latest." },
      { status: 409 }
    );
  }

  await logEvent({
    requestId,
    stage: "regeneration_requested",
    status: "success",
    detail: `Regenerate requested (would be attempt ${wouldBeCount}/${REGENERATION_CAP} if Claude is reached): ${parsed.data.comment}`,
  });

  // Not awaited - see approve/route.ts's comment on why.
  after(() => triggerRegenerate(requestId, parsed.data.comment, wouldBeCount >= REGENERATION_CAP, priorStatus));

  return NextResponse.json({ ok: true });
}
