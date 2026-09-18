// Evaluation rows are written by five different places (Workflows B, C, D, E and the
// in-app revise route), and a nested value has arrived as a JSON string from every
// model call in this project at least once. A row written wrong is permanent: it sits
// in the database and crashes the page on every render until someone repairs it, which
// is exactly what a stringified suggestions array did to the X tab.
//
// So reads are tolerant as well as writes being careful. Rendering something odd is
// always better than a runtime TypeError that takes out the whole request page.
export function asList<T = string>(value: unknown): T[] {
  let v = value;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [v as unknown as T];
    }
  }
  if (Array.isArray(v)) return v as T[];
  if (v && typeof v === "object") return Object.values(v) as T[];
  return [];
}
