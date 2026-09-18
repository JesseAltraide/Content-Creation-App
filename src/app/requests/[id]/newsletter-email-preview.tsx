"use client";

import { useState } from "react";
import { parseNewsletter } from "@/lib/channel-post-format";

// The card preview shows the subject and body. This shows the actual email: who it
// comes from, who it goes to, and the unsubscribe footer the publish job appends,
// rendered as plain text because that is genuinely how it is sent (sendMail passes
// `text` only). That fidelity is the point: any markdown left in the body reaches
// subscribers as literal asterisks and hashes, and a prettified preview would hide
// exactly the problem worth seeing before it goes out.
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
  const hasMarkdown = /(\*\*|^#{1,6} |\]\()/m.test(body_markdown);

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

          {hasMarkdown && (
            <div className="border-t border-border bg-warning-soft px-4 py-3">
              <p className="text-xs font-semibold text-warning">
                This body still contains markdown, and the email is sent as plain text.
              </p>
              <p className="mt-0.5 text-xs text-warning/90">
                Subscribers will see the asterisks and hashes exactly as they appear above, not
                bold text and headings. Edit them out, or ask for the newsletter to be sent as
                HTML instead.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
