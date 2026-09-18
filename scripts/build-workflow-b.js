// Authors n8n/workflow-b-generate-and-evaluate.json programmatically, mirroring every
// lesson learned building Workflow A (logged as Errors #3-#7 in week4-progress.md):
//  - alwaysOutputData on any fetch that could legitimately return zero rows where
//    downstream logic (a hard block, a gate) must still run.
//  - executeOnce on any HTTP Request node that could receive >1 input item.
//  - never $json.X directly after a Prefer:return=minimal write - reference the real
//    data-bearing node by name instead.
//  - no raw newlines inside backtick template literals in expressions - always the
//    2-character \n escape, built here via NL constants to avoid any transit-layer
//    mangling through shell/heredoc layers (Error #6).
//  - Count nodes filter alwaysOutputData's placeholder before counting (Error #7).
//  - credentials: Supabase API / Anthropic dedicated types, never secrets inline.
//  - explicit Claude error branch (onError: continueErrorOutput) so a Claude failure
//    logs cleanly and leaves the request in its prior state, per the Retry feature.
"use strict";
const fs = require("fs");
const path = require("path");

const NL = String.fromCharCode(10);
// Use inside any single/double-quoted string literal that itself sits within executable
// ${} code in a Claude prompt - a raw newline there is a JS syntax error (Error #6);
// this is the literal 2-character escape sequence instead, safe anywhere.
const BSN = String.fromCharCode(92, 110);
const SUPABASE_CRED = { id: "supabase-account", name: "Supabase account" };
const ANTHROPIC_CRED = { id: "anthropic-account", name: "Anthropic account" };

const nodes = [];
const connections = {};

// Horizontal layout: main flow advances left-to-right along X; branches (error paths,
// hard-block paths, pass/fail splits) get their own Y lane so they fan out vertically
// at the point they diverge instead of every node stacking in one long column.
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
  xCursor = Math.max(xCursor, savedX); // keep the main line's X moving forward too
  return result;
}

function connect(fromName, toName, outputIndex = 0) {
  connections[fromName] = connections[fromName] || { main: [] };
  while (connections[fromName].main.length <= outputIndex) connections[fromName].main.push([]);
  connections[fromName].main[outputIndex].push({ node: toName, type: "main", index: 0 });
}

// Error #10 (week4-progress.md, found live while testing Workflow C): a plain
// Supabase GET/PATCH/POST node failing (bad credential, transient outage, malformed
// query) crashes the whole n8n execution with a raw 500, completely bypassing
// claudeErrorBranch below since that only guards the Claude HTTP nodes - the request
// was left stuck at whatever status it last reached, with no revert and no way back.
// Fix applied here to every plain Supabase node in this workflow too: onError
// defaults to continueErrorOutput and its error output auto-wires to one shared
// handler (SETUP_FAILURE_HANDLER_NAME, built once below) that reverts the request to
// awaiting_angle_selection and un-chooses the angle - the same safe fallback
// claudeErrorBranch already uses, since nothing downstream of any failed node here
// succeeded either. Opt out per-call with { noAutoErrorHandling: true } - used only
// by the handler's own three writes, to avoid wiring the handler into itself.
const SETUP_FAILURE_HANDLER_NAME = "Pipeline Setup Failure: Extract Error";

