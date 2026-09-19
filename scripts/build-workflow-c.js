// Authors n8n/workflow-c-regenerate.json programmatically, reusing every structural
// lesson from Workflow B (see week4-progress.md Errors #3-#9): alwaysOutputData on
// any fetch that could legitimately return zero rows, the "build the whole Claude
// request body in a preceding Code node" pattern (n8n's {{ }} expression engine does
// its own brace-matching before real JS evaluation and chokes on large inlined JSON
// tool schemas), never $json straight after a return=minimal write, dedicated
// credential types only.
//
// Workflow C = "Regenerate Main Block" (week4-full-flow.md): human clicks Regenerate
// with a required comment. Reuses the existing chosen angle and existing excerpts —
// no re-selection — and re-runs Stage 5 (generation) + Stage 6 (Pass 1 evaluation)
// only. It does NOT re-run Stage 7's internal capped auto-revision loop; that loop
// belongs to Workflow B's own first pass. The cap here is a separate, human-facing
// one (5 regenerate-with-comment attempts per article, decided directly by the
// programmer during this build), tracked in requests.regeneration_count and enforced
// atomically by the Next.js route before this workflow is ever triggered. The route
// tells this workflow whether this is the final allowed attempt via is_final_attempt,
// so a failing last attempt lands on needs_human_attention instead of silently
// looping the human back to try again.
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

