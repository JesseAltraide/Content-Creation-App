import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { triggerSearchSources, triggerScrapeAndProposeAngle } from "@/lib/n8n";
import { logEvent } from "@/lib/events";
import { firedRecently } from "@/lib/debounce-trigger";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

// Re-triggers whichever stage the request was last attempting, without re-running
// anything that already succeeded (already-scraped sources stay scraped). Per the
// no-partial-progress rule: nothing in Supabase moved forward on the earlier
// failure, so retrying is just pinging the same webhook again.
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

  const { data: req } = await admin.from("requests").select("*").eq("id", requestId).single();
  if (!req) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (req.status !== "researching") {
    return NextResponse.json(
      { error: `Cannot retry from status "${req.status}".` },
      { status: 409 }
    );
  }

  // Retry deliberately leaves the status alone, so the conditional write that
  // protects every other action cannot protect this one. Each extra click is a
  // whole extra pipeline run, so a repeat within the window is treated as a double
  // click rather than a second intent.
  if (await firedRecently(requestId, ["research_search_trigger", "scrape_and_propose_trigger"], 30_000)) {
    return NextResponse.json(
      { error: "That retry is already running. Give it a moment before trying again." },
      { status: 429 }
    );
  }

  const { data: sources } = await admin
    .from("sources")
    .select("status")
    .eq("request_id", requestId);

  const pastSelectionStage =
    req.input_path === "url" ||
    (sources ?? []).some((s) => ["selected", "scraped", "scrape_failed"].includes(s.status));

  await logEvent({
    requestId,
    stage: pastSelectionStage ? "scrape_and_propose_trigger" : "research_search_trigger",
    status: "success",
    detail: "Retried by user after a previous failure.",
  });

  // Not awaited - see approve/route.ts's comment on why.
  if (pastSelectionStage) {
    after(() => triggerScrapeAndProposeAngle(requestId));
  } else {
    after(() => triggerSearchSources(requestId));
  }

  return NextResponse.json({ ok: true });
}
