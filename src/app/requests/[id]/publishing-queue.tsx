import { Card } from "@/components/ui/card";
import { CHANNEL_LABELS, findLengthViolations } from "@/lib/channel-post-format";
import ScheduleChannelForm from "./schedule-channel-form";

// Newsletter shares this same table/cron job but gets real delivery to every
// active subscriber instead of a reminder email (Decision #22/#48) - see
// /api/cron/publish for the branch.
const QUEUE_CHANNELS = ["linkedin", "x", "newsletter"] as const;

type ChannelPost = { id: string; channel: string; version: number; chosen: boolean; body: string };
type EvalResult = {
  channel: string | null;
  content_version: number;
  status: string;
  created_at?: string;
};
type ScheduledItem = {
  id: string;
  channel_post_id: string;
  channel: string;
  status: "scheduled" | "published" | "publish_failed" | "overdue";
  scheduled_for: string;
  published_at: string | null;
  notification_sent: boolean;
};

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
  scheduled: { label: "Scheduled", className: "bg-accent-soft text-accent" },
  published: { label: "Published", className: "bg-success-soft text-success" },
  overdue: { label: "Overdue", className: "bg-warning-soft text-warning" },
  publish_failed: { label: "Failed", className: "bg-danger-soft text-danger" },
};

export default function PublishingQueue({
  requestId,
  channelPosts,
  evaluations,
  scheduledContent,
  brandChangedAt,
  isOwner,
}: {
  requestId: string;
  channelPosts: ChannelPost[];
  evaluations: EvalResult[];
  scheduledContent: ScheduledItem[];
  /** When the audience or tone last changed, if ever. */
  brandChangedAt: string | null;
  /** Only the author schedules; reviewers see the queue state read-only. */
  isOwner: boolean;
}) {
  // Only shows once there's at least one eligible (passing) channel post to
  // schedule, or an existing queue entry to display - nothing to show before
  // adaptation has produced anything.
  const latestByChannel = new Map<string, ChannelPost>();
  for (const post of channelPosts) {
    if (!post.chosen || !QUEUE_CHANNELS.includes(post.channel as (typeof QUEUE_CHANNELS)[number])) continue;
    const existing = latestByChannel.get(post.channel);
    if (!existing || post.version > existing.version) latestByChannel.set(post.channel, post);
  }
  if (latestByChannel.size === 0 && scheduledContent.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-muted">Publishing queue</h2>
      <p className="mt-1 text-xs text-muted">
        LinkedIn and X are scheduled reminders, not automated publishing. You get the
        ready-to-post content by email and post it yourself. Newsletter is real delivery: it
        actually sends to every active subscriber at the scheduled time.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {QUEUE_CHANNELS.map((channel) => {
          const post = latestByChannel.get(channel);
          const evalForPost = post
            ? evaluations.find((e) => e.channel === channel && e.content_version === post.version)
            : undefined;
          // Over-limit content is unpublishable regardless of its score, so it
          // blocks scheduling the same way a failed evaluation does. Same helper
          // the schedule route enforces with, so the two can't drift.
          const lengthViolations = post ? findLengthViolations(channel, post.body ?? "") : [];
          const eligible = evalForPost?.status === "pass" && lengthViolations.length === 0;
          // Changing the audience or tone does not re-score anything already
          // evaluated, and re-scoring automatically would be worse: it could
          // invalidate something already scheduled to send, and cost a full
          // evaluation for every queued post on every settings tweak. Flagged
          // instead, so the author decides whether it still reads right.
          const evaluatedBeforeBrandChange =
            !!brandChangedAt &&
            !!evalForPost?.created_at &&
            new Date(evalForPost.created_at) < new Date(brandChangedAt);
          const pending = scheduledContent.find(
            (s) => s.channel === channel && (!post || s.channel_post_id === post.id) && s.status === "scheduled"
          );
          const latestForChannel = scheduledContent
            .filter((s) => s.channel === channel)
            .sort((a, b) => new Date(b.scheduled_for).getTime() - new Date(a.scheduled_for).getTime())[0];

          if (!post && !latestForChannel) return null;

          return (
            <Card key={channel} className="p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{CHANNEL_LABELS[channel]}</h3>
                {latestForChannel && (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      STATUS_LABELS[latestForChannel.status]?.className ?? "bg-black/5 text-muted"
                    }`}
                  >
                    {STATUS_LABELS[latestForChannel.status]?.label ?? latestForChannel.status}
                  </span>
                )}
              </div>

              {latestForChannel && (
                <p className="mt-1 text-xs text-muted">
                  {latestForChannel.status === "published"
                    ? `Published ${new Date(latestForChannel.published_at ?? latestForChannel.scheduled_for).toLocaleString()}${
                        latestForChannel.notification_sent ? "" : ", notification email failed to send"
                      }`
                    : `Scheduled for ${new Date(latestForChannel.scheduled_for).toLocaleString()}`}
                </p>
              )}

              {isOwner && eligible && post && (
                <div className="mt-3">
                  <ScheduleChannelForm requestId={requestId} channel={channel} hasPendingSchedule={!!pending} />
                </div>
              )}

              {post && eligible && evaluatedBeforeBrandChange && (
                <p className="mt-2 text-xs text-warning">
                  The tone samples changed after this was scored, so its Tone score was measured
                  against a voice the workspace no longer uses. It can still be scheduled. Edit it
                  to trigger a fresh evaluation if you want it re-checked.
                </p>
              )}

              {post && lengthViolations.length > 0 && (
                <p className="mt-2 text-xs text-danger">
                  Over the {CHANNEL_LABELS[channel]} limit, so this can&apos;t be scheduled until it&apos;s
                  shortened:{" "}
                  {lengthViolations
                    .map((v) => `${v.label} is ${v.length} characters (limit ${v.limit})`)
                    .join("; ")}
                  . Edit the post above to fix it.
                </p>
              )}

              {post && !eligible && lengthViolations.length === 0 && (
                <p className="mt-2 text-xs text-muted">
                  This channel&apos;s current draft hasn&apos;t passed Pass 2 evaluation yet, so there&apos;s nothing to
                  schedule until it does.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
