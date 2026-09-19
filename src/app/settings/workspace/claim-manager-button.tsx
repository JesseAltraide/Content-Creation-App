"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { hardRefresh } from "@/lib/hard-refresh";

export default function ClaimManagerButton() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/workspace-settings/content-manager", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't claim it.");
        return;
      }
      hardRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button onClick={claim} disabled={submitting}>
        {submitting ? "Claiming…" : "Make me the content manager"}
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
