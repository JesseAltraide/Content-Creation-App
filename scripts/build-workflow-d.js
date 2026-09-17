// Authors n8n/workflow-d-adapt-and-evaluate.json programmatically. Workflow D =
// "Adapt to Channels" (week4-full-flow.md): triggered automatically when a human
// approves the article (see approve/route.ts) - Stage 9's combined adaptation call
// (Decision #65: one Claude call generates all three channel posts together, not
// three separate calls) + combined Pass 2 evaluation, revision-capped at 2 rounds
// same as Pass 1 (Decision #8's pattern, restated for Pass 2 in week4-full-flow.md).
//
// Tone variants: Decision #66 stands (confirmed directly by the programmer over a
// conflicting later decision, see week4-progress.md) - one variant per channel by
// default; a second "alternate tone" variant is a separate, explicitly human-
// triggered action (not built by this workflow - Workflow D always produces exactly
// one variant per channel, tone_variant='default', chosen=true).
//
// Reuses every structural lesson from Workflows A-C (week4-progress.md Errors
// #3-#11): build the full Claude request body in a preceding Code node (never
// inline in an HTTP node's {{ }} expression), alwaysOutputData on fetches that could
// legitimately return zero rows, onError: continueErrorOutput + a shared revert
// handler on every plain Supabase node (not just the Claude calls) from the start
// this time, rather than retrofitting it after a live crash like B and C needed.
"use strict";
const fs = require("fs");
const path = require("path");

const NL = String.fromCharCode(10);
const BSN = String.fromCharCode(92, 110);
const SUPABASE_CRED = { id: "supabase-account", name: "Supabase account" };
const ANTHROPIC_CRED = { id: "anthropic-account", name: "Anthropic account" };

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

const SETUP_FAILURE_HANDLER_NAME = "Pipeline Setup Failure: Extract Error";

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
  return httpNode;
}

// Claude failures always revert to 'approved' - the one and only state this workflow
// ever starts from (unlike Workflow C, which could start from either pending_approval
// or needs_human_attention). Nothing downstream of a failed call succeeded, so
// reverting the whole batch and letting the human retry adaptation is always correct.
function claudeErrorBranch(claudeNodeName, stage) {
  withLane(-320, () => {
    const errId = claudeNodeName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
    codeNode(
      `${errId}-error-extract`,
      `${claudeNodeName}: Extract Error`,
      "const err = $json.error || {};" + NL +
        "const message = (err.message || JSON.stringify(err) || 'Unknown Claude API error').slice(0, 500);" + NL +
        "return [{ json: { requestId: $('Config').first().json.request_id, message } }];"
    );
    connect(claudeNodeName, `${claudeNodeName}: Extract Error`, 1);

    supabaseWrite(
      `${errId}-revert-status`,
      `${claudeNodeName}: Revert Request State`,
      "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$json.requestId}}",
      "={{ JSON.stringify({ status: 'approved' }) }}",
      { noAutoErrorHandling: true }
    );
    connect(`${claudeNodeName}: Extract Error`, `${claudeNodeName}: Revert Request State`);

    supabaseWrite(
      `${errId}-log-failed`,
      `${claudeNodeName}: Log Failed`,
      "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      `={{ JSON.stringify({ request_id: $('${claudeNodeName}: Extract Error').first().json.requestId, stage: '${stage}', status: 'failed', detail: \`Claude call failed: \${$('${claudeNodeName}: Extract Error').first().json.message}\` }) }}`,
      { noAutoErrorHandling: true }
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
      "={{ JSON.stringify({ status: 'approved' }) }}",
      { noAutoErrorHandling: true }
    );
    connect(SETUP_FAILURE_HANDLER_NAME, "Pipeline Setup Failure: Revert Request State");

    supabaseWrite(
      "setup-log-failed",
      "Pipeline Setup Failure: Log Failed",
      "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      "={{ JSON.stringify({ request_id: $('Pipeline Setup Failure: Extract Error').first().json.requestId, stage: 'channel_adaptation', status: 'failed', detail: `Couldn't start adaptation: ${$('Pipeline Setup Failure: Extract Error').first().json.message}` }) }}",
      { noAutoErrorHandling: true }
    );
    connect("Pipeline Setup Failure: Revert Request State", "Pipeline Setup Failure: Log Failed");

    respondNode(
      "setup-respond-failed",
      "Pipeline Setup Failure: Respond Failed",
      "={{ JSON.stringify({ ok: false, reason: 'setup_failed', detail: $('Pipeline Setup Failure: Extract Error').first().json.message }) }}"
    );
    connect("Pipeline Setup Failure: Log Failed", "Pipeline Setup Failure: Respond Failed");
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
  parameters: { path: "wf-d-adapt-evaluate", httpMethod: "POST", responseMode: "responseNode", options: {} },
  id: "webhook",
  name: "Webhook: Adapt & Evaluate",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
});

codeNode(
  "config",
  "Config",
  "return [{ json: {" + NL +
    "  request_id: $json.body.request_id," + NL +
    "  SUPABASE_URL: 'https://klblroceyiirhaxaqflq.supabase.co'" + NL +
    "} }];",
  { notes: "Non-secret config only. Supabase/Anthropic secrets live in n8n Credentials." }
);
connect("Webhook: Adapt & Evaluate", "Config");

buildSetupFailureHandler();

supabaseGet(
  "fetch-request", "Fetch Request Row",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}&select=*"
);
connect("Config", "Fetch Request Row");

