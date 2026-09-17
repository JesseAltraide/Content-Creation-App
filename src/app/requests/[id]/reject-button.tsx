"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function RejectButton({ requestId }: { requestId: string }) {
  const router = useRouter();
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
    router.refresh();
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
