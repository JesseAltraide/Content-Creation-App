import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { getClaude, GENERATION_MODEL } from "@/lib/claude";

// Audience resonance used to be judged only inside Workflow A's propose_angle call,
// which runs AFTER searching and scraping. But that call bundles two different
// judgments: "does this idea suit the audience" and "do these sources support it".
// Only the second needs the sources. So an idea with an obvious audience mismatch
// burned a Tavily search, the human's time hand-picking sources, and a Firecrawl
// scrape of every one of them, purely to arrive at a conclusion reachable from the
// idea string and the audience profile alone (Decision #104).
//
// Deliberately a hard block rather than a warning. The only inputs that can move
// this score are the ones the human controls - the idea and the context field - and
// nothing discovered later legitimately rescues the audience-fit axis. Letting a low
// score proceed just defers the same block until after the money is spent, so the
// block is the mechanism that teaches people to write descriptive input.
const BLOCK_AT_OR_BELOW = 4;

const RESONANCE_TOOL: Anthropic.Tool = {
  name: "score_audience_resonance",
  description: "Judge how well a content idea would resonate with the given audience.",
  input_schema: {
    type: "object",
    required: ["resonance_score", "reason", "best_profile_name", "keyword_matches_idea", "distinct_topics"],
    properties: {
      resonance_score: { type: "integer", minimum: 0, maximum: 15 },
      reason: {
        type: "string",
        description:
          "One or two sentences. If the score is low, say plainly what is missing and what the human should add.",
      },
      best_profile_name: {
        type: "string",
        description: "The audience profile this idea fits best, by name.",
      },
      keyword_matches_idea: {
        type: "boolean",
        description:
          "True if an article written on this idea would naturally and repeatedly use the primary keyword. False if the keyword points at a different subject from the idea.",
      },
      keyword_note: {
        type: "string",
        description:
          "Only when keyword_matches_idea is false: one sentence naming the subject the keyword points at versus the subject of the idea.",
      },
      distinct_topics: {
        type: "array",
        items: { type: "string" },
        description:
          "Each genuinely separate subject the idea asks for, as a short phrase. One entry for a focused idea. Aspects of a single subject are not separate topics; unrelated subjects joined by 'and' or 'plus' are.",
      },
    },
  },
};

/**
 * Advisory findings from the same call. Warnings, never blocks: both are judgements
 * about what the author probably meant, and a wrong guess that refuses the work is
 * worse than a wrong guess that mentions it (week4-data-quality.md's own rule that
 * over-blocking is its own failure).
 */
export type IntakeWarning = {
  kind: "keyword_mismatch" | "multiple_topics";
  message: string;
};

export type ResonanceVerdict = {
  blocked: boolean;
  score: number;
  reason: string;
  profileName: string;
  warnings: IntakeWarning[];
};

