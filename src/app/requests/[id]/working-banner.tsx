"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// These are exactly the statuses Next.js sets right before firing an after()
// trigger (see retry/route.ts, select-angle/route.ts, approve/route.ts) - the
// webhook runs in the background for real minutes with nothing else on the page
// to show for it until the *next* status change or a new row appears. Without
// this, the page looks identical before and after clicking retry/approve/select,
// which is exactly what got a genuinely-still-running request deleted as "broken".
const WORKING_MESSAGES: Record<string, string> = {
  researching: "Researching and proposing an angle",
  generating: "Writing and evaluating the draft",
  adapting: "Adapting to channels and running evaluation",
};

const POLL_INTERVAL_MS = 5000;

export default function WorkingBanner({ status }: { status: string }) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const label = WORKING_MESSAGES[status];

  useEffect(() => {
    if (!label) return;
    setElapsed(0);
    const pollId = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
    const tickId = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => {
      clearInterval(pollId);
      clearInterval(tickId);
    };
    // Restart the elapsed clock (but not the "have we ever shown this" logic) each
    // time we land on a genuinely new working status, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (!label) return null;

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const elapsedText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  return (
    <div
      role="status"
      className="mt-4 flex items-center gap-3 rounded-xl border border-accent/20 bg-accent-soft px-4 py-3"
    >
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      <div className="text-sm text-accent">
        <p className="font-medium">
          {label} — this page updates itself automatically, no need to refresh.
        </p>
        <p className="mt-0.5 text-xs text-accent/80">
          Working for {elapsedText}. This can genuinely take a few minutes — a long wait on its
          own doesn&apos;t mean anything broke, and deleting the request won&apos;t stop it (the
          work is running on n8n&apos;s side, independent of this page).
        </p>
      </div>
    </div>
  );
}
