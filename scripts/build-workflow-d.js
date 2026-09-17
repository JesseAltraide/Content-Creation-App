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

// Errors #86/#88 (week4-progress.md): a Code node throwing (a genuine JS exception,
// or n8n's own "a 'json' property isn't an object" validation error on a malformed
// return) crashes the whole execution unhandled - Code nodes had no onError
// coverage at all, unlike the plain Supabase HTTP nodes hardened in Decision #79.
// Confirmed live: a Round 1 evaluation went silent for 5+ minutes with zero error
// logged anywhere, leaving the request stuck at 'adapting' indefinitely. Same fix,
// same default-on pattern: every Code node now gets onError: continueErrorOutput
// and auto-wires to the shared failure handler, unless explicitly opted out via
// { noAutoErrorHandling: true } - used only by the handler's own internal node, to
// avoid wiring it into itself.
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
  if (!opts.noAutoErrorHandling) connect(name, SETUP_FAILURE_HANDLER_NAME, 1);
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

// cachedContextExpr: see the identical parameter in build-workflow-b.js's
// claudeNode() - the large byte-identical-across-rounds block (here: the
// approved article + excerpts, resent unchanged across all 3 adapt/revise
// rounds) gets its own cache_control breakpoint, split from the varying
// per-round instructions/feedback.
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
        "return [{ json: { requestId: $('Config').first().json.request_id, message } }];",
      { noAutoErrorHandling: true }
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
      "={{ JSON.stringify({ request_id: $('Pipeline Setup Failure: Extract Error').first().json.requestId, stage: 'channel_adaptation', status: 'failed', detail: `A step in channel adaptation failed: ${$('Pipeline Setup Failure: Extract Error').first().json.message}` }) }}",
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

// Same defensive normalization the Pass 2 gate needed for `per_channel` (Errors
// #83-#85): Claude occasionally stringifies a nested tool-input object instead of
// returning it directly. Confirmed live this time on ADAPT_TOOL's `channels` field -
// a raw string passed straight into `return [{ json: someString }]` crashes with
// n8n's own "A 'json' property isn't an object" validation error, immediately and
// unhandled (Code nodes have no onError branch the way the Supabase HTTP nodes do).
// Parses a string first if that's what comes back, and always guarantees an object.
function normalizeChannelsCode(inputExpr) {
  return (
    `let channels = ${inputExpr} || {};` + NL +
    "if (typeof channels === 'string') { try { channels = JSON.parse(channels); } catch { channels = {}; } }" + NL +
    "if (!channels || typeof channels !== 'object' || Array.isArray(channels)) channels = {};" + NL +
    "return [{ json: channels }];"
  );
}

// Everything here is genuinely byte-identical across the initial adapt call AND
// every revise round within one D run (up to 3 total: worst case is exactly the
// "3 rounds x 2 combined multi-channel Claude calls" named limitation in
// week4-progress.md) - the article, audience, channel voice rules, and excerpts
// never change round to round, only the feedback (adaptPrompt's tail) does. So
// unlike Workflow B (where only the excerpts sub-block was shared), almost the
// whole prompt qualifies as the cached prefix here.
function adaptCachedContext() {
  return (
    "`Adapt this approved article into platform-native posts for these channels: ${$('Build Adaptation Context').first().json.channels.join(', ')}.\\n\\n" +
    "Article title: ${$('Fetch Approved Section').first().json.title}\\nArticle body:\\n${$('Fetch Approved Section').first().json.body_markdown}\\n\\n" +
    "Audience: ${$('Build Adaptation Context').first().json.audienceText}\\n\\n" +
    "Only produce a 'linkedin' key if linkedin is in the requested channels, only 'x' if x is requested, only 'newsletter' if newsletter is requested. " +
    "For each requested channel, write in that channel's own real voice and format, grounded only in the article and its underlying excerpts below - no unsupported claims, and every claim must stay traceable to the same source material as the article itself:\\n${$('Build Adaptation Context').first().json.excerptsTextPlain}\\n\\n" +
    "LinkedIn: PAS structure (Problem-Agitate-Solution), short paragraphs, sparing emoji, a clear CTA. Tone reference (real previous posts or a described target, follow this voice):\\n${$('Build Adaptation Context').first().json.toneByChannel.linkedin || 'not requested'}\\n\\n" +
    "X: hook-first, one core idea per post, line breaks over hashtags, at most 1-2 hashtags and only on the final post if threaded. The human requested '${$('Build Adaptation Context').first().json.x_thread_length}' - 'single' means exactly one post, 'mini' means roughly 3 posts, 'expansive' means roughly 5 posts. Never pad to hit a target count - if the idea genuinely doesn't need that many posts, write fewer and say nothing about it. Each individual post must fit in 280 characters - this will be checked programmatically, so respect it exactly, don't rely on being checked. Tone reference:\\n${$('Build Adaptation Context').first().json.toneByChannel.x || 'not requested'}\\n\\n" +
    "Newsletter: a subject line, a 1-3 sentence intro, a skimmable body, and a closing CTA, 250-600 words total in body_markdown. Tone reference:\\n${$('Build Adaptation Context').first().json.toneByChannel.newsletter || 'not requested'}`"
  );
}

