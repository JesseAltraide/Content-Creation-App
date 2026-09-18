"use client";

import { useState } from "react";
import { parseNewsletter } from "@/lib/channel-post-format";
import ReactMarkdown from "react-markdown";

// The card preview shows the subject and body. This shows the actual email: who it
// comes from, who it goes to, the unsubscribe footer the publish job appends, and the
// body formatted the way it will arrive.
//
// It was deliberately plain text until the send itself was plain text, which made the
// markdown-in-a-text-email defect visible here rather than in someone's inbox. Now
// that the newsletter goes out as HTML with a stripped text fallback, rendering the
// markdown IS the accurate preview, and showing raw asterisks would be the lie.
export default function NewsletterEmailPreview({
  body,
  subscriberCount,
  scheduledFor,
}: {
  body: string;
  subscriberCount: number;
  /** Set once queued, so the preview can say when this actually lands. */
  scheduledFor?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { subject_line, body_markdown } = parseNewsletter(body);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-medium text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent"
      >
        {open ? "Hide full email preview" : "Preview the full email as subscribers will receive it"}
      </button>

      {open && (
        <div className="mt-2 overflow-hidden rounded-lg border border-border">
          <div className="flex flex-col gap-1 border-b border-border bg-background px-4 py-3 text-xs">
            <div className="flex gap-2">
              <span className="w-16 shrink-0 font-semibold uppercase tracking-wide text-muted">From</span>
              <span className="min-w-0 truncate text-foreground">your configured Gmail sender</span>
            </div>
            <div className="flex gap-2">
              <span className="w-16 shrink-0 font-semibold uppercase tracking-wide text-muted">To</span>
              <span className="text-foreground">
                {subscriberCount} active subscriber{subscriberCount === 1 ? "" : "s"}, each sent individually
              </span>
            </div>
            <div className="flex gap-2">
              <span className="w-16 shrink-0 font-semibold uppercase tracking-wide text-muted">Subject</span>
              <span className="min-w-0 font-medium text-foreground">{subject_line || "(no subject line)"}</span>
            </div>
            {scheduledFor && (
              <div className="flex gap-2">
                <span className="w-16 shrink-0 font-semibold uppercase tracking-wide text-muted">Sends</span>
                <span className="text-foreground">{new Date(scheduledFor).toLocaleString()}</span>
              </div>
            )}
          </div>

          {/* Monospace and whitespace-pre-wrap: this is a plain text email, and showing
              it in a proportional font with collapsed whitespace would misrepresent
              what lands in the inbox. */}
          <div className="bg-surface px-4 py-3">
            <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
              {body_markdown}
              {"\n\n---\nUnsubscribe: " + "https://your-app/api/unsubscribe?id=<each subscriber's own id>"}
            </pre>
          </div>

        </div>
      )}
    </div>
  );
}