function supabaseGet(id, name, url, opts = {}) {
  const node = addNode({
    parameters: {
      url,
      options: {},
      authentication: "predefinedCredentialType",
      nodeCredentialType: "supabaseApi",
    },
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
  if (!opts.noAutoErrorHandling) connect(name, SETUP_FAILURE_HANDLER_NAME, 1);
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
  if (!opts.noAutoErrorHandling) connect(name, SETUP_FAILURE_HANDLER_NAME, 1);
  return node;
}

// Built once, after supabaseGet/supabaseWrite exist. Every plain Supabase node
// created above this call in program order already registered its connection into
// `connections[name]` via the auto-wiring above - connect() just stores name
// strings, so call order relative to this doesn't matter as long as this function
// runs before the script writes the final JSON (it's called immediately below).
function buildSetupFailureHandler() {
  withLane(-580, () => {
    codeNode(
      "setup-error-extract",
      SETUP_FAILURE_HANDLER_NAME,
      "const err = $json.error || {};" + NL +
        "const message = (err.message || JSON.stringify(err) || 'Unknown error').slice(0, 500);" + NL +
        "return [{ json: { requestId: $('Config').first().json.request_id, message } }];"
    );

    supabaseWrite(
      "setup-revert-status",
      "Pipeline Setup Failure: Revert Request State",
      "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$json.requestId}}",
      "={{ JSON.stringify({ status: 'awaiting_angle_selection' }) }}",
      { noAutoErrorHandling: true }
    );
    connect(SETUP_FAILURE_HANDLER_NAME, "Pipeline Setup Failure: Revert Request State");

    supabaseWrite(
      "setup-revert-angle",
      "Pipeline Setup Failure: Revert Angle Choice",
      "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/angles?id=eq.{{$('Config').first().json.angle_id}}",
      "={{ JSON.stringify({ chosen: false }) }}",
      { noAutoErrorHandling: true }
    );
    connect("Pipeline Setup Failure: Revert Request State", "Pipeline Setup Failure: Revert Angle Choice");

    supabaseWrite(
      "setup-log-failed",
      "Pipeline Setup Failure: Log Failed",
      "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      `={{ JSON.stringify({ request_id: $('${SETUP_FAILURE_HANDLER_NAME}').first().json.requestId, stage: 'pipeline_setup', status: 'failed', detail: \`A setup step failed: \${$('${SETUP_FAILURE_HANDLER_NAME}').first().json.message}\` }) }}`,
      { noAutoErrorHandling: true }
    );
    connect("Pipeline Setup Failure: Revert Angle Choice", "Pipeline Setup Failure: Log Failed");

    respondNode(
      "setup-respond-failed",
      "Pipeline Setup Failure: Respond Failed",
      `={{ JSON.stringify({ ok: false, reason: 'setup_failed', detail: $('${SETUP_FAILURE_HANDLER_NAME}').first().json.message }) }}`
    );
    connect("Pipeline Setup Failure: Log Failed", "Pipeline Setup Failure: Respond Failed");
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

// n8n's {{ }} expression fields do their own brace-matching pass before real JS
// evaluation, and a large inlined JSON tool schema plus nested template-literal
// interpolations (lots of braces) can break that matching - confirmed live via
// n8n's own VM compilation error (ExpressionError: invalid syntax at
// Expression.renderExpression), independent of the actual runtime data content.
// Fix: build the ENTIRE request body in a preceding Code node (real JS, no
// brace-matching fragility) and have the HTTP node's jsonBody be the trivial
// expression ={{ $json.requestBody }} - just a property access.
// cachedContextExpr, when given, is a separate JS template-literal expression
// (same shape as promptExpr) holding the large, byte-identical-across-calls part
// of the prompt (e.g. the source excerpts) - split out so it can carry its own
// cache_control breakpoint. Only worth it for prompts actually re-sent multiple
// times within one workflow run (eval/revise rounds reusing the same excerpts) -
// a single-use prompt would just pay the 1.25x write premium with no read to
// offset it, so callers with just one Claude call should leave this unset.
function claudeNode(id, name, model, tool, promptExpr, maxTokens, cachedContextExpr) {
  const builderId = `${id}-build-request`;
  const builderName = `${name}: Build Request`;

  const contentBuild = cachedContextExpr
    ? "const content = [" + NL +
      "  { type: 'text', text: " + cachedContextExpr + ", cache_control: { type: 'ephemeral' } }," + NL +
      "  { type: 'text', text: " + promptExpr + " }" + NL +
      "];"
    : "const content = " + promptExpr + ";";

  codeNode(
    builderId,
    builderName,
    "const tool = " + JSON.stringify(tool) + ";" + NL +
      contentBuild + NL +
      "const requestBody = JSON.stringify({" + NL +
      "  model: '" + model + "'," + NL +
      "  max_tokens: " + maxTokens + "," + NL +
      "  tools: [tool]," + NL +
      "  tool_choice: { type: 'tool', name: '" + tool.name + "' }," + NL +
      "  messages: [{ role: 'user', content }]" + NL +
      "});" + NL +
      "return [{ json: { requestBody } }];",
    { notes: "Builds the full Claude request body in real Code-node JS - see the claudeNode() comment for why this can't live inline in the HTTP node's {{ }} expression." }
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

    // Per the no-partial-progress rule (see week4-progress.md): a Claude failure anywhere in
    // this workflow must leave the request exactly where it was before this attempt, not stuck
    // at 'generating' with no way back (caught live - the request page had no retry path once
    // this happened, since the UI only showed a Retry action for status='researching'). Nothing
    // downstream of the failed call succeeded, so reverting to 'awaiting_angle_selection' and
    // un-choosing the angle is always correct here, regardless of which Claude call failed.
    supabaseWrite(
      `${errId}-revert-status`,
      `${claudeNodeName}: Revert Request State`,
      "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$json.requestId}}",
      "={{ JSON.stringify({ status: 'awaiting_angle_selection' }) }}"
    );
    connect(`${claudeNodeName}: Extract Error`, `${claudeNodeName}: Revert Request State`);

    supabaseWrite(
      `${errId}-revert-angle`,
      `${claudeNodeName}: Revert Angle Choice`,
      "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/angles?id=eq.{{$('Config').first().json.angle_id}}",
      "={{ JSON.stringify({ chosen: false }) }}"
    );
    connect(`${claudeNodeName}: Revert Request State`, `${claudeNodeName}: Revert Angle Choice`);

    supabaseWrite(
      `${errId}-log-failed`,
      `${claudeNodeName}: Log Failed`,
      "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      `={{ JSON.stringify({ request_id: $('${claudeNodeName}: Extract Error').first().json.requestId, stage: '${stage}', status: 'failed', detail: \`Claude call failed: \${$('${claudeNodeName}: Extract Error').first().json.message}\` }) }}`
    );
    connect(`${claudeNodeName}: Revert Angle Choice`, `${claudeNodeName}: Log Failed`);

    respondNode(
      `${errId}-respond-failed`,
      `${claudeNodeName}: Respond Failed`,
      "={{ JSON.stringify({ ok: false, reason: 'claude_failed', detail: $('" + claudeNodeName + ": Extract Error').first().json.message }) }}"
    );
    connect(`${claudeNodeName}: Log Failed`, `${claudeNodeName}: Respond Failed`);
  });
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

// ---------------------------------------------------------------------------
// Trigger + shared setup
// ---------------------------------------------------------------------------

addNode({
  parameters: { path: "wf-b-generate-evaluate", httpMethod: "POST", responseMode: "responseNode", options: {} },
  id: "webhook",
  name: "Webhook: Generate & Evaluate",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
});

codeNode(
  "config",
  "Config",
  "return [{ json: {" + NL +
    "  request_id: $json.body.request_id," + NL +
    "  angle_id: $json.body.angle_id," + NL +
    "  SUPABASE_URL: 'https://klblroceyiirhaxaqflq.supabase.co'" + NL +
    "} }];",
  { notes: "Non-secret config only. Supabase/Anthropic secrets live in n8n Credentials." }
);
connect("Webhook: Generate & Evaluate", "Config");

buildSetupFailureHandler();

supabaseGet(
  "fetch-request",
  "Fetch Request Row",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}&select=*"
);
connect("Config", "Fetch Request Row");

supabaseGet(
  "fetch-angle",
  "Fetch Angle Row",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/angles?id=eq.{{$('Config').first().json.angle_id}}&select=*"
);
connect("Fetch Request Row", "Fetch Angle Row");

supabaseGet(
  "fetch-scraped-sources",
  "Fetch Scraped Sources",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/sources?request_id=eq.{{$('Config').first().json.request_id}}&status=eq.scraped&select=id,url,title,scraped_text",
  { executeOnce: true }
);
connect("Fetch Angle Row", "Fetch Scraped Sources");

codeNode(
  "count-scraped-sources",
  "Count Scraped Sources",
  "const items = $input.all().filter(i => i.json && i.json.id);" + NL +
    "const sources = items.map(i => i.json);" + NL +
    "const sourcesText = sources.map(s => `URL: ${s.url}" + BSN + "TITLE: ${s.title || ''}" + BSN + "${(s.scraped_text || '').slice(0, 6000)}`).join('" + BSN + BSN + "---" + BSN + BSN + "');" + NL +
    "return [{ json: { count: items.length, sources, sourcesText } }];",
  {
    notes:
      "Filters alwaysOutputData's placeholder before counting (Error #7). sourcesText is built " +
      "here in real Code-node JS, not as inline .map/.join inside an HTTP node's {{ }} expression - " +
      "scraped article text routinely contains markdown code fences (backticks), which broke the " +
      "downstream Claude node's expression when spliced into a nested template literal there. A " +
      "Code node evaluates real JS with actual data bindings, so arbitrary content is always safe " +
      "here regardless of what characters it contains.",
  }
);
connect("Fetch Scraped Sources", "Count Scraped Sources");

ifNode("if-zero-sources", "IF Zero Scraped Sources", "={{$json.count}}", 0, { type: "number", operation: "equals" });
connect("Count Scraped Sources", "IF Zero Scraped Sources");

withLane(320, () => {
  supabaseWrite(
    "mark-no-sources", "Mark Needs Attention (no sources)", "PATCH",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}",
    "={{ JSON.stringify({ status: 'needs_human_attention' }) }}"
  );
  connect("IF Zero Scraped Sources", "Mark Needs Attention (no sources)", 0);
  supabaseWrite(
    "log-no-sources", "Log Event (no sources)", "POST",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
    "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'excerpt_selection', status: 'failed', detail: 'No scraped sources available for excerpt extraction.' }) }}"
  );
  connect("Mark Needs Attention (no sources)", "Log Event (no sources)");
  respondNode("respond-no-sources", "Respond (no sources)", "={{ JSON.stringify({ ok: false, reason: 'no_scraped_sources' }) }}");
  connect("Log Event (no sources)", "Respond (no sources)");
});

// ---------------------------------------------------------------------------
// Stage 4 — excerpt selection scoped to the chosen angle
// ---------------------------------------------------------------------------

const EXCERPT_TOOL = {
  name: "select_excerpts",
  description: "Select the passages from the sources genuinely relevant to the chosen angle.",
  input_schema: {
    type: "object",
    required: ["excerpts"],
    properties: {
      excerpts: {
        type: "array",
        items: {
          type: "object",
          required: ["source_url", "text", "reason"],
          properties: {
            source_url: { type: "string" },
            text: { type: "string" },
            reason: { type: "string" },
          },
        },
      },
    },
  },
};

const excerptPrompt =
  "`You are selecting source excerpts for a content angle.\\n\\nChosen angle: ${$('Fetch Angle Row').first().json.working_title}\\nThesis: ${$('Fetch Angle Row').first().json.thesis}\\nSection shape: ${JSON.stringify($('Fetch Angle Row').first().json.section_shape)}\\n\\nSources:\\n${$('Count Scraped Sources').first().json.sourcesText}\\n\\nSelect every passage genuinely relevant to this specific angle - not the whole source, just passages that actually support it. For each, give the exact excerpt text (a real quote, not a paraphrase), which source URL it came from, and a one-line reason. If nothing in a source is relevant, select nothing from it. Return an empty excerpts array if truly nothing across all sources supports this angle.`";

claudeNode("claude-excerpts", "Claude: Select Excerpts", "claude-sonnet-5", EXCERPT_TOOL, excerptPrompt, 4000);
connect("IF Zero Scraped Sources", "Claude: Select Excerpts: Build Request", 1);
claudeErrorBranch("Claude: Select Excerpts", "excerpt_selection", "$('Config').first().json.request_id");

codeNode(
  "parse-excerpts",
  "Parse Excerpts",
  // `|| []` only guards null/undefined. Claude intermittently returns a nested
  // tool-input value as a JSON *string* rather than nesting it (confirmed live on
  // this node: "excerpts.map is not a function", and three times before that on
  // Workflow D's per_channel and channels). A tool schema describes the intended
  // shape, it does not guarantee the model won't serialize it - so parse-if-string
  // first, then insist on an array of real objects before touching it.
  "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL +
    "let excerpts = toolUse.input.excerpts;" + NL +
    "if (typeof excerpts === 'string') { try { excerpts = JSON.parse(excerpts); } catch { excerpts = []; } }" + NL +
    // A keyed object instead of an array is the other shape this has taken live
    // (Workflow D's Error #84). Unlike per_channel the keys carry no meaning here,
    // so the values alone are a faithful recovery rather than a guess.
    "if (!Array.isArray(excerpts) && excerpts && typeof excerpts === 'object') excerpts = Object.values(excerpts);" + NL +
    "if (!Array.isArray(excerpts)) excerpts = [];" + NL +
    "excerpts = excerpts.filter(e => e && typeof e === 'object');" + NL +
    "const sources = $('Count Scraped Sources').first().json.sources;" + NL +
    "const requestId = $('Config').first().json.request_id;" + NL +
    "const mapped = excerpts.map(e => {" + NL +
    "  const source = sources.find(s => s.url === e.source_url);" + NL +
    "  return { request_id: requestId, source_id: source ? source.id : null, text: e.text, reason: e.reason };" + NL +
    "}).filter(e => e.source_id);" + NL +
    "return [{ json: { requestId, excerpts: mapped } }];"
);
connect("Claude: Select Excerpts", "Parse Excerpts", 0);

ifNode("if-zero-excerpts", "IF Zero Excerpts", "={{$json.excerpts.length}}", 0, { type: "number", operation: "equals" });
connect("Parse Excerpts", "IF Zero Excerpts");

withLane(320, () => {
  supabaseWrite(
    "mark-no-excerpts", "Mark Needs Attention (no excerpts)", "PATCH",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$json.requestId}}",
    "={{ JSON.stringify({ status: 'needs_human_attention' }) }}"
  );
  connect("IF Zero Excerpts", "Mark Needs Attention (no excerpts)", 0);
  supabaseWrite(
    "log-no-excerpts", "Log Event (no excerpts)", "POST",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
    "={{ JSON.stringify({ request_id: $('Parse Excerpts').first().json.requestId, stage: 'excerpt_selection', status: 'failed', detail: 'Sources loaded fine but none contained a passage relevant to the chosen angle.' }) }}"
  );
  connect("Mark Needs Attention (no excerpts)", "Log Event (no excerpts)");
  respondNode("respond-no-excerpts", "Respond (no excerpts)", "={{ JSON.stringify({ ok: false, reason: 'zero_relevant_excerpts' }) }}");
  connect("Log Event (no excerpts)", "Respond (no excerpts)");
});

supabaseWrite(
  "insert-excerpts", "Insert Excerpts", "POST",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/excerpts",
  "={{ JSON.stringify($json.excerpts) }}",
  { returnMinimal: false }
);
connect("IF Zero Excerpts", "Insert Excerpts", 1);

supabaseGet(
  "fetch-excerpts", "Fetch Excerpts",
  // sources(url) is a PostgREST embedded select over the excerpts -> sources FK.
  // Without it the prompt only ever had source_id, so Claude cited raw UUIDs.
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/excerpts?request_id=eq.{{$('Config').first().json.request_id}}&select=id,text,reason,source_id,sources(url)"
);
connect("Insert Excerpts", "Fetch Excerpts");

codeNode(
  "build-excerpts-text",
  "Build Excerpts Text",
  "const excerpts = $input.all().map(i => i.json);" + NL +
    "const withReason = excerpts.map((e, i) => `[${i}] ${e.text} (reason selected: ${e.reason})`).join('" + BSN + BSN + "');" + NL +
    "const plain = excerpts.map((e, i) => `[${i}] Source: ${(e.sources && e.sources.url) || e.source_id}" + BSN + "${e.text}`).join('" + BSN + BSN + "');" + NL +
    "return [{ json: { excerpts, excerptsTextWithReason: withReason, excerptsTextPlain: plain } }];",
  {
    notes:
      "Same fix as Build Sources Text: excerpt text can itself contain backticks (Claude may " +
      "quote code from a source), so this formatting happens in real Code-node JS rather than " +
      "inline .map/.join inside a downstream HTTP node's {{ }} expression.",
  }
);
connect("Fetch Excerpts", "Build Excerpts Text");

// ---------------------------------------------------------------------------
// Stage 5 — generate the main block
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

const generatePrompt =
  "`Write a full SEO article grounded only in the excerpts below - no unsupported claims or invented statistics. If the excerpts can't adequately support the desired length, write a shorter, fully-grounded article and say so isn't needed in the output, just write what's honestly supportable.\\n\\nWorking title: ${$('Fetch Angle Row').first().json.working_title}\\nThesis: ${$('Fetch Angle Row').first().json.thesis}\\nSection shape: ${JSON.stringify($('Fetch Angle Row').first().json.section_shape)}\\nPrimary keyword (must appear naturally, including in a heading): ${$('Fetch Request Row').first().json.primary_keyword}\\nDesired length: ${$('Fetch Request Row').first().json.desired_length || 'no specific target'}\\nContext from the manager: ${$('Fetch Request Row').first().json.context || 'none'}\\n\\nGrounded excerpts (cite the source URL inline as [Source: url] after any claim drawn from it):\\n${$('Build Excerpts Text').first().json.excerptsTextWithReason}\\n\\nWrite in markdown with proper H1/H2 heading hierarchy.\\n\\nHouse style: never use em dashes (the character U+2014) anywhere in the output. Use a full stop, a comma, a colon or parentheses instead. Do not state anything the excerpts do not support, and do not use hedging language to smuggle in a claim you cannot cite.`";

claudeNode("claude-generate", "Claude: Generate Article", "claude-sonnet-5", ARTICLE_TOOL, generatePrompt, 4000);
connect("Build Excerpts Text", "Claude: Generate Article: Build Request");
claudeErrorBranch("Claude: Generate Article", "generation", "$('Config').first().json.request_id");

codeNode(
  "parse-generated",
  "Parse Generated Article",
  "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL +
    "return [{ json: toolUse.input }];"
);
connect("Claude: Generate Article", "Parse Generated Article", 0);

supabaseWrite(
  "insert-section-v1", "Insert Section v1", "POST",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/sections",
  "={{ JSON.stringify({ request_id: $('Config').first().json.request_id, angle_id: $('Config').first().json.angle_id, version: 1, title: $json.title, body_markdown: $json.body_markdown, primary_keyword: $('Fetch Request Row').first().json.primary_keyword, secondary_keywords: $json.secondary_keywords, generation_status: 'generated' }) }}",
  { returnMinimal: false }
);
connect("Parse Generated Article", "Insert Section v1");

// ---------------------------------------------------------------------------
// Stage 6 — Pass 1 evaluation, and Stage 7 — bounded revision loop (cap 2)
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
      sections_needing_revision: { type: "array", items: { type: "string" } },
      recommended_changes: { type: "array", items: { type: "string" } },
      weakest_criteria_suggestions: { type: "array", items: { type: "string" } },
      hard_block_triggered: { type: "boolean" },
      hard_block_reason: { type: ["string", "null"] },
    },
  },
};

