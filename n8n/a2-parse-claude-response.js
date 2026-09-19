// Replacement code for the "A2 · Parse Claude Response" node in n8n.
//
// Workflow A is hand-built rather than generated, so this cannot be emitted by a
// build script: paste it into that node's Code field.
//
// WHY: Claude intermittently leaks its own tool-call scaffolding into a string value
// instead of closing the call cleanly. Caught live on a URL-path request, where
// resonance_reasoning ended:
//
//   ...so it was excluded as a match.</resonance_reasoning>
//   <parameter name="sources_support_idea">true
//
// The model had answered `true`. Because the text landed inside the previous field,
// `sources_support_idea` arrived undefined, and the hard-block IF treats undefined as
// false under loose type validation. A request scoring 12/15 was refused with "The
// sources do not support this idea", which is the opposite of what the model said.
//
// Same failure class as the `</invoke>` leak in Workflow D (Error #41) and the
// JSON-string-instead-of-array leaks everywhere else: the model returns something
// structurally wrong and the boundary has no tolerance for it.

const toolUse = $json.content.find((c) => c.type === "tool_use");
const result = toolUse.input;
const requestId = $("A2 · Fetch Request Row").first().json.id;

// Claude intermittently returns a nested tool-input value as a JSON string rather
// than nesting it - confirmed live on Workflow B's excerpts and three times on
// Workflow D's per_channel/channels.
let angles = result.angles;
if (typeof angles === "string") {
  try {
    angles = JSON.parse(angles);
  } catch {
    angles = [];
  }
}
if (!Array.isArray(angles)) angles = [];
angles = angles.filter((a) => a && typeof a === "object");

// Recover any field that leaked into another field's text as scaffolding, and strip
// that scaffolding out of the text it landed in.
const recovered = {};
for (const [key, value] of Object.entries(result)) {
  if (typeof value !== "string") continue;
  const matcher = /<parameter\s+name="([a-z_]+)"\s*>\s*([^<\n]*)/gi;
  let m;
  while ((m = matcher.exec(value)) !== null) {
    recovered[m[1]] = m[2].trim();
  }
  // Everything from the first closing tag onwards is scaffolding, not prose.
  const cut = value.search(/<\/[a-z_]+>/i);
  if (cut !== -1) result[key] = value.slice(0, cut).trim();
}

const asBool = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return null;
};

let sourcesSupportIdea = asBool(result.sources_support_idea);
if (sourcesSupportIdea === null) sourcesSupportIdea = asBool(recovered.sources_support_idea);

// Still unknown after recovery. Do NOT hard-block on it: the resonance score is a
// real judgement and is still enforced on its own, whereas refusing a run because a
// field could not be parsed punishes the human for the model's formatting. Flagged so
// the log says what happened rather than inventing an answer.
const supportIndeterminate = sourcesSupportIdea === null;
if (supportIndeterminate) sourcesSupportIdea = true;

const score = Number(result.resonance_score);

return [
  {
    json: {
      requestId,
      ...result,
      angles,
      resonance_score: Number.isFinite(score) ? score : null,
      sources_support_idea: sourcesSupportIdea,
      support_indeterminate: supportIndeterminate,
    },
  },
];
