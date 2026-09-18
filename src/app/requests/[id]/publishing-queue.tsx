import { Card } from "@/components/ui/card";
import { CHANNEL_LABELS, findLengthViolations } from "@/lib/channel-post-format";
import ScheduleChannelForm from "./schedule-channel-form";
import NewsletterEmailPreview from "./newsletter-email-preview";

// Newsletter shares this same table/cron job but gets real delivery to every
// active subscriber instead of a reminder email (Decision #22/#48) - see
// /api/cron/publish for the branch.
const QUEUE_CHANNELS = ["linkedin", "x", "newsletter"] as const;

type ChannelPost = { id: string; channel: string; version: number; chosen: boolean; body: string };
type Criterion = { name: string; score: number; max: number; notes?: string };
type EvalResult = {
  channel: string | null;
  content_version: number;
  status: string;
  created_at?: string;
  overall_score?: number;
  criteria?: Criterion[] | null;
  weakest_criteria_suggestions?: string[] | null;
};

// Workflow D's gate: 85 or better passes. Duplicated as a display constant rather
// than imported because the authority genuinely lives in the workflow, and a stale
// number here would only ever mislabel a banner, never let something through.
const PASS_MARK = 85;
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
  subscriberCount,
}: {
  requestId: string;
  channelPosts: ChannelPost[];
  evaluations: EvalResult[];
  scheduledContent: ScheduledItem[];
  /** Active newsletter subscribers, so the email preview can say who it reaches. */
  subscriberCount: number;
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

          // Two lowest-scoring criteria by proportion of their own max, which is what
          // the human can actually act on. A criterion out of 25 losing 7 points
          // matters more than one out of 15 losing 2, and raw scores hide that.
          const weakest = [...(evalForPost?.criteria ?? [])]
            .filter((c) => c && typeof c.score === "number" && typeof c.max === "number" && c.max > 0)
            .sort((a, b) => a.score / a.max - b.score / b.max)
            .slice(0, 2);
          const suggestions = (evalForPost?.weakest_criteria_suggestions ?? []).filter(
            (s): s is string => typeof s === "string" && s.trim().length > 0
          );

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

              {/* "It didn't pass" on its own is a dead end: it states a fact and
                  leaves the human with no idea what to do next. The evaluator already
                  knows the gap and what would close it, so show that instead. */}
              {/* Newsletter is the only channel this app actually sends, so it is the
                  only one where "what will they receive" is a real question rather
                  than a copy-paste reminder to the author. */}
              {post && channel === "newsletter" && (
                <NewsletterEmailPreview
                  body={post.body}
                  subscriberCount={subscriberCount}
                  scheduledFor={latestForChannel?.scheduled_for ?? null}
                />
              )}

              {post && evalForPost?.status !== "pass" && (
                <div className="mt-2 rounded-lg bg-warning-soft p-3">
                  <p className="text-xs font-semibold text-warning">
                    {typeof evalForPost?.overall_score !== "number"
                      ? "This draft hasn't been scored yet, so it can't be scheduled."
                      : evalForPost.overall_score < PASS_MARK
                        ? `Scored ${evalForPost.overall_score}/100, ${PASS_MARK - evalForPost.overall_score} short of the ${PASS_MARK} needed to schedule.`
                        : `Scored ${evalForPost.overall_score}/100 but still marked for revision.`}
                  </p>
                  {weakest.length > 0 && (
                    <p className="mt-1 text-xs text-warning/90">
                      Weakest: {weakest.map((c) => `${c.name} ${c.score}/${c.max}`).join(", ")}.
                    </p>
                  )}
                  {suggestions.length > 0 && (
                    <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-xs text-warning/90">
                      {suggestions.map((sug, i) => (
                        <li key={i}>{sug}</li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-warning/90">
                    {isOwner
                      ? `Edit the post in the ${CHANNEL_LABELS[channel]} tab to fix it. Saving an edit re-runs the evaluation, and it becomes schedulable as soon as it clears ${PASS_MARK}.`
                      : "The author can edit the post to fix this, which re-runs the evaluation."}
                  </p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
