import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";
import { sendMail } from "@/lib/mailer";

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

  const { data: candidates } = await admin
    .from("requests")
    .select("id, status, raw_idea, primary_keyword, user_id, notified_status")
    .in("status", Object.keys(NOTIFIABLE))
    .limit(50);

  const pending = (candidates ?? []).filter((r) => r.notified_status !== r.status);
  if (pending.length === 0) {
    return NextResponse.json({ ok: true, notified: 0 });
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

  return NextResponse.json({ ok: true, notified, failures });
}
