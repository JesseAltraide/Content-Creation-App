"use client";

import { useState } from "react";

// Reading the sources yourself is part of judging whether a draft is actually
// grounded, so the URL needs to be reachable rather than just displayed. Truncated
// text in a list is not something you can select and copy reliably.
export default function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused (insecure origin, permissions). The link
      // itself is still open-able, so this stays quiet rather than erroring.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy link"
      className="shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted transition-colors hover:bg-background hover:text-foreground"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
