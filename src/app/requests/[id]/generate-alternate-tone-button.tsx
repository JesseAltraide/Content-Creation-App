"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function GenerateAlternateToneButton({
  requestId,
  channel,
}: {
  requestId: string;
  channel: "linkedin" | "x" | "newsletter";
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/generate-alternate-tone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(
          body.error === "hard_block"
            ? `Blocked: ${body.reason ?? "a critical criterion failed."}`
            : body.error ?? "Generation failed."
        );
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" onClick={handleClick} disabled={submitting}>
        {submitting ? "Generating alternate tone…" : "Generate alternate tone"}
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
