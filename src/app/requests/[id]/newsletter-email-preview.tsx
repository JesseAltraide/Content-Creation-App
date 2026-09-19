"use client";

import { useState } from "react";
import { parseNewsletter } from "@/lib/channel-post-format";
import ReactMarkdown from "react-markdown";
import LocalTime from "@/components/local-time";

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
                <LocalTime value={scheduledFor} className="text-foreground" />
              </div>
            )}
          </div>

          {/* Rendered, not raw. This was deliberately monospaced plain text while the
              send itself was plain text, which is how the markdown-in-a-text-email
              defect surfaced here rather than in a subscriber's inbox. The send now
              carries an HTML part built from this same markdown, so rendering it is
              the accurate preview and showing raw asterisks would be the lie. */}
          <div className="bg-surface px-4 py-4">
            <div
              className="flex flex-col gap-3 text-sm leading-relaxed text-foreground
                [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold
                [&_h3]:text-sm [&_h3]:font-semibold [&_strong]:font-semibold
                [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5
                [&_a]:text-accent [&_a]:underline"
            >
              <ReactMarkdown>{body_markdown}</ReactMarkdown>
            </div>
            <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
              You are receiving this because you subscribed. Unsubscribe.
            </p>
          </div>

        </div>
      )}
    </div>
  );
}