supabaseGet(
  "fetch-section", "Fetch Approved Section",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/sections?request_id=eq.{{$('Config').first().json.request_id}}&order=version.desc&limit=1&select=*"
);
connect("Fetch Request Row", "Fetch Approved Section");

// resolved_audience_profile_id can genuinely be null (no audience profile configured
// yet) - PostgREST rejects `id=eq.null` outright as an invalid UUID (400 Bad
// Request), which is exactly what crashed here on first live test. Falling back to
// the nil UUID keeps the query syntactically valid and just yields zero rows, which
// Build Adaptation Context already handles the same way as "no profile fetched".
supabaseGet(
  "fetch-audience", "Fetch Audience Profile",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/audience_profiles?id=eq.{{$('Fetch Request Row').first().json.resolved_audience_profile_id || '00000000-0000-0000-0000-000000000000'}}&select=*"
);
connect("Fetch Approved Section", "Fetch Audience Profile");

supabaseGet(
  "fetch-tone-samples", "Fetch Tone Samples",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/tone_samples?select=*",
  { executeOnce: true }
);
connect("Fetch Audience Profile", "Fetch Tone Samples");

supabaseGet(
  "fetch-excerpts", "Fetch Excerpts",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/excerpts?request_id=eq.{{$('Config').first().json.request_id}}&select=id,text,reason,source_id"
);
connect("Fetch Tone Samples", "Fetch Excerpts");

codeNode(
  "build-context", "Build Adaptation Context",
  "const req = $('Fetch Request Row').first().json;" + NL +
    "const audience = ($('Fetch Audience Profile').all().map(i => i.json).find(a => a && a.id)) || null;" + NL +
    "const toneSamples = $('Fetch Tone Samples').all().map(i => i.json).filter(t => t && t.id && req.channels.includes(t.channel));" + NL +
    "const toneByChannel = {};" + NL +
    "for (const ch of req.channels) {" + NL +
    "  const samples = toneSamples.filter(t => t.channel === ch);" + NL +
    "  toneByChannel[ch] = samples.length" + NL +
    "    ? samples.map(s => `[${s.source}] ${s.content}`).join('" + BSN + BSN + "---" + BSN + BSN + "')" + NL +
    "    : 'No tone samples on file for this channel - use a neutral, professional default tone.';" + NL +
    "}" + NL +
    "const excerpts = $('Fetch Excerpts').all().map(i => i.json).filter(e => e && e.id);" + NL +
    "const excerptsTextPlain = excerpts.map((e, i) => `[${i}] Source: ${e.source_id}" + BSN + "${e.text}`).join('" + BSN + BSN + "');" + NL +
    "return [{ json: {" + NL +
    "  channels: req.channels," + NL +
    "  x_thread_length: req.x_thread_length || 'single'," + NL +
    "  audienceText: audience ? audience.description : 'No audience profile on file - write for a general professional audience.'," + NL +
    "  toneByChannel," + NL +
    "  excerptsTextPlain" + NL +
    "} }];",
  {
    notes:
      "Aggregates per-channel tone samples, the resolved audience profile, and grounding excerpts into one object the adaptation prompt reads from. Real JS here, not inline HTTP-node expressions, since tone sample content and excerpt text can contain arbitrary characters (backticks, quotes) that break n8n's {{ }} brace-matching (Workflow B Error #9).",
  }
);
connect("Fetch Excerpts", "Build Adaptation Context");

