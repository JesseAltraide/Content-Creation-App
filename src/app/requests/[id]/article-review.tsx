import ReactMarkdown from "react-markdown";
import { asList } from "@/lib/eval-shape";
import { extractCitations } from "@/lib/citations";
import { Card } from "@/components/ui/card";
import { ScoreBar } from "@/components/ui/score-bar";
import ReviewActions from "./review-actions";
import BackToAngleSelectionButton from "./back-to-angle-selection-button";
import { pickDraft, scoreForDraft } from "@/lib/pick-draft";
import DraftVersionPicker from "./draft-version-picker";

const CRITERION_FLOORS: Record<string, number> = {
  "topic relevance": 15,
  "source grounding": 15,
  "factual consistency": 15,
  "audience fit": 6,
  "seo fit": 4,
  clarity: 4,
  completeness: 2,
};

function floorFor(name: string): number | undefined {
  return CRITERION_FLOORS[name.trim().toLowerCase()];
}

type Section = {
  id: string;
  created_at: string;
  version: number;
  /** Optional until migration 016 is applied; the score decides in its absence. */
  chosen?: boolean | null;
  title: string | null;
  body_markdown: string | null;
  generation_status: string;
};

type EvalResult = {
  id: string;
  /** The exact draft this scored. content_version is ambiguous once a re-pick reuses a number. */
  section_id: string | null;
  content_version: number;
  overall_score: number;
  status: string;
  criteria: { name: string; score: number; max: number; notes?: string }[];
  weakest_criteria_suggestions: string[] | null;
  hard_block_triggered: boolean;
  hard_block_reason: string | null;
};

type Excerpt = { id: string; text: string; reason: string; source_id: string };

