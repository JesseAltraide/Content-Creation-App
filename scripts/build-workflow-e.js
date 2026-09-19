// Authors n8n/workflow-e-edit-triage.json programmatically. Workflow E = "Channel
// Edit Triage" (week4-full-flow.md Decisions #45-47): a human directly edits a
// channel post (never the article - it locks permanently once adaptation is
// triggered, per Decisions #56/#221; only channel posts stay editable, including
// after approval - Decision #43). This is NOT another generate-and-evaluate
// workflow like A-D: it's a graduated diff-and-triage pipeline that decides
// WHETHER to re-run evaluation, never replaces or weakens the Pass 2 rubric itself
// when it does:
//   1. Deterministic word-diff against the last FULLY-EVALUATED version (not the
//      last saved edit - this is what makes the cumulative-drift guard, Decision
//      #47, work for free: as long as no full re-eval has run yet, every edit
//      keeps diffing against the same anchor, so several small edits compound
//      correctly instead of each looking individually harmless).
//   2. Mechanical pre-filters that force full re-evaluation regardless of size:
//      a changed numeral, a changed excerpt-cited sentence, a whole sentence
//      added/removed, or >~15% edit distance.
//   3. Only the ambiguous remainder goes to a cheap Haiku call for a binary
//      grammatical-vs-substantive classification, biased hard toward
//      "substantive" on any uncertainty (a wrong "grammatical" call silently
//      skips a real evaluation - the safe failure direction is re-evaluating
//      something that didn't need it, not the reverse).
//   4. Grammatical edits save in place, no new version, logged but not re-scored.
//   5. Substantive edits run the same single-channel Pass 2 rubric already used in
//      Workflow D (not a lighter check) - hard block on a floor failure (nothing
//      saved, human must fix/revert), otherwise a new version + evaluation row.
//
// Reuses every structural lesson from A-D (week4-progress.md Errors #3-#88):
// build Claude request bodies in a preceding Code node, onError:
// continueErrorOutput + a shared handler on every plain Supabase node AND every
// Code node from the start (not retrofitted after a live crash like B/C/D all
// needed), alwaysOutputData on legitimately-empty fetches.
"use strict";
const fs = require("fs");
const path = require("path");

const NL = String.fromCharCode(10);
const BSN = String.fromCharCode(92, 110);
const CREDS = require("./n8n-credentials");
const SUPABASE_CRED = CREDS.supabaseApi;
const ANTHROPIC_CRED = CREDS.anthropicApi;

const nodes = [];
const connections = {};

let xCursor = -500;
let currentLane = 0;
const X_STEP = 260;

function addNode(n) {
  n.position = n.position || [(xCursor += X_STEP), currentLane];
  nodes.push(n);
  return n;
}

function withLane(offset, fn) {
  const prev = currentLane;
  currentLane = offset;
  const savedX = xCursor;
  const result = fn();
  currentLane = prev;
  xCursor = Math.max(xCursor, savedX);
  return result;
}

function connect(fromName, toName, outputIndex = 0) {
  connections[fromName] = connections[fromName] || { main: [] };
  while (connections[fromName].main.length <= outputIndex) connections[fromName].main.push([]);
  connections[fromName].main[outputIndex].push({ node: toName, type: "main", index: 0 });
}

const FAILURE_HANDLER_NAME = "Triage Failure: Extract Error";

function supabaseGet(id, name, url, opts = {}) {
  const node = addNode({
    parameters: { url, options: {}, authentication: "predefinedCredentialType", nodeCredentialType: "supabaseApi" },
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    credentials: { supabaseApi: SUPABASE_CRED },
    alwaysOutputData: opts.alwaysOutputData ?? true,
    ...(opts.executeOnce ? { executeOnce: true } : {}),
    ...(opts.noAutoErrorHandling ? {} : { onError: "continueErrorOutput" }),
    ...(opts.notes ? { notes: opts.notes } : {}),
  });
  if (!opts.noAutoErrorHandling) connect(name, FAILURE_HANDLER_NAME, 1);
  return node;
}

function supabaseWrite(id, name, method, url, jsonBody, opts = {}) {
  const returnMinimal = opts.returnMinimal !== false;
  const node = addNode({
    parameters: {
      method,
      url,
      sendBody: true,
      specifyBody: "json",
      jsonBody,
      sendHeaders: true,
      headerParameters: {
        parameters: returnMinimal
          ? [{ name: "Prefer", value: "return=minimal" }]
          : [{ name: "Prefer", value: "return=representation" }],
      },
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
    },
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    credentials: { supabaseApi: SUPABASE_CRED },
    ...(opts.alwaysOutputData ? { alwaysOutputData: true } : {}),
    ...(opts.noAutoErrorHandling ? {} : { onError: "continueErrorOutput" }),
    ...(opts.notes ? { notes: opts.notes } : {}),
  });
  if (!opts.noAutoErrorHandling) connect(name, FAILURE_HANDLER_NAME, 1);
  return node;
}