const RUBRIC_TEXT =
  "Score out of 100 across: Topic Relevance (20, floor 15), Source Grounding (20, floor 15), Factual Consistency (20, floor 15), Audience Fit (15, floor 6), SEO Fit (10, floor 4), Clarity (10, floor 4), Completeness (5, floor 2). Topic Relevance/Source Grounding/Factual Consistency are hard-block tier: if any scores below its floor, hard_block_triggered must be true regardless of the total. Verify every claim against the excerpt it cites and flag any claim citing nothing. Always populate weakest_criteria_suggestions, even on a passing score - a passing draft can still have one mediocre criterion worth naming.";

// Prompt caching re-enabled. The excerpts and rubric are byte-identical across all
// three eval rounds in a run, so they become the cached prefix; the article body,
// which is exactly what changes each round, stays in the uncached tail.
const EVAL_CACHED_CONTEXT =
  "`Grounded excerpts to check this article against:\\n${$('Build Excerpts Text').first().json.excerptsTextPlain}\\n\\nRubric: " +
  RUBRIC_TEXT +
  "`";

function evalPrompt(bodyExpr) {
  return (
    "`Evaluate the article below against the rubric and excerpts above. You have not seen how it was written or planned - judge only what's here.\\n\\nArticle:\\n${" +
    bodyExpr +
    "}`"
  );
}

