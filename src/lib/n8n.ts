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

// Human picked an angle — extract excerpts scoped to it, generate the main block,
// evaluate against the Pass 1 rubric, and revise (capped at 2 rounds) if needed.
export function triggerGenerateAndEvaluate(requestId: string, angleId: string) {
  return pingWebhook(
    "wf-b-generate-evaluate",
    { request_id: requestId, angle_id: angleId },
    requestId,
    "generate_and_evaluate_trigger"
  );
}

// Human clicked Regenerate with a required comment on a pending_approval or
// needs_human_attention article — reuses the existing chosen angle and excerpts,
// re-runs generation + Pass 1 evaluation only (Workflow C, not the internal
// capped auto-revision loop). priorStatus lets the workflow revert to wherever
// the request actually started from on a Claude failure, not a hardcoded value.
export function triggerRegenerate(
  requestId: string,
  comment: string,
  isFinalAttempt: boolean,
  priorStatus: string
) {
  return pingWebhook(
    "wf-c-regenerate",
    { request_id: requestId, comment, is_final_attempt: isFinalAttempt, prior_status: priorStatus },
    requestId,
    "regenerate_trigger"
  );
}
