"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const REGENERATION_CAP = 5;

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

  async function handleApprove() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/approve`, { method: "POST" });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  async function handleRegenerate() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
    });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  async function handleReject() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
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
            placeholder="Be specific — this becomes the instruction for the next draft."
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
          : "Regeneration limit reached — reject this draft or go back to angle selection instead."}
      </p>
    </div>
  );
}