function supabaseGet(id, name, url, opts = {}) {
  return addNode({
    parameters: { url, options: {}, authentication: "predefinedCredentialType", nodeCredentialType: "supabaseApi" },
    id,
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    credentials: { supabaseApi: SUPABASE_CRED },
    alwaysOutputData: opts.alwaysOutputData ?? true,
    ...(opts.executeOnce ? { executeOnce: true } : {}),
    ...(opts.onError ? { onError: opts.onError } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
  });
}

function supabaseWrite(id, name, method, url, jsonBody, opts = {}) {
  const returnMinimal = opts.returnMinimal !== false;
  return addNode({
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
    ...(opts.onError ? { onError: opts.onError } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
  });
}

function codeNode(id, name, jsCode, opts = {}) {
  return addNode({
    parameters: { jsCode },
    id,
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    ...(opts.notes ? { notes: opts.notes } : {}),
  });
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
    { notes: "Full Claude request body built in real Code-node JS - n8n's {{ }} expression engine chokes on large inlined JSON tool schemas (see Workflow B Error #9)." }
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
  return httpNode;
}

// Unlike Workflow B (which always reverts to awaiting_angle_selection on any Claude
// failure, since it only ever runs starting from that state), Workflow C starts from
// pending_approval or needs_human_attention and must revert to whichever it actually
// started from - captured in Config as prior_status - not a single hardcoded value.
function claudeErrorBranch(claudeNodeName, stage, requestIdExpr) {
  withLane(-320, () => {
    const errId = claudeNodeName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    codeNode(
      `${errId}-error-extract`,
      `${claudeNodeName}: Extract Error`,
      "const err = $json.error || {};" + NL +
        "const message = (err.message || JSON.stringify(err) || 'Unknown Claude API error').slice(0, 500);" + NL +
        `return [{ json: { requestId: ${requestIdExpr}, message } }];`
    );
    connect(claudeNodeName, `${claudeNodeName}: Extract Error`, 1);

    supabaseWrite(
      `${errId}-revert-status`,
      `${claudeNodeName}: Revert Request State`,
      "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$json.requestId}}",
      // regeneration_count is restored alongside the status. Increment Regeneration
      // Count runs immediately before the Claude call, so by the time we land here the
      // attempt has already been charged for a call that produced nothing - an
      // Anthropic outage or a 529 would quietly eat one of the human's five. Fetch
      // Request Row holds the pre-increment value, so this is a restore rather than
      // arithmetic on a number that may have moved.
      "={{ JSON.stringify({ status: $('Config').first().json.prior_status, regeneration_count: $('Fetch Request Row').first().json.regeneration_count }) }}"
    );
    connect(`${claudeNodeName}: Extract Error`, `${claudeNodeName}: Revert Request State`);

    supabaseWrite(
      `${errId}-log-failed`,
      `${claudeNodeName}: Log Failed`,
      "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      `={{ JSON.stringify({ request_id: $('${claudeNodeName}: Extract Error').first().json.requestId, stage: '${stage}', status: 'failed', detail: \`Claude call failed: \${$('${claudeNodeName}: Extract Error').first().json.message}\` }) }}`
    );
    connect(`${claudeNodeName}: Revert Request State`, `${claudeNodeName}: Log Failed`);

    respondNode(
      `${errId}-respond-failed`,
      `${claudeNodeName}: Respond Failed`,
      "={{ JSON.stringify({ ok: false, reason: 'claude_failed', detail: $('" + claudeNodeName + ": Extract Error').first().json.message }) }}"
    );
    connect(`${claudeNodeName}: Log Failed`, `${claudeNodeName}: Respond Failed`);
  });
}

// Generic safety net for the plain Supabase GET/PATCH nodes between the webhook and
// the Claude call (Fetch Request Row through Increment Regeneration Count). Error
// #10 (week4-progress.md) proved these are real failure points too, not just the
// Claude calls - a missing credential crashed the whole execution with a raw 500
// and left the request stuck at 'generating' with no revert, since claudeErrorBranch
// only guards the two Claude nodes. Every node passed onError:"continueErrorOutput"
// should have its output 1 connected here via connectToSetupFailureHandler() below.
// Built once; every guarded node's error output routes into this same shared chain.
function buildSetupFailureHandler() {
  withLane(-580, () => {
    codeNode(
      "setup-error-extract",
      "Pre-Claude Setup: Extract Error",
      "const err = $json.error || {};" + NL +
        "const message = (err.message || JSON.stringify(err) || 'Unknown error').slice(0, 500);" + NL +
        "return [{ json: { requestId: $('Config').first().json.request_id, message } }];"
    );

    supabaseWrite(
      "setup-revert-status",
      "Pre-Claude Setup: Revert Request State",
      "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$json.requestId}}",
      "={{ JSON.stringify({ status: $('Config').first().json.prior_status }) }}"
    );
    connect("Pre-Claude Setup: Extract Error", "Pre-Claude Setup: Revert Request State");

    supabaseWrite(
      "setup-log-failed",
      "Pre-Claude Setup: Log Failed",
      "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      "={{ JSON.stringify({ request_id: $('Pre-Claude Setup: Extract Error').first().json.requestId, stage: 'regeneration_setup', status: 'failed', detail: `Couldn't start regeneration: ${$('Pre-Claude Setup: Extract Error').first().json.message}` }) }}"
    );
    connect("Pre-Claude Setup: Revert Request State", "Pre-Claude Setup: Log Failed");

    respondNode(
      "setup-respond-failed",
      "Pre-Claude Setup: Respond Failed",
      "={{ JSON.stringify({ ok: false, reason: 'setup_failed', detail: $('Pre-Claude Setup: Extract Error').first().json.message }) }}"
    );
    connect("Pre-Claude Setup: Log Failed", "Pre-Claude Setup: Respond Failed");
  });
}

function connectToSetupFailureHandler(nodeName) {
  connect(nodeName, "Pre-Claude Setup: Extract Error", 1);
}

// Terminal marker only. With onReceived the response has already been sent by the
// time any of these run, so a real Respond to Webhook node here would have nothing
// to respond to. The outcome is already in event_log, written by the Log node
// immediately before each of these, so nothing is lost by making them no-ops.
function respondNode(id, name) {
  return addNode({
    parameters: {},
    id,
    name,
    type: "n8n-nodes-base.noOp",
    typeVersion: 1,
  });
}

// ---------------------------------------------------------------------------
// Trigger + shared setup
// ---------------------------------------------------------------------------

// onReceived, not responseNode (Decision #101). These workflows run for minutes:
// Workflow B's generation plus two revision rounds, C's regeneration, D's adaptation
// plus Pass 2. Holding the HTTP connection open for that long means Cloudflare cuts
// it at 100 seconds and the caller records a 524 for work that is still running and
// usually succeeds. Confirmed live: a 524 logged at 10:37 for an adaptation that
// completed at 10:39.
//
// Nothing reads these responses. Every trigger for A, B, C and D is fired from
// after() and only checks that n8n accepted the call; the real outcome arrives via
// requests.status and event_log. Workflow E is deliberately left on responseNode,
// because its edit-triage verdict is the one response a human is actually waiting on.
addNode({
  parameters: { path: "wf-c-regenerate", httpMethod: "POST", responseMode: "onReceived", options: {} },
  id: "webhook",
  name: "Webhook: Regenerate",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
});

codeNode(
  "config",
  "Config",
  "return [{ json: {" + NL +
    "  request_id: $json.body.request_id," + NL +
    "  comment: $json.body.comment," + NL +
    "  is_final_attempt: !!$json.body.is_final_attempt," + NL +
    "  prior_status: $json.body.prior_status," + NL +
    "  SUPABASE_URL: 'https://klblroceyiirhaxaqflq.supabase.co'" + NL +
    "} }];",
  { notes: "prior_status is whatever status the request was in before Next.js atomically flipped it to 'generating' (pending_approval or needs_human_attention) - a Claude failure here reverts to that, not a hardcoded value." }
);
connect("Webhook: Regenerate", "Config");

buildSetupFailureHandler();

supabaseGet(
  "fetch-request", "Fetch Request Row",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}&select=*",
  { onError: "continueErrorOutput" }
);
connect("Config", "Fetch Request Row");
connectToSetupFailureHandler("Fetch Request Row");

supabaseGet(
  "fetch-angle", "Fetch Chosen Angle",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/angles?request_id=eq.{{$('Config').first().json.request_id}}&chosen=eq.true&select=*",
  { onError: "continueErrorOutput" }
);
connect("Fetch Request Row", "Fetch Chosen Angle");
connectToSetupFailureHandler("Fetch Chosen Angle");

supabaseGet(
  "fetch-latest-section", "Fetch Latest Section",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/sections?request_id=eq.{{$('Config').first().json.request_id}}&order=version.desc&limit=1&select=*",
  { onError: "continueErrorOutput" }
);
connect("Fetch Chosen Angle", "Fetch Latest Section");
connectToSetupFailureHandler("Fetch Latest Section");

supabaseGet(
  "fetch-excerpts", "Fetch Excerpts",
  // sources(url) embed: see build-workflow-b.js - without it Claude is handed
  // source_id and cites raw UUIDs into the article.
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/excerpts?request_id=eq.{{$('Config').first().json.request_id}}&select=id,text,reason,source_id,sources(url)",
  { onError: "continueErrorOutput" }
);
connect("Fetch Latest Section", "Fetch Excerpts");
connectToSetupFailureHandler("Fetch Excerpts");

codeNode(
  "build-excerpts-text", "Build Excerpts Text",
  "const excerpts = $input.all().map(i => i.json);" + NL +
    "const plain = excerpts.map((e, i) => `[${i}] Source: ${(e.sources && e.sources.url) || e.source_id}" + BSN + "${e.text}`).join('" + BSN + BSN + "');" + NL +
    "return [{ json: { excerpts, excerptsTextPlain: plain } }];",
  { notes: "Same reason as Workflow B: excerpt text can contain backticks (quoted code), so join in real Code-node JS, never inline in an HTTP node expression." }
);
connect("Fetch Excerpts", "Build Excerpts Text");

// ---------------------------------------------------------------------------
// Stage 5 — regenerate the main block with the human's comment
// ---------------------------------------------------------------------------

const ARTICLE_TOOL = {
  name: "write_article",
  description: "Write the full grounded article for the chosen angle.",
  input_schema: {
    type: "object",
    required: ["title", "body_markdown", "secondary_keywords"],
    properties: {
      title: { type: "string" },
      body_markdown: { type: "string" },
      secondary_keywords: { type: "array", items: { type: "string" } },
    },
  },
};

// Only advance regeneration_count once Claude is actually about to be called - not
// in Next.js before this workflow even ran. Everything upstream (fetching the
// request/angle/section/excerpts) is plain Supabase reads that can fail for reasons
// that have nothing to do with the human's attempt (a bad credential, a transient
// outage - exactly what happened live during testing, see week4-progress.md Errors
// #10) and shouldn't cost them one of their 5 tries. This write reads the count
// already fetched in Fetch Request Row rather than re-fetching, since nothing else
// can be concurrently regenerating this same request (Next.js's atomic status write
// guarantees only one attempt is in flight at a time).
supabaseWrite(
  "increment-regeneration-count", "Increment Regeneration Count", "PATCH",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}",
  "={{ JSON.stringify({ regeneration_count: $('Fetch Request Row').first().json.regeneration_count + 1 }) }}",
  { onError: "continueErrorOutput" }
);
connect("Build Excerpts Text", "Increment Regeneration Count");
connectToSetupFailureHandler("Increment Regeneration Count");