function gateCode(varName) {
  return (
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
}

function buildEvalRound(roundLabel, sectionSourceName, isFinalRound) {
  const idBase = roundLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase();

  claudeNode(
    `claude-eval-${idBase}`,
    `Claude: Evaluate (${roundLabel})`,
    "claude-opus-5",
    EVAL_TOOL,
    evalPrompt(`$('${sectionSourceName}').first().json.body_markdown`),
    3000,
    EVAL_CACHED_CONTEXT
  );
  connect(sectionSourceName, `Claude: Evaluate (${roundLabel}): Build Request`);
  claudeErrorBranch(`Claude: Evaluate (${roundLabel})`, "evaluation", "$('Config').first().json.request_id");

  codeNode(
    `parse-eval-${idBase}`,
    `Parse Evaluation (${roundLabel})`,
    "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL + "return [{ json: toolUse.input }];"
  );
  connect(`Claude: Evaluate (${roundLabel})`, `Parse Evaluation (${roundLabel})`, 0);

  supabaseWrite(
    `insert-eval-${idBase}`,
    `Insert Evaluation (${roundLabel})`,
    "POST",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/evaluation_results",
    `={{ JSON.stringify({ request_id: $('Config').first().json.request_id, section_id: $('${sectionSourceName}').first().json.id, pass: 'pass_1_article', content_version: $('${sectionSourceName}').first().json.version, overall_score: $json.overall_score, status: $json.status, criteria: $json.criteria, unsupported_or_weak_claims: $json.unsupported_or_weak_claims, weakest_criteria_suggestions: $json.weakest_criteria_suggestions, hard_block_triggered: $json.hard_block_triggered, hard_block_reason: $json.hard_block_reason }) }}`,
    { returnMinimal: false }
  );
  connect(`Parse Evaluation (${roundLabel})`, `Insert Evaluation (${roundLabel})`);

  // Gate reads from the write's own return=representation output, not a separate
  // reference back to Parse Evaluation - either works, but this keeps the chain
  // linear and matches what actually got persisted (see Error #3 in
  // week4-progress.md: never assume $json survives a return=minimal write).
  codeNode(`gate-${idBase}`, `Gate (${roundLabel})`, gateCode());
  connect(`Insert Evaluation (${roundLabel})`, `Gate (${roundLabel})`);

  ifNode(`if-pass-${idBase}`, `IF Pass (${roundLabel})`, "={{$json.decision}}", "pass", { type: "string", operation: "equals" });
  connect(`Gate (${roundLabel})`, `IF Pass (${roundLabel})`);

  withLane(-260, () => {
  supabaseWrite(
    `mark-approved-${idBase}`, `Mark Pending Approval (${roundLabel})`, "PATCH",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}",
    "={{ JSON.stringify({ status: 'pending_approval' }) }}"
  );
  connect(`IF Pass (${roundLabel})`, `Mark Pending Approval (${roundLabel})`, 0);
  supabaseWrite(
    `log-approved-${idBase}`, `Log Event (pass, ${roundLabel})`, "POST",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
    `={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'evaluation', status: 'success', detail: \`Pass 1 passed at ${roundLabel}: \${$('Gate (${roundLabel})').first().json.overall_score}/100.\` }) }}`
  );
  connect(`Mark Pending Approval (${roundLabel})`, `Log Event (pass, ${roundLabel})`);
  respondNode(
    `respond-pass-${idBase}`,
    `Respond (pass, ${roundLabel})`,
    `={{ JSON.stringify({ ok: true, status: 'pass', score: $('Gate (${roundLabel})').first().json.overall_score }) }}`
  );
  connect(`Log Event (pass, ${roundLabel})`, `Respond (pass, ${roundLabel})`);
  });

  // Not pass: either final-round-fail (needs_human_attention) or continue to next revision round.
  if (isFinalRound) {
    withLane(260, () => {
    supabaseWrite(
      `mark-cap-${idBase}`, `Mark Needs Attention (cap reached)`, "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}",
      "={{ JSON.stringify({ status: 'needs_human_attention' }) }}"
    );
    connect(`IF Pass (${roundLabel})`, `Mark Needs Attention (cap reached)`, 1);
    supabaseWrite(
      `log-cap-${idBase}`, `Log Event (cap reached)`, "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      `={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'evaluation', status: 'failed', detail: \`Revision cap (2 rounds) reached, still \${$('Gate (${roundLabel})').first().json.decision} at \${$('Gate (${roundLabel})').first().json.overall_score}/100.\` }) }}`
    );
    connect(`Mark Needs Attention (cap reached)`, `Log Event (cap reached)`);
    respondNode(
      `respond-cap-${idBase}`,
      `Respond (cap reached)`,
      `={{ JSON.stringify({ ok: false, reason: 'revision_cap_reached', status: $('Gate (${roundLabel})').first().json.decision, score: $('Gate (${roundLabel})').first().json.overall_score }) }}`
    );
    connect(`Log Event (cap reached)`, `Respond (cap reached)`);
    });
    return null;
  }

  return `IF Pass (${roundLabel})`; // caller connects output 1 (not-pass) into the next round's revise step
}

