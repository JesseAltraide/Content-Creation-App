"use client";

import { useEffect, useState } from "react";

// One in-flight action at a time, enforced centrally rather than per button.
//
// Every control already disables its own button while its own request is running,
// which stops a double-click on that button but not a click on a different one. You
// could fire Approve and then Regenerate, or schedule two channels at once, and each
// route would only see its own guard. Doing this per component would mean touching
// every form and trusting each one to remember.
//
// Patching fetch instead catches every mutating call there is, including ones added
// later. GET is deliberately excluded: the request page polls while work is running,
// and a poll is not an action the human took.
export default function PendingActionOverlay() {
  const [pending, setPending] = useState(0);
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const original = window.fetch;
    // Guard against a double mount (React strict mode runs effects twice in dev)
    // wrapping the wrapper and double-counting every request.
    if ((original as { __pendingPatched?: boolean }).__pendingPatched) return;

    const patched: typeof window.fetch = async (input, init) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const isMutation = method !== "GET" && method !== "HEAD" && url.includes("/api/");
      if (!isMutation) return original(input, init);

      setPending((n) => n + 1);
      try {
        return await original(input, init);
      } finally {
        setPending((n) => Math.max(0, n - 1));
      }
    };
    (patched as { __pendingPatched?: boolean }).__pendingPatched = true;
    window.fetch = patched;
    return () => {
      window.fetch = original;
    };
  }, []);

  // A generation plus an evaluation runs for half a minute or more, and a spinner
  // with no explanation reads as a hang. Same lesson as the working banner.
  useEffect(() => {
    if (pending === 0) {
      setSlow(false);
      return;
    }
    const id = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(id);
  }, [pending]);

  if (pending === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-5 py-4 shadow-lg">
        <span
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-accent"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-medium">Working…</p>
          <p className="mt-0.5 text-xs text-muted">
            {slow
              ? "Still going. Anything that writes or scores content can take up to a minute."
              : "Hang on while this finishes."}
          </p>
        </div>
      </div>
    </div>
  );
}