// ---------------------------------------------------------------------------
// Stage 9 — combined adaptation call (Decision #65: one call, all three channels)
// ---------------------------------------------------------------------------

const ADAPT_TOOL = {
  name: "adapt_to_channels",
  description: "Adapt the approved article into platform-native posts for each requested channel.",
  input_schema: {
    type: "object",
    required: ["channels"],
    properties: {
      channels: {
        type: "object",
        properties: {
          linkedin: {
            type: "object",
            properties: { body_markdown: { type: "string" } },
          },
          x: {
            type: "object",
            properties: {
              posts: { type: "array", items: { type: "string" }, description: "1 post for a single post, 3+ for a thread" },
            },
          },
          newsletter: {
            type: "object",
            properties: {
              subject_line: { type: "string" },
              body_markdown: { type: "string" },
            },
          },
        },
      },
    },
  },
};

function adaptPrompt(feedbackExpr) {
  return (
    "`Adapt this approved article into platform-native posts for these channels: ${$('Build Adaptation Context').first().json.channels.join(', ')}.\\n\\n" +
    "Article title: ${$('Fetch Approved Section').first().json.title}\\nArticle body:\\n${$('Fetch Approved Section').first().json.body_markdown}\\n\\n" +
    "Audience: ${$('Build Adaptation Context').first().json.audienceText}\\n\\n" +
    "Only produce a 'linkedin' key if linkedin is in the requested channels, only 'x' if x is requested, only 'newsletter' if newsletter is requested. " +
    "For each requested channel, write in that channel's own real voice and format, grounded only in the article and its underlying excerpts below - no unsupported claims, and every claim must stay traceable to the same source material as the article itself:\\n${$('Build Adaptation Context').first().json.excerptsTextPlain}\\n\\n" +
    "LinkedIn: PAS structure (Problem-Agitate-Solution), short paragraphs, sparing emoji, a clear CTA. Tone reference (real previous posts or a described target, follow this voice):\\n${$('Build Adaptation Context').first().json.toneByChannel.linkedin || 'not requested'}\\n\\n" +
    "X: hook-first, one core idea per post, line breaks over hashtags, at most 1-2 hashtags and only on the final post if threaded. The human requested '${$('Build Adaptation Context').first().json.x_thread_length}' - 'single' means exactly one post, 'mini' means roughly 3 posts, 'expansive' means roughly 5 posts. Never pad to hit a target count - if the idea genuinely doesn't need that many posts, write fewer and say nothing about it. Each individual post must fit in 280 characters - this will be checked programmatically, so respect it exactly, don't rely on being checked. Tone reference:\\n${$('Build Adaptation Context').first().json.toneByChannel.x || 'not requested'}\\n\\n" +
    "Newsletter: a subject line, a 1-3 sentence intro, a skimmable body, and a closing CTA, 250-600 words total in body_markdown. Tone reference:\\n${$('Build Adaptation Context').first().json.toneByChannel.newsletter || 'not requested'}" +
    (feedbackExpr ? "\\n\\nThe previous attempt needs these specific changes: ${" + feedbackExpr + "}" : "") +
    "`"
  );
}

claudeNode("claude-adapt", "Claude: Adapt to Channels", "claude-sonnet-5", ADAPT_TOOL, adaptPrompt(null), 4000);
connect("Build Adaptation Context", "Claude: Adapt to Channels: Build Request");
claudeErrorBranch("Claude: Adapt to Channels", "channel_adaptation");

