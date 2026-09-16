import ReactMarkdown from "react-markdown";
import { Card } from "@/components/ui/card";
import { ScoreBar } from "@/components/ui/score-bar";
import ReviewActions from "./review-actions";

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
  version: number;
  title: string | null;
  body_markdown: string | null;
  generation_status: string;
};

type EvalResult = {
  id: string;
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
  sections,
  evaluations,
  excerpts,
  sourceUrlsById,
}: {
  requestId: string;
  requestStatus: string;
  sections: Section[];
  evaluations: EvalResult[];
  excerpts: Excerpt[];
  sourceUrlsById: Record<string, string>;
}) {
  if (sections.length === 0) return null;

  const latest = sections[sections.length - 1];
  const latestEval = evaluations.find((e) => e.content_version === latest.version);
  const canReview = requestStatus === "pending_approval";

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
          <ReactMarkdown>{latest.body_markdown ?? ""}</ReactMarkdown>
        </div>
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
            {latestEval.criteria.map((c) => (
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
                {latestEval.weakest_criteria_suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {canReview && latestEval?.status === "pass" && (
        <Card className="mt-4 p-5">
          <ReviewActions requestId={requestId} />
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
                  {e.reason} —{" "}
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
