import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { intakeSchema, dedupeUrls } from "@/lib/intake-validation";
import { logEvent } from "@/lib/events";
import { triggerSearchSources, triggerScrapeAndProposeAngle } from "@/lib/n8n";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
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
  // Path B (URL provided): the URL(s) already are the curation — scrape straight away.
  if (input.inputPath === "raw_idea") {
    await triggerSearchSources(request_.id);
  } else {
    await triggerScrapeAndProposeAngle(request_.id);
  }

  return NextResponse.json({ request: request_ }, { status: 201 });
}
