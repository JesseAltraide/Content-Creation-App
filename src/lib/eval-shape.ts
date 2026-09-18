// Evaluation rows are written by five different places (Workflows B, C, D, E and the
// in-app revise route), and a nested value has arrived as a JSON string from every
// model call in this project at least once. A row written wrong is permanent: it sits
// in the database and crashes the page on every render until someone repairs it, which
// is exactly what a stringified suggestions array did to the X tab.
//
// So reads are tolerant as well as writes being careful. Rendering something odd is
// always better than a runtime TypeError that takes out the whole request page.

/**
 * Last resort for a string that looks like a list but does not parse. Seen live:
 * `["first item"], "second item", "third item"` - the model closed the array after
 * one element and carried on. Treating that as a single item produced one bullet
 * containing 1,292 characters of text and JSON punctuation, which is technically
 * "not crashing" and useless to read. Pulling the quoted segments out recovers the
 * actual list.
 */
function quotedSegments(text: string): string[] {
  const matches = text.match(/"((?:[^"\\]|\\.)*)"/g);
  if (!matches || matches.length < 2) return [];
  const parsed: string[] = [];
  for (const m of matches) {
    try {
      const value = JSON.parse(m);
      if (typeof value === "string" && value.trim()) parsed.push(value);
    } catch {
      // Skip a segment that will not parse rather than losing the whole list.
    }
  }
  return parsed;
}

export function asList<T = string>(value: unknown): T[] {
  let v = value;

  if (typeof v === "string") {
    // Held separately because the assignment below widens the type, and the catch
    // branch still needs the original text to recover a list from.
    const original = v;
    try {
      v = JSON.parse(original);
    } catch {
      const recovered = quotedSegments(original);
      return (recovered.length > 0 ? recovered : [original]) as unknown as T[];
    }
  }

  if (Array.isArray(v)) {
    // A one-element array whose only element is itself an unparsed list: what a
    // well-meaning repair produces when it wraps a malformed string.
    const only = v[0];
    if (v.length === 1 && typeof only === "string") {
      const recovered = quotedSegments(only);
      if (recovered.length > 1) return recovered as unknown as T[];
    }
    return v as T[];
  }

  if (v && typeof v === "object") return Object.values(v) as T[];
  return [];
}
