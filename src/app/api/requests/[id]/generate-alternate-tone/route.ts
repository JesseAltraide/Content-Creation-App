import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanAccessRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";
import type Anthropic from "@anthropic-ai/sdk";
import { getClaude, GENERATION_MODEL, EVALUATION_MODEL } from "@/lib/claude";

// One tone variant per channel by default; a second "alternate tone" is generated
// only on explicit human request, and the human picks which becomes canonical
// (Decision #78). Called directly from Next.js rather than through another n8n
// workflow: it's a single, short, one-shot call with no orchestration needs, same
// reasoning that already kept Stage 9b/10 out of n8n - avoids another reimport cycle.
//
// Stored as a new version rather than reusing the current one: every existing
// "latest chosen per channel" query and Pass 2 evaluation already key off
// (channel, version) with no concept of tone_variant - reusing the current version
// would mean the alternate silently inherits the default variant's evaluation
// without ever being scored itself.
const bodySchema = z.object({
  channel: z.enum(["linkedin", "x", "newsletter"]),
});

const PASS2_RUBRIC_TEXT =
  "Score out of 100 across: Factual Consistency re-verified against the excerpts (20, floor 15 - hard block tier), Tone (25, floor 10), Channel Fit (25, floor 10 - does it genuinely read as native to that platform), Audience Fit re-verified (15, floor 6), Clarity (15, floor 6). Topic Relevance, SEO Fit, and Completeness do not apply post-adaptation. If Factual Consistency scores below its floor, hard_block_triggered must be true regardless of the total.";

const ALT_TOOLS: Record<string, Anthropic.Tool> = {
  linkedin: {
    name: "write_linkedin_post",
    description: "Write an alternate-tone LinkedIn version of this article.",
    input_schema: {
      type: "object",
      required: ["body_markdown"],
      properties: { body_markdown: { type: "string" } },
    },
  },
  x: {
    name: "write_x_post",
    description: "Write an alternate-tone X post (or thread) version of this article.",
    input_schema: {
      type: "object",
      required: ["posts"],
      properties: { posts: { type: "array", items: { type: "string" } } },
    },
  },
  newsletter: {
    name: "write_newsletter",
    description: "Write an alternate-tone newsletter version of this article.",
    input_schema: {
      type: "object",
      required: ["subject_line", "body_markdown"],
      properties: {
        subject_line: { type: "string" },
        body_markdown: { type: "string" },
      },
    },
  },
};

