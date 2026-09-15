import { logEvent } from "@/lib/events";

async function pingWebhook(path: string, body: Record<string, unknown>, requestId: string, stage: string) {
  const base = process.env.N8N_BASE_URL;
  if (!base) {
    await logEvent({
      requestId,
      stage,
      status: "failed",
      detail: "N8N_BASE_URL is not configured.",
    });
    return;
  }

  try {
    const res = await fetch(`${base}/webhook/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      await logEvent({
        requestId,
        stage,
        status: "failed",
        detail: `n8n webhook ${path} responded ${res.status}.`,
      });
    }
  } catch (err) {
    await logEvent({
      requestId,
      stage,
      status: "failed",
      detail: `n8n webhook ${path} unreachable: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// Path A: raw idea, no URL — kicks off search for candidate sources.
export function triggerSearchSources(requestId: string) {
  return pingWebhook("wf-a-search", { request_id: requestId }, requestId, "research_search_trigger");
}

// Path B (right after intake), or Path A continuation (after human selects sources) —
// scrapes selected sources and proposes an angle.
export function triggerScrapeAndProposeAngle(requestId: string) {
  return pingWebhook(
    "wf-a-scrape-and-propose",
    { request_id: requestId },
    requestId,
    "scrape_and_propose_trigger"
  );
}
