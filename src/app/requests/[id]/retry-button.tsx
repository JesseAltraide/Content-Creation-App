"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RetryButton({ requestId }: { requestId: string }) {
  const router = useRouter();
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
    router.refresh();
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <button
        onClick={handleRetry}
        disabled={submitting}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {submitting ? "Retrying…" : "Retry"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
