"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

import { REGENERATION_CAP } from "@/lib/regeneration";

export default function ReviewActions({
  requestId,
  regenerationCount,
  canApprove,
}: {
  requestId: string;
  regenerationCount: number;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const attemptsLeft = REGENERATION_CAP - regenerationCount;

  // A failure response isn't guaranteed to be JSON (e.g. a transient 404/502 from
  // the platform itself, not our route) - res.json() throwing on that would leave
  // `submitting` stuck true forever with no error shown, the button spinning
  // indefinitely with no way to tell the user went wrong or retry. Parse
  // defensively and always clear `submitting` in a finally.
  async function submit(path: string, options: RequestInit) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/${path}`, options);
      if (!res.ok) {
        let message = `Request failed (${res.status}).`;
        try {
          const body = await res.json();
          message = body.error ?? message;
        } catch {
          // non-JSON error body - keep the generic status-based message
        }
        setError(message);
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleApprove() {
    return submit("approve", { method: "POST" });
  }

  function handleRegenerate() {
    return submit("regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
  }

  function handleReject() {
    return submit("reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
  }

  if (regenerating) {
    return (
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">What should change? *</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            placeholder="Be specific. This becomes the instruction for the next draft."
            className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={handleRegenerate} disabled={submitting || comment.trim().length < 10}>
            {submitting ? "Regenerating…" : "Confirm regenerate"}
          </Button>
          <Button variant="ghost" onClick={() => setRegenerating(false)} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (rejecting) {
    return (
      <div className="flex flex-col gap-2">
        {/* Reject reads as "reject these posts" when it sits under the channel
            adaptation, but it ends the whole request: the approved article and every
            channel post stop here, and there is no route back to any of them. Worth
            saying plainly before the click rather than discovering it after. */}
        <div className="rounded-lg bg-danger-soft px-3 py-2.5">
          <p className="text-sm font-medium text-danger">This ends the whole request.</p>
          <p className="mt-0.5 text-xs text-danger/90">
            The article and every channel post stop here. Nothing is deleted, but the request
            can&apos;t continue afterwards and there&apos;s no way to reopen it. If you only want
            to change one post, cancel and edit or revise it instead.
          </p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Reason for rejecting *</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder="What's wrong with this draft, and what should change?"
            className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-danger focus:ring-2 focus:ring-danger/20"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button
            variant="danger"
            onClick={handleReject}
            disabled={submitting || reason.trim().length < 10}
          >
            {submitting ? "Rejecting…" : "Confirm rejection"}
          </Button>
          <Button variant="ghost" onClick={() => setRejecting(false)} disabled={submitting}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {canApprove && (
          <Button onClick={handleApprove} disabled={submitting}>
            {submitting ? "Approving…" : "Approve article"}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => setRegenerating(true)}
          disabled={submitting || attemptsLeft <= 0}
        >
          Regenerate with comment
        </Button>
        <Button variant="secondary" onClick={() => setRejecting(true)} disabled={submitting}>
          Reject
        </Button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
      <p className="text-xs text-muted">
        {attemptsLeft > 0
          ? `${attemptsLeft} regeneration${attemptsLeft === 1 ? "" : "s"} left for this article.`
          : "Regeneration limit reached. Reject this draft or go back to angle selection instead."}
      </p>
    </div>
  );
}