const regeneratePrompt =
  "`Regenerate this article. The human reviewer read the previous version and asked for a specific change - address it directly, don't just lightly reword the same draft. Fidelity of figures: carry every number, unit, percentage, date and conditional across from the excerpts EXACTLY as they state it. Never compress a unit into a shorter one ('nine percentage points' is not 'nine points'), and never drop a qualifier to save space. If a figure will not fit with its unit and qualifier intact, leave it out rather than shortening it. The reviewer's comment is a request about the writing, not a source. It is not authoritative on any figure, unit, name or date: if acting on it would state something the excerpts do not support, address the underlying point another way. Accuracy outranks the comment. Handling conflicting or undateable sources: resolve it BEFORE you write, and write the resolution, not the reasoning. Prefer the source that states its own timeframe explicitly over one that does not. If two excerpts cannot both be true and you cannot tell which holds, leave the claim out entirely: a missing figure costs the reader nothing, a paragraph about why you are unsure costs them the article. Never write a sentence about what the excerpts do or do not establish, never give a section a heading about sourcing, and never explain that two details 'should not be conflated'. At most one short caveat in the whole piece, inline, and only where its absence would mislead. You are writing for the reader named in the audience profile, not for a fact-checker reviewing your work.\\n\\nWorking title: ${$('Fetch Chosen Angle').first().json.working_title}\\nThesis: ${$('Fetch Chosen Angle').first().json.thesis}\\nSection shape: ${JSON.stringify($('Fetch Chosen Angle').first().json.section_shape)}\\nPrimary keyword (must appear naturally, including in a heading): ${$('Fetch Request Row').first().json.primary_keyword}\\nDesired length: ${$('Fetch Request Row').first().json.desired_length || 'no specific target'}\\n\\nPrevious version:\\n${$('Fetch Latest Section').first().json.body_markdown}\\n\\nReviewer's comment on what to change:\\n${$('Config').first().json.comment}\\n\\nKeep every citation. The previous version cites its sources inline as [Source: url] and the regenerated article must carry every one of them across. Rewrite a sentence and its citation goes with it. Add a claim and it gets the same inline citation as everything else. Coming back with fewer citations than you were given is a failed regeneration no matter how well it reads.\n\nStay grounded only in the excerpts below - no unsupported claims or invented statistics, even to satisfy the comment:\\n${$('Build Excerpts Text').first().json.excerptsTextPlain}\\n\\nWrite in markdown with proper H1/H2 heading hierarchy.\\n\\nHouse style: never use em dashes (the character U+2014) anywhere in the output. Use a full stop, a comma, a colon or parentheses instead. Do not state anything the excerpts do not support, and do not use hedging language to smuggle in a claim you cannot cite.`";

