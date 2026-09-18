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

// Hard platform limits. X is per-post in a thread, not for the thread as a whole.
// LinkedIn's is the post body cap. Newsletter has no platform limit (length is a
// quality judgment the rubric already makes), so it is deliberately absent rather
// than given an invented number.
export const CHANNEL_CHAR_LIMITS: Record<string, number> = {
  x: 280,
  linkedin: 3000,
};

export type LengthViolation = { label: string; length: number; limit: number };

// One source of truth for both the review UI and the schedule route, so what the
// human is shown and what the server enforces can never drift apart.
export function findLengthViolations(channel: string, body: string): LengthViolation[] {
  const limit = CHANNEL_CHAR_LIMITS[channel];
  if (!limit) return [];

  if (channel === "x") {
    return parseXPosts(body)
      .map((post, i) => ({ label: `Post ${i + 1}`, length: post.length, limit }))
      .filter((v) => v.length > limit);
  }

  return body.length > limit ? [{ label: "Post", length: body.length, limit }] : [];
}

// How a stored post is presented TO AN EVALUATOR. This is not cosmetic. An X thread
// is stored as a JSON array, and handing that array to the evaluator in its raw or
// naively-joined form makes it score our serialization as if the writer had chosen
// it:
//
//   - joined with "\n\n---\n\n", Pass 2 deducted Channel Fit for "'---' horizontal
//     rules as section dividers... a newsletter/blog or Markdown convention, not
//     native X". No stored post has ever contained a '---'. That separator was ours.
//   - handed the raw JSON string, the evaluator sees brackets, quotes and escaped
//     newlines as post content.
//
// Labelled per post with its character count instead, which is what Workflow D's
// Pass 2 already does correctly, and which tells the evaluator the structure
// explicitly rather than encoding it in punctuation it has to guess about.
export function formatForEvaluator(channel: string, storedBody: string): string {
  if (channel === "x") {
    const posts = parseXPosts(storedBody);
    const limit = CHANNEL_CHAR_LIMITS.x;
    return posts
      .map(
        (p, i) =>
          `Post ${i + 1} of ${posts.length} (${p.length} characters${p.length > limit ? `, OVER the ${limit} limit` : ""}):\n${p}`
      )
      .join("\n\n");
  }
  if (channel === "newsletter") {
    const { subject_line, body_markdown } = parseNewsletter(storedBody);
    return `Subject line: ${subject_line}\n\nBody:\n${body_markdown}`;
  }
  return storedBody;
}
