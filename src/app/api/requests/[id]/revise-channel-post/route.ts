import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";
import { firedRecently } from "@/lib/debounce-trigger";
import { findLengthViolations, CHANNEL_CHAR_LIMITS, formatForEvaluator, PASS_MARK } from "@/lib/channel-post-format";
import type Anthropic from "@anthropic-ai/sdk";
import { getClaude, GENERATION_MODEL, EVALUATION_MODEL } from "@/lib/claude";
// Shared with the pages that render these rows, so what is written and what is read
// can never disagree about the shape.
import { asList } from "@/lib/eval-shape";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

// Workflow D's auto-revision loop stops after 2 rounds, and what it leaves behind is
// a scored draft plus the evaluator's own suggestions for closing the gap. Until now
// the only way past that was to hand-edit the post yourself, which for an X thread
// means manually re-splitting posts around a 280 character limit to recover a Channel
// Fit score. The suggestions are already specific and already stored; this applies
// them automatically instead.
//
// Called directly from Next.js rather than as another n8n workflow: one generation
// plus one evaluation, no orchestration, and no reimport cycle.
const bodySchema = z.object({
  channel: z.enum(["linkedin", "x", "newsletter"]),
  /** Optional extra steer from the human, on top of the evaluator's suggestions. */
  note: z.string().trim().max(1000).optional(),
});

// Workflow D produces up to v3 on its own, so this leaves five human-triggered
// revisions before the channel is declared a dead end. A cap on versions rather than
// on a counter column: it needs no migration and it cannot drift from reality, since
// the versions are the attempts.
const MAX_CHANNEL_VERSION = 8;

const PASS2_RUBRIC_TEXT =
  "Score out of 100 across: Factual Consistency re-verified against the excerpts (20, floor 15 - hard block tier), Tone (25, floor 10), Channel Fit (25, floor 10 - does it genuinely read as native to that platform), Audience Fit re-verified (15, floor 6), Clarity (15, floor 6). Topic Relevance, SEO Fit, and Completeness do not apply post-adaptation. If Factual Consistency scores below its floor, hard_block_triggered must be true regardless of the total.";