function codeNode(id, name, jsCode, opts = {}) {
  const node = addNode({
    parameters: { jsCode },
    id,
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    ...(opts.noAutoErrorHandling ? {} : { onError: "continueErrorOutput" }),
    ...(opts.notes ? { notes: opts.notes } : {}),
  });
  if (!opts.noAutoErrorHandling) connect(name, FAILURE_HANDLER_NAME, 1);
  return node;
}

function ifNode(id, name, leftValue, rightValue, operator) {
  return addNode({
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [{ leftValue, rightValue, operator }],
        combinator: "and",
      },
      options: {},
    },
    id,
    name,
    type: "n8n-nodes-base.if",
    typeVersion: 2.2,
  });
}

function claudeNode(id, name, model, tool, promptExpr, maxTokens) {
  const builderId = `${id}-build-request`;
  const builderName = `${name}: Build Request`;

  codeNode(
    builderId,
    builderName,
    "const tool = " + JSON.stringify(tool) + ";" + NL +
      "const content = " + promptExpr + ";" + NL +
      "const requestBody = JSON.stringify({" + NL +
      "  model: '" + model + "'," + NL +
      "  max_tokens: " + maxTokens + "," + NL +
      "  tools: [tool]," + NL +
      "  tool_choice: { type: 'tool', name: '" + tool.name + "' }," + NL +
      "  messages: [{ role: 'user', content }]" + NL +
      "});" + NL +
      "return [{ json: { requestBody } }];",
    { notes: "Full Claude request body built in real Code-node JS - n8n's {{ }} expression engine chokes on large inlined JSON tool schemas (Workflow B Error #9)." }
  );

  const httpNode = addNode({
    parameters: {
      method: "POST",
      url: "https://api.anthropic.com/v1/messages",
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: "anthropic-version", value: "2023-06-01" },
          { name: "content-type", value: "application/json" },
        ],
      },
      sendBody: true,
      specifyBody: "json",
      jsonBody: "={{ $json.requestBody }}",
      authentication: "predefinedCredentialType",
      nodeCredentialType: "anthropicApi",
    },
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    credentials: { anthropicApi: ANTHROPIC_CRED },
    onError: "continueErrorOutput",
  });

  connect(builderName, name);
  connect(name, FAILURE_HANDLER_NAME, 1);
  return httpNode;
}

function respondNode(id, name, bodyExpr) {
  return addNode({
    parameters: { respondWith: "json", responseBody: bodyExpr },
    id,
    name,
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1.4,
  });
}

// Unlike Workflows B/C/D, a failure here never needs to revert requests.status -
// this workflow never touches it (editing a channel post is independent of the
// request's own pipeline stage, per Decision #43). The only safe, correct action
// on any failure is: don't save the edit (nothing destructive happens by default -
// every write below only fires on the success path), log what happened, respond.
function buildFailureHandler() {
  withLane(-580, () => {
    codeNode(
      "failure-error-extract",
      FAILURE_HANDLER_NAME,
      "const err = $json.error || {};" + NL +
        "const message = (err.message || JSON.stringify(err) || 'Unknown error').slice(0, 500);" + NL +
        "return [{ json: { requestId: $('Config').first().json.request_id, message } }];",
      { noAutoErrorHandling: true }
    );

    supabaseWrite(
      "failure-log",
      "Triage Failure: Log Failed",
      "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      `={{ JSON.stringify({ request_id: $('${FAILURE_HANDLER_NAME}').first().json.requestId, stage: 'edit_triage', status: 'failed', detail: \`Edit triage failed: \${$('${FAILURE_HANDLER_NAME}').first().json.message}\` }) }}`,
      { noAutoErrorHandling: true }
    );
    connect(FAILURE_HANDLER_NAME, "Triage Failure: Log Failed");

    respondNode(
      "failure-respond",
      "Triage Failure: Respond",
      `={{ JSON.stringify({ ok: false, reason: 'triage_failed', detail: $('${FAILURE_HANDLER_NAME}').first().json.message }) }}`
    );
    connect("Triage Failure: Log Failed", "Triage Failure: Respond");
  });
}

