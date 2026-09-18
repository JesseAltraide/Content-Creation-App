import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";
import { sendMail } from "@/lib/mailer";
import { SAFE_STATE, STALLED_SWEEP_MS } from "@/lib/stalled-runs";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

// Every stage of this pipeline runs on n8n and writes straight to Supabase, which is
// what makes it safe to close the tab, and also what made it silent. A run that
// finished, or dead-ended, while you were elsewhere told you nothing: you had to
// navigate back and look.
//
// A cron sweep rather than n8n calling us on completion: it needs no workflow edit
// (so no reimport), it catches states set by this app as well as by n8n, and a
// missed run self-heals on the next pass instead of losing the notification.
const NOTIFIABLE: Record<string, { subject: string; line: string }> = {
  awaiting_source_selection: {
    subject: "Sources are ready to pick",
    line: "The search finished and there are candidate sources waiting for you to choose from.",
  },
  awaiting_angle_selection: {
    subject: "An angle is ready to choose",
    line: "Research is done and there's an angle (or several) waiting for you to pick.",
  },
  pending_approval: {
    subject: "A draft is ready to review",
    line: "The article has been written and scored, and it's waiting on your approval.",
  },
  ready_to_schedule: {
    subject: "Channel posts are ready to schedule",
    line: "Adaptation and Pass 2 evaluation are done. The posts are ready to go into the queue.",
  },
  needs_human_attention: {
    subject: "A request needs your attention",
    line: "This one stopped and can't continue on its own. Open it to see what happened and what your options are.",
  },
};

export async function GET(request: Request) {
  // Same guard as the publish cron: Vercel sends CRON_SECRET as a Bearer token, and
  // it stays unenforced only when the var was never set (local dev).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const baseUrl = new URL(request.url).origin;

  // Reclaim runs that stopped without reporting back, BEFORE the notification pass, so
  // a reclaimed request can be emailed about in the same sweep.
  //
  // This exists because a run can die inside n8n without reaching any of its own
  // failure handlers: nothing is logged, nothing reverts, and the request claims to be
  // busy indefinitely (seen live at 'adapting' for 112 minutes). The manual reset in
  // the banner covers the human who is looking at the page. This covers the one who
  // is not.
  const reclaimed: string[] = [];
  const { data: working } = await admin
    .from("requests")
    .select("id, status, updated_at, user_id, raw_idea, primary_keyword")
    .in("status", Object.keys(SAFE_STATE))
    .lt("updated_at", new Date(Date.now() - STALLED_SWEEP_MS).toISOString())
    .limit(25);

  for (const req of working ?? []) {
    const target = SAFE_STATE[req.status];
    if (!target) continue;

    // Guarded on the exact status read, so a run that finishes between the query and
    // this write keeps its own result rather than being dragged backwards.
    const { data: moved } = await admin
      .from("requests")
      .update({ status: target.to })
      .eq("id", req.id)
      .eq("status", req.status)
      .select("id")
      .maybeSingle();

    if (!moved) continue;
    if (target.unchooseAngles) {
      await admin.from("angles").update({ chosen: false }).eq("request_id", req.id);
    }

    const minutes = Math.round((Date.now() - new Date(req.updated_at).getTime()) / 60000);
    await logEvent({
      requestId: req.id,
      stage: "pipeline_setup",
      status: "failed",
      detail: `Run stopped without reporting back. Reset automatically from ${req.status} to ${target.to} after ${minutes} minutes of silence, so it can be retried. Nothing was generated. If the original run somehow completes later it will write its own result.`,
    });

    // Emailed directly rather than through the status-based notifier below: the
    // state it lands in (usually 'approved') is a normal one that nobody should be
    // emailed about, but THIS arriving at it is worth knowing.
    let to = "";
    if (req.user_id) {
      const { data: owner } = await admin.auth.admin.getUserById(req.user_id);
      if (owner?.user?.email) to = owner.user.email;
    }
    if (to) {
      const label = req.raw_idea?.trim() || req.primary_keyword || "your content request";
      await sendMail({
        to,
        subject: `A run stopped and was reset: ${label.slice(0, 60)}`,
        text: `This request was left at "${req.status}" with nothing reporting back for ${minutes} minutes, so it has been reset to "${target.to}" and can be retried.

${label}

Open it here: ${baseUrl}/requests/${req.id}
`,
      });
    }
    reclaimed.push(req.id);
  }

  const { data: candidates } = await admin
    .from("requests")
    .select("id, status, raw_idea, primary_keyword, user_id, notified_status")
    .in("status", Object.keys(NOTIFIABLE))
    .limit(50);

  const pending = (candidates ?? []).filter((r) => r.notified_status !== r.status);
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, notified: 0, reclaimed: reclaimed.length });
  }

  const { data: workspaceSettings } = await admin
    .from("workspace_settings")
    .select("notification_email")
    .eq("id", true)
    .maybeSingle();
  const fallbackEmail = workspaceSettings?.notification_email || process.env.NOTIFICATION_EMAIL || "";

  let notified = 0;
  const failures: string[] = [];

  for (const req of pending) {
    // Claim it BEFORE sending. Two overlapping cron runs would otherwise both read
    // the same row and both email about it; the conditional write means only one can
    // win. A send that then fails is logged and not retried, which is the right way
    // round: a missed notification is a small problem, the same one arriving every
    // five minutes forever is a much bigger one.
    const claim = admin
      .from("requests")
      .update({ notified_status: req.status, notified_at: new Date().toISOString() })
      .eq("id", req.id)
      .eq("status", req.status);

    const { data: claimed } = await (req.notified_status === null
      ? claim.is("notified_status", null)
      : claim.eq("notified_status", req.notified_status)
    )
      .select("id")
      .maybeSingle();

    if (!claimed) continue;

    // The owner is who asked for it, so they get told. Requests predating ownership
    // (user_id null) fall back to the workspace notification address.
    let to = fallbackEmail;
    if (req.user_id) {
      const { data: owner } = await admin.auth.admin.getUserById(req.user_id);
      if (owner?.user?.email) to = owner.user.email;
    }
    if (!to) {
      failures.push(`${req.id}: no address to send to`);
      continue;
    }

    const copy = NOTIFIABLE[req.status];
    const label = req.raw_idea?.trim() || req.primary_keyword || "your content request";
    const result = await sendMail({
      to,
      subject: `${copy.subject}: ${label.slice(0, 60)}`,
      text: `${copy.line}\n\n${label}\n\nOpen it here: ${baseUrl}/requests/${req.id}\n`,
    });

    if (result.ok) {
      notified += 1;
    } else {
      failures.push(`${req.id}: ${result.error}`);
      await logEvent({
        requestId: req.id,
        stage: "notification",
        status: "failed",
        detail: `Couldn't email the ${req.status} notification: ${result.error}`,
      });
    }
  }

  return NextResponse.json({ ok: true, notified, reclaimed: reclaimed.length, failures });
}