export default function ArticleReview({
  requestId,
  requestStatus,
  isOwner,
  regenerationCount,
  unusedAngles,
  sections,
  evaluations,
  excerpts,
  sourceUrlsById,
}: {
  requestId: string;
  requestStatus: string;
  /** Reviewers read a colleague's draft; every action stays with the author. */
  isOwner: boolean;
  regenerationCount: number;
  /** Proposed angles never generated from, so "try a different one" can be honest. */
  unusedAngles: number;
  sections: Section[];
  evaluations: EvalResult[];
  excerpts: Excerpt[];
  sourceUrlsById: Record<string, string>;
}) {
  if (sections.length === 0) return null;

  // The best draft, not the newest. A regeneration that scored worse used to become
  // the article silently while the better draft sat in the table unreachable, which is
  // the same complaint the channel version picker was built for.
  const latest = pickDraft(sections, evaluations) ?? sections[sections.length - 1];
  const draftVersions = [...sections]
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((sec) => ({
      id: sec.id,
      version: sec.version,
      score: scoreForDraft(sec, evaluations),
      chosen: sec.id === latest.id,
    }));
  // The generation prompt asks for "proper H1/H2 heading hierarchy", so body_markdown
  // opens with an H1 of the article's own title, and the title is already rendered
  // above it from section.title. Two identical headings, one on top of the other.
  // Stripped at render rather than in the prompt so existing drafts are fixed too,
  // and only when it really is a leading H1 (never touches body content).
  const stripped = (latest.body_markdown ?? "").replace(/^\s*#\s+[^\n]*\n+/, "");
  // Display only: the stored text keeps its full [Source: url] trail, which is what the
  // evaluator scores and what an edit is re-checked against. The reader gets numbered
  // markers and one reference list, because the same 90-character URL four times in a
  // paragraph is noise rather than provenance.
  const { body, citations } = extractCitations(stripped);
  // Matched on section_id, not content_version. Two sections can share a version
  // number once a re-picked angle restarts numbering at 1, and matching on the number
  // then shows one draft's text beside another draft's score.
  const latestEval =
    evaluations.find((e) => e.section_id === latest.id) ??
    // Only for rows written before section_id was populated, and only when the number
    // is unambiguous within this request.
    (evaluations.filter((e) => e.content_version === latest.version).length === 1
      ? evaluations.find((e) => e.content_version === latest.version)
      : undefined);
  // Regenerate/Reject are available on any draft awaiting review, whether it just
  // passed or is stuck at needs_human_attention (the internal auto-revision loop's
  // own cap having been reached doesn't remove the human's ability to try again with
  // guidance - regenerate's own separate 5-attempt cap is what actually stops this).
  const canReview =
    isOwner && (requestStatus === "pending_approval" || requestStatus === "needs_human_attention");

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-muted">Draft</h2>

      <Card className="mt-2 p-6">
        <h3 className="text-xl font-semibold tracking-tight">{latest.title}</h3>
        <div
          className="mt-4 flex flex-col gap-3 text-sm leading-relaxed text-foreground
            [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h1]:mt-2
            [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:mt-3
            [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-2
            [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
            [&_a]:underline [&_a]:text-accent [&_strong]:font-semibold
            [&_code]:rounded [&_code]:bg-black/5 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono
            [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black/5 [&_pre]:p-3"
        >
          <ReactMarkdown>{body}</ReactMarkdown>
        </div>

        {citations.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Sources</p>
            <ol className="mt-2 flex flex-col gap-1.5 text-xs">
              {citations.map((c) => (
                <li key={c.number} className="flex gap-2">
                  <span className="shrink-0 font-medium text-muted">[{c.number}]</span>
                  <a
                    href={c.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate text-accent hover:underline"
                    title={c.url}
                  >
                    {c.label}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        )}

        <DraftVersionPicker requestId={requestId} versions={draftVersions} isOwner={isOwner} />
      </Card>

      {latestEval && (
        <Card className="mt-4 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Pass 1 evaluation</h3>
            <span className="text-lg font-bold">{latestEval.overall_score}/100</span>
          </div>
          {latestEval.hard_block_triggered && (
            <p className="mt-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              Hard block: {latestEval.hard_block_reason ?? "a critical criterion fell below its floor."}
            </p>
          )}
          <div className="mt-4 flex flex-col gap-4">
            {asList<{ name: string; score: number; max: number; notes?: string }>(latestEval.criteria).map((c) => (
              <div key={c.name}>
                <ScoreBar label={c.name} score={c.score} max={c.max} floor={floorFor(c.name)} />
                {c.notes && <p className="mt-1 text-xs text-muted">{c.notes}</p>}
              </div>
            ))}
          </div>
          {latestEval.weakest_criteria_suggestions && latestEval.weakest_criteria_suggestions.length > 0 && (
            <div className="mt-4 rounded-lg bg-warning-soft p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-warning">
                Improvement suggestions
              </p>
              <ul className="mt-1.5 flex flex-col gap-1 text-sm text-warning">
                {asList(latestEval.weakest_criteria_suggestions).map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {canReview && (
        <Card className="mt-4 p-5">
          <ReviewActions
            requestId={requestId}
            regenerationCount={regenerationCount}
            canApprove={latestEval?.status === "pass"}
          />
          {/* Regenerating reuses the chosen angle, so it produces the same shape of
              article. When the treatment itself is the problem, the answer is a
              different angle, and that was only reachable from a dead end until now. */}
          {/* Only when another angle actually exists to move to: with one proposed
              angle this offers a screen holding the angle already in use. */}
          {requestStatus === "pending_approval" && unusedAngles > 0 && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-sm text-muted">
                Want a different treatment rather than another pass at this one?
              </p>
              <BackToAngleSelectionButton
                requestId={requestId}
                hasPassingDraft
                otherAngles={unusedAngles}
              />
            </div>
          )}
        </Card>
      )}

      {excerpts.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Source excerpts ({excerpts.length})
          </h3>
          <Card className="mt-2 divide-y divide-border p-1">
            {excerpts.map((e) => (
              <div key={e.id} className="px-4 py-3">
                <p className="text-sm text-foreground">&ldquo;{e.text}&rdquo;</p>
                <p className="mt-1 text-xs text-muted">
                  {e.reason}:{" "}
                  <a
                    href={sourceUrlsById[e.source_id]}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {sourceUrlsById[e.source_id]}
                  </a>
                </p>
              </div>
            ))}
          </Card>
        </div>
      )}

      {sections.length > 1 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
            Revision history
          </h3>
          <Card className="mt-2 divide-y divide-border p-1">
            {sections.map((s) => {
              const ev = evaluations.find((e) => e.content_version === s.version);
              return (
                <div key={s.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <span>Version {s.version}</span>
                  {ev && (
                    <span className="text-muted">
                      {ev.overall_score}/100 · {ev.status}
                    </span>
                  )}
                </div>
              );
            })}
          </Card>
        </div>
      )}
    </section>
  );
}