// ---------------------------------------------------------------------------
// Trigger + shared setup
// ---------------------------------------------------------------------------

addNode({
  parameters: { path: "wf-e-edit-triage", httpMethod: "POST", responseMode: "responseNode", options: {} },
  id: "webhook",
  name: "Webhook: Edit Triage",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
});

codeNode(
  "config",
  "Config",
  "return [{ json: {" + NL +
    "  request_id: $json.body.request_id," + NL +
    "  channel: $json.body.channel," + NL +
    "  edited_body: $json.body.edited_body," + NL +
    "  SUPABASE_URL: 'https://klblroceyiirhaxaqflq.supabase.co'" + NL +
    "} }];",
  { notes: "Non-secret config only. Supabase/Anthropic secrets live in n8n Credentials." }
);
connect("Webhook: Edit Triage", "Config");

buildFailureHandler();

supabaseGet(
  "fetch-request", "Fetch Request Row",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}&select=*"
);
connect("Config", "Fetch Request Row");

// The current (possibly already-grammatically-patched) row for this channel - the
// one whose id gets updated in place, or superseded by a new version.
supabaseGet(
  "fetch-current-post", "Fetch Current Channel Post",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/channel_posts?request_id=eq.{{$('Config').first().json.request_id}}&channel=eq.{{$('Config').first().json.channel}}&chosen=eq.true&order=version.desc&limit=1&select=*"
);
connect("Fetch Request Row", "Fetch Current Channel Post");

// The anchor for diffing: the same channel's most recent version that actually has
// a Pass 2 evaluation row - NOT necessarily the current row above, since a
// grammatical edit updates the current row in place without creating a new
// evaluated version. Diffing against this anchor (not the last save) is what makes
// the cumulative-drift guard work without any extra bookkeeping.
supabaseGet(
  "fetch-last-eval", "Fetch Last Evaluation",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/evaluation_results?request_id=eq.{{$('Config').first().json.request_id}}&channel=eq.{{$('Config').first().json.channel}}&pass=eq.pass_2_channel&order=content_version.desc&limit=1&select=*"
);
connect("Fetch Current Channel Post", "Fetch Last Evaluation");

supabaseGet(
  "fetch-anchor-post", "Fetch Anchor Post",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/channel_posts?request_id=eq.{{$('Config').first().json.request_id}}&channel=eq.{{$('Config').first().json.channel}}&version=eq.{{$('Fetch Last Evaluation').first().json.content_version}}&select=*"
);
connect("Fetch Last Evaluation", "Fetch Anchor Post");

supabaseGet(
  "fetch-excerpts", "Fetch Excerpts",
  // sources(url) embed: see build-workflow-b.js - without it the prompt only has
  // source_id and the model cites raw UUIDs.
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/excerpts?request_id=eq.{{$('Config').first().json.request_id}}&select=id,text,reason,source_id,sources(url)"
);
connect("Fetch Anchor Post", "Fetch Excerpts");

// Decision #17: tone profiles and the audience description go to the EVALUATOR,
// not just the generator, because "without it, Tone and Audience Fit are graded
// against nothing". This workflow re-scores an edited post against the same Pass 2
// rubric (Tone 25/floor 10, Audience Fit 15/floor 6) and had neither in context,
// so 40 of 100 points with blocking floors were being judged with no reference.
supabaseGet(
  "fetch-tone-samples", "Fetch Tone Samples",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/tone_samples?channel=eq.{{$('Config').first().json.channel}}&select=content,source"
);
connect("Fetch Excerpts", "Fetch Tone Samples");

// Nil-UUID fallback: resolved_audience_profile_id can legitimately be null, and
// id=eq.null is an invalid UUID that Postgres rejects outright (Error #5).
supabaseGet(
  "fetch-audience-profile", "Fetch Audience Profile",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/audience_profiles?id=eq.{{$('Fetch Request Row').first().json.resolved_audience_profile_id || '00000000-0000-0000-0000-000000000000'}}&select=description"
);
connect("Fetch Tone Samples", "Fetch Audience Profile");

// ---------------------------------------------------------------------------
// Step 1-2: deterministic word-diff + mechanical pre-filters (Decisions #45-46)
// ---------------------------------------------------------------------------

