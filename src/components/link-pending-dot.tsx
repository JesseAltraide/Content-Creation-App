"use client";

import { useLinkStatus } from "next/link";

// Inline feedback on the row you actually clicked, which loading.tsx cannot give:
// the skeleton replaces the whole page, so between the click and the skeleton there
// is a gap where nothing on the list has changed. Sits inside the <Link> it reports
// on, which is how useLinkStatus finds it.
export default function LinkPendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      role="status"
      aria-label="Opening"
      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-border border-t-accent"
    />
  );
}