export async function preflightResonance(input: {
  rawIdea?: string | null;
  context?: string | null;
  primaryKeyword: string;
  audienceProfileId?: string | null;
  /**
   * "advisory" on the URL path, where no idea text exists: it changes how the model is
   * briefed, so it judges the subject from the keyword and context instead of marking
   * the missing idea statement down. It no longer changes the verdict. A score at or
   * below the floor blocks on both paths, because a score that low means no stated
   * connection to the audience at all, and letting it through only defers the same
   * refusal until after the scrape is paid for.
   */
  mode?: "block" | "advisory";
}): Promise<ResonanceVerdict | null> {
  const admin = createAdminClient();
  const { data: profiles } = await admin.from("audience_profiles").select("id, name, description");
  if (!profiles || profiles.length === 0) return null;

  // Mirrors Workflow A: judge against the explicitly chosen profile if there is one,
  // otherwise against all of them and take the best match.
  const scoped = input.audienceProfileId
    ? profiles.filter((p) => p.id === input.audienceProfileId)
    : profiles;
  const candidates = scoped.length > 0 ? scoped : profiles;

  const advisory = input.mode === "advisory";
  const hasIdea = !!input.rawIdea?.trim();

  // No idea text exists on the URL path, so the model is told why rather than left to
  // treat the blank as the author having nothing to say.
  const advisoryNote = advisory
    ? `

Note: no idea text was written. The author supplied source URLs directly, so judge the subject from the primary keyword and any context, and do not penalise the absence of an idea statement itself.`
    : "";

  const prompt = `Judge how strongly this content idea would resonate with the audience below, on a 0-15 scale.${advisoryNote}

Content idea: ${input.rawIdea?.trim() || "(none given)"}
Additional context from the author: ${input.context?.trim() || "(none given)"}
Primary keyword: ${input.primaryKeyword}

Audience profile(s):
${candidates.map((p) => `- ${p.name}: ${p.description}`).join("\n")}

Judge the idea as written, not a charitable interpretation of it: if a topic could plausibly connect to this audience but the author has not said how, score it low, because that missing connection is the whole problem.

Two separate judgements alongside the score, which do not affect it:

keyword_matches_idea. The primary keyword is the SEO spine: the article has to use it naturally and often. Set this false only when the keyword points at a genuinely different subject from the idea (idea about team culture, keyword "fintech compliance"). A keyword that is a narrower or broader phrasing of the same subject still matches.

distinct_topics. Name each genuinely separate subject the idea asks for. "Database indexing strategies, plus why our hiring process changed, and also remote work policy" is three. "How indexing affects query performance at scale, including write amplification" is one subject with an aspect, not two. Err towards one: a focused idea split into pieces would nag the author about nothing.

Calibrate against this scale: a topic squarely in this audience's domain, stated clearly, should land around 11-13. A relevant topic stated vaguely lands around 7-9. A topic with no stated connection to this audience lands at 4 or below.`;

  const claude = getClaude();
  const response = await claude.messages.create({
    model: GENERATION_MODEL,
    max_tokens: 1000,
    tools: [RESONANCE_TOOL],
    tool_choice: { type: "tool", name: RESONANCE_TOOL.name },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return null;
  const result = toolUse.input as {
    resonance_score?: number;
    reason?: string;
    best_profile_name?: string;
    keyword_matches_idea?: boolean;
    keyword_note?: string;
    distinct_topics?: unknown;
  };

  if (typeof result.resonance_score !== "number") return null;

  // Same defensive normalisation every other tool parse in this codebase needs:
  // Claude returns a nested array as a JSON string often enough that assuming the
  // declared shape has broken four separate nodes already.
  let topics = result.distinct_topics;
  if (typeof topics === "string") {
    try {
      topics = JSON.parse(topics);
    } catch {
      topics = [topics];
    }
  }
  if (!Array.isArray(topics) && topics && typeof topics === "object") topics = Object.values(topics);
  const topicList = (Array.isArray(topics) ? topics : []).map((t) => String(t)).filter(Boolean);

  const warnings: IntakeWarning[] = [];

  // Meaningless without an idea to compare the keyword against, so it is only ever
  // raised where there is one.
  if (hasIdea && result.keyword_matches_idea === false) {
    warnings.push({
      kind: "keyword_mismatch",
      message:
        result.keyword_note?.trim() ||
        `The primary keyword "${input.primaryKeyword}" points somewhere the idea does not go, so the article would be optimised for a search it never answers.`,
    });
  }
  if (topicList.length > 1) {
    warnings.push({
      kind: "multiple_topics",
      message: `This reads as ${topicList.length} separate ideas: ${topicList.join("; ")}. One article covering all of them tends to fail Topic Relevance, and each would be stronger on its own.`,
    });
  }

  return {
    // Blocks on both paths. The URL path used to downgrade this to a warning because
    // the judgement rests on a keyword rather than an idea, but a score this low means
    // the content has no stated connection to the audience at all, and letting it
    // through just moves the same refusal to after the scrape has been paid for.
    blocked: result.resonance_score <= BLOCK_AT_OR_BELOW,
    score: result.resonance_score,
    reason: result.reason ?? "No reason given.",
    profileName: result.best_profile_name ?? candidates[0].name,
    warnings,
  };
}
