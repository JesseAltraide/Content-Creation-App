"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { hardRefresh } from "@/lib/hard-refresh";

export type StoredImageSuggestion = {
  recommended: boolean;
  reason: string;
  what_to_show: string | null;
  alt_text: string | null;
} | null;

// Asked for rather than generated automatically: it is a judgement about the final
// text, so running it during adaptation would spend a call on a draft that is about
// to be revised, and running it on every render would spend one per page view.
export default function ImageSuggestion({
  requestId,
  channel,
  suggestion,
  isOwner,
}: {
  requestId: string;
  channel: "linkedin" | "x";
  suggestion: StoredImageSuggestion;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/suggest-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Couldn't get a suggestion.");
        return;
      }
      // Not router.refresh(): client navigation has repeatedly failed to re-render
      // the server components on this page, which shows up as an action that
      // appears to do nothing. Same reason the polling and the source picker
      // reload outright.
      hardRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!suggestion) {
    if (!isOwner) return null;
    return (
      <div className="mt-4 border-t border-border pt-4">
        <Button variant="ghost" onClick={ask} disabled={submitting}>
          {submitting ? "Thinking…" : "Should this post have an image?"}
        </Button>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            suggestion.recommended ? "bg-accent-soft text-accent" : "bg-black/5 text-muted"
          }`}
        >
          {suggestion.recommended ? "Image recommended" : "No image needed"}
        </span>
        {isOwner && (
          <Button variant="ghost" onClick={ask} disabled={submitting}>
            {submitting ? "Rechecking…" : "Recheck"}
          </Button>
        )}
      </div>

      <p className="mt-2 text-sm text-muted">{suggestion.reason}</p>

      {suggestion.recommended && suggestion.what_to_show && (
        <div className="mt-2 rounded-lg bg-background p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">What to show</p>
          <p className="mt-1 text-sm">{suggestion.what_to_show}</p>
          {suggestion.alt_text && (
            <>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">Alt text</p>
              <p className="mt-1 text-sm">{suggestion.alt_text}</p>
            </>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