claudeNode("claude-regenerate", "Claude: Regenerate Article", "claude-sonnet-5", ARTICLE_TOOL, regeneratePrompt, 4000);
connect("Increment Regeneration Count", "Claude: Regenerate Article: Build Request");
claudeErrorBranch("Claude: Regenerate Article", "generation", "$('Config').first().json.request_id");

codeNode(
  "parse-generated", "Parse Regenerated Article",
  "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL + "return [{ json: toolUse.input }];"
);
connect("Claude: Regenerate Article", "Parse Regenerated Article", 0);

supabaseWrite(
  "insert-section", "Insert New Section Version", "POST",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/sections",
  "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, angle_id: $('Fetch Chosen Angle').first().json.id, version: $('Fetch Latest Section').first().json.version + 1, title: $json.title, body_markdown: $json.body_markdown, primary_keyword: $('Fetch Request Row').first().json.primary_keyword, secondary_keywords: $json.secondary_keywords, generation_status: 'generated' }) }}",
  { returnMinimal: false }
);
connect("Parse Regenerated Article", "Insert New Section Version");

// ---------------------------------------------------------------------------
// Stage 6 — Pass 1 evaluation on the regenerated draft (single pass, no internal
// revision loop here - that belongs to Workflow B's first generation only)
// ---------------------------------------------------------------------------

