// What we can tell about a source from its URL alone, before anything is fetched.
//
// This matters because of WHEN curation happens: on the raw-idea path the human picks
// from candidate sources that have only a url and a title, since scraped_text is not
// written until after they choose. So anything that needs the page body (a publication
// date, a word count, whether five results are the same syndicated story) cannot be
// checked at the moment the human is actually deciding. URL shape can, and it catches
// the cases that produced the worst drafts in testing.
//
// Warnings, never blocks. A transcript page on a video host, or a hub page that really
// does carry an article, are both plausible, and refusing a source the human chose
// deliberately is worse than telling them what they are about to get.

export type SourceIssue = {
  kind: "video" | "homepage" | "listing" | "commercial" | "social";
  /** "weak" means it usually cannot support claims. "check" means look before relying on it. */
  severity: "weak" | "check";
  label: string;
  message: string;
};

const VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "dailymotion.com"];
const SOCIAL_HOSTS = ["twitter.com", "x.com", "facebook.com", "instagram.com", "threads.net", "reddit.com"];
const LISTING_SEGMENTS = ["tag", "tags", "category", "categories", "topic", "topics", "author", "search", "archive", "overview"];
const COMMERCIAL_SEGMENTS = ["pricing", "plans", "checkout", "signup", "sign-up", "register", "cart", "contact"];

function hostOf(url: URL): string {
  return url.hostname.replace(/^www\./, "").toLowerCase();
}

export function assessSourceUrl(rawUrl: string): SourceIssue | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = hostOf(url);
  const segments = url.pathname.split("/").filter(Boolean);

  // A scraper reads the page, not the video. What comes back is a title, a
  // description and whatever caption text the host renders, which is why a derby
  // video produced "excerpts" that could not establish whether two incidents were
  // the same event.
  if (VIDEO_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    return {
      kind: "video",
      severity: "weak",
      label: "Video",
      message:
        "Scraping a video page gets the title and description, not what is said in the video, so claims drawn from it are usually thin and hard to verify. Prefer an article that reports the same thing.",
    };
  }

  if (SOCIAL_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    return {
      kind: "social",
      severity: "weak",
      label: "Social post",
      message:
        "Social pages are mostly rendered after load and are often behind a login, so a scrape typically returns little usable text.",
    };
  }

  // No path at all: the front page. Its content is whatever was current when it was
  // fetched, which makes any claim drawn from it undateable by construction.
  //
  // A lone locale segment counts too. manutd.com/en is the club's front page, and it
  // was in the source set that produced a draft arguing with itself about which
  // season it was describing.
  const localeOnly =
    segments.length === 1 && /^[a-z]{2}([-_][a-z]{2})?$/i.test(segments[0]);
  if (segments.length === 0 || localeOnly) {
    return {
      kind: "homepage",
      severity: "weak",
      label: "Homepage",
      message:
        "This is a site's front page, not an article. What it says changes over time, so anything taken from it cannot be dated or checked later. Link the specific article instead.",
    };
  }

  const lowered = segments.map((s) => s.toLowerCase());

  // A hub of headlines, or a live-updating stats or overview page. Extraction gets
  // fragments with no argument behind them, and a standings snapshot with no date is
  // exactly what made the Manchester United draft contradict itself.
  if (lowered.some((s) => LISTING_SEGMENTS.includes(s)) || lowered[lowered.length - 1] === "overview") {
    return {
      kind: "listing",
      severity: "check",
      label: "Listing or overview page",
      message:
        "This looks like a listing, hub or overview page rather than one article. Those are usually headlines or live-updating figures with no publication date, so claims from them cannot be tied to a moment in time.",
    };
  }

  if (lowered.some((s) => COMMERCIAL_SEGMENTS.includes(s))) {
    return {
      kind: "commercial",
      severity: "check",
      label: "Marketing page",
      message: "Pricing and sign-up pages are marketing copy, so there is rarely a claim worth citing on them.",
    };
  }

  return null;
}

/** Issues across a set of URLs, deduplicated by kind so a list of ten does not shout ten times. */
export function assessSourceUrls(urls: string[]): SourceIssue[] {
  const byKind = new Map<string, SourceIssue>();
  for (const url of urls) {
    const issue = assessSourceUrl(url);
    if (issue && !byKind.has(issue.kind)) byKind.set(issue.kind, issue);
  }
  return [...byKind.values()];
}
