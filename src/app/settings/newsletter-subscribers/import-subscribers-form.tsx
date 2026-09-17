"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function ImportSubscribersForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);

  async function handleImport() {
    const emails = text
      .split(/[\n,;]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (emails.length === 0) {
      setError("Paste at least one email address.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/newsletter-subscribers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      setResult(body.imported);
      setText("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error - please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Import subscribers</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="One email per line, or comma-separated"
          className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
      </label>
      <div className="flex items-center gap-2">
        <Button onClick={handleImport} disabled={submitting}>
          {submitting ? "Importing…" : "Import"}
        </Button>
        {error && <span className="text-sm text-danger">{error}</span>}
        {result !== null && !error && (
          <span className="text-sm text-success">Imported {result} new address{result === 1 ? "" : "es"}.</span>
        )}
      </div>
      <p className="text-xs text-muted">
        Re-importing an address that already unsubscribed won&apos;t re-subscribe them.
      </p>
    </div>
  );
}
