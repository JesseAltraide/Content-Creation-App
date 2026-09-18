import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { intakeSchema, dedupeUrls } from "@/lib/intake-validation";
import { logEvent } from "@/lib/events";
import { triggerSearchSources, triggerScrapeAndProposeAngle } from "@/lib/n8n";
import { getOnboardingStatus } from "@/lib/onboarding";
import { preflightResonance } from "@/lib/resonance-preflight";
import { assessSourceUrls } from "@/lib/source-quality";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Server-enforced, not just hidden behind the /new page's own check (same "hard
  // rule" discipline as every other gate in this build) - someone hitting this
  // route directly shouldn't be able to skip workspace setup.
  const onboarding = await getOnboardingStatus();
  if (!onboarding.complete) {
    return NextResponse.json(
      { error: "This workspace needs an audience profile, a tone sample, and a notification email configured before it can generate content." },
      { status: 409 }
    );
  }

  const body = await request.json();
  const parsed = intakeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed.", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const input = parsed.data;
  const urls = dedupeUrls(input.urls ?? []);

  // Pre-flight audience resonance (Decision #104). Runs before anything is created
  // or triggered, so a mismatched idea costs one small Claude call instead of a
  // search, the human's source-picking time, and a scrape of every result.
  //
  // Both paths run it now, but they are not the same check, because they do not have
  // the same evidence:
  //
  //   raw idea  the author wrote an argument, so it can be judged and REFUSED. A bad
  //             one would otherwise burn a Tavily search, the human's source-picking
  //             time, and a scrape of every result.
  //   url       no idea text exists at all. The judgement rests on a keyword and any
  //             context, which is too thin to refuse work on, especially when the
  //             author has already committed to specific sources. So it WARNS, and
  //             the authoritative block stays where the evidence is: Workflow A2,
  //             which scores resonance with the scraped sources actually read.
  //
  // Both are worth running early: the URL path still scrapes every URL and makes an
  // angle call before A2's gate can fire, so an obvious mismatch is worth mentioning
  // before that spend rather than after it.
  // Needs no model at all: a video, a homepage or a live-updating overview page is
  // knowable from the URL alone, and those are the sources that produce claims nobody
  // can date or verify later.
  const sourceIssues = input.inputPath === "url" ? assessSourceUrls(urls) : [];

  {
    const advisory = input.inputPath === "url";
    let verdict = null;
    try {
      verdict = await preflightResonance({
        rawIdea: input.rawIdea,
        context: input.context,
        primaryKeyword: input.primaryKeyword,
        audienceProfileId: input.audienceProfileId,
        mode: advisory ? "advisory" : "block",
      });
    } catch {
      // Fails open on purpose: a gate that takes intake down whenever the Anthropic
      // API hiccups is worse than the waste it exists to prevent, and the
      // authoritative ≤6 block still runs downstream with the sources in hand.
      verdict = null;
    }

    if (verdict?.blocked) {
      return NextResponse.json(
        {
          error: "low_resonance",
          resonance: verdict,
        },
        { status: 422 }
      );
    }

    // Advisory findings from the same call, so they cost nothing extra: a keyword
    // pointing away from the idea, an idea that is really several, and on the URL
    // path a weak keyword-to-audience fit. None can be caught by word rules and none
    // justifies a refusal, so they are shown once and the author decides.
    const warnings = [
      ...(verdict?.warnings ?? []),
      ...sourceIssues.map((issue) => ({ kind: `source_${issue.kind}`, message: `${issue.label}: ${issue.message}` })),
    ];

    if (warnings.length > 0 && !input.acknowledgedWarnings) {
      return NextResponse.json({ error: "intake_warnings", warnings }, { status: 409 });
    }
  }

  const admin = createAdminClient();

  // Stage 1 hard block (Decision #34): a selected channel with zero tone samples must not
  // silently fall back to a generic voice. Server-side, not just the UI hint the form shows -
  // enforced here regardless of what the client actually sent.
  const { data: existingSamples } = await admin
    .from("tone_samples")
    .select("channel")
    .in("channel", input.channels);
  const channelsWithSamples = new Set((existingSamples ?? []).map((s) => s.channel));

  const unresolvedChannels = input.channels.filter((c) => {
    if (channelsWithSamples.has(c)) return true;
    if (input.confirmedGenericToneChannels.includes(c)) return true;
    const described = input.describedToneByChannel[c]?.trim();
    return !!described && described.length >= 20;
  });
  const blockedChannels = input.channels.filter((c) => !unresolvedChannels.includes(c));

  if (blockedChannels.length > 0) {
    return NextResponse.json(
      {
        error: `No tone samples for ${blockedChannels.join(", ")}. Confirm a generic default or describe the target tone before submitting.`,
      },
      { status: 400 }
    );
  }

  // Any described-target tone becomes a real, reusable workspace tone sample - so this
  // channel's gap is closed for every future request too, not just this one.
  for (const channel of input.channels) {
    if (channelsWithSamples.has(channel)) continue;
    const described = input.describedToneByChannel[channel]?.trim();
    if (described && described.length >= 20) {
      await admin.from("tone_samples").insert({
        channel,
        content: described,
        source: "described_target",
      });
    }
  }

  const { data: request_, error: insertError } = await admin
    .from("requests")
    .insert({
      user_id: user.id,
      status: "draft",
      input_path: input.inputPath,
      raw_idea: input.rawIdea?.trim() || null,
      context: input.context?.trim() || null,
      primary_keyword: input.primaryKeyword.trim(),
      desired_length: input.desiredLength || null,
      channels: input.channels,
      audience_profile_id: input.audienceProfileId || null,
      x_thread_length: input.xThreadLength,
    })
    .select()
    .single();

  if (insertError || !request_) {
    await logEvent({
      stage: "intake",
      status: "failed",
      detail: insertError?.message ?? "Unknown insert failure.",
    });
    return NextResponse.json({ error: "Failed to create request." }, { status: 500 });
  }

  if (urls.length > 0) {
    const { error: sourcesError } = await admin.from("sources").insert(
      urls.map((url) => ({ request_id: request_.id, url, status: "pending_selection" }))
    );
    if (sourcesError) {
      await logEvent({
        requestId: request_.id,
        stage: "intake",
        status: "failed",
        detail: `Failed to record source URLs: ${sourcesError.message}`,
      });
      return NextResponse.json({ error: "Failed to record source URLs." }, { status: 500 });
    }
  }

  await admin
    .from("requests")
    .update({ status: "researching" })
    .eq("id", request_.id)
    .eq("status", "draft");

  await logEvent({
    requestId: request_.id,
    stage: "intake",
    status: "success",
    detail: `Request created via ${input.inputPath} path with ${urls.length} source URL(s).`,
  });

  // Path A (raw idea): kick off search for candidate sources, human picks after.
  // Path B (URL provided): the URL(s) already are the curation - scrape straight away.
  // Triggered after the response is sent, not awaited inline - the underlying
  // pipeline can run for minutes across multiple Claude calls, well past what a
  // synchronous connection (a gateway timeout, or a serverless function's own
  // duration limit) can be relied on to survive. n8n keeps running regardless of
  // whether anything is still listening for its response; the human just checks
  // back on the request page once it's done.
  if (input.inputPath === "raw_idea") {
    after(() => triggerSearchSources(request_.id));
  } else {
    after(() => triggerScrapeAndProposeAngle(request_.id));
  }

  return NextResponse.json({ request: request_ }, { status: 201 });
}
