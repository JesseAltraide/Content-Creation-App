"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function RetryAdaptationButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRetry() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/retry-adaptation`, { method: "POST" });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Retry failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <Button onClick={handleRetry} disabled={submitting}>
        {submitting ? "Retrying…" : "Retry adaptation"}
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
