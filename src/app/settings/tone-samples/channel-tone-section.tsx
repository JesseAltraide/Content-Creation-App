"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { findLink, TONE_SAMPLE_LINK_MESSAGE } from "@/lib/find-link";
import { hardRefresh } from "@/lib/hard-refresh";

type Sample = { id: string; content: string; source: string; created_at: string };

export default function ChannelToneSection({
  channel,
  label,
  samples,
  canEdit,
}: {
  channel: string;
  label: string;
  samples: Sample[];
  /** Only the content manager edits the brand voice (migration 009). */
  canEdit: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"real_post" | "described_target">("real_post");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setContent(text);
    e.target.value = "";
  }

  async function handleAdd() {
    // Caught here as well as on the server, so the link is named before a round trip
    // rather than after. The server check is the one that counts.
    const link = findLink(content);
    if (link) {
      setError(`${TONE_SAMPLE_LINK_MESSAGE} Found: ${link}`);
      return;
    }
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/tone-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, content, source: mode }),
    });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    setContent("");
    hardRefresh();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await fetch(`/api/tone-samples/${id}`, { method: "DELETE" });
    setDeletingId(null);
    hardRefresh();
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs text-muted">
          {samples.length} sample{samples.length === 1 ? "" : "s"}
        </span>
      </div>

      {canEdit && <Card className="mt-2 p-5">
        <div className="mb-3 flex gap-1 rounded-lg bg-background p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("real_post")}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
              mode === "real_post" ? "bg-surface text-foreground shadow-sm" : "text-muted"
            }`}
          >
            Paste a real post
          </button>
          <button
            type="button"
            onClick={() => setMode("described_target")}
            className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${
              mode === "described_target" ? "bg-surface text-foreground shadow-sm" : "text-muted"
            }`}
          >
            Describe target tone
          </button>
        </div>

        {mode === "real_post" && (
          <p className="mb-2 text-xs text-muted">
            Paste the words of the post itself. Links are not read and are refused:
            nothing here is fetched, so what you paste is exactly what the voice is
            learned and graded from.
          </p>
        )}

        {mode === "described_target" && (
          <p className="mb-2 text-xs text-muted">
            For a brand-new channel with no posts yet. Weaker than a real sample, but better than
            nothing. Replace it with real posts once they exist.
          </p>
        )}

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder={
            mode === "real_post"
              ? `Paste the text of a real ${label} post here, links removed…`
              : `Describe the ${label} voice you're going for, e.g. "confident but not salesy, short sentences, no corporate jargon, occasional dry humor"`
          }
          className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={handleAdd} disabled={submitting || !content.trim()}>
            {submitting ? "Saving…" : "Add sample"}
          </Button>
          {mode === "real_post" && (
            <>
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                Upload file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,text/plain"
                onChange={handleFileChosen}
                className="hidden"
              />
            </>
          )}
        </div>
      </Card>}

      {samples.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {samples.map((s) => (
            <Card key={s.id} className="flex items-start justify-between gap-4 p-4">
              <div>
                {s.source === "described_target" && (
                  <span className="mb-1.5 inline-block rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                    Described target, not a real post
                  </span>
                )}
                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {s.content.length > 240 ? s.content.slice(0, 240) + "…" : s.content}
                </p>
              </div>
              {canEdit && (
                <Button
                  variant="ghost"
                  onClick={() => handleDelete(s.id)}
                  disabled={deletingId === s.id}
                  className="shrink-0 !text-danger"
                >
                  {deletingId === s.id ? "Removing…" : "Remove"}
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
