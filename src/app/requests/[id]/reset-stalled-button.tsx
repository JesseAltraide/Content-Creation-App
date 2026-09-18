"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function ResetStalledButton({ requestId }: { requestId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/reset-stalled`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't reset this. Refresh and try again.");
        return;
      }
      // A full reload, not router.refresh(). This changes the request's status, which
      // decides which banners and actions the server renders, and refresh() was leaving
      // the old markup on screen until the person reloaded by hand. A recovery action
      // that appears not to have worked is worse than a page flash.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3">
      <Button variant="secondary" onClick={handleReset} disabled={submitting}>
        {submitting ? "Resetting…" : "Reset this run"}
      </Button>
      <p className="mt-1.5 text-xs text-warning/90">
        Moves it back to the last safe point so you can retry. Nothing is deleted, and this does
        not start a new run by itself.
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
