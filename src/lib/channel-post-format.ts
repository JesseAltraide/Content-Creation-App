// x posts and the newsletter's subject+body pair are stored as JSON-stringified
// structures in the same plain `body` column (a plain text column can't hold a
// thread array or a subject+body pair cleanly - see Workflow D's Insert Channel
// Posts notes). Parsing is tolerant of failure so a malformed or legacy row still
// renders as something rather than crashing the page.
export function parseXPosts(body: string): string[] {
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [body];
  } catch {
    return [body];
  }
}

export function parseNewsletter(body: string): { subject_line: string; body_markdown: string } {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "body_markdown" in parsed) return parsed;
  } catch {
    // fall through
  }
  return { subject_line: "", body_markdown: body };
}

export const CHANNEL_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X",
  newsletter: "Newsletter",
};

// Pass 2's own rubric (week4-full-flow.md) - different criteria and floors from
// Pass 1's article rubric (Topic Relevance/SEO Fit/Completeness don't apply
// post-adaptation).
export const PASS2_CRITERION_FLOORS: Record<string, number> = {
  "factual consistency": 15,
  tone: 10,
  "channel fit": 10,
  "audience fit": 6,
  clarity: 6,
};

export function floorForPass2Criterion(name: string): number | undefined {
  return PASS2_CRITERION_FLOORS[name.trim().toLowerCase()];
}
