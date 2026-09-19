"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { hardRefresh } from "@/lib/hard-refresh";

export default function RejectButton({ requestId }: { requestId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

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
    hardRefresh();
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
            placeholder="What's wrong, and what should change?"
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
    <div className="flex items-center gap-2">
      <Button variant="secondary" onClick={() => setRejecting(true)}>
        Reject
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
