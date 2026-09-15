import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { intakeSchema, dedupeUrls } from "@/lib/intake-validation";
import { logEvent } from "@/lib/events";

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

  const nextStatus = input.inputPath === "raw_idea" ? "researching" : "researching";

  await admin
    .from("requests")
    .update({ status: nextStatus })
    .eq("id", request_.id)
    .eq("status", "draft");

  await logEvent({
    requestId: request_.id,
    stage: "intake",
    status: "success",
    detail: `Request created via ${input.inputPath} path with ${urls.length} source URL(s).`,
  });

  return NextResponse.json({ request: request_ }, { status: 201 });
}