codeNode(
  "compute-diff", "Compute Diff",
  // LCS-based word-diff ratio (same metric as Python's difflib.SequenceMatcher.ratio:
  // 1 - 2*LCS/(lenA+lenB)) - O(n*m) is trivial at channel-post lengths (a few
  // hundred words at most). Falls back to the current row's own text as the anchor
  // if no evaluation has ever run yet for this channel (Fetch Anchor Post then
  // legitimately returns zero rows), so a first-ever edit before any Pass 2 result
  // exists still gets a sane (zero-length) diff rather than crashing.
  "function words(s) { return (s || '').trim().split(/\\s+/).filter(Boolean); }" + NL +
    "function sentences(s) { return (s || '').split(/(?<=[.!?])\\s+/).map(x => x.trim()).filter(Boolean); }" + NL +
    "function lcsLength(a, b) {" + NL +
    "  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));" + NL +
    "  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {" + NL +
    "    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);" + NL +
    "  }" + NL +
    "  return dp[a.length][b.length];" + NL +
    "}" + NL +
    "const anchorRows = $('Fetch Anchor Post').all().filter(i => i.json && i.json.id);" + NL +
    "const currentRow = $('Fetch Current Channel Post').first().json;" + NL +
    "const anchorText = anchorRows.length ? anchorRows[0].json.body : (currentRow.body || '');" + NL +
    "const editedText = $('Config').first().json.edited_body;" + NL +
    // Everything below compares TEXT, but an X thread and a newsletter are stored as
    // JSON, so the raw strings carry brackets, quotes and escaped newlines. Sentence
    // splitting looks for whitespace after a full stop and an escaped newline is not
    // whitespace, so for those two channels the sentence heuristics were reading one
    // enormous sentence and detecting almost nothing. Verified live: deleting a whole
    // sentence from an X thread did not register as a sentence change.
    "const plainOf = (raw) => {" + NL +
    "  const text = String(raw == null ? '' : raw);" + NL +
    "  let parsed; try { parsed = JSON.parse(text); } catch { return text; }" + NL +
    "  if (Array.isArray(parsed)) return parsed.map(p => String(p)).join(String.fromCharCode(10, 10));" + NL +
    "  if (parsed && typeof parsed === 'object' && parsed.body_markdown !== undefined) {" + NL +
    "    return [parsed.subject_line || '', parsed.body_markdown || ''].join(String.fromCharCode(10, 10));" + NL +
    "  }" + NL +
    "  return text;" + NL +
    "};" + NL +
    "const anchorPlain = plainOf(anchorText);" + NL +
    "const editedPlain = plainOf(editedText);" + NL +
    // An X thread is stored, and arrives here, as a JSON array string. Handing that
    // straight to the evaluator means it scores brackets, quotes and escaped newlines
    // as if the writer had typed them, and the same goes for the newsletter's
    // subject+body object. Labelled per post instead, matching Workflow D's Pass 2 and
    // the app's formatForEvaluator, so structure is stated rather than punctuated.
    "let evaluatorText = editedText;" + NL +
    "if ($('Config').first().json.channel === 'x') {" + NL +
    "  let posts; try { posts = JSON.parse(editedText); } catch { posts = null; }" + NL +
    "  if (Array.isArray(posts)) evaluatorText = posts.map((p, i) => `Post ${i + 1} of ${posts.length} (${String(p).length} characters${String(p).length > 280 ? ', OVER the 280 limit' : ''}):" + BSN + "${p}`).join('" + BSN + BSN + "');" + NL +
    "}" + NL +
    "if ($('Config').first().json.channel === 'newsletter') {" + NL +
    "  let parsed; try { parsed = JSON.parse(editedText); } catch { parsed = null; }" + NL +
    "  if (parsed && parsed.body_markdown) evaluatorText = `Subject line: ${parsed.subject_line || ''}" + BSN + BSN + "Body:" + BSN + "${parsed.body_markdown}`;" + NL +
    "}" + NL +
    "const oldWords = words(anchorPlain);" + NL +
    "const newWords = words(editedPlain);" + NL +
    "const lcs = lcsLength(oldWords, newWords);" + NL +
    "const editRatio = oldWords.length + newWords.length === 0 ? 0 : 1 - (2 * lcs) / (oldWords.length + newWords.length);" + NL +
    "const oldNumerals = new Set((anchorPlain.match(/\\d+(\\.\\d+)?%?/g) || []));" + NL +
    "const newNumerals = new Set((editedPlain.match(/\\d+(\\.\\d+)?%?/g) || []));" + NL +
    "const numeralsChanged = oldNumerals.size !== newNumerals.size || [...oldNumerals].some(n => !newNumerals.has(n));" + NL +
    "const oldSentences = sentences(anchorPlain);" + NL +
    "const newSentenceSet = new Set(sentences(editedPlain));" + NL +
    "const removedSentences = oldSentences.filter(s => !newSentenceSet.has(s));" + NL +
    "const citationSentenceChanged = removedSentences.some(s => s.includes('[Source: excerpt'));" + NL +
    // A sentence being REWORDED is not the same as a sentence being removed or added,
    // and treating them alike made the cheap path unreachable: any typo fix, contraction
    // or comma changed a sentence string and escalated straight to a full Opus
    // evaluation, so the Haiku classifier this step exists to feed was never consulted.
    // Verified live by editing three contractions and watching it escalate.
    //
    // A removed sentence that still has a close relative in the new text is a rewording,
    // and reworded text is exactly the ambiguous case Haiku is meant to judge (biased to
    // substantive on uncertainty, Decision #46). A removed sentence with no relative is
    // content genuinely gone, which still escalates mechanically.
    //
    // 0.5 rather than something stricter because contractions delete words: "Here is
    // what changed, and what did not" to "Here's what changed, and what didn't" shares
    // only 4 of 7 words, and a contraction is the canonical grammatical edit. A reworded
    // sentence that changes meaning is not caught here on purpose; that is precisely
    // what the classifier exists to judge.
    "const wordsOf = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));" + NL +
    "const overlap = (a, b) => {" + NL +
    "  const A = wordsOf(a), B = wordsOf(b);" + NL +
    "  if (A.size === 0 || B.size === 0) return 0;" + NL +
    "  let shared = 0;" + NL +
    "  for (const w of A) if (B.has(w)) shared++;" + NL +
    "  return shared / Math.max(A.size, B.size);" + NL +
    "};" + NL +
    "const newSentenceList = [...newSentenceSet];" + NL +
    "const orphanedSentences = removedSentences.filter(s => !newSentenceList.some(n => overlap(s, n) >= 0.5));" + NL +
    "const wholeSentenceChanged = orphanedSentences.length > 0 || newSentenceSet.size !== oldSentences.length;" + NL +
    "const mechanicalEscalate = numeralsChanged || citationSentenceChanged || wholeSentenceChanged || editRatio > 0.15;" + NL +
    "return [{ json: { anchorText, editedText, evaluatorText, editRatio, numeralsChanged, citationSentenceChanged, wholeSentenceChanged, mechanicalEscalate, hasAnyEvaluation: anchorRows.length > 0 } }];",
  {
    notes:
      "Word-diff ratio uses the same 1 - 2*LCS/(lenA+lenB) metric as Python's difflib.SequenceMatcher.ratio. Mechanical pre-filters (numeral change, a removed excerpt-cited sentence, any whole sentence added/removed, or >15% edit distance) force full re-evaluation regardless of what Haiku would say - these are the project's own judgment calls on what 'numerals changed' / 'excerpt-cited sentence changed' / 'whole sentence added or removed' concretely mean, since the source docs describe the categories but not exact detection logic.",
  }
);
// Inline in the main chain, not a fork off Fetch Excerpts: a parallel branch would
// leave the ordering between the fetches and the eval build up to n8n rather than
// guaranteed, and the eval prompt reads both by name.
connect("Fetch Audience Profile", "Compute Diff");