codeNode(
  "parse-adapted", "Parse Adapted Content",
  "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL +
    "return [{ json: toolUse.input.channels || {} }];"
);
connect("Claude: Adapt to Channels", "Parse Adapted Content", 0);

// X length is enforced programmatically (Decision #11), never left to the model
// following instructions correctly - and never silently truncated/padded either
// (Decision #35): a post over 280 chars is a genuine failure that forces a revision,
// not something this workflow quietly fixes by cutting text and changing the meaning.
codeNode(
  "validate-x-length", "Validate X Length",
  "const channels = $json;" + NL +
    "const x = channels.x;" + NL +
    "const posts = x && Array.isArray(x.posts) ? x.posts : [];" + NL +
    "const overLimit = posts.filter(p => p.length > 280);" + NL +
    "return [{ json: { ...channels, x_length_violation: overLimit.length > 0, x_over_limit_count: overLimit.length } }];"
);
connect("Parse Adapted Content", "Validate X Length");

// Builds the insert payload in a preceding Code node (real JS) rather than an inline
// IIFE inside the HTTP node's {{ }} expression - the exact mistake that broke
// Workflow B (Error #9): n8n's expression engine does its own brace-matching before
// real JS evaluation and chokes on complex inline expressions regardless of whether
// the JS itself is valid.
function insertChannelPostsNode(id, name, sourceNodeName, version) {
  const builderId = `${id}-build-rows`;
  const builderName = `${name}: Build Rows`;

  codeNode(
    builderId,
    builderName,
    "const ch = $('" + sourceNodeName + "').first().json;" + NL +
      "const requestId = $('Config').first().json.request_id;" + NL +
      `const version = ${version};` + NL +
      "const rows = [];" + NL +
      "if (ch.linkedin) rows.push({ request_id: requestId, channel: 'linkedin', version, body: ch.linkedin.body_markdown, tone_variant: 'default', chosen: true });" + NL +
      "if (ch.x) rows.push({ request_id: requestId, channel: 'x', version, body: JSON.stringify(ch.x.posts || []), tone_variant: 'default', chosen: true });" + NL +
      "if (ch.newsletter) rows.push({ request_id: requestId, channel: 'newsletter', version, body: JSON.stringify({ subject_line: ch.newsletter.subject_line, body_markdown: ch.newsletter.body_markdown }), tone_variant: 'default', chosen: true });" + NL +
      "return [{ json: { rows: JSON.stringify(rows) } }];",
    { notes: "X posts and the newsletter's subject/body pair don't fit a single plain-text `body` column cleanly, so both are stored as JSON-stringified structures in that column; the UI parses them back out by channel." }
  );
  connect(sourceNodeName, builderName);

  supabaseWrite(
    id, name, "POST",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/channel_posts",
    "={{ $json.rows }}",
    { returnMinimal: false }
  );
  connect(builderName, name);
}

insertChannelPostsNode("insert-channel-posts-v1", "Insert Channel Posts v1", "Validate X Length", 1);

supabaseGet(
  "fetch-channel-posts-v1", "Fetch Channel Posts v1",
  "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/channel_posts?request_id=eq.{{$('Config').first().json.request_id}}&version=eq.1&select=*"
);
connect("Insert Channel Posts v1", "Fetch Channel Posts v1");

// ---------------------------------------------------------------------------
// Pass 2 evaluation, revision-capped at 2 rounds (same cap as Pass 1, restated for
// Pass 2 in week4-full-flow.md) - unrolled as fixed sequential blocks since n8n has
// no cycle construct outside SplitInBatches (Workflow B's same reasoning).
// ---------------------------------------------------------------------------

