// Plain-English translations for the retry banner shown to the human. The technical
// detail (exact stage, raw error) still lives in the collapsed Technical log below —
// this is only ever the headline, never the only place the real detail is recorded.
const STAGE_MESSAGES: Record<string, string> = {
  research_search_trigger: "Searching for sources failed. Try again.",
  scrape_and_propose_trigger: "Generating your angle failed. Try again.",
};

export function friendlyStageMessage(stage: string): string {
  return STAGE_MESSAGES[stage] ?? "Something went wrong on that step. Try again.";
}