ifNode("if-mechanical-escalate", "IF Mechanical Escalate", "={{$json.mechanicalEscalate}}", true, { type: "boolean", operation: "equals" });
connect("Compute Diff", "IF Mechanical Escalate");

// ---------------------------------------------------------------------------
// Step 3: ambiguous remainder -> cheap Haiku classification, biased toward
// "substantive" on uncertainty (Decision #46) - a wrong "grammatical" call
// silently skips a real evaluation, which is the unsafe direction.
// ---------------------------------------------------------------------------

const TRIAGE_TOOL = {
  name: "classify_edit",
  description: "Classify whether an edit to a piece of content is purely grammatical/stylistic or substantive (changes meaning, claims, or tone).",
  input_schema: {
    type: "object",
    required: ["classification"],
    properties: {
      classification: { type: "string", enum: ["grammatical", "substantive"] },
      reason: { type: "string" },
    },
  },
};

const triagePrompt =
  "`An editor changed a piece of published content. Classify the edit as 'grammatical' (spelling, punctuation, word choice, sentence structure with no change in meaning, claims, or tone) or 'substantive' (changes what's being claimed, adds/removes information, shifts tone or emphasis). If genuinely unsure, classify as 'substantive' - treating an ambiguous edit as needing review is the safe default, silently skipping review on a real content change is not.\\n\\nOriginal:\\n${$('Compute Diff').first().json.anchorText}\\n\\nEdited:\\n${$('Compute Diff').first().json.evaluatorText}`";