const round0FailOutput = buildEvalRound("Round 0", "Insert Section v1", false);

// Revision rounds: revise -> insert new section version -> evaluate -> gate.
function buildRevisionRound(roundNum, prevGateIfName, prevSectionName) {
  const label = `Round ${roundNum}`;
  const idBase = `revise-${roundNum}`;

  const revisePrompt =
    "`Revise this article based on the evaluation feedback below. Address the flagged sections and unsupported claims specifically - stay grounded only in the excerpts, don't invent anything new to fill gaps.\\n\\nCurrent article:\\n${$('" +
    prevSectionName +
    "').first().json.body_markdown}\\n\\nSections needing revision: ${JSON.stringify($('Gate (" +
    (roundNum === 1 ? "Round 0" : `Round ${roundNum - 1}`) +
    ")').first().json.sections_needing_revision)}\\nRecommended changes: ${JSON.stringify($('Gate (" +
    (roundNum === 1 ? "Round 0" : `Round ${roundNum - 1}`) +
    ")').first().json.recommended_changes)}\\nUnsupported/weak claims flagged: ${JSON.stringify($('Gate (" +
    (roundNum === 1 ? "Round 0" : `Round ${roundNum - 1}`) +
    ")').first().json.unsupported_or_weak_claims)}`";

  // Same excerpts block for both revise rounds, so they share one cache entry.
  const REVISE_CACHED_CONTEXT =
    "`Grounded excerpts available:\\n${$('Build Excerpts Text').first().json.excerptsTextPlain}`";

  claudeNode(`claude-${idBase}`, `Claude: Revise (${label})`, "claude-sonnet-5", ARTICLE_TOOL, revisePrompt, 4000, REVISE_CACHED_CONTEXT);
  connect(prevGateIfName, `Claude: Revise (${label}): Build Request`, 1);
  claudeErrorBranch(`Claude: Revise (${label})`, "revision", "$('Config').first().json.request_id");

  codeNode(
    `parse-${idBase}`,
    `Parse Revised Article (${label})`,
    "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL + "return [{ json: toolUse.input }];"
  );
  connect(`Claude: Revise (${label})`, `Parse Revised Article (${label})`, 0);

  supabaseWrite(
    `insert-section-${idBase}`,
    `Insert Section v${roundNum + 1}`,
    "POST",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/sections",
    `={{ JSON.stringify({ request_id: $('Config').first().json.request_id, angle_id: $('Config').first().json.angle_id, version: ${roundNum + 1}, title: $json.title, body_markdown: $json.body_markdown, primary_keyword: $('Fetch Request Row').first().json.primary_keyword, secondary_keywords: $json.secondary_keywords, generation_status: 'generated' }) }}`,
    { returnMinimal: false }
  );
  connect(`Parse Revised Article (${label})`, `Insert Section v${roundNum + 1}`);

  return `Insert Section v${roundNum + 1}`;
}

if (round0FailOutput) {
  const section2 = buildRevisionRound(1, round0FailOutput, "Insert Section v1");
  const round1FailOutput = buildEvalRound("Round 1", section2, false);

  if (round1FailOutput) {
    const section3 = buildRevisionRound(2, round1FailOutput, section2);
    buildEvalRound("Round 2", section3, true); // final round — cap reached on failure
  }
}

const workflow = {
  name: "Content Agent — Workflow B (Generate & Evaluate)",
  meta: {
    notes:
      "Triggered when a human picks an angle. Stage 4 (excerpt extraction scoped to the angle) -> Stage 5 (generation, Sonnet) -> Stage 6 (Pass 1 evaluation, Opus) -> Stage 7 (revision loop, capped at 2 rounds, unrolled as three fixed blocks rather than a true n8n loop since regular nodes can't form cycles - SplitInBatches is the only looping construct n8n supports). SECRETS: Supabase API and Anthropic credentials, same as Workflow A - map both on import.",
  },
  nodes,
  connections,
};

fs.writeFileSync(
  path.join(__dirname, "..", "n8n", "workflow-b-generate-and-evaluate.json"),
  JSON.stringify(workflow, null, 2)
);
console.log("Workflow B written. Node count:", nodes.length);
