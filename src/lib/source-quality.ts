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
  kind:
    | "video"
    | "homepage"
    | "listing"
    | "commercial"
    | "social"
    | "paywall"
    | "shortener"
    | "lookalike"
    | "download";
  /** "weak" means it usually cannot support claims. "check" means look before relying on it. */
  severity: "weak" | "check";
  label: string;
  message: string;
};

const VIDEO_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "tiktok.com", "dailymotion.com"];
const SOCIAL_HOSTS = ["twitter.com", "x.com", "facebook.com", "instagram.com", "threads.net", "reddit.com"];
// Sites that meter or wall their articles. A scrape of one of these usually succeeds
// and returns the teaser: a headline, the first paragraph or two, and a subscribe
// prompt. That is the worst failure shape in this system, because nothing reports an
// error. The excerpt step then quotes an intro as though it were the argument, and the
// draft is grounded in a fragment.
//
// A list of domains is a blunt instrument and deliberately only warns: metering means
// some of these are readable some of the time, and a scraper can get through. It
// exists so the human knows what they are likely to get before they spend a scrape on
// it, not to refuse the source.
const PAYWALL_HOSTS = [
  "nytimes.com", "ft.com", "wsj.com", "economist.com", "bloomberg.com", "washingtonpost.com",
  "thetimes.co.uk", "telegraph.co.uk", "newyorker.com", "theatlantic.com", "wired.com",
  "hbr.org", "businessinsider.com", "medium.com", "seekingalpha.com", "barrons.com",
  "foreignaffairs.com", "thetimes.com", "afr.com", "theinformation.com",
];

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

  if (PAYWALL_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    return {
      kind: "paywall",
      severity: "check",
      label: "Likely paywalled",
      message:
        "This site usually meters or walls its articles. A scrape often succeeds and returns only the opening paragraphs and a subscribe prompt, which reads as a real source but cannot support a claim. Check what actually came back before relying on it.",
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
    const issue = assessSourceUrl(url) ?? suspiciousSourceUrl(url);
    if (issue && !byKind.has(issue.kind)) byKind.set(issue.kind, issue);
  }
  return [...byKind.values()];
}

// What a paywall teaser looks like AFTER scraping, which is the only reliable signal:
// the domain list above is a guess, this is evidence. Checked on the request page once
// scraped_text exists, so a source that scraped "successfully" into 400 characters and
// a subscribe prompt is visible as such rather than being quietly quoted as though it
// were the article.
const PAYWALL_PHRASES = [
  "subscribe to continue",
  "already a subscriber",
  "subscribers only",
  "to continue reading",
  "create a free account",
  "sign in to read",
  "this article is for subscribers",
  "start your free trial",
  "register to continue",
];

/** Roughly 400 words. Below this, an article page has almost certainly been truncated. */
const THIN_SCRAPE_CHARS = 2200;

export function looksPaywalled(scrapedText: string | null | undefined): {
  thin: boolean;
  phrase: string | null;
} {
  const text = (scrapedText ?? "").trim();
  if (!text) return { thin: false, phrase: null };
  const lowered = text.toLowerCase();
  const phrase = PAYWALL_PHRASES.find((p) => lowered.includes(p)) ?? null;
  return { thin: text.length < THIN_SCRAPE_CHARS, phrase };
}

// ---------------------------------------------------------------------------
// Refusals, as opposed to the warnings above.
//
// Everything else in this file advises; this part blocks. The distinction matters
// because a stored URL is eventually fetched by n8n's scraper from a server, not by
// the person who typed it. That makes the source list a server-side request
// primitive: whatever goes in here, something on the network will go and GET.
// ---------------------------------------------------------------------------

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^0\./,
  /^192\.168\./,
  /^169\.254\./, // link-local, which is how cloud metadata is usually reached
  /^172\.(1[6-9]|2\d|3[01])\./,
];

function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return true;
  }
  if (host === "::1" || host === "[::1]" || host.startsWith("fd") || host.startsWith("fe80")) return true;
  return PRIVATE_V4.some((re) => re.test(host));
}

/** A bare IPv4 address, which a real article almost never lives on. */
function isIpLiteral(host: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
}

/**
 * Why a URL must not be stored or scraped at all, or null if it is acceptable.
 *
 * Deliberately strict: each of these is a URL a content researcher has no legitimate
 * reason to submit, and several of them are how a fetch-on-behalf-of-the-server
 * becomes a way to read things the server can see and the user cannot.
 */
export function blockSourceUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return "That is not a valid URL.";
  }

  // https only. http is trivially intercepted and rewritten in transit, and what comes
  // back becomes source material a draft is grounded in.
  if (url.protocol !== "https:") {
    return url.protocol === "http:"
      ? "Only https links can be used as sources. Try the https version of this address."
      : `Only https links can be used as sources (this one is ${url.protocol.replace(":", "")}).`;
  }

  // Credentials in the URL would be sent to the scraper and stored in plain text.
  if (url.username || url.password) {
    return "Remove the username and password from this URL before using it as a source.";
  }

  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (isPrivateHost(host)) {
    return "That address points inside a private network, so it cannot be fetched or used as a source.";
  }

  if (host.endsWith(".onion") || host.endsWith(".i2p")) {
    return "That address is not reachable from here, so it cannot be used as a source.";
  }

  if (isIpLiteral(host)) {
    return "Use the site's domain name rather than a raw IP address.";
  }

  // 443 is implied by https; anything else on an https URL is unusual enough that it
  // is more likely to be an internal service than an article.
  if (url.port && url.port !== "443") {
    return `Sources have to be on the standard https port, not port ${url.port}.`;
  }

  return null;
}

const SHORTENER_HOSTS = [
  "bit.ly", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "buff.ly", "rebrand.ly",
  "is.gd", "cutt.ly", "shorturl.at", "lnkd.in",
];

/**
 * Sketchy but not refused: the destination is hidden or the page is unlikely to be an
 * article. Warned about for the same reason as everything else in this file, because
 * a legitimate use exists for each of them.
 */
export function suspiciousSourceUrl(rawUrl: string): SourceIssue | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (SHORTENER_HOSTS.some((h) => host === h || host.endsWith("." + h))) {
    return {
      kind: "shortener",
      severity: "check",
      label: "Shortened link",
      message:
        "A shortened link hides where it actually goes, and what gets scraped is whatever it redirects to on the day. Paste the real article URL so the source stays checkable later.",
    };
  }

  // Punycode: a domain that renders as familiar letters but is not the site it looks
  // like. Rare in honest use, standard in impersonation.
  if (host.split(".").some((part) => part.startsWith("xn--"))) {
    return {
      kind: "lookalike",
      severity: "check",
      label: "Lookalike domain",
      message:
        "This domain uses characters that can render as a different, more familiar name. Check it really is the site you meant before using it as a source.",
    };
  }

  if (/\.(exe|zip|dmg|apk|msi|bin|iso)$/i.test(url.pathname)) {
    return {
      kind: "download",
      severity: "weak",
      label: "File download",
      message: "That link points at a file download rather than an article, so there is nothing to read from it.",
    };
  }

  return null;
}
