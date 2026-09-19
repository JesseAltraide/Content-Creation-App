"use client";

import { useEffect } from "react";

// A send happens on a timer, not in response to anything the person did, so the page
// they are looking at has no idea it happened. Until it reloads, the queue still shows
// a Schedule form for a post that has already gone out, and scheduling it again is a
// second real delivery to real inboxes.
//
// The server refuses that, so this is not the only guard. It is the one that stops
// someone trying: the page catches up on its own within a few seconds of the send.
//
// Only mounted while a send is actually pending, so an idle request page polls nothing.
export default function PendingSendWatcher({
  requestId,
  renderedEventAt,
}: {
  requestId: string;
  /**
   * When the newest event was written, as of this render. A publish writes its own
   * event, so a change here means something happened even though the request's own
   * status may not have moved at all.
   */
  renderedEventAt: string | null;
}) {
  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      try {
        const res = await fetch(`/api/requests/${requestId}/status`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { latestEventAt: string | null };
        if (cancelled) return;
        if (body.latestEventAt && body.latestEventAt !== renderedEventAt) {
          // Full reload rather than router.refresh(), for the reason recorded against
          // the polling fix: client navigation has repeatedly failed to re-render the
          // server components on this page.
          window.location.reload();
        }
      } catch {
        // The next tick is seconds away, and the server refuses a double send anyway.
      }
    };

    // Every 15 seconds. The publish job runs every minute, so this catches a send
    // within a quarter of a minute of it happening without polling hard.
    const id = setInterval(check, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [requestId, renderedEventAt]);

  return null;
}
