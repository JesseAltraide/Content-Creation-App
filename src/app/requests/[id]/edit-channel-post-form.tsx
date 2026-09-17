"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const X_POST_SEPARATOR = "\n\n---\n\n";

// x and newsletter bodies are stored as JSON-stringified structures (see
// channel-posts-review.tsx's parseXPosts/parseNewsletter) - editing the raw JSON
// directly would be terrible UX and risks the human breaking the structure by hand.
// These convert between the stored format and a plain-text editing surface, and
// back, so the human only ever edits readable text.
function toEditableText(channel: string, body: string): string {
  if (channel === "x") {
    try {
      const posts = JSON.parse(body);
      if (Array.isArray(posts)) return posts.join(X_POST_SEPARATOR);
    } catch {
      // fall through - treat as plain text
    }
    return body;
  }
  if (channel === "newsletter") {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object" && "body_markdown" in parsed) {
        return `Subject: ${parsed.subject_line ?? ""}\n\n${parsed.body_markdown ?? ""}`;
      }
    } catch {
      // fall through
    }
    return body;
  }
  return body;
}

function fromEditableText(channel: string, text: string): string {
  if (channel === "x") {
    const posts = text
      .split(X_POST_SEPARATOR)
      .map((p) => p.trim())
      .filter(Boolean);
    return JSON.stringify(posts);
  }
  if (channel === "newsletter") {
    const match = text.match(/^Subject:\s*(.*?)\n\n([\s\S]*)$/);
    if (match) {
      return JSON.stringify({ subject_line: match[1].trim(), body_markdown: match[2].trim() });
    }
    return JSON.stringify({ subject_line: "", body_markdown: text.trim() });
  }
  return text;
}

export default function EditChannelPostForm({
  requestId,
  channel,
  currentBody,
  onCancel,
}: {
  requestId: string;
  channel: "linkedin" | "x" | "newsletter";
  currentBody: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState(() => toEditableText(channel, currentBody));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ escalated: boolean; score?: number; status?: string } | null>(null);

  async function handleSave() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/edit-channel-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, editedBody: fromEditableText(channel, text) }),
      });
      const responseBody = await res.json();
      if (!res.ok) {
        setError(
          responseBody.reason === "hard_block"
            ? `Blocked: ${responseBody.detail ?? "a critical criterion fell below its floor."}`
            : responseBody.error ?? "Something went wrong."
        );
        return;
      }
      setResult({ escalated: responseBody.escalated, score: responseBody.score, status: responseBody.status });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (channel === "x") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-xs text-muted">Separate posts with a blank line and three dashes (---) on their own line.</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="rounded-lg border border-border bg-surface px-3.5 py-2.5 font-mono text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <EditFormActions
          submitting={submitting}
          error={error}
          result={result}
          onSave={handleSave}
          onCancel={onCancel}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={channel === "newsletter" ? 12 : 6}
        className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      />
      <EditFormActions
        submitting={submitting}
        error={error}
        result={result}
        onSave={handleSave}
        onCancel={onCancel}
      />
    </div>
  );
}

function EditFormActions({
  submitting,
  error,
  result,
  onSave,
  onCancel,
}: {
  submitting: boolean;
  error: string | null;
  result: { escalated: boolean; score?: number; status?: string } | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button onClick={onSave} disabled={submitting}>
          {submitting ? "Saving…" : "Save edit"}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {result && !error && (
        <p className="text-sm text-success">
          {result.escalated
            ? `Re-evaluated: ${result.score}/100 (${result.status}).`
            : "Saved. A grammatical edit, no re-evaluation needed."}
        </p>
      )}
    </div>
  );
}
