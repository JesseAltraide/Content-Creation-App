"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { REGENERATION_CAP } from "@/lib/regeneration";

// The evaluator already says exactly what would close the gap. Making the human
// hand-apply that is the worst of both worlds, and for an X thread it means manually
// re-splitting posts around a 280 character limit to recover a Channel Fit score.
export default function ReviseWithSuggestionsButton({
  requestId,
  channel,
  rewritesUsed,
}: {
  requestId: string;
  channel: "linkedin" | "x" | "newsletter";
  /** Spent so far, against REGENERATION_CAP. Shown because the limit is real and
   *  hitting it without warning reads as the button breaking. */
  rewritesUsed: number;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Kept only for a hard block, which is the one case that still saves nothing. */
  const [keptExisting, setKeptExisting] = useState(false);
  const [result, setResult] = useState<{ previousScore: number | null; score: number; status: string; inUse: boolean } | null>(null);

  async function handleRevise() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    setKeptExisting(false);
    try {
      const res = await fetch(`/api/requests/${requestId}/revise-channel-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      let payload: {
        error?: string;
        previousScore?: number | null;
        score?: number;
        status?: string;
        keptExisting?: boolean;
        inUse?: boolean;
      } = {};
      try {
        payload = await res.json();
      } catch {
        // A non-JSON error body (a platform 502, not our route) would otherwise throw
        // here and leave the button spinning with nothing shown.
      }
      if (!res.ok) {
        setError(payload.error ?? `Revision failed (${res.status}).`);
        setKeptExisting(payload.keptExisting === true);
        setConfirming(false);
        return;
      }
      setResult({
        previousScore: payload.previousScore ?? null,
        score: payload.score ?? 0,
        status: payload.status ?? "revise",
        inUse: payload.inUse !== false,
      });
      setConfirming(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // Asked before the call, not explained after it. A rewrite acts on every suggestion
  // at once and criteria trade against each other, so the score can legitimately fall;
  // the guard keeps the better version, but someone who expected a guaranteed
  // improvement has still spent a minute waiting to be told no. Editing by hand
  // against the same list is often the faster route, and this says so while the choice
  // is still open.
  if (confirming && !submitting) {
    return (
      <div className="mt-3 rounded-lg border border-warning/30 bg-warning-soft p-3">
        <p className="text-sm font-medium text-warning">
          A rewrite is not guaranteed to score higher.
        </p>
        <p className="mt-1 text-xs text-warning/90">
          It acts on every suggestion at once, and the criteria pull against each other: adding
          line breaks for Channel Fit can cost you on Tone. The evaluator also scores
          independently each time, so a few points either way is normal variance. If the
          rewrite comes back lower, it is saved to the version history and your current
          version stays in use, so nothing is lost except the wait.
        </p>
        <p className="mt-1.5 text-xs text-warning/90">
          For a specific fix, editing the post yourself against the list above is usually faster
          and lands exactly what you meant. Use &ldquo;Add your own steer&rdquo; if you want the
          rewrite pointed at one thing in particular.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button onClick={handleRevise} disabled={submitting}>
            Rewrite it anyway
          </Button>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const atCap = rewritesUsed >= REGENERATION_CAP;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setConfirming(true)} disabled={submitting || atCap}>
          {submitting ? "Revising and re-scoring…" : "Apply these suggestions"}
        </Button>
        {/* The budget, on screen, before it runs out. The server refuses the sixth
            attempt, and a button that simply stops working reads as broken. */}
        <span className={`text-xs ${atCap ? "text-danger" : "text-muted"}`}>
          {rewritesUsed} of {REGENERATION_CAP} rewrites used
          {atCap ? " - edit it yourself, or regenerate the article" : ""}
        </span>
        {!showNote && !submitting && (
          <Button variant="ghost" onClick={() => setShowNote(true)}>
            Add your own steer
          </Button>
        )}
      </div>

      {showNote && (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Anything you want changed on top of the suggestions above. This takes priority."
          className="mt-2 w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      )}

      <p className="mt-2 text-xs text-muted">
        Rewrites this post against the suggestions above and re-scores it. Takes around half a
        minute. Your current version is kept if the rewrite contradicts the sources.
      </p>

      {/* The outcome stays on screen rather than the page reloading straight past it:
          the number on its own does not answer the question people actually have,
          which is which version will be the one that goes out. */}
      {result && (
        <div className="mt-3 rounded-lg bg-success-soft p-3">
          <p className="text-sm font-medium text-success">
            {result.previousScore !== null
              ? `Rescored ${result.previousScore}/100 to ${result.score}/100 (${result.status}).`
              : `Scored ${result.score}/100 (${result.status}).`}
          </p>
          {/* Which version is actually in use now, rather than leaving the author to
              infer it from a score that may have gone down. */}
          <p className="mt-1 text-xs text-success/90">
            {result.inUse === false
              ? "That is lower than the version you already had, so your existing post stays in use and this rewrite is saved in the version history. Open the version list on the post to compare them and switch if you prefer it."
              : "That is at least as good as the version it replaced, so it is now the one up for scheduling. Every attempt is kept in the version history, and the higher score is always the one selected."}
          </p>
          <div className="mt-2">
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Show the updated post
            </Button>
          </div>
        </div>
      )}
      {error && (
        <div className="mt-3 rounded-lg bg-warning-soft p-3">
          <p className="text-sm text-warning">{error}</p>
          {keptExisting && (
            <p className="mt-1 text-xs text-warning/90">
              Nothing changed: the higher-scoring version you already had is still the one up for
              scheduling.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
