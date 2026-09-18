"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function ResumeSourcesButton({
  requestId,
  sourceCount,
}: {
  requestId: string;
  sourceCount: number;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleResume() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/resume-source-selection`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't continue. Refresh and try again.");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3">
      <Button onClick={handleResume} disabled={submitting}>
        {submitting ? "Continuing…" : `Continue with the ${sourceCount} source(s) found`}
      </Button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
