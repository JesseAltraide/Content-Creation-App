import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

// Workflow A1's success path is Insert Candidate Sources -> Mark Awaiting Selection
// -> Respond, and only the first of those has any failure handling. When the middle
// step does not take effect, the sources are sitting in the table ready to pick while
// the request still says 'researching', with no failed event logged, so nothing
// flips it to needs_human_attention and nothing tells the human either. Caught live:
// 8 sources inserted, status unchanged, log silent.
//
// The n8n-side fix is a handler on that branch, which needs a reimport. This is the
// app-side recovery for the state that already exists: it only ever moves a request
// to where the data says it already is, so it cannot invent progress.
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

  const { count: pendingSources } = await admin
    .from("sources")
    .select("id", { count: "exact", head: true })
    .eq("request_id", requestId)
    .eq("status", "pending_selection");

  if (!pendingSources) {
    return NextResponse.json(
      { error: "There are no candidate sources waiting on this request, so there's nothing to continue to." },
      { status: 409 }
    );
  }

  // Guarded on 'researching' so this can only ever fix the stuck case, never pull a
  // request backwards from a stage it has legitimately moved on to.
  const { data: updated, error } = await admin
    .from("requests")
    .update({ status: "awaiting_source_selection" })
    .eq("id", requestId)
    .eq("status", "researching")
    .select()
    .single();

  if (error || !updated) {
    return NextResponse.json(
      { error: "This request isn't waiting on research any more. Refresh to see where it got to." },
      { status: 409 }
    );
  }

  await logEvent({
    requestId,
    stage: "research_search_trigger",
    status: "success",
    detail: `Continued to source selection: ${pendingSources} candidate source(s) had been saved, but the run did not mark the request as awaiting selection.`,
  });

  return NextResponse.json({ ok: true, sources: pendingSources });
}
