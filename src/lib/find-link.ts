// Finds a link in text that is supposed to be prose.
//
// Used by the settings fields that feed the model directly: tone samples and audience
// profiles. Neither is ever fetched. The characters stored there are handed to the
// writer as "this is the voice" and "this is who you are writing for", and to the
// evaluator as what Tone and Audience Fit are graded against, so a URL sitting in one
// of those fields is not a reference to content, it IS the content as far as the
// model is concerned.
//
// It could not be followed even if something tried: a paywalled article refuses the
// fetch outright, and a social post behind a sign-in returns a login wall.
const SCHEME = /\bhttps?:\/\/\S+/i;
const PROTOCOL_RELATIVE = /(^|\s)\/\/[a-z0-9-]+\.[a-z]{2,}/i;
const WWW = /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;

// A bare domain with no scheme. Deliberately a fixed list of common TLDs rather than
// "any dot followed by letters", which would match an ordinary sentence ending in a
// full stop, a file name, or a version number like PostgreSQL 16.2.
const BARE_DOMAIN =
  /\b[a-z0-9][a-z0-9-]*\.(com|net|org|io|ai|co|dev|app|xyz|me|so|uk|us|gg|to|ly|sh|tech|news|blog)(\/\S*)?\b/i;

/**
 * The link found in the text, or null when there is none.
 *
 * Known cost, accepted deliberately: a genuine post that happens to mention a product
 * by domain ("we moved off Notion.so") is refused too. For a field whose entire job is
 * to carry voice, refusing a real post with a link in it is a smaller harm than
 * accepting a link with no post around it.
 */
export function findLink(content: string): string | null {
  const text = String(content ?? "");
  for (const pattern of [SCHEME, PROTOCOL_RELATIVE, WWW, BARE_DOMAIN]) {
    const match = pattern.exec(text);
    if (match) return match[0].trim();
  }
  return null;
}

export const TONE_SAMPLE_LINK_MESSAGE =
  "Links aren't read. Paste the words of the post itself, with any links taken out.";

export const AUDIENCE_LINK_MESSAGE =
  "Links aren't read. Describe the audience in your own words instead.";
