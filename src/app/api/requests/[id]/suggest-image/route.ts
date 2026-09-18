import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";
import { formatForEvaluator } from "@/lib/channel-post-format";
import type Anthropic from "@anthropic-ai/sdk";
import { getClaude, TRIAGE_MODEL } from "@/lib/claude";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

// Only LinkedIn and X. The newsletter is sent by this app as plain text, so there is
// nowhere to put an image, and suggesting one would be advice the human cannot act on.
const bodySchema = z.object({ channel: z.enum(["linkedin", "x"]) });

const SUGGEST_TOOL: Anthropic.Tool = {
  name: "suggest_image",
  description: "Judge whether this post would be materially better with an image attached.",
  input_schema: {
    type: "object",
    required: ["recommended", "reason"],
    properties: {
      recommended: { type: "boolean" },
      reason: {
        type: "string",
        description: "One or two sentences on why, grounded in what this specific post says.",
      },
      what_to_show: {
        type: "string",
        description:
          "Only when recommended: what the image should actually depict, specific to this post's content. Not a generic art direction.",
      },
      alt_text: {
        type: "string",
        description: "Only when recommended: alt text for the image being described.",
      },
    },
  },
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!(await userCanModifyRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const { channel } = parsed.data;

  const admin = createAdminClient();

  const { data: post } = await admin
    .from("channel_posts")
    .select("id, version, body")
    .eq("request_id", requestId)
    .eq("channel", channel)
    .eq("chosen", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!post) {
    return NextResponse.json({ error: "No adapted content exists yet for this channel." }, { status: 409 });
  }

  const claude = getClaude();
  let response;
  try {
    // Haiku: this is a judgement about one short piece of text against a handful of
    // rules, the same class of call as the edit triage, not something that needs the
    // generation or evaluation models.
    response = await claude.messages.create({
      model: TRIAGE_MODEL,
      max_tokens: 700,
      tools: [SUGGEST_TOOL],
      tool_choice: { type: "tool", name: SUGGEST_TOOL.name },
      messages: [
        {
          role: "user",
          content: `Would this ${channel} post be materially better with an image attached? Judge this specific post, not ${channel} posts in general.\n\nRecommend one when the post carries something an image genuinely does better than the text: a comparison, a trend, a before and after, a process with steps, a number that lands harder shown than stated, or a physical thing the reader needs to picture.\n\nDo not recommend one when it would just be decoration. A stock photo of people at laptops adds nothing, dilutes a sharp text post, and costs the author time to find. A short, punchy opinion post is usually stronger on its own. If in doubt, say no: a missing image costs nothing, a pointless one makes the post look like everyone else's.\n\nIf you do recommend one, say what it should actually show, drawn from this post's own content, and give alt text for it. Never suggest generic art direction.\n\nThe post:\n${formatForEvaluator(channel, post.body ?? "")}`,
        },
      ],
    });
  } catch (err) {
    await logEvent({ requestId, stage: "image_suggestion", status: "failed", detail: `Image suggestion failed for ${channel}: ${err instanceof Error ? err.message : String(err)}` });
    return NextResponse.json({ error: "Couldn't get a suggestion. Try again." }, { status: 502 });
  }

  const toolUse = response.content.find((c) => c.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    return NextResponse.json({ error: "Couldn't get a suggestion. Try again." }, { status: 502 });
  }

  const suggestion = toolUse.input as {
    recommended?: boolean;
    reason?: string;
    what_to_show?: string;
    alt_text?: string;
  };

  const stored = {
    recommended: suggestion.recommended === true,
    reason: suggestion.reason ?? "",
    what_to_show: suggestion.what_to_show ?? null,
    alt_text: suggestion.alt_text ?? null,
    suggested_at: new Date().toISOString(),
  };

  // Written against this exact version, so a later revision does not inherit an
  // opinion formed about text that no longer exists. The error is checked rather than
  // ignored: without migration 014 the column does not exist, and a silent failure
  // here would look like the button simply doing nothing.
  const { error: saveError } = await admin
    .from("channel_posts")
    .update({ image_suggestion: stored })
    .eq("id", post.id);

  if (saveError) {
    return NextResponse.json(
      {
        error: `The suggestion was generated but couldn't be saved (${saveError.message}). If this mentions image_suggestion, migration 014 hasn't been run yet.`,
      },
      { status: 500 }
    );
  }

  await logEvent({
    requestId,
    stage: "image_suggestion",
    status: "success",
    detail: `Image ${stored.recommended ? "recommended" : "not recommended"} for ${channel}: ${stored.reason}`.slice(0, 400),
  });

  return NextResponse.json({ ok: true, suggestion: stored });
}
