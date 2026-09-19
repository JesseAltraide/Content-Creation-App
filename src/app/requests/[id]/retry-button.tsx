"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { hardRefresh } from "@/lib/hard-refresh";

export default function RetryButton({ requestId }: { requestId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/retry`, { method: "POST" });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Retry failed.");
      return;
    }
    hardRefresh();
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <Button onClick={handleRetry} disabled={submitting}>
        {submitting ? "Retrying…" : "Retry"}
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
