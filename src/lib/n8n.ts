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

// Same as pingWebhook, but returns the workflow's own response body instead of
// discarding it - for the rare synchronous, interactive triggers (edit triage)
// where the human needs to see the actual outcome (blocked/saved/score), not just
// know that the request was sent.
async function pingWebhookForResult(
  path: string,
  body: Record<string, unknown>,
  requestId: string,
  stage: string
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const base = process.env.N8N_BASE_URL;
  if (!base) {
    await logEvent({ requestId, stage, status: "failed", detail: "N8N_BASE_URL is not configured." });
    return { ok: false, error: "N8N_BASE_URL is not configured." };
  }

  try {
    const res = await fetch(`${base}/webhook/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => undefined);
    if (!res.ok) {
      await logEvent({ requestId, stage, status: "failed", detail: `n8n webhook ${path} responded ${res.status}.` });
      return { ok: false, error: `n8n webhook responded ${res.status}.`, data };
    }
    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logEvent({ requestId, stage, status: "failed", detail: `n8n webhook ${path} unreachable: ${message}` });
    return { ok: false, error: message };
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

// Human approved the article — adapt it into per-channel posts (LinkedIn/X/
// newsletter) and run the Pass 2 evaluation. Workflow D fetches everything else
// itself from the request_id, same as every other workflow trigger here.
export function triggerAdaptAndEvaluate(requestId: string) {
  return pingWebhook("wf-d-adapt-evaluate", { request_id: requestId }, requestId, "adapt_and_evaluate_trigger");
}

// Human directly edited a channel post (never the article - it's locked once
// adaptation runs). Awaited, not fired via after() like the other triggers: this is
// a short, single-purpose interactive action (at most one Haiku call plus one Opus
// re-evaluation, not a multi-round pipeline), and the human expects to know
// immediately whether their edit was accepted, saved-as-is, or hard-blocked -
// unlike approve/regenerate/select-angle, which kick off genuinely long-running
// work the browser shouldn't have to wait on.
export function triggerEditTriage(requestId: string, channel: string, editedBody: string) {
  return pingWebhookForResult(
    "wf-e-edit-triage",
    { request_id: requestId, channel, edited_body: editedBody },
    requestId,
    "edit_triage_trigger"
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