const EVAL_TOOL = {
  name: "evaluate_article",
  description: "Score the article against the Pass 1 rubric.",
  input_schema: {
    type: "object",
    required: ["overall_score", "status", "criteria", "hard_block_triggered"],
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
      unsupported_or_weak_claims: { type: "array", items: { type: "object" } },
      recommended_changes: { type: "array", items: { type: "string" } },
      weakest_criteria_suggestions: { type: "array", items: { type: "string" } },
      hard_block_triggered: { type: "boolean" },
      hard_block_reason: { type: ["string", "null"] },
    },
  },
};

const RUBRIC_TEXT =
  "Score out of 100 across: Topic Relevance (20, floor 15), Source Grounding (20, floor 15), Factual Consistency (20, floor 15), Audience Fit (15, floor 6), SEO Fit (10, floor 4), Clarity (10, floor 4), Completeness (5, floor 2). Topic Relevance/Source Grounding/Factual Consistency are hard-block tier: if any scores below its floor, hard_block_triggered must be true regardless of the total. Verify every claim against the excerpt it cites and flag any claim citing nothing. An article whose claims are accurate but carry no inline [Source: url] citations at all cannot score above its Source Grounding floor: a rewrite that silently stripped the citation trail reads perfectly and leaves the reader no way to check anything, which is the failure this criterion exists to catch. Always populate weakest_criteria_suggestions, even on a passing score.";

const evalPrompt =
  "`Evaluate this article against the rubric. You have not seen how it was written or planned - judge only what's here.\\n\\nRubric: " +
  RUBRIC_TEXT +
  "\\n\\nArticle:\\n${$('Parse Regenerated Article').first().json.body_markdown}\\n\\nGrounded excerpts it should be checked against:\\n${$('Build Excerpts Text').first().json.excerptsTextPlain}`";

claudeNode("claude-eval", "Claude: Evaluate Regenerated Article", "claude-opus-5", EVAL_TOOL, evalPrompt, 3000);
connect("Insert New Section Version", "Claude: Evaluate Regenerated Article: Build Request");
claudeErrorBranch("Claude: Evaluate Regenerated Article", "evaluation", "$('Config').first().json.request_id");

codeNode(
  "parse-eval", "Parse Evaluation",
  "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL + "return [{ json: toolUse.input }];"
);
connect("Claude: Evaluate Regenerated Article", "Parse Evaluation", 0);

supabaseWrite(
  "insert-eval", "Insert Evaluation", "POST",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/evaluation_results",
  "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, section_id: $('Insert New Section Version').first().json.id, pass: 'pass_1_article', content_version: $('Insert New Section Version').first().json.version, overall_score: $json.overall_score, status: $json.status, criteria: $json.criteria, unsupported_or_weak_claims: $json.unsupported_or_weak_claims, weakest_criteria_suggestions: $json.weakest_criteria_suggestions, hard_block_triggered: $json.hard_block_triggered, hard_block_reason: $json.hard_block_reason }) }}",
  { returnMinimal: false }
);
connect("Parse Evaluation", "Insert Evaluation");

codeNode(
  "gate", "Gate",
  "const c = $json.criteria || [];" + NL +
    "const floor = (name, f) => { const crit = c.find(x => x.name.toLowerCase().includes(name)); return crit ? crit.score < f : false; };" + NL +
    "const hardBlock = $json.hard_block_triggered || floor('topic', 15) || floor('grounding', 15) || floor('factual', 15) || floor('consistency', 15);" + NL +
    "const score = $json.overall_score;" + NL +
    "let decision;" + NL +
    "if (hardBlock) { decision = score < 60 ? 'reject' : 'revise'; }" + NL +
    "else if (score >= 85) { decision = 'pass'; }" + NL +
    "else if (score >= 60) { decision = 'revise'; }" + NL +
    "else { decision = 'reject'; }" + NL +
    "return [{ json: { ...$json, hardBlock, decision } }];"
);
connect("Insert Evaluation", "Gate");

ifNode("if-pass", "IF Pass", "={{$json.decision}}", "pass", { type: "string", operation: "equals" });
connect("Gate", "IF Pass");

