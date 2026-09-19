"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { hardRefresh } from "@/lib/hard-refresh";

export default function SelectAngleButton({
  requestId,
  angleId,
  alreadyGenerated,
  attemptsLeft,
}: {
  requestId: string;
  angleId: string;
  /** Generation has run against this angle before, so re-picking it spends an attempt. */
  alreadyGenerated: boolean;
  attemptsLeft: number;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/select-angle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ angleId }),
    });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    hardRefresh();
  }

  // The cost of re-picking is the same full Workflow B run as pressing Regenerate,
  // so it spends from the same budget. Say so before the click rather than
  // surfacing it as a 409 afterwards.
  const blocked = alreadyGenerated && attemptsLeft <= 0;

  return (
    <div className="mt-4">
      <Button onClick={handleSelect} disabled={submitting || blocked}>
        {submitting ? "Selecting…" : alreadyGenerated ? "Generate from this angle again" : "Select this angle"}
      </Button>
      {alreadyGenerated && (
        <p className="mt-2 text-xs text-muted">
          {blocked
            ? "Regeneration limit reached. Pick a different angle, or reject this draft and start again."
            : `This angle has already been generated from, so running it again uses one of your ${attemptsLeft} remaining regenerations.`}
        </p>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