claudeNode("claude-triage", "Claude: Classify Edit", "claude-haiku-4-5-20251001", TRIAGE_TOOL, triagePrompt, 500);
connect("IF Mechanical Escalate", "Claude: Classify Edit: Build Request", 1);

codeNode(
  "parse-triage", "Parse Triage Classification",
  "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL +
    "const classification = toolUse && toolUse.input && toolUse.input.classification === 'grammatical' ? 'grammatical' : 'substantive';" + NL +
    "return [{ json: { classification } }];"
);
connect("Claude: Classify Edit", "Parse Triage Classification", 0);

// ---------------------------------------------------------------------------
// Grammatical path: save in place, no new version, logged but not re-scored.
// ---------------------------------------------------------------------------

ifNode("if-grammatical", "IF Grammatical", "={{$json.classification}}", "grammatical", { type: "string", operation: "equals" });
connect("Parse Triage Classification", "IF Grammatical");

withLane(-260, () => {
  supabaseWrite(
    "save-in-place", "Update Post In Place", "PATCH",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/channel_posts?id=eq.{{$('Fetch Current Channel Post').first().json.id}}",
    "={{ JSON.stringify({ body: $('Config').first().json.edited_body }) }}"
  );
  connect("IF Grammatical", "Update Post In Place", 0);
  supabaseWrite(
    "log-grammatical", "Log Event (grammatical)", "POST",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
    "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'edit_triage', status: 'success', detail: `Edit to ${$('Config').first().json.channel} classified as grammatical - saved without re-evaluation.` }) }}"
  );
  connect("Update Post In Place", "Log Event (grammatical)");
  respondNode(
    "respond-grammatical", "Respond (grammatical)",
    "={{ JSON.stringify({ ok: true, escalated: false }) }}"
  );
  connect("Log Event (grammatical)", "Respond (grammatical)");
});

// ---------------------------------------------------------------------------
// Substantive path (mechanical escalation OR Haiku said substantive): full
// single-channel Pass 2 re-evaluation - the SAME rubric Workflow D uses, never a
// lighter check.
// ---------------------------------------------------------------------------

const EVAL_TOOL = {
  name: "evaluate_channel_post",
  description: "Score this single channel post against the Pass 2 rubric.",
  input_schema: {
    type: "object",
    required: ["overall_score", "status", "criteria"],
    properties: {
      overall_score: { type: "integer" },
      status: { type: "string", enum: ["pass", "revise", "reject"] },
      criteria: {
        type: "array",
        items: {
          type: "object",
          required: ["name", "score", "max"],
          properties: {
            name: { type: "string" },
            score: { type: "integer" },
            max: { type: "integer" },
            notes: { type: "string" },
          },
        },
      },
      weakest_criteria_suggestions: { type: "array", items: { type: "string" } },
      hard_block_triggered: { type: "boolean" },
      hard_block_reason: { type: ["string", "null"] },
    },
  },
};

const PASS2_RUBRIC_TEXT =
  "Score out of 100 across: Factual Consistency re-verified against the excerpts (20, floor 15 - hard block tier), Tone (25, floor 10), Channel Fit (25, floor 10 - does it genuinely read as native to that platform), Audience Fit re-verified (15, floor 6), Clarity (15, floor 6). Topic Relevance, SEO Fit, and Completeness do not apply post-adaptation. If Factual Consistency scores below its floor, hard_block_triggered must be true regardless of the total.";

// X posts kept coming back over 280 characters and still scoring a pass, because
// Workflow D's programmatic length check (Decision #35) only guards D's own gate -
// an edit re-scored through E bypassed it entirely. Confirmed live: three posts at
// 329/327/317 characters passed at 82/100. The count is measured here in real JS
// rather than trusted to the model, and handed to the evaluator so the violation
// lands on the score instead of being invisible.
// Built with plain string concatenation, no nested template literals: this whole
// expression is interpolated into an outer backtick string, and nesting backticks
// inside it does not survive the round trip.
const X_LENGTH_NOTE =
  "${(() => { if ($('Config').first().json.channel !== 'x') return ''; " +
  "let posts; const raw = $('Compute Diff').first().json.editedText; " +
  "try { posts = JSON.parse(raw); } catch (err) { posts = String(raw).split(" + JSON.stringify("\n\n") + "); } " +
  "if (!Array.isArray(posts)) posts = [String(posts)]; " +
  "const lens = posts.map(function (p, i) { return 'post ' + (i + 1) + ': ' + String(p).length + ' characters'; }); " +
  "const over = posts.filter(function (p) { return String(p).length > 280; }).length; " +
  "let note = 'Measured character counts (counted programmatically, do not recount): ' + lens.join('; ') + '.'; " +
  "if (over > 0) { note += ' ' + over + ' post(s) exceed the 280 character limit, which is a hard Channel Fit failure: score Channel Fit no higher than 10 and name the offending post and its length in the notes.'; } " +
  "return note; })()}";

