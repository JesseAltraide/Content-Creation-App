"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type Sample = { id: string; content: string; created_at: string };

export default function ChannelToneSection({
  channel,
  label,
  samples,
}: {
  channel: string;
  label: string;
  samples: Sample[];
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/tone-samples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, content }),
    });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    setContent("");
    router.refresh();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await fetch(`/api/tone-samples/${id}`, { method: "DELETE" });
    setDeletingId(null);
    router.refresh();
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs text-muted">
          {samples.length} sample{samples.length === 1 ? "" : "s"}
        </span>
      </div>

      <Card className="mt-2 p-5">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder={`Paste a real ${label} post here…`}
          className="w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        <div className="mt-3 flex items-center gap-2">
          <Button onClick={handleAdd} disabled={submitting || !content.trim()}>
            {submitting ? "Saving…" : "Add sample"}
          </Button>
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
        </div>
      </Card>

      {samples.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {samples.map((s) => (
            <Card key={s.id} className="flex items-start justify-between gap-4 p-4">
              <p className="whitespace-pre-wrap text-sm text-foreground">
                {s.content.length > 240 ? s.content.slice(0, 240) + "…" : s.content}
              </p>
              <Button
                variant="ghost"
                onClick={() => handleDelete(s.id)}
                disabled={deletingId === s.id}
                className="shrink-0 !text-danger"
              >
                {deletingId === s.id ? "Removing…" : "Remove"}
              </Button>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
