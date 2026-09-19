"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { hardRefresh } from "@/lib/hard-refresh";

export default function MarkReadyButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/mark-ready`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      // Not router.refresh(): client navigation has repeatedly failed to re-render
      // the server components on this page, which shows up as an action that
      // appears to do nothing. Same reason the polling and the source picker
      // reload outright.
      hardRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button onClick={handleClick} disabled={submitting}>
        {submitting ? "Checking…" : "All channels pass now, mark ready to schedule"}
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