const evalPrompt =
  "`Evaluate this edited channel post against the rubric. You have not seen the edit reasoning - judge only what's here. When writing weakest_criteria_suggestions, name what is wrong and where, but do NOT compose replacement wording that restates a figure, unit, name or date. Say 'the odds gap is stated in the wrong unit' rather than quoting a corrected sentence: a suggestion is fed straight back into the next generation, and a figure restated in your words becomes the next version's error.\\n\\nRubric: " +
  PASS2_RUBRIC_TEXT +
  "\\n\\nChannel: ${$('Config').first().json.channel}\\n\\nEdited post:\\n${$('Compute Diff').first().json.evaluatorText}\\n\\n" +
  X_LENGTH_NOTE +
  "\\n\\nAudience this must fit (score Audience Fit against this, not a general reader):\\n${$('Fetch Audience Profile').first().json.description || 'No audience profile on file, judge for a general professional audience.'}" +
  "\\n\\nBrand voice for this channel (score Tone against these real samples, not a generic idea of good writing):\\n${$('Fetch Tone Samples').all().filter(i => i.json && i.json.content).map(i => `[${i.json.source}] ${i.json.content}`).join('" + BSN + BSN + "---" + BSN + BSN + "') || 'No tone samples on file for this channel, judge against a neutral professional default.'}" +
  "\\n\\nGrounded excerpts it should stay consistent with:\\n${$('Fetch Excerpts').all().filter(i => i.json && i.json.id).map((i, idx) => `[${idx}] Source: ${(i.json.sources && i.json.sources.url) || i.json.source_id}" + BSN + "${i.json.text}`).join('" + BSN + BSN + "')}`";

claudeNode("claude-eval-edit", "Claude: Evaluate Edited Post", "claude-opus-5", EVAL_TOOL, evalPrompt, 3000);
connect("IF Mechanical Escalate", "Claude: Evaluate Edited Post: Build Request", 0);
connect("IF Grammatical", "Claude: Evaluate Edited Post: Build Request", 1);

codeNode(
  "parse-eval-edit", "Parse Edited Evaluation",
  "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL + "return [{ json: toolUse.input }];"
);
connect("Claude: Evaluate Edited Post", "Parse Edited Evaluation", 0);

codeNode(
  "gate-edit", "Gate Edited Evaluation",
  "const r = $json;" + NL +
    "const c = r.criteria || [];" + NL +
    "const floor = (name, f) => { const crit = c.find(x => x.name.toLowerCase().includes(name)); return crit ? crit.score < f : false; };" + NL +
    "const hardBlock = r.hard_block_triggered || floor('factual', 15);" + NL +
    // The model's own `status` was being stored as the verdict, so an edit could
    // self-report "pass" at 82 and become schedulable while Workflow D refuses
    // anything under 85. The gate belongs here, applied to the number, exactly as D
    // applies it. Same thresholds deliberately: one rule, three places that read it.
    "let status;" + NL +
    "if (hardBlock) { status = r.overall_score < 60 ? 'reject' : 'revise'; }" + NL +
    "else if (r.overall_score >= 85) { status = 'pass'; }" + NL +
    "else if (r.overall_score >= 60) { status = 'revise'; }" + NL +
    "else { status = 'reject'; }" + NL +
    "return [{ json: { ...r, hardBlock, status } }];"
);
connect("Parse Edited Evaluation", "Gate Edited Evaluation");

ifNode("if-hard-block", "IF Hard Block", "={{$json.hardBlock}}", true, { type: "boolean", operation: "equals" });
connect("Gate Edited Evaluation", "IF Hard Block");