const EVAL_TOOL = {
  name: "evaluate_channel_posts",
  description: "Score each channel's adapted post against the Pass 2 rubric.",
  input_schema: {
    type: "object",
    required: ["per_channel"],
    properties: {
      per_channel: {
        type: "object",
        description: "Keyed by channel name (linkedin/x/newsletter), only for channels that were adapted",
        additionalProperties: {
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
      },
    },
  },
};

const PASS2_RUBRIC_TEXT =
  "Score each channel's post out of 100 across: Factual Consistency re-verified against the excerpts (20, floor 15 - hard block tier, re-checks the claims survived adaptation unchanged), Tone (25, floor 10), Channel Fit (25, floor 10 - does it genuinely read as native to that platform, not just the article reformatted), Audience Fit re-verified (15, floor 6), Clarity (15, floor 6). Topic Relevance, SEO Fit, and Completeness do not apply post-adaptation - do not score them. If Factual Consistency scores below its floor, hard_block_triggered must be true regardless of the total.";

function pass2EvalPrompt(sourceNodeName) {
  return (
    "`Evaluate each adapted channel post below against the rubric. You have not seen the adaptation reasoning - judge only what's here.\\n\\nRubric: " +
    PASS2_RUBRIC_TEXT +
    "\\n\\nOriginal article (for factual comparison):\\n${$('Fetch Approved Section').first().json.body_markdown}\\n\\n" +
    "Grounded excerpts:\\n${$('Build Adaptation Context').first().json.excerptsTextPlain}\\n\\n" +
    "Adapted posts to evaluate:\\n${JSON.stringify($('" + sourceNodeName + "').all().map(i => ({ channel: i.json.channel, body: i.json.body })))}`"
  );
}

// Builds both the gate decision AND the evaluation_results insert rows in one Code
// node (real JS) - keeping the row-building here instead of a separate inline HTTP
// expression avoids yet another large inline IIFE inside an HTTP node's {{ }} field
// (the same mistake already caught once in this file, and the root cause of
// Workflow B's Error #9).
function pass2GateCode(channelPostsSourceName, xLengthSourceName) {
  return (
    "const perChannel = $json.per_channel || {};" + NL +
    "const results = {};" + NL +
    "let anyReject = false;" + NL +
    "let allPass = true;" + NL +
    "for (const [channel, r] of Object.entries(perChannel)) {" + NL +
    "  const c = r.criteria || [];" + NL +
    "  const floor = (name, f) => { const crit = c.find(x => x.name.toLowerCase().includes(name)); return crit ? crit.score < f : false; };" + NL +
    "  const hardBlock = r.hard_block_triggered || floor('factual', 15);" + NL +
    "  let decision;" + NL +
    `  if (channel === 'x' && $('${xLengthSourceName}').first().json.x_length_violation) { decision = 'revise'; }` + NL +
    "  else if (hardBlock) { decision = r.overall_score < 60 ? 'reject' : 'revise'; }" + NL +
    "  else if (r.overall_score >= 85) { decision = 'pass'; }" + NL +
    "  else if (r.overall_score >= 60) { decision = 'revise'; }" + NL +
    "  else { decision = 'reject'; }" + NL +
    "  if (decision === 'reject') anyReject = true;" + NL +
    "  if (decision !== 'pass') allPass = false;" + NL +
    "  results[channel] = { ...r, hardBlock, decision };" + NL +
    "}" + NL +
    `const posts = $('${channelPostsSourceName}').all().map(i => i.json);` + NL +
    "const requestId = $('Config').first().json.request_id;" + NL +
    "const sectionId = $('Fetch Approved Section').first().json.id;" + NL +
    "const evalRows = Object.entries(results).map(([channel, r]) => {" + NL +
    "  const post = posts.find(p => p.channel === channel);" + NL +
    "  return { request_id: requestId, section_id: sectionId, channel, pass: 'pass_2_channel', content_version: post ? post.version : 1, overall_score: r.overall_score, status: r.decision, criteria: r.criteria, weakest_criteria_suggestions: r.weakest_criteria_suggestions, hard_block_triggered: r.hardBlock, hard_block_reason: r.hard_block_reason };" + NL +
    "});" + NL +
    "return [{ json: { perChannel: results, allPass, anyReject, evalRows: JSON.stringify(evalRows) } }];"
  );
}

function buildPass2EvalRound(roundLabel, channelPostsSourceName, isFinalRound) {
  const idBase = roundLabel.replace(/[^a-z0-9]/gi, "-").toLowerCase();

  claudeNode(
    `claude-eval-${idBase}`,
    `Claude: Evaluate Channels (${roundLabel})`,
    "claude-opus-5",
    EVAL_TOOL,
    pass2EvalPrompt(channelPostsSourceName),
    3000
  );
  connect(channelPostsSourceName, `Claude: Evaluate Channels (${roundLabel}): Build Request`);
  claudeErrorBranch(`Claude: Evaluate Channels (${roundLabel})`, "pass2_evaluation");

  codeNode(
    `parse-eval-${idBase}`,
    `Parse Pass 2 Evaluation (${roundLabel})`,
    "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL + "return [{ json: toolUse.input }];"
  );
  connect(`Claude: Evaluate Channels (${roundLabel})`, `Parse Pass 2 Evaluation (${roundLabel})`, 0);

  const xLengthNodeForRound = roundLabel === "Round 0" ? "Validate X Length" : `Validate X Length (${roundLabel})`;
  codeNode(`gate-${idBase}`, `Gate (${roundLabel})`, pass2GateCode(channelPostsSourceName, xLengthNodeForRound));
  connect(`Parse Pass 2 Evaluation (${roundLabel})`, `Gate (${roundLabel})`);

  supabaseWrite(
    `insert-eval-${idBase}`,
    `Insert Evaluations (${roundLabel})`,
    "POST",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/evaluation_results",
    "={{ $json.evalRows }}",
    { returnMinimal: false }
  );
  connect(`Gate (${roundLabel})`, `Insert Evaluations (${roundLabel})`);

  ifNode(`if-pass-${idBase}`, `IF All Pass (${roundLabel})`, "={{$('Gate (" + roundLabel + ")').first().json.allPass}}", true, { type: "boolean", operation: "equals" });
  connect(`Insert Evaluations (${roundLabel})`, `IF All Pass (${roundLabel})`);

  withLane(-260, () => {
    supabaseWrite(
      `mark-ready-${idBase}`, `Mark Ready to Schedule (${roundLabel})`, "PATCH",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}",
      "={{ JSON.stringify({ status: 'ready_to_schedule' }) }}"
    );
    connect(`IF All Pass (${roundLabel})`, `Mark Ready to Schedule (${roundLabel})`, 0);
    supabaseWrite(
      `log-ready-${idBase}`, `Log Event (all pass, ${roundLabel})`, "POST",
      "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
      `={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'pass2_evaluation', status: 'success', detail: 'All channels passed Pass 2 at ${roundLabel}.' }) }}`
    );
    connect(`Mark Ready to Schedule (${roundLabel})`, `Log Event (all pass, ${roundLabel})`);
    respondNode(
      `respond-ready-${idBase}`,
      `Respond (all pass, ${roundLabel})`,
      "={{ JSON.stringify({ ok: true, status: 'pass' }) }}"
    );
    connect(`Log Event (all pass, ${roundLabel})`, `Respond (all pass, ${roundLabel})`);
  });

  if (isFinalRound) {
    withLane(260, () => {
      supabaseWrite(
        `mark-cap-${idBase}`, `Mark Needs Attention (cap reached, ${roundLabel})`, "PATCH",
        "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/requests?id=eq.{{$('Config').first().json.request_id}}",
        "={{ JSON.stringify({ status: 'needs_human_attention' }) }}"
      );
      connect(`IF All Pass (${roundLabel})`, `Mark Needs Attention (cap reached, ${roundLabel})`, 1);
      supabaseWrite(
        `log-cap-${idBase}`, `Log Event (cap reached, ${roundLabel})`, "POST",
        "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/event_log",
        `={{ JSON.stringify({ request_id: $('Config').first().json.request_id, stage: 'pass2_evaluation', status: 'failed', detail: 'Revision cap (2 rounds) reached - at least one channel still not passing Pass 2.' }) }}`
      );
      connect(`Mark Needs Attention (cap reached, ${roundLabel})`, `Log Event (cap reached, ${roundLabel})`);
      respondNode(
        `respond-cap-${idBase}`,
        `Respond (cap reached, ${roundLabel})`,
        "={{ JSON.stringify({ ok: false, reason: 'revision_cap_reached' }) }}"
      );
      connect(`Log Event (cap reached, ${roundLabel})`, `Respond (cap reached, ${roundLabel})`);
    });
    return null;
  }

  return `IF All Pass (${roundLabel})`;
}

