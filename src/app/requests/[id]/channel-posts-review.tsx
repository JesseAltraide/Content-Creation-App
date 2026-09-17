import { Card } from "@/components/ui/card";
import { ScoreBar } from "@/components/ui/score-bar";
import { friendlyStageMessage } from "@/lib/friendly-errors";
import RetryAdaptationButton from "./retry-adaptation-button";
import RejectButton from "./reject-button";

// Pass 2's own rubric (week4-full-flow.md) - different criteria and floors from
// Pass 1's article rubric (Topic Relevance/SEO Fit/Completeness don't apply
// post-adaptation).
const PASS2_CRITERION_FLOORS: Record<string, number> = {
  "factual consistency": 15,
  tone: 10,
  "channel fit": 10,
  "audience fit": 6,
  clarity: 6,
};

function floorFor(name: string): number | undefined {
  return PASS2_CRITERION_FLOORS[name.trim().toLowerCase()];
}

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

// x posts and the newsletter's subject+body pair are stored as JSON-stringified
// structures in the same plain `body` column (see Workflow D's Insert Channel
// Posts notes) - parsed back out here, tolerant of a parse failure so a malformed
// or legacy row still renders as something rather than crashing the page.
function parseXPosts(body: string): string[] {
  try {
    const parsed = JSON.parse(body);
    return Array.isArray(parsed) ? parsed : [body];
  } catch {
    return [body];
  }
}

function parseNewsletter(body: string): { subject_line: string; body_markdown: string } {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === "object" && "body_markdown" in parsed) return parsed;
  } catch {
    // fall through
  }
  return { subject_line: "", body_markdown: body };
}

function LinkedInPreview({ body }: { body: string }) {
  return (
    <div className="whitespace-pre-wrap rounded-lg border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
      {body}
    </div>
  );
}

function XPreview({ body }: { body: string }) {
  const posts = parseXPosts(body);
  return (
    <div className="flex flex-col gap-2">
      {posts.map((post, i) => (
        <div key={i} className="rounded-lg border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
          {posts.length > 1 && (
            <p className="mb-1.5 text-xs font-semibold text-muted">
              Post {i + 1} of {posts.length}
            </p>
          )}
          <p className="whitespace-pre-wrap">{post}</p>
          <p className="mt-2 text-xs text-muted">{post.length}/280 characters</p>
        </div>
      ))}
    </div>
  );
}

function NewsletterPreview({ body }: { body: string }) {
  const { subject_line, body_markdown } = parseNewsletter(body);
  return (
    <div className="rounded-lg border border-border bg-background p-4 text-sm leading-relaxed text-foreground">
      <p className="mb-2 border-b border-border pb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Subject </span>
        {subject_line}
      </p>
      <p className="whitespace-pre-wrap">{body_markdown}</p>
    </div>
  );
}

const CHANNEL_LABELS: Record<string, string> = {
  linkedin: "LinkedIn",
  x: "X",
  newsletter: "Newsletter",
};

function ChannelPreview({ channel, body }: { channel: string; body: string }) {
  if (channel === "x") return <XPreview body={body} />;
  if (channel === "newsletter") return <NewsletterPreview body={body} />;
  return <LinkedInPreview body={body} />;
}

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
        {latestPosts.map((post) => {
          const ev = evalByChannel.get(post.channel);
          return (
            <Card key={post.id} className="p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{CHANNEL_LABELS[post.channel] ?? post.channel}</h3>
                {ev && <span className="text-lg font-bold">{ev.overall_score}/100</span>}
              </div>

              <div className="mt-3">
                <ChannelPreview channel={post.channel} body={post.body} />
              </div>

              {ev && (
                <div className="mt-4 border-t border-border pt-4">
                  {ev.hard_block_triggered && (
                    <p className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                      Hard block: {ev.hard_block_reason ?? "a critical criterion fell below its floor."}
                    </p>
                  )}
                  <div className="flex flex-col gap-3">
                    {ev.criteria.map((c) => (
                      <div key={c.name}>
                        <ScoreBar label={c.name} score={c.score} max={c.max} floor={floorFor(c.name)} />
                        {c.notes && <p className="mt-1 text-xs text-muted">{c.notes}</p>}
                      </div>
                    ))}
                  </div>
                  {ev.weakest_criteria_suggestions && ev.weakest_criteria_suggestions.length > 0 && (
                    <div className="mt-3 rounded-lg bg-warning-soft p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-warning">
                        Improvement suggestions
                      </p>
                      <ul className="mt-1.5 flex flex-col gap-1 text-sm text-warning">
                        {ev.weakest_criteria_suggestions.map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {stuckHere && (
        <Card className="mt-4 p-5">
          <RejectButton requestId={requestId} />
        </Card>
      )}
    </section>
  );
}
