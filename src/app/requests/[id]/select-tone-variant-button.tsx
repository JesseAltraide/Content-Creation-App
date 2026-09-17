"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function SelectToneVariantButton({
  requestId,
  channel,
  version,
  label,
}: {
  requestId: string;
  channel: "linkedin" | "x" | "newsletter";
  version: number;
  label: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/select-tone-variant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, version }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Couldn't switch variants.");
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
      <Button onClick={handleClick} disabled={submitting}>
        {submitting ? "Switching…" : label}
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