function buildPass2RevisionRound(roundNum, prevGateIfName, prevChannelPostsSourceName) {
  const label = `Round ${roundNum}`;
  const idBase = `revise-${roundNum}`;
  const prevRoundLabel = roundNum === 1 ? "Round 0" : `Round ${roundNum - 1}`;

  const feedbackExpr =
    "JSON.stringify($('Gate (" + prevRoundLabel + ")').first().json.perChannel)";

  claudeNode(`claude-${idBase}`, `Claude: Revise Channels (${label})`, "claude-sonnet-5", ADAPT_TOOL, adaptPrompt(feedbackExpr), 4000);
  connect(prevGateIfName, `Claude: Revise Channels (${label}): Build Request`, 1);
  claudeErrorBranch(`Claude: Revise Channels (${label})`, "channel_adaptation");

  codeNode(
    `parse-${idBase}`,
    `Parse Revised Channels (${label})`,
    "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL + "return [{ json: toolUse.input.channels || {} }];"
  );
  connect(`Claude: Revise Channels (${label})`, `Parse Revised Channels (${label})`, 0);

  codeNode(
    `validate-x-${idBase}`, `Validate X Length (${label})`,
    "const channels = $json;" + NL +
      "const x = channels.x;" + NL +
      "const posts = x && Array.isArray(x.posts) ? x.posts : [];" + NL +
      "const overLimit = posts.filter(p => p.length > 280);" + NL +
      "return [{ json: { ...channels, x_length_violation: overLimit.length > 0, x_over_limit_count: overLimit.length } }];"
  );
  connect(`Parse Revised Channels (${label})`, `Validate X Length (${label})`);

  insertChannelPostsNode(`insert-channel-posts-${idBase}`, `Insert Channel Posts v${roundNum + 1}`, `Validate X Length (${label})`, roundNum + 1);

  supabaseGet(
    `fetch-channel-posts-${idBase}`, `Fetch Channel Posts v${roundNum + 1}`,
    `={{$('Config').first().json.SUPABASE_URL}}/rest/v1/channel_posts?request_id=eq.{{$('Config').first().json.request_id}}&version=eq.${roundNum + 1}&select=*`
  );
  connect(`Insert Channel Posts v${roundNum + 1}`, `Fetch Channel Posts v${roundNum + 1}`);

  return `Fetch Channel Posts v${roundNum + 1}`;
}

