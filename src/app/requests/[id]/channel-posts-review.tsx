import { Card } from "@/components/ui/card";
import { friendlyStageMessage } from "@/lib/friendly-errors";
import { evaluationPassed, PASS_MARK, CHANNEL_LABELS } from "@/lib/channel-post-format";
import RetryAdaptationButton from "./retry-adaptation-button";
import RejectButton from "./reject-button";
import ChannelPostCard from "./channel-post-card";
import type { StoredImageSuggestion } from "./image-suggestion";
import MarkReadyButton from "./mark-ready-button";
import type { ChannelVersion } from "./channel-version-picker";

type ChannelPost = {
  id: string;
  channel: "linkedin" | "x" | "newsletter";
  version: number;
  body: string;
  tone_variant: string;
  chosen: boolean;
  /** Written per version, so a revision does not inherit an opinion about older text. */
  image_suggestion?: StoredImageSuggestion;
};

type EvalResult = {
  id: string;
  channel: string | null;
  content_version: number;
  overall_score: number;
  status: string;
  criteria: { name: string; score: number; max: number; notes?: string }[];
  weakest_criteria_suggestions: string[] | null;
  hard_block_triggered: boolean;
  hard_block_reason: string | null;
};

export default function ChannelPostsReview({
  requestId,
  requestStatus,
  latestEvent,
  latestFailedEvent,
  channelPosts,
  evaluations,
  channelOnly,
  isOwner,
  pendingSends,
}: {
  requestId: string;
  requestStatus: string;
  latestEvent: { stage: string; status: string; detail: string | null } | undefined;
  latestFailedEvent: { stage: string; status: string; detail: string | null } | undefined;
  channelPosts: ChannelPost[];
  evaluations: EvalResult[];
  /**
   * With a channel: render just that channel's card, for its own tab.
   * Without: render only the cross-channel banners and actions, which stay pinned
   * above the tab strip so a failure can never hide behind an unselected tab.
   */
  channelOnly?: "linkedin" | "x" | "newsletter";
  isOwner: boolean;
  /** Channel to the time of a send still waiting to go out, for the version picker. */
  pendingSends: Record<string, string>;
}) {
  const isAdapting = requestStatus === "adapting";
  // A failed adaptation attempt reverts to 'approved' (see approve/route.ts and
  // Workflow D's setup-failure handler) - worth showing the retry banner even when
  // it crashed before generating anything, so there's no content to preview yet.
  const failedSetup = requestStatus === "approved" && latestEvent?.status === "failed";
  if (channelPosts.length === 0 && !isAdapting && !failedSetup) return null;

  // Only the chosen variant per channel, at its latest version.
  // Arrives ordered by created_at, so the last chosen row per channel is the newest
  // one. Comparing version numbers here would tie between two different v2 posts from
  // two different adaptation runs and keep whichever happened to be read first.
  const latestByChannel = new Map<string, ChannelPost>();
  for (const post of channelPosts) {
    if (!post.chosen) continue;
    latestByChannel.set(post.channel, post);
  }
  const latestPosts = Array.from(latestByChannel.values());

  const evalByChannel = new Map<string, EvalResult>();
  for (const ev of evaluations) {
    if (!ev.channel) continue;
    const post = latestByChannel.get(ev.channel);
    // Last write wins for the same reason as the publishing queue: duplicate version
    // numbers across adaptation runs mean the first match can be an older score.
    if (post && ev.content_version === post.version) evalByChannel.set(ev.channel, ev);
  }

  // The generic needs_human_attention banner (with the why/action explanation) is
  // already rendered by page.tsx for every stage, including this one - only the
  // Reject action itself lives here, scoped to the channel-review section.
  // Uses the latest FAILED event, not the absolute latest - needs_human_attention is
  // a status, not a log line, and doesn't change just because something else (e.g.
  // a successful edit_triage on a different channel) gets logged afterward. See
  // page.tsx's latestFailedEvent comment for the live bug this fixes.
  const stuckHere = requestStatus === "needs_human_attention" && latestFailedEvent?.stage === "pass2_evaluation";
  // Workflow E can fix the one channel that was still failing via a direct edit
  // without ever touching requests.status (it's a per-post action, independent of
  // the request's pipeline stage) - if every channel now individually passes, offer
  // the explicit re-check rather than leaving Reject as the only visible option.
  const allNowPass =
    stuckHere && latestPosts.length > 0 && latestPosts.every((p) => evaluationPassed(evalByChannel.get(p.channel)));

  // Whether every channel currently in use actually passes, computed from the posts
  // and their scores rather than read off requests.status. The status records what
  // was true at the moment it was set and nothing re-derives it: an edit or a
  // revision round afterwards can drop a channel below the mark while the row still
  // says ready_to_schedule. Caught live on a request sitting at ready_to_schedule
  // with LinkedIn on 77 and X on 64, under a green banner saying all channels
  // passed. Same failure as Error #46: trusting a stored label over the numbers.
  const failingChannels = latestPosts
    .filter((p) => !evaluationPassed(evalByChannel.get(p.channel)))
    .map((p) => ({
      channel: p.channel,
      score: evalByChannel.get(p.channel)?.overall_score ?? null,
    }));

  // Every version this channel has, newest last, each with the score it was given.
  // Scores are matched on the version number within this channel; a request can hold
  // two different v1 posts when adaptation is re-run, so the LAST evaluation for a
  // version wins, the same rule the queue and the card already use.
  const versionsFor = (channel: string): ChannelVersion[] =>
    channelPosts
      .filter((p) => p.channel === channel)
      .map((p) => {
        const ev = [...evaluations]
          .reverse()
          .find((e) => e.channel === channel && e.content_version === p.version);
        return {
          // The row id, because version numbers are NOT unique per channel: re-running
          // adaptation restarts them at 1, so a request holds two v1 posts and React
          // saw two children with the same key. Switching version had the same
          // ambiguity underneath it, which matters more than the warning did.
          id: p.id,
          version: p.version,
          chosen: p.chosen,
          createdAt: (p as unknown as { created_at: string }).created_at,
          score: typeof ev?.overall_score === "number" ? ev.overall_score : null,
        };
      });

  if (channelOnly) {
    const post = latestByChannel.get(channelOnly);
    if (!post) return null;
    return (
      <ChannelPostCard
        requestId={requestId}
        channel={post.channel}
        body={post.body}
        evaluation={evalByChannel.get(post.channel)}
        isOwner={isOwner}
        imageSuggestion={post.image_suggestion ?? null}
        versions={versionsFor(post.channel)}
        pendingSendAt={pendingSends[post.channel] ?? null}
      />
    );
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-muted">Channel adaptation</h2>

      {isAdapting && (
        <Card className="mt-2 p-5">
          <p className="text-sm text-muted">
            Adaptation and Pass 2 run on n8n, not in this tab, so it is safe to leave this
            page or close it. The status updates itself when the run finishes.
          </p>
          {/* This used to explain away a "responded 524" log entry, which was our own
              outbound connection giving up at 100 seconds while n8n carried on working.
              The webhooks now acknowledge immediately (Decision #101), so a new run
              should not produce one at all. Older requests still carry those entries,
              and page.tsx still treats them as non-fatal for exactly that reason. */}
        </Card>
      )}

      {failedSetup && (
        <Card className="mt-2 border-danger/20 bg-danger-soft p-5">
          <p className="text-sm font-medium text-danger">{friendlyStageMessage(latestEvent!.stage)}</p>
          <p className="mt-1 text-xs text-danger/80">
            The article itself is untouched and still approved, so it&apos;s safe to retry adaptation.
          </p>
          <RetryAdaptationButton requestId={requestId} />
        </Card>
      )}

      {requestStatus === "ready_to_schedule" && failingChannels.length === 0 && (
        <Card className="mt-2 border-success/20 bg-success-soft p-5">
          <p className="text-sm font-medium text-success">
            All channels passed Pass 2 evaluation. Ready to schedule.
          </p>
        </Card>
      )}

      {requestStatus === "ready_to_schedule" && failingChannels.length > 0 && (
        <Card className="mt-2 border-warning/30 bg-warning-soft p-5">
          <p className="text-sm font-medium text-warning">
            This request was marked ready to schedule, but{" "}
            {failingChannels.length === 1 ? "one channel is" : `${failingChannels.length} channels are`}{" "}
            below the {PASS_MARK} needed now:{" "}
            {failingChannels
              .map((c) => `${CHANNEL_LABELS[c.channel] ?? c.channel} ${c.score !== null ? `${c.score}/100` : "unscored"}`)
              .join(", ")}
            .
          </p>
          <p className="mt-1 text-xs text-warning/90">
            The status records what was true when it was set, and an edit or a revision
            round since then has changed the score. Those channels cannot be scheduled
            until they clear the mark. If an earlier version scored better, the version
            list on each channel will let you go back to it.
          </p>
        </Card>
      )}

      {stuckHere && (
        <Card className="mt-4 p-5">
          <div className="flex flex-col gap-3">
            {allNowPass && <MarkReadyButton requestId={requestId} />}
            <RejectButton requestId={requestId} />
          </div>
        </Card>
      )}
    </section>
  );
}
