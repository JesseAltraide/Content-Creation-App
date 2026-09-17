import { Card } from "@/components/ui/card";
import { CHANNEL_LABELS } from "@/lib/channel-post-format";
import ScheduleChannelForm from "./schedule-channel-form";

// Newsletter isn't part of this queue at all - it has its own real-delivery path
// (Stage 9b, not yet built), not the LinkedIn/X scheduled-reminder queue (Decision
// #22/#48).
const QUEUE_CHANNELS = ["linkedin", "x"] as const;

type ChannelPost = { id: string; channel: string; version: number; chosen: boolean };
type EvalResult = { channel: string | null; content_version: number; status: string };
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
}: {
  requestId: string;
  channelPosts: ChannelPost[];
  evaluations: EvalResult[];
  scheduledContent: ScheduledItem[];
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
        A scheduled reminder, not automated publishing — at the scheduled time you get the
        ready-to-post content by email and post it yourself.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {QUEUE_CHANNELS.map((channel) => {
          const post = latestByChannel.get(channel);
          const evalForPost = post
            ? evaluations.find((e) => e.channel === channel && e.content_version === post.version)
            : undefined;
          const eligible = evalForPost?.status === "pass";
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
                        latestForChannel.notification_sent ? "" : " — notification email failed to send"
                      }`
                    : `Scheduled for ${new Date(latestForChannel.scheduled_for).toLocaleString()}`}
                </p>
              )}

              {eligible && post && (
                <div className="mt-3">
                  <ScheduleChannelForm requestId={requestId} channel={channel} hasPendingSchedule={!!pending} />
                </div>
              )}

              {post && !eligible && (
                <p className="mt-2 text-xs text-muted">
                  This channel's current draft hasn't passed Pass 2 evaluation yet — nothing to
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