const EVAL_TOOL: Anthropic.Tool = {
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

function bodyForEval(channel: string, input: Record<string, unknown>): string {
  if (channel === "x") return (input.posts as string[]).join("\n\n---\n\n");
  if (channel === "newsletter") return `Subject: ${input.subject_line}\n\n${input.body_markdown}`;
  return input.body_markdown as string;
}

function bodyForStorage(channel: string, input: Record<string, unknown>): string {
  if (channel === "x") return JSON.stringify(input.posts ?? []);
  if (channel === "newsletter")
    return JSON.stringify({ subject_line: input.subject_line, body_markdown: input.body_markdown });
  return input.body_markdown as string;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Ownership (migration 007). 404 not 403: telling someone a request exists
  // but is not theirs still leaks that it exists.
  if (!(await userCanAccessRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { channel } = parsed.data;

  const admin = createAdminClient();

  const { data: current } = await admin
    .from("channel_posts")
    .select("id, version, body, tone_variant")
    .eq("request_id", requestId)
    .eq("channel", channel)
    .eq("chosen", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "No adapted content exists yet for this channel." }, { status: 409 });
  }

  // One pending alternate at a time - generating a second before the human has
  // picked between the first pair would just pile up unreviewed options.
  const { data: pendingAlternate } = await admin
    .from("channel_posts")
    .select("id")
    .eq("request_id", requestId)
    .eq("channel", channel)
    .eq("chosen", false)
    .gt("version", current.version)
    .limit(1)
    .maybeSingle();

  if (pendingAlternate) {
    return NextResponse.json(
      { error: "An alternate tone already exists for this channel. Pick one before generating another." },
      { status: 409 }
    );
  }

  const [{ data: section }, { data: toneSamples }, { data: excerpts }, { data: sources }, { data: req }] = await Promise.all([
    admin.from("sections").select("title, body_markdown").eq("request_id", requestId).order("version", { ascending: false }).limit(1).maybeSingle(),
    admin.from("tone_samples").select("content, source").eq("channel", channel),
    admin.from("excerpts").select("id, text, source_id").eq("request_id", requestId),
    admin.from("sources").select("id, url").eq("request_id", requestId),
    admin.from("requests").select("resolved_audience_profile_id").eq("id", requestId).single(),
  ]);

  if (!section) {
    return NextResponse.json({ error: "No approved article found for this request." }, { status: 409 });
  }

  const { data: audience } = req?.resolved_audience_profile_id
    ? await admin.from("audience_profiles").select("description").eq("id", req.resolved_audience_profile_id).maybeSingle()
    : { data: null };

  const urlBySourceId = new Map((sources ?? []).map((s) => [s.id, s.url]));
  const toneText = (toneSamples ?? []).length
    ? (toneSamples ?? []).map((t) => `[${t.source}] ${t.content}`).join("\n\n---\n\n")
    : "No tone samples on file - use a neutral, professional default.";
  const excerptsText = (excerpts ?? [])
    .map((e) => `Source: ${urlBySourceId.get(e.source_id) ?? "unknown"}\n${e.text}`)
    .join("\n\n");

  const claude = getClaude();
  const tool = ALT_TOOLS[channel];

  let genResponse;
  try {
    genResponse = await claude.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 4000,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content: `Adapt this approved article into an ALTERNATE-tone ${channel} post - a genuinely different position within this channel's normal range (e.g. friendlier vs. more serious), not a departure from it. Grounded only in the article and its excerpts below - no unsupported claims.\n\nArticle title: ${section.title}\nArticle body:\n${section.body_markdown}\n\nAudience: ${audience?.description ?? "No audience profile on file - write for a general professional audience."}\n\nTone reference for this channel (stay within this range, just take a different position inside it):\n${toneText}\n\nGrounded excerpts (cite as [Source: url] after any claim drawn from it - use the exact URL shown, not a placeholder or id):\n${excerptsText}\n\nThe current default-tone version, for contrast (write something genuinely different, not a paraphrase):\n${current.body}`,
        },
      ],
    });
  } catch (err) {
    await logEvent({ requestId, stage: "alternate_tone", status: "failed", detail: `Generation failed: ${err instanceof Error ? err.message : String(err)}` });
    return NextResponse.json({ error: "Generation failed. Try again." }, { status: 502 });
  }

  const genToolUse = genResponse.content.find((c) => c.type === "tool_use");
  if (!genToolUse || genToolUse.type !== "tool_use") {
    await logEvent({ requestId, stage: "alternate_tone", status: "failed", detail: "Claude didn't return structured output." });
    return NextResponse.json({ error: "Generation failed. Try again." }, { status: 502 });
  }
  const genInput = genToolUse.input as Record<string, unknown>;

  let evalResponse;
  try {
    evalResponse = await claude.messages.create({
      model: EVALUATION_MODEL,
      max_tokens: 3000,
      tools: [EVAL_TOOL],
      tool_choice: { type: "tool", name: EVAL_TOOL.name },
      messages: [
        {
          role: "user",
          content: `Evaluate this adapted channel post against the rubric. You have not seen the adaptation reasoning - judge only what's here.\n\nRubric: ${PASS2_RUBRIC_TEXT}\n\nChannel: ${channel}\n\nPost:\n${bodyForEval(channel, genInput)}\n\nGrounded excerpts it should stay consistent with:\n${excerptsText}`,
        },
      ],
    });
  } catch (err) {
    await logEvent({ requestId, stage: "alternate_tone", status: "failed", detail: `Evaluation failed: ${err instanceof Error ? err.message : String(err)}` });
    return NextResponse.json({ error: "Evaluation failed. Try again." }, { status: 502 });
  }

  const evalToolUse = evalResponse.content.find((c) => c.type === "tool_use");
  if (!evalToolUse || evalToolUse.type !== "tool_use") {
    await logEvent({ requestId, stage: "alternate_tone", status: "failed", detail: "Claude didn't return structured evaluation." });
    return NextResponse.json({ error: "Evaluation failed. Try again." }, { status: 502 });
  }
  const evalInput = evalToolUse.input as {
    overall_score: number;
    status: string;
    criteria: { name: string; score: number; max: number; notes?: string }[];
    weakest_criteria_suggestions?: string[];
    hard_block_triggered?: boolean;
    hard_block_reason?: string | null;
  };

  const factualCriterion = evalInput.criteria.find((c) => c.name.toLowerCase().includes("factual"));
  const hardBlock = !!evalInput.hard_block_triggered || (!!factualCriterion && factualCriterion.score < 15);

  if (hardBlock) {
    await logEvent({
      requestId,
      stage: "alternate_tone",
      status: "failed",
      detail: `Alternate tone for ${channel} blocked: ${evalInput.hard_block_reason ?? "a critical criterion fell below its floor"}.`,
    });
    return NextResponse.json(
      { error: "hard_block", reason: evalInput.hard_block_reason, criteria: evalInput.criteria },
      { status: 422 }
    );
  }

  const newVersion = current.version + 1;
  const { error: insertError } = await admin.from("channel_posts").insert({
    request_id: requestId,
    channel,
    version: newVersion,
    body: bodyForStorage(channel, genInput),
    tone_variant: "alternate",
    chosen: false,
  });
  if (insertError) {
    return NextResponse.json({ error: "Couldn't save the alternate. Try again." }, { status: 500 });
  }

  await admin.from("evaluation_results").insert({
    request_id: requestId,
    section_id: null,
    channel,
    pass: "pass_2_channel",
    content_version: newVersion,
    overall_score: evalInput.overall_score,
    status: evalInput.status,
    criteria: evalInput.criteria,
    weakest_criteria_suggestions: evalInput.weakest_criteria_suggestions ?? null,
    hard_block_triggered: hardBlock,
    hard_block_reason: evalInput.hard_block_reason ?? null,
  });

  await logEvent({
    requestId,
    stage: "alternate_tone",
    status: "success",
    detail: `Alternate tone generated for ${channel}: ${evalInput.overall_score}/100 (${evalInput.status}).`,
  });

  return NextResponse.json({ ok: true, score: evalInput.overall_score, status: evalInput.status });
}