function adaptPrompt(feedbackExpr) {
  return feedbackExpr
    ? "`The previous attempt needs these specific changes: ${" + feedbackExpr + "}`"
    : "`Write the first version now.`";
}

claudeNode("claude-adapt", "Claude: Adapt to Channels", "claude-sonnet-5", ADAPT_TOOL, adaptPrompt(null), 4000, adaptCachedContext());
connect("Build Adaptation Context", "Claude: Adapt to Channels: Build Request");
claudeErrorBranch("Claude: Adapt to Channels", "channel_adaptation");

codeNode(
  "parse-adapted", "Parse Adapted Content",
  "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL +
    normalizeChannelsCode("toolUse.input.channels")
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
// sourceNodeName is where the channels data actually lives; triggerNodeName (if
// different) is what should execute immediately before this - lets a node with no
// useful output of its own (e.g. an "unchoose previous versions" write) sit in the
// execution chain without breaking the data reference, which stays pointed at the
// real data node regardless of what's chained in between.
function insertChannelPostsNode(id, name, sourceNodeName, version, triggerNodeName) {
  const builderId = `${id}-build-rows`;
  const builderName = `${name}: Build Rows`;
  const trigger = triggerNodeName || sourceNodeName;

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
  connect(trigger, builderName);

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
        description: "Score EVERY channel post listed in the prompt - one entry per channel shown, using that exact channel name (linkedin/x/newsletter) as the key. Never return an empty object - every channel shown in the prompt must get an entry here.",
        minProperties: 1,
        properties: {
          linkedin: channelScoreSchema(),
          x: channelScoreSchema(),
          newsletter: channelScoreSchema(),
        },
      },
    },
  },
};

