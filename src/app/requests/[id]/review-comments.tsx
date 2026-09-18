"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CHANNEL_LABELS } from "@/lib/channel-post-format";

export type Comment = {
  id: string;
  user_id: string | null;
  author_email: string | null;
  channel: string | null;
  body: string;
  created_at: string;
};

export default function ReviewComments({
  requestId,
  comments,
  currentUserId,
  isOwner,
}: {
  requestId: string;
  comments: Comment[];
  currentUserId: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, channel: channel || null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Couldn't save your comment.");
        return;
      }
      setBody("");
      setChannel("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function remove(commentId: string) {
    await fetch(`/api/requests/${requestId}/comments?commentId=${commentId}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-semibold text-muted">
        Review comments{comments.length > 0 ? ` (${comments.length})` : ""}
      </h2>
      <p className="mt-1 text-xs text-muted">
        {isOwner
          ? "Suggestions from the team. They're advisory: nothing here blocks scheduling, and it's your call what to act on."
          : "You can read this and suggest improvements. Only the author can edit or schedule it."}
      </p>

      <Card className="mt-2 p-5">
        <form onSubmit={submit} className="flex flex-col gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="What would make this better?"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <select
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="">Whole request</option>
              <option value="linkedin">{CHANNEL_LABELS.linkedin}</option>
              <option value="x">{CHANNEL_LABELS.x}</option>
              <option value="newsletter">{CHANNEL_LABELS.newsletter}</option>
            </select>
            <Button type="submit" disabled={submitting || body.trim().length === 0}>
              {submitting ? "Posting…" : "Post comment"}
            </Button>
            {error && <span className="text-sm text-danger">{error}</span>}
          </div>
        </form>

        {comments.length > 0 && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4">
            {comments.map((c) => (
              <div key={c.id} className="text-sm">
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span className="font-medium text-foreground">
                    {c.author_email ?? "Someone who has since left"}
                  </span>
                  {c.channel && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">
                      {CHANNEL_LABELS[c.channel] ?? c.channel}
                    </span>
                  )}
                  <span>{new Date(c.created_at).toLocaleString()}</span>
                  {c.user_id === currentUserId && (
                    <button
                      type="button"
                      onClick={() => remove(c.id)}
                      className="text-muted underline hover:text-danger"
                    >
                      delete
                    </button>
                  )}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-foreground">{c.body}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