const round0FailOutput = buildPass2EvalRound("Round 0", "Fetch Channel Posts v1", false);

if (round0FailOutput) {
  const posts2 = buildPass2RevisionRound(1, round0FailOutput, "Fetch Channel Posts v1");
  const round1FailOutput = buildPass2EvalRound("Round 1", posts2, false);

  if (round1FailOutput) {
    const posts3 = buildPass2RevisionRound(2, round1FailOutput, posts2);
    buildPass2EvalRound("Round 2", posts3, true);
  }
}

const workflow = {
  name: "Content Agent — Workflow D (Adapt to Channels)",
  meta: {
    notes:
      "Triggered automatically when a human approves the article. Stage 9: one combined Claude call (Sonnet) adapts the approved article into LinkedIn/X/newsletter posts (Decision #65), X length enforced programmatically (Decision #11) never truncated/padded (Decision #35). Combined Pass 2 evaluation (Opus) scores all channels together, revision-capped at 2 rounds like Pass 1. Tone variants: one per channel by default (Decision #66) - the 'alternate tone' second variant is a separate human-triggered action, not built here. SECRETS: Supabase API and Anthropic credentials - map both on import, and check every node's credential individually (see Errors #10 in week4-progress.md - import doesn't always propagate to every node).",
  },
  nodes,
  connections,
};

fs.writeFileSync(
  path.join(__dirname, "..", "n8n", "workflow-d-adapt-and-evaluate.json"),
  JSON.stringify(workflow, null, 2)
);
console.log("Workflow D written. Node count:", nodes.length);
