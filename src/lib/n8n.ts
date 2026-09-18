import { logEvent } from "@/lib/events";
import { createAdminClient } from "@/lib/supabase/admin";

// Every trigger below sets a "working" status on the request first, then fires the
// webhook from after(). Each workflow has its own failure handler that reverts that
// status - but those only run if n8n actually receives the call. When the trigger
// itself fails (n8n down, a 500 before the workflow starts), nothing reverted and
// the request was stranded in a working status with no recovery UI at all. Caught
// live: a wf-b 500 left a request at 'generating' forever with no retry offered.
// This is the client-side mirror of each workflow's own revert.
type Revert = {
  /** Only revert from the exact status this trigger set - never clobber a state something else moved on to. */
  from: string;
  to: string;
  /** Match Workflow B's handler, which also releases the angle so it can be re-picked. */
  unchooseAngles?: boolean;
};

async function revertOnTriggerFailure(requestId: string, revert: Revert | undefined) {
  if (!revert) return;
  const admin = createAdminClient();
  const { data } = await admin
    .from("requests")
    .update({ status: revert.to })
    .eq("id", requestId)
    .eq("status", revert.from)
    .select()
    .maybeSingle();

  // Only touch the angle if the status revert actually applied - if it didn't, the
  // request moved on under us and its angle is none of our business.
  if (data && revert.unchooseAngles) {
    await admin.from("angles").update({ chosen: false }).eq("request_id", requestId);
  }
}

// Statuses a proxy or gateway returns when it gives up on a connection it is only
// relaying. None of them come from n8n's webhook, so none of them tell us whether
// the workflow is running.
const GATEWAY_TIMEOUTS = new Set([408, 502, 503, 504, 522, 523, 524]);

async function pingWebhook(
  path: string,
  body: Record<string, unknown>,
  requestId: string,
  stage: string,
  revert?: Revert
) {
  const base = process.env.N8N_BASE_URL;
  if (!base) {
    await revertOnTriggerFailure(requestId, revert);
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
    // A gateway timeout is not a trigger failure. n8n.cloud's gateway cuts the
    // connection at roughly 100 seconds (limitation #93) while the workflow carries
    // on running, so on any long workflow this fired routinely: it reverted the
    // status out from under a run that was still going, and logged "Nothing was
    // generated, so it's safe to try again" when something very much was being
    // generated. Acting on that message starts a SECOND run against the same
    // request. Seen live on a Champions League adaptation: 524 logged at 10:37, the
    // same run completed at 10:39.
    //
    // These codes are emitted by something between us and n8n, never by n8n's own
    // webhook, so they say nothing about whether the workflow started. Everything
    // else (a 404 on a bad path, a 500 before the workflow runs) genuinely means it
    // did not, and still reverts.
    if (GATEWAY_TIMEOUTS.has(res.status)) {
      await logEvent({
        requestId,
        stage,
        status: "failed",
        detail: `The connection to n8n timed out (${res.status}) waiting for ${path}. This usually means the run is still going rather than that it failed: give it a few minutes and check back before retrying, because retrying now would start a second run alongside the first.`,
      });
    } else if (!res.ok) {
      await revertOnTriggerFailure(requestId, revert);
      await logEvent({
        requestId,
        stage,
        status: "failed",
        detail: `n8n webhook ${path} responded ${res.status}. Nothing was generated, so it's safe to try again.`,
      });
    }
  } catch (err) {
    // Same distinction one level down. A refused or unresolvable connection never
    // reached n8n, so reverting is right. A timeout means we stopped listening to a
    // request that was very likely delivered, so it is not safe to assume nothing
    // started.
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code ?? (err as { code?: string })?.code ?? "";
    const timedOut = /timeout|timed out|aborted/i.test(message) || /TIMEOUT|ETIMEDOUT|ABORT/i.test(code);

    if (timedOut) {
      await logEvent({
        requestId,
        stage,
        status: "failed",
        detail: `The connection to n8n timed out waiting for ${path} (${message}). The run may well still be going: check back before retrying, because retrying now would start a second run alongside the first.`,
      });
    } else {
      await revertOnTriggerFailure(requestId, revert);
      await logEvent({
        requestId,
        stage,
        status: "failed",
        detail: `n8n webhook ${path} unreachable: ${message}`,
      });
    }
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

// Path A: raw idea, no URL - kicks off search for candidate sources.
export function triggerSearchSources(requestId: string) {
  return pingWebhook("wf-a-search", { request_id: requestId }, requestId, "research_search_trigger");
}

// Path B (right after intake), or Path A continuation (after human selects sources) - // scrapes selected sources and proposes an angle.
export function triggerScrapeAndProposeAngle(requestId: string) {
  return pingWebhook(
    "wf-a-scrape-and-propose",
    { request_id: requestId },
    requestId,
    "scrape_and_propose_trigger"
  );
}

// Human picked an angle - extract excerpts scoped to it, generate the main block,
// evaluate against the Pass 1 rubric, and revise (capped at 2 rounds) if needed.
export function triggerGenerateAndEvaluate(
  requestId: string,
  angleId: string,
  spentRegeneration = false
) {
  return pingWebhook(
    "wf-b-generate-evaluate",
    { request_id: requestId, angle_id: angleId, spent_regeneration: spentRegeneration },
    requestId,
    "generate_and_evaluate_trigger",
    // Mirrors Workflow B's own failure handler, so a trigger that never reached
    // n8n leaves exactly the state a mid-run Claude failure would have.
    { from: "generating", to: "awaiting_angle_selection", unchooseAngles: true }
  );
}

// Human approved the article - adapt it into per-channel posts (LinkedIn/X/
// newsletter) and run the Pass 2 evaluation. Workflow D fetches everything else
// itself from the request_id, same as every other workflow trigger here.
export function triggerAdaptAndEvaluate(requestId: string) {
  return pingWebhook(
    "wf-d-adapt-evaluate",
    { request_id: requestId },
    requestId,
    "adapt_and_evaluate_trigger",
    // 'approved' is what the Retry adaptation button keys off (see
    // channel-posts-review.tsx), and what Workflow D's own handler reverts to.
    { from: "adapting", to: "approved" }
  );
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
// needs_human_attention article - reuses the existing chosen angle and excerpts,
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
    "regenerate_trigger",
    // priorStatus is already tracked for exactly this purpose - the workflow uses it
    // to revert on a Claude failure, and the same value is right when the trigger
    // never lands. (The attempt isn't consumed either: regenerate/route.ts only
    // increments the count inside the workflow, not here.)
    { from: "generating", to: priorStatus }
  );
}
