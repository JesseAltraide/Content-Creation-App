import { Card } from "@/components/ui/card";
import { friendlyStageMessage } from "@/lib/friendly-errors";
import RetryAdaptationButton from "./retry-adaptation-button";
import RejectButton from "./reject-button";
import ChannelPostCard from "./channel-post-card";

type ChannelPost = {
  id: string;
  channel: "linkedin" | "x" | "newsletter";
  version: number;
  body: string;
  tone_variant: string;
  chosen: boolean;
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
  channelPosts,
  evaluations,
}: {
  requestId: string;
  requestStatus: string;
  latestEvent: { stage: string; status: string; detail: string | null } | undefined;
  channelPosts: ChannelPost[];
  evaluations: EvalResult[];
}) {
  const isAdapting = requestStatus === "adapting";
  // A failed adaptation attempt reverts to 'approved' (see approve/route.ts and
  // Workflow D's setup-failure handler) - worth showing the retry banner even when
  // it crashed before generating anything, so there's no content to preview yet.
  const failedSetup = requestStatus === "approved" && latestEvent?.status === "failed";
  if (channelPosts.length === 0 && !isAdapting && !failedSetup) return null;

  // Only the chosen variant per channel, at its latest version - a channel could in
  // principle have more than one tone_variant row once the alternate-tone action
  // exists, but that's not built yet (Decision #66/#78), so "chosen" is always the
  // only row per channel today.
  const latestByChannel = new Map<string, ChannelPost>();
  for (const post of channelPosts) {
    if (!post.chosen) continue;
    const existing = latestByChannel.get(post.channel);
    if (!existing || post.version > existing.version) latestByChannel.set(post.channel, post);
  }
  const latestPosts = Array.from(latestByChannel.values());

  const evalByChannel = new Map<string, EvalResult>();
  for (const ev of evaluations) {
    if (!ev.channel) continue;
    const post = latestByChannel.get(ev.channel);
    if (post && ev.content_version === post.version) evalByChannel.set(ev.channel, ev);
  }

  // The generic needs_human_attention banner (with the why/action explanation) is
  // already rendered by page.tsx for every stage, including this one - only the
  // Reject action itself lives here, scoped to the channel-review section.
  const stuckHere = requestStatus === "needs_human_attention" && latestEvent?.stage === "pass2_evaluation";

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-muted">Channel adaptation</h2>

      {isAdapting && (
        <Card className="mt-2 p-5">
          <p className="text-sm text-foreground">
            Adapting to channels and running Pass 2 evaluation — this can take a couple of
            minutes across revision rounds. Refresh to check progress.
          </p>
        </Card>
      )}

      {failedSetup && (
        <Card className="mt-2 border-danger/20 bg-danger-soft p-5">
          <p className="text-sm font-medium text-danger">{friendlyStageMessage(latestEvent!.stage)}</p>
          <p className="mt-1 text-xs text-danger/80">
            The article itself is untouched and still approved — safe to retry adaptation.
          </p>
          <RetryAdaptationButton requestId={requestId} />
        </Card>
      )}

      {requestStatus === "ready_to_schedule" && (
        <Card className="mt-2 border-success/20 bg-success-soft p-5">
          <p className="text-sm font-medium text-success">
            All channels passed Pass 2 evaluation — ready to schedule.
          </p>
        </Card>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {latestPosts.map((post) => (
          <ChannelPostCard
            key={post.id}
            requestId={requestId}
            channel={post.channel}
            body={post.body}
            evaluation={evalByChannel.get(post.channel)}
          />
        ))}
      </div>

      {stuckHere && (
        <Card className="mt-4 p-5">
          <RejectButton requestId={requestId} />
        </Card>
      )}
    </section>
  );
}
