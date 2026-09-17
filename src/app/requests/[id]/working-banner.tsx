"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// These are exactly the statuses Next.js sets right before firing an after()
// trigger (see retry/route.ts, select-angle/route.ts, approve/route.ts) - the
// webhook runs in the background for real minutes with nothing else on the page
// to show for it until the *next* status change or a new event lands. Without
// this, the page looks identical before and after clicking retry/approve/select,
// which is exactly what got a genuinely-still-running request deleted as "broken".
const WORKING_MESSAGES: Record<string, string> = {
  researching: "Researching and proposing an angle",
  generating: "Writing and evaluating the draft",
  adapting: "Adapting to channels and running evaluation",
};

export default function WorkingBanner({
  requestId,
  status,
  stalled,
}: {
  requestId: string;
  status: string;
  stalled: boolean;
}) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  // A trigger status alone doesn't mean work is still happening: these statuses
  // are set before the webhook fires and nothing sets them back if the run dies.
  // Caught live - Workflow A crashed on a duplicate-source insert, logged the
  // failure immediately, and this banner still cheerfully counted to 5 minutes
  // telling the human to be patient. `stalled` comes from the latest event
  // actually being a dead failure (see page.tsx).
  const label = stalled ? undefined : WORKING_MESSAGES[status];

  // Push-based, not polling: subscribes to the two things that can actually mean
  // "something happened" for this request - the row's own status changing, or a
  // new event_log entry landing for it (a failed trigger doesn't always change
  // status, e.g. a webhook erroring before n8n even runs - see retry/route.ts).
  // Only refreshes on a real change instead of re-fetching on a timer regardless.
  useEffect(() => {
    if (!label) return;
    setElapsed(0);
    const tickId = setInterval(() => setElapsed((s) => s + 1), 1000);

    const supabase = createClient();
    const channel = supabase
      .channel(`request-${requestId}-working`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "requests", filter: `id=eq.${requestId}` },
        () => router.refresh()
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "event_log", filter: `request_id=eq.${requestId}` },
        () => router.refresh()
      )
      .subscribe();

    return () => {
      clearInterval(tickId);
      supabase.removeChannel(channel);
    };
    // `stalled` is a dependency too: when a retry clears it, this has to re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, requestId, stalled]);

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
