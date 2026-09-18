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
import { REGENERATION_CAP } from "@/lib/regeneration";
import BackToAngleSelectionButton from "./back-to-angle-selection-button";
import ResumeSourcesButton from "./resume-sources-button";
import ArticleReview from "./article-review";
import ChannelPostsReview from "./channel-posts-review";
import PublishingQueue from "./publishing-queue";
import WorkingBanner from "./working-banner";
import RequestTabs from "./request-tabs";
import CopyLinkButton from "@/components/copy-link-button";
import ReviewComments from "./review-comments";
import { getRequestAccess, REVIEWABLE_STATUSES } from "@/lib/request-access";
import { CHANNEL_LABELS } from "@/lib/channel-post-format";

const CHANNEL_TABS = [
  { key: "linkedin" as const, label: CHANNEL_LABELS.linkedin },
  { key: "x" as const, label: CHANNEL_LABELS.x },
  { key: "newsletter" as const, label: CHANNEL_LABELS.newsletter },
];

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

  // notFound() rather than a "not yours" message on purpose: confirming a request
  // exists but belongs to someone else leaks that it exists at all.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const access = await getRequestAccess(id, user!.id);
  if (!access.canView) notFound();

  // Comments only exist once a request is readable by the team, so they are
  // fetched with the same gate rather than separately.
  const { data: comments } = await supabase
    .from("request_comments")
    .select("id, user_id, author_email, channel, body, created_at")
    .eq("request_id", id)
    .order("created_at", { ascending: true });

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

