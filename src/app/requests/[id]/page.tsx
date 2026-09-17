import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import SourceSelection from "./source-selection";
import RetryButton from "./retry-button";
import DeleteButton from "./delete-button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { ScoreBar } from "@/components/ui/score-bar";
import { PipelineProgress } from "@/components/ui/pipeline-progress";
import { friendlyStageMessage, explainNeedsAttention } from "@/lib/friendly-errors";
import SelectAngleButton from "./select-angle-button";
import BackToAngleSelectionButton from "./back-to-angle-selection-button";
import ArticleReview from "./article-review";
import ChannelPostsReview from "./channel-posts-review";
import PublishingQueue from "./publishing-queue";
import WorkingBanner from "./working-banner";

const SOURCE_STATUS_STYLES: Record<string, string> = {
  scraped: "bg-success-soft text-success",
  scrape_failed: "bg-danger-soft text-danger",
  rejected: "bg-black/5 text-muted",
  selected: "bg-accent-soft text-accent",
  pending_selection: "bg-warning-soft text-warning",
};

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: req } = await supabase.from("requests").select("*").eq("id", id).single();
  if (!req) notFound();

  const { data: sources } = await supabase
    .from("sources")
    .select("*")
    .eq("request_id", id)
    .order("created_at");

  const { data: events } = await supabase
    .from("event_log")
    .select("*")
    .eq("request_id", id)
    .order("created_at", { ascending: false });

  const { data: angles } = await supabase
    .from("angles")
    .select("*")
    .eq("request_id", id)
    .order("created_at");

  const { data: sections } = await supabase
    .from("sections")
    .select("*")
    .eq("request_id", id)
    .order("version");

  const { data: evaluations } = await supabase
    .from("evaluation_results")
    .select("*")
    .eq("request_id", id)
    .eq("pass", "pass_1_article")
    .order("content_version");

  const { data: excerpts } = await supabase
    .from("excerpts")
    .select("*")
    .eq("request_id", id);

  const { data: channelPosts } = await supabase
    .from("channel_posts")
    .select("*")
    .eq("request_id", id)
    .order("version");

  const { data: pass2Evaluations } = await supabase
    .from("evaluation_results")
    .select("*")
    .eq("request_id", id)
    .eq("pass", "pass_2_channel")
    .order("content_version");

  const channelPostIds = (channelPosts ?? []).map((p) => p.id);
  const { data: scheduledContent } = channelPostIds.length
    ? await supabase.from("scheduled_content").select("*").in("channel_post_id", channelPostIds)
    : { data: [] };

  const sourceUrlsById = Object.fromEntries((sources ?? []).map((s) => [s.id, s.url]));

  const latestEvent = events?.[0];
  const canRetry = req.status === "researching" && latestEvent?.status === "failed";
  const angleAttemptFailed =
    req.status === "awaiting_angle_selection" && latestEvent?.status === "failed";
  // needs_human_attention is a status, not itself a log line - it doesn't change just
  // because something else gets logged afterward (e.g. Workflow E's edit_triage
  // deliberately never touches requests.status). Using the absolute latest event to
  // explain *why* we're stuck breaks the moment an unrelated success event follows a
  // real failure - caught live: fixing one channel's post via a manual edit logged a
  // clean "re-evaluated: pass" success event while the request was still stuck on a
  // different channel, and that success message rendered as if it were the reason
  // for being stuck. The latest *failed* event is what actually explains the status.
  const latestFailedEvent = events?.find((e) => e.status === "failed");
  const needsAttention = req.status === "needs_human_attention" && latestFailedEvent;
  const attentionExplanation = needsAttention
    ? explainNeedsAttention(latestFailedEvent!.stage, latestFailedEvent!.detail)
    : null;
  // angle_proposal excluded deliberately: a hard block there means Claude returned
  // an empty angles array (see workflow-a's prompt), so there is nothing to fall
  // back to - "back to angle selection" on that stage produces a dead screen with
  // zero angles rather than an actual choice. Only excerpt_selection/evaluation
  // dead ends happen after a real angle already exists to fall back to.
  const canTryDifferentAngle =
    needsAttention && ["excerpt_selection", "evaluation"].includes(latestFailedEvent!.stage);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground"
      >
        ← Back to requests
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {req.raw_idea || req.primary_keyword}
        </h1>
        <StatusBadge status={req.status} />
      </div>

      <Card className="mt-6 p-5">
        <PipelineProgress
          status={req.status}
          failed={canRetry || angleAttemptFailed}
          blockedEventStage={needsAttention ? latestFailedEvent!.stage : undefined}
        />
      </Card>

      <WorkingBanner requestId={id} status={req.status} />

      <Card className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 p-5 text-sm">
        <dt className="text-muted">Path</dt>
        <dd className="text-right">{req.input_path === "raw_idea" ? "Raw idea" : "Source URL"}</dd>
        <dt className="text-muted">Primary keyword</dt>
        <dd className="text-right">{req.primary_keyword}</dd>
        <dt className="text-muted">Channels</dt>
        <dd className="text-right">{req.channels.join(", ")}</dd>
      </Card>

      {canRetry && (
        <Card className="mt-8 border-danger/20 bg-danger-soft p-5">
          <p className="text-sm font-medium text-danger">
            {friendlyStageMessage(latestEvent!.stage)}
          </p>
          <p className="mt-1 text-xs text-danger/80">
            Nothing has progressed since — safe to retry from here. See the technical log below
            for the exact error.
          </p>
          <RetryButton requestId={id} />
        </Card>
      )}

      {angleAttemptFailed && (
        <Card className="mt-8 border-danger/20 bg-danger-soft p-5">
          <p className="text-sm font-medium text-danger">
            {friendlyStageMessage(latestEvent!.stage)}
          </p>
          <p className="mt-1 text-xs text-danger/80">
            Nothing has progressed since — pick the angle below again to retry. See the technical
            log for the exact error.
          </p>
        </Card>
      )}

      {attentionExplanation && (
        <Card className="mt-8 border-danger/20 bg-danger-soft p-5">
          <p className="text-sm font-medium text-danger">{attentionExplanation.why}</p>
          <p className="mt-2 text-sm text-danger/90">{attentionExplanation.action}</p>
          {canTryDifferentAngle && <BackToAngleSelectionButton requestId={id} />}
        </Card>
      )}

      {req.status === "awaiting_source_selection" && (
        <SourceSelection
          requestId={id}
          sources={(sources ?? []).filter((s) => s.status === "pending_selection")}
        />
      )}

      {angles && angles.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted">
            {angles.length > 1 ? "Proposed angles" : "Proposed angle"}
          </h2>
          <div className="mt-2 flex flex-col gap-3">
            {angles.map((a) => (
              <Card key={a.id} className={`p-5 ${a.chosen ? "border-accent" : ""}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium">{a.working_title}</p>
                    <p className="mt-1 text-sm text-muted">{a.thesis}</p>
                  </div>
                  {a.chosen && (
                    <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
                      Selected
                    </span>
                  )}
                </div>

                <div className="mt-4">
                  <ScoreBar label="Audience resonance" score={a.resonance_score} max={15} floor={7} />
                  <p className="mt-1 text-xs text-muted">
                    Floor at 7/15 — below it, generation is hard-blocked; 7-10 proceeds with a
                    soft flag; 11-15 proceeds cleanly.
                  </p>
                </div>

                {Array.isArray(a.section_shape) && a.section_shape.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Section shape
                    </p>
                    <ol className="mt-1.5 flex flex-col gap-1 text-sm text-foreground">
                      {a.section_shape.map((heading: string, i: number) => (
                        <li key={i} className="flex gap-2">
                          <span className="text-muted">{i + 1}.</span>
                          {heading}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {req.status === "awaiting_angle_selection" && (
                  <SelectAngleButton requestId={id} angleId={a.id} />
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      <ArticleReview
        requestId={id}
        requestStatus={req.status}
        regenerationCount={req.regeneration_count ?? 0}
        sections={sections ?? []}
        evaluations={evaluations ?? []}
        excerpts={excerpts ?? []}
        sourceUrlsById={sourceUrlsById}
      />

      <ChannelPostsReview
        requestId={id}
        requestStatus={req.status}
        latestEvent={latestEvent}
        latestFailedEvent={latestFailedEvent}
        channelPosts={channelPosts ?? []}
        evaluations={pass2Evaluations ?? []}
      />

      <PublishingQueue
        requestId={id}
        channelPosts={channelPosts ?? []}
        evaluations={pass2Evaluations ?? []}
        scheduledContent={scheduledContent ?? []}
      />

      {sources && sources.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted">Sources</h2>
          <Card className="mt-2 divide-y divide-border p-1">
            {sources.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="truncate text-sm text-foreground">{s.url}</span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    SOURCE_STATUS_STYLES[s.status] ?? "bg-black/5 text-muted"
                  }`}
                >
                  {s.status.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {events && events.length > 0 && (
        <details className="mt-8" open={events.some((ev) => ev.status === "failed")}>
          <summary className="cursor-pointer text-sm font-semibold text-muted hover:text-foreground">
            Technical log ({events.length} event{events.length === 1 ? "" : "s"})
          </summary>
          <Card className="mt-2 divide-y divide-border p-1">
            {events.map((ev) => (
              <div key={ev.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span
                  className={`text-sm ${ev.status === "failed" ? "text-danger" : "text-foreground"}`}
                >
                  {ev.stage}: {ev.detail}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {new Date(ev.created_at).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </Card>
        </details>
      )}

      <section className="mt-10 border-t border-border pt-6">
        <DeleteButton requestId={id} title={req.raw_idea || req.primary_keyword} />
      </section>
    </main>
  );
}
