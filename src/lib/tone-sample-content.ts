// A tone sample is the actual words of a post, pasted in. Not a link to one.
//
// Nothing in this system fetches a tone sample: the text is read straight out of the
// database and put in front of the writer and the evaluator as "this is the voice".
// A link stored there teaches nothing, and worse, it teaches something wrong, because
// the model grades Tone against whatever characters are sitting in that field.
//
// The old rule only refused a sample that was EXACTLY one bare URL and nothing else,
// so "have a look at this https://linkedin.com/posts/abc" sailed through and became a
// tone reference.
const SCHEME = /\bhttps?:\/\/\S+/i;
const PROTOCOL_RELATIVE = /(^|\s)\/\/[a-z0-9-]+\.[a-z]{2,}/i;
const WWW = /\bwww\.[a-z0-9-]+\.[a-z]{2,}/i;

// A bare domain with no scheme. Deliberately a fixed list of common TLDs rather than
// "any dot followed by letters", which would match an ordinary sentence ending in a
// full stop, a file name, or a version number like PostgreSQL 16.2.
const BARE_DOMAIN =
  /\b[a-z0-9][a-z0-9-]*\.(com|net|org|io|ai|co|dev|app|xyz|me|so|uk|us|gg|to|ly|sh|tech|news|blog)(\/\S*)?\b/i;

/**
 * The link found in a tone sample, or null when there is none.
 *
 * Known cost, accepted deliberately: a genuine post that happens to mention a product
 * by domain ("we moved off Notion.so") is refused too. For a field whose entire job is
 * to carry voice, refusing a real post with a link in it is a smaller harm than
 * accepting a link with no post around it.
 */
export function findLinkInToneSample(content: string): string | null {
  const text = String(content ?? "");
  for (const pattern of [SCHEME, PROTOCOL_RELATIVE, WWW, BARE_DOMAIN]) {
    const match = pattern.exec(text);
    if (match) return match[0].trim();
  }
  return null;
}

export const TONE_SAMPLE_LINK_MESSAGE =
  "Links aren't read. Paste the words of the post itself, with any links taken out.";