withLane(-260, () => {
  supabaseWrite(
    "mark-approved", "Mark Pending Approval (pass)", "PATCH",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}",
    "={{ JSON.stringify({ status: 'pending_approval' }) }}"
  );
  connect("IF Pass", "Mark Pending Approval (pass)", 0);
  supabaseWrite(
    "log-approved", "Log Event (pass)", "POST",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
    "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'evaluation', status: 'success', detail: `Regenerated draft passed: ${$('Gate').first().json.overall_score}/100.` }) }}"
  );
  connect("Mark Pending Approval (pass)", "Log Event (pass)");
  respondNode(
    "respond-pass", "Respond (pass)",
    "={{ JSON.stringify({ ok: true, status: 'pass', score: $('Gate').first().json.overall_score }) }}"
  );
  connect("Log Event (pass)", "Respond (pass)");
});

// Not pass: either this was the 5th (final) allowed attempt -> needs_human_attention,
// or the human still has attempts left -> back to pending_approval so they can read
// the new draft's evaluation and decide whether to regenerate again, approve anyway
// (Decision #36's guard blocks approving a non-passing version regardless), reject,
// or go back to angle selection.
withLane(260, () => {
  ifNode("if-final-attempt", "IF Final Attempt", "={{$('Config').first().json.is_final_attempt}}", true, { type: "boolean", operation: "equals" });
  connect("IF Pass", "IF Final Attempt", 1);

  withLane(520, () => {
    supabaseWrite(
      "mark-cap", "Mark Needs Attention (cap reached)", "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}",
      "={{ JSON.stringify({ status: 'needs_human_attention' }) }}"
    );
    connect("IF Final Attempt", "Mark Needs Attention (cap reached)", 0);
    supabaseWrite(
      "log-cap", "Log Event (cap reached)", "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'evaluation', status: 'failed', detail: `Regeneration limit (5 attempts) reached, still ${$('Gate').first().json.decision} at ${$('Gate').first().json.overall_score}/100.` }) }}"
    );
    connect("Mark Needs Attention (cap reached)", "Log Event (cap reached)");
    respondNode(
      "respond-cap", "Respond (cap reached)",
      "={{ JSON.stringify({ ok: false, reason: 'regeneration_cap_reached', status: $('Gate').first().json.decision, score: $('Gate').first().json.overall_score }) }}"
    );
    connect("Log Event (cap reached)", "Respond (cap reached)");
  });

  withLane(0, () => {
    supabaseWrite(
      "mark-still-pending", "Mark Pending Approval (not pass, attempts remain)", "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}",
      "={{ JSON.stringify({ status: 'pending_approval' }) }}"
    );
    connect("IF Final Attempt", "Mark Pending Approval (not pass, attempts remain)", 1);
    supabaseWrite(
      "log-still-pending", "Log Event (not pass, attempts remain)", "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'evaluation', status: 'failed', detail: `Regenerated draft still ${$('Gate').first().json.decision} at ${$('Gate').first().json.overall_score}/100. Attempts remain.` }) }}"
    );
    connect("Mark Pending Approval (not pass, attempts remain)", "Log Event (not pass, attempts remain)");
    respondNode(
      "respond-still-pending", "Respond (not pass, attempts remain)",
      "={{ JSON.stringify({ ok: true, status: $('Gate').first().json.decision, score: $('Gate').first().json.overall_score }) }}"
    );
    connect("Log Event (not pass, attempts remain)", "Respond (not pass, attempts remain)");
  });
});

const workflow = {
  name: "Content Agent — Workflow C (Regenerate Main Block)",
  meta: {
    notes:
      "Triggered when a human clicks Regenerate with a required comment on a pending_approval or needs_human_attention article. Reuses the existing chosen angle and existing excerpts (no re-selection) - re-runs Stage 5 (generation) + Stage 6 (Pass 1 evaluation) only, not Workflow B's internal capped auto-revision loop. Capped at 5 human-triggered attempts per article, enforced atomically by the Next.js route (requests.regeneration_count) before this webhook is ever called; this workflow is told via is_final_attempt whether a fail here should escalate to needs_human_attention. SECRETS: Supabase API and Anthropic credentials - map both on import.",
  },
  nodes,
  connections,
};

fs.writeFileSync(
  path.join(__dirname, "..", "n8n", "workflow-c-regenerate.json"),
  JSON.stringify(workflow, null, 2)
);
console.log("Workflow C written. Node count:", nodes.length);