const REVISE_TOOLS: Record<string, Anthropic.Tool> = {
  linkedin: {
    name: "write_linkedin_post",
    description: "Write the revised LinkedIn version of this post.",
    input_schema: {
      type: "object",
      required: ["body_markdown"],
      properties: { body_markdown: { type: "string" } },
    },
  },
  x: {
    name: "write_x_post",
    description: "Write the revised X post (or thread).",
    input_schema: {
      type: "object",
      required: ["posts"],
      properties: { posts: { type: "array", items: { type: "string" } } },
    },
  },
  newsletter: {
    name: "write_newsletter",
    description: "Write the revised newsletter version.",
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

// Built from the STORED form so the evaluator sees exactly the shape
// formatForEvaluator defines, rather than a second, subtly different serialization
// maintained in parallel here. See that function for what handing an evaluator a
// naive join actually cost us.
function bodyForEval(channel: string, input: Record<string, unknown>): string {
  return formatForEvaluator(channel, bodyForStorage(channel, input));
}

function bodyForStorage(channel: string, input: Record<string, unknown>): string {
  if (channel === "x") return JSON.stringify(input.posts ?? []);
  if (channel === "newsletter")
    return JSON.stringify({ subject_line: input.subject_line, body_markdown: input.body_markdown });
  return input.body_markdown as string;
}

// Claude returns a nested tool value as a JSON string often enough that every parse
// in this codebase guards for it (Errors #83-#85, and again on Workflow B's
// excerpts, and again on Workflow D's channels). A thread arriving as "[\"post one\",\"post two\"]" would otherwise be
// stored as a single 2-post-long string and blow the character limit on save.
function normaliseInput(channel: string, input: Record<string, unknown>): Record<string, unknown> {
  if (channel !== "x") return input;
  let posts = input.posts;
  if (typeof posts === "string") {
    try {
      posts = JSON.parse(posts);
    } catch {
      posts = [posts];
    }
  }
  if (!Array.isArray(posts) && posts && typeof posts === "object") posts = Object.values(posts);
  if (!Array.isArray(posts)) posts = [];
  return { ...input, posts: (posts as unknown[]).map((p) => String(p)) };
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
  if (!(await userCanModifyRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { channel, note } = parsed.data;

  const admin = createAdminClient();

  const { data: current } = await admin
    .from("channel_posts")
    .select("id, version, body")
    .eq("request_id", requestId)
    .eq("channel", channel)
    .eq("chosen", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!current) {
    return NextResponse.json({ error: "No adapted content exists yet for this channel." }, { status: 409 });
  }

  if (current.version >= MAX_CHANNEL_VERSION) {
    return NextResponse.json(
      {
        error:
          "This channel has been revised as many times as it's worth. Edit it yourself, or regenerate the article if the source material is the problem.",
      },
      { status: 409 }
    );
  }

  const { data: latestEval } = await admin
    .from("evaluation_results")
    .select("overall_score, status, criteria, weakest_criteria_suggestions")
    .eq("request_id", requestId)
    .eq("channel", channel)
    .eq("pass", "pass_2_channel")
    .eq("content_version", current.version)
    .maybeSingle();

  const lengthViolations = findLengthViolations(channel, current.body ?? "");

  // Nothing to act on. Revising a passing post with no feedback is just a re-roll
  // that could as easily make it worse, and it costs a Sonnet call plus an Opus one.
  if (latestEval?.status === "pass" && lengthViolations.length === 0) {
    return NextResponse.json(
      { error: "This post already passed. Use Edit if you want to change it anyway." },
      { status: 409 }
    );
  }

  // Check-then-act above: two quick clicks can both pass it and both run a full
  // generation plus evaluation before either inserts. Same event-log debounce the
  // debounce used elsewhere, since there is no status change to guard on here.
  if (await firedRecently(requestId, ["channel_revision"], 60_000)) {
    return NextResponse.json(
      { error: "A revision for this request was just run. Give it a moment." },
      { status: 429 }
    );
  }

  const [{ data: section }, { data: toneSamples }, { data: excerpts }, { data: sources }, { data: req }] =
    await Promise.all([
      admin.from("sections").select("title, body_markdown").eq("request_id", requestId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
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

  const suggestions = (latestEval?.weakest_criteria_suggestions ?? []) as string[];
  const criteria = (latestEval?.criteria ?? []) as { name: string; score: number; max: number; notes?: string }[];
  const scoreLines = criteria.map((c) => `- ${c.name}: ${c.score}/${c.max}${c.notes ? ` (${c.notes})` : ""}`).join("\n");

  const limit = CHANNEL_CHAR_LIMITS[channel];
  const lengthRule = limit
    ? `\n\nHARD LIMIT: every individual ${channel === "x" ? "post in the thread" : "post"} must be ${limit} characters or fewer, counted exactly. This is not a style preference, it is enforced on save and an over-length post cannot be scheduled at all. If the content does not fit, split it across more ${channel === "x" ? "posts" : "sections"} rather than trimming the substance out of it.${
        lengthViolations.length > 0
          ? ` The current version breaks this: ${lengthViolations.map((v) => `${v.label} is ${v.length} characters`).join("; ")}.`
          : ""
      }`
    : "";

  const claude = getClaude();
  const tool = REVISE_TOOLS[channel];

  async function generate(extraInstruction: string) {
    return claude.messages.create({
      model: GENERATION_MODEL,
      max_tokens: 8000,
      tools: [tool],
      tool_choice: { type: "tool", name: tool.name },
      messages: [
        {
          role: "user",
          content: `Revise this ${channel} post so it passes the Pass 2 rubric. It scored ${latestEval?.overall_score ?? "an unknown score"}/100 and needs 85 to be schedulable.\n\nWhat the evaluator scored it on:\n${scoreLines || "No criteria breakdown available."}\n\nThe evaluator's own suggestions, which are the specific changes to make:\n${suggestions.length ? suggestions.map((s) => `- ${s}`).join("\n") : "No suggestions were recorded. Improve the weakest criteria above."}${note ? `\n\nAdditional instruction from the author, which takes priority:\n${note}` : ""}${lengthRule}${extraInstruction}\n\nKeep everything that already works. Change what the suggestions actually ask for rather than rewriting wholesale, and do not introduce any claim the excerpts do not support.

The recommended changes are the evaluator's wording, not fact. They are advisory on structure and emphasis, and are NOT authoritative on any figure, unit, name or date. If following one would state something the excerpts do not support, ignore that part and fix the underlying point another way. Accuracy outranks every recommendation here.

Fidelity of figures: carry every number, unit, percentage, date and conditional across from the excerpts EXACTLY as they state it. Never compress a unit into a shorter one ('nine percentage points' is not 'nine points'), and never drop a qualifier to save space. If a figure will not fit with its unit and qualifier intact, leave it out rather than shortening it.\n\nCurrent version:\n${current!.body}\n\nSource article title: ${section!.title}\nSource article:\n${section!.body_markdown}\n\nAudience: ${audience?.description ?? "No audience profile on file - write for a general professional audience."}\n\nTone reference for this channel:\n${toneText}\n\nGrounded excerpts (cite as [Source: url] after any claim drawn from it - use the exact URL shown, not a placeholder or id):\n${excerptsText}\n\nHouse style: never use em dashes (the character U+2014). Use a full stop, a comma, a colon or parentheses instead.`,
        },
      ],
    });
  }

  function extractInput(response: Anthropic.Message): Record<string, unknown> | null {
    const toolUse = response.content.find((c) => c.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") return null;
    return normaliseInput(channel, toolUse.input as Record<string, unknown>);
  }

  let genInput: Record<string, unknown> | null;
  try {
    genInput = extractInput(await generate(""));
  } catch (err) {
    await logEvent({ requestId, stage: "channel_revision", status: "failed", detail: `Revision failed for ${channel}: ${err instanceof Error ? err.message : String(err)}` });
    return NextResponse.json({ error: "Revision failed. Try again." }, { status: 502 });
  }

  if (!genInput) {
    await logEvent({ requestId, stage: "channel_revision", status: "failed", detail: `Revision for ${channel} returned no structured output.` });
    return NextResponse.json({ error: "Revision failed. Try again." }, { status: 502 });
  }

  // One corrective pass on the character limit before spending an Opus evaluation.
  // The limit is arithmetic, not judgement, so a model that overshot it can be told
  // exactly by how much and reliably fix it - and an over-length post is unschedulable
  // no matter how well it scores, so evaluating one first would waste the call.
  let violations = findLengthViolations(channel, bodyForStorage(channel, genInput));
  if (violations.length > 0) {
    try {
      const repaired = extractInput(
        await generate(
          `\n\nYour previous attempt broke the character limit: ${violations
            .map((v) => `${v.label} was ${v.length} characters against a limit of ${v.limit}`)
            .join("; ")}. Split the content across more posts. Do not simply delete the substance to fit.`
        )
      );
      if (repaired) {
        const repairedViolations = findLengthViolations(channel, bodyForStorage(channel, repaired));
        if (repairedViolations.length < violations.length) {
          genInput = repaired;
          violations = repairedViolations;
        }
      }
    } catch {
      // Keep the first attempt. It is still an improvement on the version that
      // prompted this, and the length banner will show what is still wrong.
    }
  }

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
          content: `Evaluate this adapted channel post against the rubric. You have not seen the revision reasoning - judge only what's here, not what it used to be.\n\nRubric: ${PASS2_RUBRIC_TEXT}\n\nChannel: ${channel}\n\nPost:\n${bodyForEval(channel, genInput)}\n\nGrounded excerpts it should stay consistent with:\n${excerptsText}`,
        },
      ],
    });
  } catch (err) {
    await logEvent({ requestId, stage: "channel_revision", status: "failed", detail: `Evaluation failed for ${channel}: ${err instanceof Error ? err.message : String(err)}` });
    return NextResponse.json({ error: "The revision was written but couldn't be scored. Try again." }, { status: 502 });
  }

  const evalToolUse = evalResponse.content.find((c) => c.type === "tool_use");
  if (!evalToolUse || evalToolUse.type !== "tool_use") {
    await logEvent({ requestId, stage: "channel_revision", status: "failed", detail: `Evaluation for ${channel} returned no structured output.` });
    return NextResponse.json({ error: "The revision was written but couldn't be scored. Try again." }, { status: 502 });
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

  // A revision that contradicts the sources is worse than the failing draft it would
  // replace, so it is never saved.
  if (hardBlock) {
    await logEvent({
      requestId,
      stage: "channel_revision",
      status: "failed",
      detail: `Revision for ${channel} was blocked on factual consistency and discarded: ${evalInput.hard_block_reason ?? "a critical criterion fell below its floor"}.`,
    });
    return NextResponse.json(
      {
        error:
          "The revision contradicted the sources, so it was discarded and your current version is untouched. Try again, or edit it yourself.",
        reason: evalInput.hard_block_reason,
      },
      { status: 422 }
    );
  }

  // A rewrite is always kept as a version; what changes is whether it becomes the one
  // in use. The old behaviour discarded a lower-scoring rewrite entirely and returned
  // an error, which threw away work the author might have preferred and gave them
  // nothing to look at.
  //
  // Now every attempt lands in the version history and the higher score is selected
  // automatically. Nothing is lost, nothing is silently downgraded, and the version
  // picker is there if the author disagrees with the number.
  //
  // The exception is a current version that cannot be published at all: a post over
  // the character limit is worth replacing even by a lower-scoring one that fits,
  // because an unschedulable post is worth nothing regardless of its score.
  const previousScore = latestEval?.overall_score ?? null;
  const previousBlocked = lengthViolations.length > 0;
  const scoredWorse = previousScore !== null && evalInput.overall_score < previousScore;
  const keepPrevious = scoredWorse && !previousBlocked;

  const newVersion = current.version + 1;
  const { error: insertError } = await admin.from("channel_posts").insert({
    request_id: requestId,
    channel,
    version: newVersion,
    body: bodyForStorage(channel, genInput),
    tone_variant: "default",
    chosen: !keepPrevious,
  });
  if (insertError) {
    return NextResponse.json({ error: "Couldn't save the revision. Try again." }, { status: 500 });
  }

  // Only when the new version won. Done after the insert so a failed insert leaves
  // the old version still chosen rather than leaving the channel with nothing chosen.
  if (!keepPrevious) {
    await admin
      .from("channel_posts")
      .update({ chosen: false })
      .eq("request_id", requestId)
      .eq("channel", channel)
      .eq("id", current.id);
  }

  // The gate's verdict, not the model's own word for it. Caught live: this route
  // stored an X rewrite as "pass" at 81, and the log said so too, while the schedule
  // route and the publishing queue both correctly refuse anything under 85. The same
  // mismatch has now appeared four times in this build (Errors #46, #54, #59), always
  // because a label was written where a number was the actual authority.
  //
  // A character-limit violation is a fail regardless of score, for the same reason it
  // blocks scheduling: an over-length post cannot be published at all.
  const revisedViolations = findLengthViolations(channel, bodyForStorage(channel, genInput));
  const gateStatus =
    revisedViolations.length > 0 || evalInput.overall_score < PASS_MARK ? "revise" : "pass";

  await admin.from("evaluation_results").insert({
    request_id: requestId,
    section_id: null,
    channel,
    pass: "pass_2_channel",
    content_version: newVersion,
    overall_score: evalInput.overall_score,
    status: gateStatus,
    criteria: asList<Record<string, unknown>>(evalInput.criteria),
    weakest_criteria_suggestions: asList<string>(evalInput.weakest_criteria_suggestions).map((x) => String(x)),
    hard_block_triggered: false,
    hard_block_reason: null,
  });

  await logEvent({
    requestId,
    stage: "channel_revision",
    status: "success",
    detail:
      `${channel} revised against the evaluator's suggestions: ${latestEval?.overall_score ?? "?"}/100 to ${evalInput.overall_score}/100 (${gateStatus})` +
      (keepPrevious
        ? `, so the higher-scoring version stays in use and this one is in the version history.`
        : `, and it is now the version in use.`) +
      `${violations.length ? " Still over the character limit." : ""}`,
  });

  return NextResponse.json({
    ok: true,
    score: evalInput.overall_score,
    previousScore: latestEval?.overall_score ?? null,
    status: gateStatus,
    // Whether the rewrite took over, so the page can say which version it is showing
    // rather than leaving the author to work it out from a number that went down.
    inUse: !keepPrevious,
    lengthViolations: violations,
  });
}
