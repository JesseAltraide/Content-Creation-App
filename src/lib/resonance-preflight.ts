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
    required: ["resonance_score", "reason", "best_profile_name"],
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
    },
  },
};

export type ResonanceVerdict = {
  blocked: boolean;
  score: number;
  reason: string;
  profileName: string;
};

export async function preflightResonance(input: {
  rawIdea?: string | null;
  context?: string | null;
  primaryKeyword: string;
  audienceProfileId?: string | null;
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

  const prompt = `Judge how strongly this content idea would resonate with the audience below, on a 0-15 scale.

Content idea: ${input.rawIdea?.trim() || "(none given)"}
Additional context from the author: ${input.context?.trim() || "(none given)"}
Primary keyword: ${input.primaryKeyword}

Audience profile(s):
${candidates.map((p) => `- ${p.name}: ${p.description}`).join("\n")}

Judge the idea as written, not a charitable interpretation of it: if a topic could plausibly connect to this audience but the author has not said how, score it low, because that missing connection is the whole problem.

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
  const result = toolUse.input as { resonance_score?: number; reason?: string; best_profile_name?: string };

  if (typeof result.resonance_score !== "number") return null;

  return {
    blocked: result.resonance_score <= BLOCK_AT_OR_BELOW,
    score: result.resonance_score,
    reason: result.reason ?? "No reason given.",
    profileName: result.best_profile_name ?? candidates[0].name,
  };
}
