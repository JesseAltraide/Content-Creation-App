"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// The evaluator already says exactly what would close the gap. Making the human
// hand-apply that is the worst of both worlds, and for an X thread it means manually
// re-splitting posts around a 280 character limit to recover a Channel Fit score.
export default function ReviseWithSuggestionsButton({
  requestId,
  channel,
}: {
  requestId: string;
  channel: "linkedin" | "x" | "newsletter";
}) {
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ previousScore: number | null; score: number; status: string } | null>(null);

  async function handleRevise() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/revise-channel-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      let payload: { error?: string; previousScore?: number | null; score?: number; status?: string } = {};
      try {
        payload = await res.json();
      } catch {
        // A non-JSON error body (a platform 502, not our route) would otherwise throw
        // here and leave the button spinning with nothing shown.
      }
      if (!res.ok) {
        setError(payload.error ?? `Revision failed (${res.status}).`);
        setConfirming(false);
        return;
      }
      setResult({
        previousScore: payload.previousScore ?? null,
        score: payload.score ?? 0,
        status: payload.status ?? "revise",
      });
      setConfirming(false);
      window.location.reload();
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
          rewrite comes back lower, your current version is kept and nothing is lost except the
          wait.
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

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setConfirming(true)} disabled={submitting}>
          {submitting ? "Revising and re-scoring…" : "Apply these suggestions"}
        </Button>
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

      {result && (
        <p className="mt-2 text-xs font-medium text-foreground">
          {result.previousScore !== null
            ? `Rescored ${result.previousScore}/100 to ${result.score}/100 (${result.status}).`
            : `Rescored ${result.score}/100 (${result.status}).`}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
