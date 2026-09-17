import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logEvent } from "@/lib/events";
import { sendMail } from "@/lib/mailer";
import { parseXPosts, parseNewsletter } from "@/lib/channel-post-format";

// Newsletter's unsubscribe footer, appended to every real send - required
// alongside real sending, not optional (week4-full-flow.md line 295): a basic
// unsubscribe link, honored immediately, not a silent compliance gap.
function unsubscribeFooter(baseUrl: string, subscriberId: string): string {
  return `\n\n---\nUnsubscribe: ${baseUrl}/api/unsubscribe?id=${subscriberId}`;
}

// How far past scheduled_for a still-'scheduled' item can sit before it's treated
// as stale rather than fired late - the docs require a visible "overdue" state for
// "cron misconfigured, worker down" (week4-full-flow.md line 314) but don't specify
// a threshold. 2 hours: long enough that a few minutes of cron jitter or a single
// missed run (this fires every 15 minutes, see vercel.json) never trips it, short
// enough that a "Tuesday 9am" reminder that would otherwise land Tuesday evening
// gets flagged instead of silently sent hours late.
const OVERDUE_THRESHOLD_MS = 2 * 60 * 60 * 1000;

function formatChannelBody(channel: string, body: string): string {
  if (channel === "x") {
    const posts = parseXPosts(body);
    return posts.map((p, i) => (posts.length > 1 ? `Post ${i + 1}/${posts.length}:\n${p}` : p)).join("\n\n");
  }
  return body;
}