// Hard block: nothing gets saved (Decision: "submission blocked outright... human
// must revert or fix") - the prior version stays exactly as it was, no new version,
// no update to the current row either.
withLane(260, () => {
  supabaseWrite(
    "log-hard-block", "Log Event (hard block)", "POST",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
    "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'edit_triage', status: 'failed', detail: `Edit to ${$('Config').first().json.channel} blocked: ${$('Gate Edited Evaluation').first().json.hard_block_reason || 'a critical criterion fell below its floor'}.` }) }}"
  );
  connect("IF Hard Block", "Log Event (hard block)", 0);
  respondNode(
    "respond-hard-block", "Respond (hard block)",
    "={{ JSON.stringify({ ok: false, reason: 'hard_block', detail: $('Gate Edited Evaluation').first().json.hard_block_reason, criteria: $('Gate Edited Evaluation').first().json.criteria }) }}"
  );
  connect("Log Event (hard block)", "Respond (hard block)");
});

// Passed the hard-block check (pass or revise): saved as a new version regardless -
// Decision #36-equivalent for editing (a non-passing draft can still be saved for
// the human to see the score and decide what to do next), matching how Workflow D
// itself always saves the batch it just evaluated.
supabaseWrite(
  "unchoose-old", "Unchoose Previous Version", "PATCH",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/channel_posts?request_id=eq.{{$('Config').first().json.request_id}}&channel=eq.{{$('Config').first().json.channel}}&chosen=eq.true",
  "={{ JSON.stringify({ chosen: false }) }}"
);
connect("IF Hard Block", "Unchoose Previous Version", 1);

codeNode(
  "build-new-version-row", "Build New Version Row",
  "const current = $('Fetch Current Channel Post').first().json;" + NL +
    "return [{ json: { row: JSON.stringify({ request_id: $('Config').first().json.request_id, channel: $('Config').first().json.channel, version: current.version + 1, body: $('Config').first().json.edited_body, tone_variant: current.tone_variant, chosen: true }) } }];"
);
connect("Unchoose Previous Version", "Build New Version Row");

supabaseWrite(
  "insert-new-version", "Insert New Version", "POST",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/channel_posts",
  "={{ $json.row }}",
  { returnMinimal: false }
);
connect("Build New Version Row", "Insert New Version");

supabaseWrite(
  "insert-edit-eval", "Insert Evaluation (edit)", "POST",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/evaluation_results",
  "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, section_id: null, channel: $('Config').first().json.channel, pass: 'pass_2_channel', content_version: $('Insert New Version').first().json.version, overall_score: $('Gate Edited Evaluation').first().json.overall_score, status: $('Gate Edited Evaluation').first().json.status, criteria: $('Gate Edited Evaluation').first().json.criteria, weakest_criteria_suggestions: $('Gate Edited Evaluation').first().json.weakest_criteria_suggestions, hard_block_triggered: $('Gate Edited Evaluation').first().json.hardBlock, hard_block_reason: $('Gate Edited Evaluation').first().json.hard_block_reason }) }}",
  { returnMinimal: false }
);
connect("Insert New Version", "Insert Evaluation (edit)");

supabaseWrite(
  "log-substantive", "Log Event (substantive)", "POST",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
  "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'edit_triage', status: 'success', detail: `Edit to ${$('Config').first().json.channel} re-evaluated: ${$('Gate Edited Evaluation').first().json.overall_score}/100 (${$('Gate Edited Evaluation').first().json.status}).` }) }}"
);
connect("Insert Evaluation (edit)", "Log Event (substantive)");

respondNode(
  "respond-substantive", "Respond (substantive)",
  "={{ JSON.stringify({ ok: true, escalated: true, score: $('Gate Edited Evaluation').first().json.overall_score, status: $('Gate Edited Evaluation').first().json.status }) }}"
);
connect("Log Event (substantive)", "Respond (substantive)");

const workflow = {
  name: "Content Agent — Workflow E (Channel Edit Triage)",
  meta: {
    notes:
      "Triggered when a human saves a manual edit to a channel post (never the article - it's locked permanently once adaptation runs). Diffs the edit against the last fully-evaluated version, applies mechanical pre-filters (numeral change, removed excerpt-cited sentence, whole sentence added/removed, >15% edit distance) that force full re-evaluation regardless, and only sends the ambiguous remainder to a cheap Haiku classification biased toward 'substantive'. Grammatical edits save in place; substantive edits run the same Pass 2 rubric Workflow D uses (never a lighter check) and hard-block on a floor failure without saving anything. SECRETS: Supabase API and Anthropic credentials - map both on import, and check every node's credential individually (Errors #10/#83-88 in week4-progress.md - import doesn't always propagate to every node).",
  },
  nodes,
  connections,
};

fs.writeFileSync(
  path.join(__dirname, "..", "n8n", "workflow-e-edit-triage.json"),
  JSON.stringify(workflow, null, 2)
);
console.log("Workflow E written. Node count:", nodes.length);
