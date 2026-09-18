// Plain-English translations for banners shown to the human. The technical detail
// (exact stage, raw error) still lives in the collapsed Technical log below - this is
// only ever the headline, never the only place the real detail is recorded.
const STAGE_MESSAGES: Record<string, string> = {
  research_search_trigger: "Searching for sources failed. Try again.",
  scrape_and_propose_trigger: "Generating your angle failed. Try again.",
  excerpt_selection: "Selecting source excerpts failed. Pick the angle again to retry.",
  generation: "Writing the article failed. Pick the angle again to retry.",
  evaluation: "Evaluating the draft failed. Pick the angle again to retry.",
  revision: "Revising the draft failed. Pick the angle again to retry.",
  channel_adaptation: "Adapting to channels failed. Retry adaptation below.",
  // Trigger-stage failures: the workflow never started, so nothing was generated and
  // the request has already been reverted to where it was (see pingWebhook's revert).
  generate_and_evaluate_trigger: "Couldn't start generating. Pick the angle again to retry.",
  adapt_and_evaluate_trigger: "Couldn't start channel adaptation. Retry adaptation below.",
  regenerate_trigger: "Couldn't start regenerating. Try again.",
};

export function friendlyStageMessage(stage: string): string {
  return STAGE_MESSAGES[stage] ?? "Something went wrong on that step. Try again.";
}

// needs_human_attention is a genuine content-level dead end, not a transient failure - // the "why" is usually already a decent plain-English sentence (it's the detail we wrote
// to event_log ourselves), but it needs a concrete next action attached, not just a
// status badge and a buried log line.
export function explainNeedsAttention(stage: string, detail: string | null) {
  const why = detail ?? "This request needs a human decision before it can continue.";

  if (stage === "excerpt_selection") {
    return {
      why,
      action:
        "The sources don't actually support this angle. Try a different angle if one's available, or add a source that genuinely covers it.",
    };
  }
  if (stage === "evaluation") {
    return {
      why,
      action:
        "The draft couldn't pass evaluation even after revision. Try a different angle, or add stronger/more relevant sources before trying again.",
    };
  }
  if (stage === "angle_proposal") {
    return {
      why,
      action: "Try a different idea, or add sources that more directly support this one.",
    };
  }
  if (stage === "pass2_evaluation") {
    return {
      why,
      action:
        "At least one channel post couldn't pass Pass 2 evaluation even after revision. Reject and start channel adaptation over, or accept the current draft manually if it's close enough.",
    };
  }
  return { why, action: "Review the technical log below for the exact reason, then decide how to proceed." };
}