// `channel` is required inside EACH score entry, not just used as the surrounding
// object's key - live testing caught Claude returning `per_channel` as an ARRAY of
// these objects instead of an object keyed by channel name (a real, reproducible
// tool-schema deviation, not a hypothetical one: confirmed via the exact Postgres
// error `invalid input value for enum channel: "0"`, which is what you get when
// Object.entries() runs on an array and gets numeric indices back as "keys"). With
// no channel name embedded in the entry itself, that data was unrecoverable. Now the
// gate code below reads `r.channel` directly and works the same whether Claude
// returns the keyed-object shape or strays into an array - the channel name is
// always present on the entry, never inferred from its position or its container.
function channelScoreSchema() {
  return {
    type: "object",
    required: ["channel", "overall_score", "status", "criteria"],
    properties: {
      channel: { type: "string", enum: ["linkedin", "x", "newsletter"] },
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
  };
}

const PASS2_RUBRIC_TEXT =
  "Score each channel's post out of 100 across: Factual Consistency re-verified against the excerpts (20, floor 15 - hard block tier, re-checks the claims survived adaptation unchanged), Tone (25, floor 10), Channel Fit (25, floor 10 - does it genuinely read as native to that platform, not just the article reformatted), Audience Fit re-verified (15, floor 6), Clarity (15, floor 6). Topic Relevance, SEO Fit, and Completeness do not apply post-adaptation - do not score them. If Factual Consistency scores below its floor, hard_block_triggered must be true regardless of the total.";

// x and newsletter bodies are stored as JSON-stringified structures (Insert Channel
// Posts's own note explains why - a plain `body` column can't hold a thread array or
// a subject+body pair cleanly). Feeding that raw stringified JSON straight into the
// eval prompt via JSON.stringify() means Claude receives doubly-escaped JSON - which
// is exactly what produced the empty `per_channel: {}` response caught in live
// testing (Claude likely couldn't make sense of the garbled input and gave up rather
// than evaluate it). This builds clean, human-readable text per channel instead, in
// a preceding Code node - same reasoning as every other "never build this inline"
// fix in this file.
function buildPass2EvalTextNode(id, name, sourceNodeName) {
  codeNode(
    id, name,
    "const posts = $('" + sourceNodeName + "').all().map(i => i.json);" + NL +
      "const parts = posts.map(p => {" + NL +
      "  if (p.channel === 'x') {" + NL +
      "    let thread; try { thread = JSON.parse(p.body); } catch { thread = [p.body]; }" + NL +
      "    return `--- X ---" + BSN + BSN + "${thread.map((t, i) => `Post ${i + 1}: ${t}`).join('" + BSN + BSN + "')}`;" + NL +
      "  }" + NL +
      "  if (p.channel === 'newsletter') {" + NL +
      "    let nl; try { nl = JSON.parse(p.body); } catch { nl = { subject_line: '', body_markdown: p.body }; }" + NL +
      "    return `--- NEWSLETTER ---" + BSN + "Subject: ${nl.subject_line}" + BSN + BSN + "${nl.body_markdown}`;" + NL +
      "  }" + NL +
      "  return `--- LINKEDIN ---" + BSN + BSN + "${p.body}`;" + NL +
      "});" + NL +
      "return [{ json: { channelsText: parts.join('" + BSN + BSN + "') } }];"
  );
  connect(sourceNodeName, name);
}

// Rubric + original article + excerpts are byte-identical across every Pass 2
// eval round in a run (up to 3) - only the adapted posts being scored change
// round to round, so that's the only part left in the varying tail.
function pass2EvalCachedContext() {
  return (
    "`Rubric: " +
    PASS2_RUBRIC_TEXT +
    "\\n\\nOriginal article (for factual comparison):\\n${$('Fetch Approved Section').first().json.body_markdown}\\n\\n" +
    "Grounded excerpts:\\n${$('Build Adaptation Context').first().json.excerptsTextPlain}`"
  );
}

function pass2EvalPrompt(textNodeName) {
  return (
    "`Evaluate each adapted channel post below against the rubric and excerpts above. You have not seen the adaptation reasoning - judge only what's here.\\n\\n" +
    "Adapted posts to evaluate - score every one shown here. Each entry in per_channel MUST include its own \\\"channel\\\" field set to that post's exact channel name (linkedin/x/newsletter), in addition to using that name as its key:\\n${$('" + textNodeName + "').first().json.channelsText}`"
  );
}

// Builds both the gate decision AND the evaluation_results insert rows in one Code
// node (real JS) - keeping the row-building here instead of a separate inline HTTP
// expression avoids yet another large inline IIFE inside an HTTP node's {{ }} field
// (the same mistake already caught once in this file, and the root cause of
// Workflow B's Error #9).
function pass2GateCode(channelPostsSourceName, xLengthSourceName) {
  return (
    // per_channel has now shown up in three different shapes across live testing:
    // an empty object (Decision/Error #83), an array of entries with no keys at all
    // (Error #84), and - caught here - a JSON-STRINGIFIED string containing the real
    // object (confirmed live: Object.entries() on a ~9000-character string iterates
    // it character by character, producing 9000+ bogus "channel" entries "0".."9344",
    // one per character). A tool schema describes the intended shape; it does not
    // guarantee the model won't occasionally serialize a nested value as a string
    // instead of nesting it directly. This normalizer tolerates all three: parses a
    // string first, then treats the result as either an array or an object, always
    // trusting each entry's own `channel` field over the container's keys/indices,
    // and drops anything that isn't a real object (so a stray character or null
    // can never masquerade as a channel entry again).
    "let rawPerChannel = $json.per_channel;" + NL +
    "if (typeof rawPerChannel === 'string') { try { rawPerChannel = JSON.parse(rawPerChannel); } catch { rawPerChannel = {}; } }" + NL +
    "if (!rawPerChannel || typeof rawPerChannel !== 'object') rawPerChannel = {};" + NL +
    "const rawList = Array.isArray(rawPerChannel) ? rawPerChannel : Object.entries(rawPerChannel).map(([key, r]) => (r && typeof r === 'object' ? { ...r, channel: r.channel || key } : null));" + NL +
    "const rawEntries = rawList.filter(r => r && typeof r === 'object' && r.channel).map(r => [r.channel, r]);" + NL +
    "const results = {};" + NL +
    "let anyReject = false;" + NL +
    "let allPass = rawEntries.length > 0;" + NL +
    "for (const [channel, r] of rawEntries) {" + NL +
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

  const textNodeName = `Build Pass 2 Eval Text (${roundLabel})`;
  buildPass2EvalTextNode(`build-eval-text-${idBase}`, textNodeName, channelPostsSourceName);

  claudeNode(
    `claude-eval-${idBase}`,
    `Claude: Evaluate Channels (${roundLabel})`,
    "claude-opus-5",
    EVAL_TOOL,
    pass2EvalPrompt(textNodeName),
    // Scoring 3 separate channel posts (each with its own criteria array, notes, and
    // weakest_criteria_suggestions) needs far more output than Workflow B's Pass 1
    // eval, which only ever scores one article. 3000 (copied from Pass 1 without
    // adjusting for 3x the content) truncated mid-generation - confirmed live via
    // stop_reason: "max_tokens" with an empty tool_use input, not a prompt/schema
    // problem as first suspected.
    8000,
    pass2EvalCachedContext()
  );
  connect(textNodeName, `Claude: Evaluate Channels (${roundLabel}): Build Request`);
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

  claudeNode(`claude-${idBase}`, `Claude: Revise Channels (${label})`, "claude-sonnet-5", ADAPT_TOOL, adaptPrompt(feedbackExpr), 4000, adaptCachedContext());
  connect(prevGateIfName, `Claude: Revise Channels (${label}): Build Request`, 1);
  claudeErrorBranch(`Claude: Revise Channels (${label})`, "channel_adaptation");

  codeNode(
    `parse-${idBase}`,
    `Parse Revised Channels (${label})`,
    "const toolUse = $json.content.find(c => c.type === 'tool_use');" + NL + normalizeChannelsCode("toolUse.input.channels")
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

  // Un-chooses every prior version before inserting this round's - without this,
  // both the old and new versions stay chosen:true simultaneously, breaking the
  // "exactly one chosen row per channel" invariant every downstream reader (the
  // review UI, the publishing queue, Workflow E's edit triage) relies on. Caught
  // live: a stuck run left two chosen rows per channel behind, not itself harmful
  // to any reader (they all reduce to max-version-among-chosen defensively) but a
  // real data-integrity gap worth closing at the source.
  supabaseWrite(
    `unchoose-prev-${idBase}`, `Unchoose Previous Channel Posts (${label})`, "PATCH",
    "={{$('Config').first().json.SUPABASE_URL}}/rest/v1/channel_posts?request_id=eq.{{$('Config').first().json.request_id}}",
    "={{ JSON.stringify({ chosen: false }) }}"
  );
  connect(`Validate X Length (${label})`, `Unchoose Previous Channel Posts (${label})`);

  insertChannelPostsNode(
    `insert-channel-posts-${idBase}`,
    `Insert Channel Posts v${roundNum + 1}`,
    `Validate X Length (${label})`,
    roundNum + 1,
    `Unchoose Previous Channel Posts (${label})`
  );

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
