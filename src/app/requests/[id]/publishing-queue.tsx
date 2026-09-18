import { Card } from "@/components/ui/card";
import { asList } from "@/lib/eval-shape";
import { CHANNEL_LABELS, findLengthViolations, evaluationPassed } from "@/lib/channel-post-format";
import ScheduleChannelForm from "./schedule-channel-form";
import NewsletterEmailPreview from "./newsletter-email-preview";
import UseVersionButton from "./use-version-button";

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
  manuallyEditedChannels,
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
  /**
   * Channels whose current post came from a manual edit, read from the edit_triage
   * events. It decides only what the score-regression banner SAYS and whether going
   * back to an earlier version is offered: an edit is the author's own text and is
   * never swapped out, an automated round is the system's own work and can be.
   */
  manuallyEditedChannels: string[];
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
        actually sends to every active subscriber.
      </p>
      {/* Stated plainly rather than buried, because the previous wording promised
          delivery "at the scheduled time" and the hosting plan cannot keep that
          promise. Vercel's Hobby plan runs a cron once a day, so the scheduled time
          is the earliest a post goes out, not the time it goes out. Someone picking
          a 9am slot should learn that here, not by watching it arrive the next
          morning. */}
      <p className="mt-1 text-xs text-warning">
        Sending runs once a day, at 06:00 UTC. A scheduled time is the earliest
        something will be sent, not the exact moment: anything scheduled after that
        morning&apos;s run goes out on the next one. This is a limit of the hosting
        plan, not of the schedule you pick.
      </p>

      <div className="mt-3 flex flex-col gap-3">
        {QUEUE_CHANNELS.map((channel) => {
          const post = latestByChannel.get(channel);
          // Latest match wins, not the first. Re-running adaptation restarts channel
          // post numbering at 1, so a request can hold two different v1 posts per
          // channel with two different scores. Taking the first match showed a post's
          // text beside an older post's score (seen live: 54 shown where the current
          // post had scored 61). Ordered by created_at upstream, so scanning to the
          // last match takes the evaluation written most recently.
          const evalForPost = post
            ? [...evaluations]
                .reverse()
                .find((e) => e.channel === channel && e.content_version === post.version)
            : undefined;
          // Over-limit content is unpublishable regardless of its score, so it
          // blocks scheduling the same way a failed evaluation does. Same helper
          // the schedule route enforces with, so the two can't drift.
          const lengthViolations = post ? findLengthViolations(channel, post.body ?? "") : [];
          const eligible = evaluationPassed(evalForPost) && lengthViolations.length === 0;
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
          const weakest = [...asList<Criterion>(evalForPost?.criteria)]
            .filter((c) => c && typeof c.score === "number" && typeof c.max === "number" && c.max > 0)
            .sort((a, b) => a.score / a.max - b.score / b.max)
            .slice(0, 2);
          // A manual edit is the author's own intent, so it is never overridden the way a
          // lower-scoring automated rewrite is: Workflow E saves what they wrote and
          // re-scores it. But it can still end up shipping a post that scores worse than
          // one they already had, without anyone mentioning it. So the fact is surfaced
          // here, at the point of scheduling, and the decision stays theirs.
          const scoredForChannel = evaluations.filter(
            (e) => e.channel === channel && typeof e.overall_score === "number"
          );
          const bestEval = scoredForChannel.reduce<EvalResult | null>(
            (best, e) => (best === null || e.overall_score! > best.overall_score! ? e : best),
            null
          );
          const bestForChannel = bestEval?.overall_score ?? null;
          const currentScore = evalForPost?.overall_score ?? null;
          const betterExisted =
            currentScore !== null && bestForChannel !== null && bestForChannel > currentScore;
          // The banner used to state flatly that a manual edit caused this, because
          // that was the only case it was written for. It is not the only case: a
          // Workflow D adaptation round can replace a passing version with a worse
          // one all by itself, and blaming an edit the author never made sends them
          // looking for a mistake that is not theirs. Caught live on a request with
          // no edits at all: X scored 62, then 87, then 62 again.
          const wasEdited = manuallyEditedChannels.includes(channel);
          // Only offered for a version this app produced. A manual edit is the
          // author's own text and is never swapped out from under them, which is the
          // whole of Decision #126.
          const betterVersion =
            betterExisted && !wasEdited && bestEval
              ? channelPosts.find(
                  (p) => p.channel === channel && p.version === bestEval.content_version
                )
              : undefined;

          const suggestions = asList<string>(evalForPost?.weakest_criteria_suggestions).filter(
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

              {post && betterExisted && (
                <div className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
                  <p>
                    An earlier version of this post scored {bestForChannel}/100, higher than the{" "}
                    {currentScore}/100 currently in use.{" "}
                    {wasEdited
                      ? "That is expected after a manual edit, which is kept as written rather than being judged against the old score. Worth a look if the edit was not deliberate."
                      : "Nobody edited this: a later automated revision round replaced a better version with a worse one. You can go back to the better one."}
                  </p>
                  {betterVersion && isOwner && (
                    <UseVersionButton
                      requestId={requestId}
                      channel={channel}
                      version={betterVersion.version}
                      score={bestForChannel!}
                    />
                  )}
                </div>
              )}

              {post && !evaluationPassed(evalForPost) && (
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
