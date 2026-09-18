import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanAccessRequest } from "@/lib/request-access";
import { triggerSearchSources, triggerScrapeAndProposeAngle } from "@/lib/n8n";
import { logEvent } from "@/lib/events";

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
  if (!(await userCanAccessRequest(requestId, user.id))) {
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