// Ordered by created_at, not version. A re-picked angle starts a fresh generation in
// Workflow B, which numbers its first section v1 regardless of what already exists, so
// a newer draft can carry a LOWER version than an older one. Caught live: a re-pick
// wrote a v1 that scored 85 while the page kept showing the v3 from an hour earlier at
// 80, and the human reasonably concluded the regeneration had done nothing.
  const { data: sections } = await supabase
    .from("sections")
    .select("*")
    .eq("request_id", id)
    .order("created_at");

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
  // Only needed for the newsletter email preview, and only a count, so this stays a
  // head-only query rather than pulling every subscriber row into the page.
  const { count: subscriberCount } = await supabase
    .from("newsletter_subscribers")
    .select("id", { count: "exact", head: true })
    .is("unsubscribed_at", null);

  const { data: scheduledContent } = channelPostIds.length
    ? await supabase.from("scheduled_content").select("*").in("channel_post_id", channelPostIds)
    : { data: [] };

  // Tone ONLY, deliberately, even though audience changes are also announced.
  // The two behave differently: tone samples are workspace-level and fetched fresh
  // at generation time, so a queued post really can have been written against a
  // voice that no longer exists. A request's audience is pinned on the row
  // (resolved_audience_profile_id) and cannot change underneath it: profiles can
  // only be created or deleted, never edited, and one that any request references
  // cannot be deleted at all because the foreign key refuses. So flagging a queued
  // post because some OTHER profile was added would be a false alarm. If profile
  // editing is ever added, that stops being true and audience belongs here too.
  const { data: brandChanges } = await supabase
    .from("settings_announcements")
    .select("created_at")
    .in("kind", ["tone"])
    .order("created_at", { ascending: false })
    .limit(1);
  const brandChangedAt = brandChanges?.[0]?.created_at ?? null;

  // The audience this request was written and graded against, shown so the human
  // can judge it against current intent. More useful than a "something changed"
  // alert, because this value is pinned and cannot drift.
  //
  // audience_profile_id is what the human picked at intake and is null when they
  // left it on auto-match, so the two columns together say WHO chose. With several
  // profiles on file that matters: an auto-matched audience is Claude's judgement
  // call, and the human should be able to see it was made and disagree with it.
  const audienceWasAutoMatched = !req.audience_profile_id && !!req.resolved_audience_profile_id;
  const { data: resolvedAudience } = req.resolved_audience_profile_id
    ? await supabase
        .from("audience_profiles")
        .select("name")
        .eq("id", req.resolved_audience_profile_id)
        .maybeSingle()
    : { data: null };

  // Commenting is only invited once the work is actually open to the team. Before
  // that nobody else can even see the request, so offering a box captioned
  // "suggestions from the team" promises something impossible.
  // Every owner-only control in the subtree keys off one prop, so closing a rejected
  // request is one substitution rather than a status check in each component. Delete
  // deliberately keeps using access.isOwner: throwing away finished work is
  // housekeeping, and a rejected request would otherwise be undeletable forever.
  const canAct = access.isOwner && !access.isClosed;

  const openForReview = REVIEWABLE_STATUSES.includes(req.status);

  const sourceUrlsById = Object.fromEntries((sources ?? []).map((s) => [s.id, s.url]));

  const latestEvent = events?.[0];
  // There is no liveness signal from n8n - a trigger status only ever gets cleared
  // by n8n reporting back, so if n8n is offline (or the run died without logging),
  // the request sits in "working" state forever and the UI keeps reassuring the
  // human. Silence past this threshold is treated as "probably not running", which
  // is the honest reading: every stage that IS alive writes events well inside it.
  const SILENCE_THRESHOLD_MS = 5 * 60 * 1000;
  const lastEventAt = latestEvent?.created_at ? new Date(latestEvent.created_at).getTime() : null;
  const silentFor = lastEventAt ? Date.now() - lastEventAt : null;
  const goneQuiet = silentFor !== null && silentFor > SILENCE_THRESHOLD_MS;

  // Retry is offered on a logged failure, and now also when a research run has
  // simply gone silent - otherwise a request whose n8n run died without logging
  // anything has no recovery path at all (the failure banner never appears).
  const canRetry =
    req.status === "researching" && (latestEvent?.status === "failed" || goneQuiet);
  const angleAttemptFailed =
    req.status === "awaiting_angle_selection" && latestEvent?.status === "failed";
  // The search plainly worked (candidate sources are sitting in the table) but the
  // request never left 'researching', because A1 marks the status in a step after the
  // insert that has no failure handling of its own. Offering "retry the search" here
  // would redo work that already succeeded; the honest action is to go where the data
  // already is.
  const strandedSources =
    req.status === "researching"
      ? (sources ?? []).filter((s) => s.status === "pending_selection").length
      : 0;
  // needs_human_attention is a status, not itself a log line - it doesn't change just
  // because something else gets logged afterward (e.g. Workflow E's edit_triage
  // deliberately never touches requests.status). Using the absolute latest event to
  // explain *why* we're stuck breaks the moment an unrelated success event follows a
  // real failure - caught live: fixing one channel's post via a manual edit logged a
  // clean "re-evaluated: pass" success event while the request was still stuck on a
  // different channel, and that success message rendered as if it were the reason
  // for being stuck. The latest *failed* event is what actually explains the status.
  const latestFailedEvent = events?.find((e) => e.status === "failed");
  // Whether background work is dead rather than slow. A trigger-status alone can't
  // tell us (nothing resets 'researching'/'generating'/'adapting' when a run dies),
  // so the signal is: the most recent event is a failure. The exception is a timeout
  // between us and n8n, which says nothing about whether the run is alive: the
  // connection gave up, the workflow carries on. Matched on the wording pingWebhook
  // writes for exactly that case rather than on "524" alone, which missed the other
  // gateway codes and would have shown a live run as dead.
  const isTimeoutEvent = /timed out|\b(408|502|503|504|52[234])\b/.test(latestEvent?.detail ?? "");
  const latestIsDeadFailure = latestEvent?.status === "failed" && !isTimeoutEvent;
  const needsAttention = req.status === "needs_human_attention" && latestFailedEvent;
  const attentionExplanation = needsAttention
    ? explainNeedsAttention(latestFailedEvent!.stage, latestFailedEvent!.detail)
    : null;
  // angle_proposal excluded deliberately: a hard block there means Claude returned
  // an empty angles array (see workflow-a's prompt), so there is nothing to fall
  // back to - "back to angle selection" on that stage produces a dead screen with
  // zero angles rather than an actual choice. Only excerpt_selection/evaluation
  // dead ends happen after a real angle already exists to fall back to.
  // Angles that have never been generated from. Shown in the offer because "try a
  // different angle" is only worth taking if a different one exists.
  const unusedAngles = (angles ?? []).filter((a) => (a.generation_count ?? 0) === 0).length;
  const canTryDifferentAngle =
    needsAttention && ["excerpt_selection", "evaluation"].includes(latestFailedEvent!.stage);

  // A channel only earns a tab once it actually has a chosen post to show.
  const channelTabKeys = new Set(
    (channelPosts ?? []).filter((p) => p.chosen).map((p) => p.channel as string)
  );
  const showSchedule = channelTabKeys.size > 0 || (scheduledContent ?? []).length > 0;

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

      {access.isClosed && (
        <Card className="mt-4 p-4">
          <p className="text-sm font-medium">This request was rejected and is closed.</p>
          <p className="mt-0.5 text-xs text-muted">
            Everything below stays readable as a record of what happened, including the scores
            and the technical log, but nothing about it can change now: no edits, no revisions,
            no scheduling, and it can&apos;t be reopened. Any post still waiting to publish was
            cancelled. Start a new request to take the idea further.
          </p>
        </Card>
      )}

      {!access.isOwner && (
        <Card className="mt-4 border-accent/20 bg-accent-soft p-4">
          <p className="text-sm font-medium text-accent">
            You&apos;re reviewing someone else&apos;s request.
          </p>
          <p className="mt-1 text-xs text-accent/80">
            {req.status === "pending_approval"
              ? "It's waiting on the author's approval, so feedback now can still change the article itself. "
              : "It's ready to schedule, so this is the last look before it goes out. "}
            Leave comments at the bottom. Editing, regenerating and scheduling stay with the author.
          </p>
        </Card>
      )}

      <Card className="mt-6 p-5">
        <PipelineProgress
          status={req.status}
          failed={canRetry || angleAttemptFailed}
          blockedEventStage={needsAttention ? latestFailedEvent!.stage : undefined}
        />
      </Card>

      <WorkingBanner
        requestId={id}
        status={req.status}
        stalled={latestIsDeadFailure}
        quiet={goneQuiet}
        canReset={canAct}
      />

      <Card className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 p-5 text-sm">
        <dt className="text-muted">Path</dt>
        <dd className="text-right">{req.input_path === "raw_idea" ? "Raw idea" : "Source URL"}</dd>
        <dt className="text-muted">Primary keyword</dt>
        <dd className="text-right">{req.primary_keyword}</dd>
        <dt className="text-muted">Audience</dt>
        <dd className="text-right">
          {resolvedAudience?.name ?? "Not resolved yet"}
          {resolvedAudience && (
            <span className="ml-1.5 text-xs text-muted">
              {audienceWasAutoMatched ? "(best match)" : "(you chose this)"}
            </span>
          )}
        </dd>
        <dt className="text-muted">Channels</dt>
        <dd className="text-right">{req.channels.join(", ")}</dd>
      </Card>

      {/* Two distinct reasons to offer a retry, and they shouldn't read the same:
          a logged failure has an actual error to point at, while a run that just
          went silent has nothing in the log to explain it - saying "see the
          technical log for the exact error" there would send the human looking
          for something that was never written. */}
      {strandedSources > 0 && (
        <Card className="mt-8 border-warning/30 bg-warning-soft p-5">
          <p className="text-sm font-medium text-warning">
            The search found {strandedSources} source{strandedSources === 1 ? "" : "s"}, but the run
            stopped before handing them over.
          </p>
          <p className="mt-1 text-xs text-warning/90">
            They were saved and are ready to pick from, so nothing needs researching again. This is
            a known gap in the research workflow rather than a problem with your idea.
          </p>
          {access.isOwner && (
            <ResumeSourcesButton requestId={id} sourceCount={strandedSources} />
          )}
        </Card>
      )}

      {!strandedSources && canRetry && latestEvent?.status === "failed" && (
        <Card className="mt-8 border-danger/20 bg-danger-soft p-5">
          <p className="text-sm font-medium text-danger">
            {friendlyStageMessage(latestEvent!.stage)}
          </p>
          <p className="mt-1 text-xs text-danger/80">
            Nothing has progressed since, so it&apos;s safe to retry from here. See the technical log below
            for the exact error.
          </p>
          <RetryButton requestId={id} />
        </Card>
      )}

      {!strandedSources && canRetry && latestEvent?.status !== "failed" && (
        <Card className="mt-8 p-5">
          <p className="text-sm text-foreground">
            Nothing has progressed since the last step, and no error was ever logged, so there&apos;s
            nothing to read in the technical log. Retrying re-runs this stage from where it left off.
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
            Nothing has progressed since. Pick the angle below again to retry. See the technical
            log for the exact error.
          </p>
        </Card>
      )}

      {attentionExplanation && (
        <Card className="mt-8 border-danger/20 bg-danger-soft p-5">
          <p className="text-sm font-medium text-danger">{attentionExplanation.why}</p>
          <p className="mt-2 text-sm text-danger/90">{attentionExplanation.action}</p>
          {canTryDifferentAngle && (
            <BackToAngleSelectionButton requestId={id} otherAngles={unusedAngles} />
          )}
        </Card>
      )}

      {req.status === "awaiting_source_selection" && (
        <SourceSelection
          requestId={id}
          sources={(sources ?? []).filter((s) => s.status === "pending_selection")}
        />
      )}

      {/* Cross-channel banners and actions stay OUTSIDE the tabs on purpose: a
          failure or a "mark ready" action must never be hidden behind a tab the
          human has not selected. */}
      <ChannelPostsReview
        requestId={id}
        requestStatus={req.status}
        latestEvent={latestEvent}
        latestFailedEvent={latestFailedEvent}
        channelPosts={channelPosts ?? []}
        evaluations={pass2Evaluations ?? []}
        isOwner={canAct}
      />

      <RequestTabs
        tabs={[
          ...(angles && angles.length > 0
            ? [{ key: "angle" as const, label: angles.length > 1 ? "Angles" : "Angle" }]
            : []),
          ...((sections ?? []).length > 0 ? [{ key: "draft" as const, label: "Draft" }] : []),
          ...CHANNEL_TABS.filter((c) => channelTabKeys.has(c.key)),
          ...(showSchedule ? [{ key: "schedule" as const, label: "Schedule" }] : []),
          ...((sources ?? []).length > 0 ? [{ key: "sources" as const, label: "Sources" }] : []),
        ]}
        panels={{
          angle: (
            <>
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
                      Floor at 7/15. Below it, generation is hard-blocked; 7-10 proceeds with a
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
                    <SelectAngleButton
                      requestId={id}
                      angleId={a.id}
                      alreadyGenerated={(a.generation_count ?? 0) > 0}
                      attemptsLeft={REGENERATION_CAP - (req.regeneration_count ?? 0)}
                    />
                  )}
                </Card>
              ))}
            </div>
          </section>
        )}

            </>
          ),
          draft: (
          <ArticleReview
            requestId={id}
            requestStatus={req.status}
            isOwner={canAct}
            regenerationCount={req.regeneration_count ?? 0}
            unusedAngles={unusedAngles}
            sections={sections ?? []}
            evaluations={evaluations ?? []}
            excerpts={excerpts ?? []}
            sourceUrlsById={sourceUrlsById}
          />

          ),
          ...Object.fromEntries(
            (["linkedin", "x", "newsletter"] as const)
              .filter((c) => channelTabKeys.has(c))
              .map((c) => [
                c,
                <ChannelPostsReview
                  key={c}
                  requestId={id}
                  requestStatus={req.status}
                  latestEvent={latestEvent}
                  latestFailedEvent={latestFailedEvent}
                  channelPosts={channelPosts ?? []}
                  evaluations={pass2Evaluations ?? []}
                  isOwner={canAct}
                  channelOnly={c}
                />,
              ])
          ),
          schedule: (

          <PublishingQueue
            requestId={id}
            channelPosts={channelPosts ?? []}
            evaluations={pass2Evaluations ?? []}
            scheduledContent={scheduledContent ?? []}
            subscriberCount={subscriberCount ?? 0}
            brandChangedAt={brandChangedAt}
            isOwner={canAct}
          />
          ),
          sources: (
            <>
        {sources && sources.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-semibold text-muted">Sources</h2>
            <Card className="mt-2 divide-y divide-border p-1">
              {sources.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 truncate text-sm text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
                  title={s.url}
                >
                  {s.url}
                </a>
                <CopyLinkButton url={s.url} />
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
            </>
          ),
        }}
      />


      {(openForReview || (comments ?? []).length > 0) && (
        <ReviewComments
          requestId={id}
          comments={comments ?? []}
          currentUserId={user!.id}
          isOwner={canAct}
          openForReview={openForReview}
        />
      )}

      {/* Never auto-opens, not even on failure: the banners above already say what
          went wrong in plain language, and springing a wall of stage names on
          someone is noise. Anyone who wants the detail can open it. */}
      {events && events.length > 0 && (
        <details className="mt-8">
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
        {access.isOwner ? (
          <DeleteButton requestId={id} title={req.raw_idea || req.primary_keyword} />
        ) : (
          <p className="text-xs text-muted">
            This is someone else&apos;s request. You can read it and comment, nothing more.
          </p>
        )}
      </section>
    </main>
  );
}