// Vercel Cron invokes this on the schedule in vercel.json and sends CRON_SECRET as
// a Bearer token automatically once that env var is set - verified here so the
// endpoint can't be triggered by anyone who finds the URL. Left unenforced only if
// CRON_SECRET was never configured (local dev convenience), same conditional
// pattern used elsewhere in this build (e.g. mailer.ts's missing-credentials check).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const admin = createAdminClient();
  const now = new Date();

  // Shared workspace-level setting (Decision #96), not the env var directly - the
  // onboarding gate (Decision #97) requires this to be set via the settings UI
  // before generation is even allowed, so by the time anything reaches this cron
  // job it should already exist. NOTIFICATION_EMAIL env var stays as a fallback
  // only for content created before the gate existed.
  const { data: workspaceSettings } = await admin
    .from("workspace_settings")
    .select("notification_email")
    .eq("id", true)
    .maybeSingle();
  const notificationEmail = workspaceSettings?.notification_email || process.env.NOTIFICATION_EMAIL || "";

  const { data: due } = await admin
    .from("scheduled_content")
    .select("id, channel_post_id, channel, scheduled_for")
    .eq("status", "scheduled")
    .lte("scheduled_for", now.toISOString());

  const results = { published: 0, overdue: 0, staleSkipped: 0, notificationFailed: 0, errors: [] as string[] };

  for (const item of due ?? []) {
    try {
      const { data: post } = await admin
        .from("channel_posts")
        .select("id, request_id, channel, body, chosen")
        .eq("id", item.channel_post_id)
        .single();

      // The content was superseded (edited or regenerated) after this was
      // scheduled - Decision: "any edit to approved content immediately reverts it
      // out of the publish queue" (week4-full-flow.md line 356). Rather than fire a
      // stale reminder for content that no longer exists as the current draft,
      // fail this item explicitly and let the human re-schedule the new version.
      if (!post || !post.chosen) {
        const { data: updated } = await admin
          .from("scheduled_content")
          .update({ status: "publish_failed" })
          .eq("id", item.id)
          .eq("status", "scheduled")
          .select()
          .single();
        if (updated) {
          results.staleSkipped++;
          await logEvent({
            requestId: post?.request_id ?? null,
            stage: "publish_job",
            status: "failed",
            detail: `Scheduled ${item.channel} post was superseded by a newer version before its publish time - re-schedule the current draft.`,
          });
        }
        continue;
      }

      const overdueMs = now.getTime() - new Date(item.scheduled_for).getTime();
      if (overdueMs > OVERDUE_THRESHOLD_MS) {
        const { data: updated } = await admin
          .from("scheduled_content")
          .update({ status: "overdue" })
          .eq("id", item.id)
          .eq("status", "scheduled")
          .select()
          .single();
        if (updated) {
          results.overdue++;
          await logEvent({
            requestId: post.request_id,
            stage: "publish_job",
            status: "failed",
            detail: `${item.channel} publish reminder is over 2 hours late (cron may have missed a run) - marked overdue instead of sending a stale notification.`,
          });
        }
        continue;
      }

      // The atomic conditional write itself IS the duplicate-fire guard (week4-
      // full-flow.md line 315 / week4-claude-code-instructions.md's own example):
      // if two cron invocations somehow race on the same item, only one UPDATE can
      // match status='scheduled' and return a row - the loser sees zero rows
      // updated and does nothing further, no duplicate notification possible.
      const { data: updated } = await admin
        .from("scheduled_content")
        .update({ status: "published", published_at: now.toISOString() })
        .eq("id", item.id)
        .eq("status", "scheduled")
        .select()
        .single();

      if (!updated) continue; // lost the race to another concurrent run - fine, do nothing

      results.published++;

      // Newsletter is the one channel with real, live delivery this week - not a
      // reminder like LinkedIn/X (Decision #22/#48). Same scheduled_content table
      // and cron job, different action at fire time: a real send to every active
      // subscriber, not a single email to the workspace notification address.
      if (item.channel === "newsletter") {
        const { subject_line, body_markdown } = parseNewsletter(post.body);
        const { data: subscribers } = await admin
          .from("newsletter_subscribers")
          .select("id, email")
          .is("unsubscribed_at", null);

        const baseUrl = new URL(request.url).origin;
        let sent = 0;
        let failed = 0;
        for (const sub of subscribers ?? []) {
          const result = await sendMail({
            to: sub.email,
            subject: subject_line || "Newsletter",
            text: `${body_markdown}${unsubscribeFooter(baseUrl, sub.id)}`,
          });
          if (result.ok) sent++;
          else failed++;
        }

        // Notification failure is tracked separately from the state transition
        // (week4-full-flow.md line 316) - the item is genuinely published (its
        // time arrived) regardless of how many individual sends succeeded;
        // notification_sent only reflects whether delivery was clean.
        if (failed === 0) {
          await admin.from("scheduled_content").update({ notification_sent: true }).eq("id", item.id);
        } else {
          results.notificationFailed++;
        }
        await logEvent({
          requestId: post.request_id,
          stage: "publish_job",
          status: failed === 0 ? "success" : "failed",
          detail: `Newsletter sent to ${sent}/${(subscribers ?? []).length} active subscribers${failed > 0 ? ` (${failed} failed)` : ""}.`,
        });
        continue;
      }

      // LinkedIn/X: a scheduled reminder, not automated publishing (Decision #22) -
      // the human still posts it themselves; the email just has the content ready
      // to paste.
      const mailResult = await sendMail({
        to: notificationEmail,
        subject: `Ready to publish: ${item.channel} post`,
        text: `Your scheduled ${item.channel} post is ready to paste and publish:\n\n${formatChannelBody(item.channel, post.body)}`,
      });

      if (mailResult.ok) {
        await admin.from("scheduled_content").update({ notification_sent: true }).eq("id", item.id);
        await logEvent({
          requestId: post.request_id,
          stage: "publish_job",
          status: "success",
          detail: `${item.channel} post published and notification sent.`,
        });
      } else {
        results.notificationFailed++;
        await logEvent({
          requestId: post.request_id,
          stage: "publish_job",
          status: "failed",
          detail: `${item.channel} post marked published, but the notification email failed: ${mailResult.error}`,
        });
      }
    } catch (err) {
      results.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return NextResponse.json({ ok: true, checked: due?.length ?? 0, ...results });
}
