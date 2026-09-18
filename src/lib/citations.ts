// The writer is told to cite inline as [Source: url] so that every claim can be traced
// back to the excerpt it came from, and the evaluator checks exactly that. The cost is
// that a full URL lands mid-sentence, repeatedly, and at that density it stops being
// provenance and starts being noise: a 200-word paragraph carrying four copies of the
// same 90-character link reads worse than the same paragraph with none.
//
// So the trail stays in the stored text, which is what the evaluator scores and what
// gets re-checked on every edit, and the READER gets numbered references instead. This
// is a display transform: nothing is rewritten in the database, and dropping it would
// restore the raw text exactly.

export type Citation = { number: number; url: string; label: string };

/** "sports.yahoo.com/articles/manchester-..." becomes "sports.yahoo.com". */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Matches the shapes the model actually produces: "(Source: url)" and "[Source: url]",
// with or without the space, and tolerates a trailing full stop inside the bracket.
const CITATION = /[([]\s*Source:\s*(https?:\/\/[^\s)\]]+?)\s*\.?\s*[)\]]/gi;

export function extractCitations(markdown: string): {
  body: string;
  citations: Citation[];
} {
  const order: string[] = [];

  const body = markdown.replace(CITATION, (_match, rawUrl: string) => {
    const url = rawUrl.replace(/[.,;]+$/, "");
    let index = order.indexOf(url);
    if (index === -1) {
      order.push(url);
      index = order.length - 1;
    }
    // A marker rather than a link: this runs before markdown rendering, and the
    // numbered list below is where the href belongs, so a reader scanning the prose
    // is not stepping over a link on every other line.
    return `[${index + 1}]`;
  });

  return {
    body,
    citations: order.map((url, i) => ({ number: i + 1, url, label: domainOf(url) })),
  };
}
