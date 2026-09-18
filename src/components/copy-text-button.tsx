"use client";

import { useState } from "react";

// LinkedIn and X are reminder channels: this app never posts to them, because it has
// no company account to post from. The human does it by hand, which makes "get this
// text out of the page cleanly" the actual last step of the pipeline, not an
// afterthought. Selecting a rendered preview by dragging picks up the character
// counter and the post labels along with it.
export default function CopyTextButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  variant = "subtle",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  /** "subtle" sits inside a preview; "outline" stands alone above one. */
  variant?: "subtle" | "outline";
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused: an insecure origin, or a browser that wants a
      // more direct gesture. Saying so beats a button that silently does nothing.
      setFailed(true);
      setTimeout(() => setFailed(false), 2500);
    }
  }

  const base =
    variant === "outline"
      ? "rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-background"
      : "rounded-md px-1.5 py-0.5 text-xs font-medium hover:bg-surface";

  return (
    <button
      type="button"
      onClick={copy}
      title={failed ? "Copy failed" : `Copy ${label.toLowerCase()}`}
      className={`${base} shrink-0 transition-colors ${
        copied ? "text-success" : failed ? "text-danger" : "text-muted hover:text-foreground"
      }`}
    >
      {failed ? "Copy failed" : copied ? copiedLabel : label}
    </button>
  );
}
