"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import ResetStalledButton from "./reset-stalled-button";

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
  quiet,
  canReset,
  renderedEventAt,
  visibleRound,
}: {
  requestId: string;
  status: string;
  stalled: boolean;
  /**
   * Version of the newest draft currently rendered below this banner, or null when
   * there is nothing to read yet. Workflow B writes each round to the database as it
   * finishes it, so a complete, finished-looking draft sits under this spinner while
   * the next round is still being written. Caught live: a v2 draft was on screen and
   * fully readable at 19:00, the banner said "writing the draft", and nothing said
   * the two were talking about different rounds.
   */
  visibleRound?: number | null;
  /** Nothing has been logged for this request in a while - see page.tsx. */
  quiet: boolean;
  /** Reviewers watch; only the author can reset a run. */
  canReset?: boolean;
  /**
   * When the newest event on this request was written, as of this render. Compared
   * against the polled value so a failure logged WITHOUT a status change (a trigger
   * failure, a gateway timeout) still counts as something worth reloading for.
   */
  renderedEventAt?: string | null;
}) {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  // The poll is the only thing keeping this page current, and it used to fail in
  // total silence: a 401 from an expired session, and every subsequent request went
  // into the same empty catch while the banner kept promising the page updates
  // itself. Three consecutive failures is 30 seconds, long enough that a single
  // blip or a sleeping laptop does not raise it.
  const [pollBroken, setPollBroken] = useState(false);
  const failuresRef = useRef(0);
  // Initialised in the effect, not here: Date.now() during render is impure.
  const startedAtRef = useRef(0);
  // A trigger status alone doesn't mean work is still happening: these statuses
  // are set before the webhook fires and nothing sets them back if the run dies.
  // Caught live - Workflow A crashed on a duplicate-source insert, logged the
  // failure immediately, and this banner still cheerfully counted to 5 minutes
  // telling the human to be patient. `stalled` comes from the latest event
  // actually being a dead failure (see page.tsx).
  const label = stalled ? undefined : WORKING_MESSAGES[status];

  // Keeps the page current while a stage is running, by polling and also
  // subscribing to the two things that mean "something happened" for this request:
  // the row's own status changing, or a new event_log entry landing for it (a
  // failed trigger does not always change status, e.g. a webhook erroring before
  // n8n even runs - see retry/route.ts). Refreshing only re-renders the page; it
  // never re-triggers the pipeline.
  useEffect(() => {
    if (!label) return;
    // Elapsed is derived from a start timestamp rather than reset via setState in
    // the effect body, which triggers a cascading render (and an eslint error).
    startedAtRef.current = Date.now();
    const tickId = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      1000
    );

    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | undefined;
    let cancelled = false;
    let fallbackId: ReturnType<typeof setInterval> | undefined;

    // Realtime is an accelerator here, not the mechanism. It has twice reported
    // SUBSCRIBED in a real browser session and then delivered nothing, which the
    // previous safety net did not catch because it only reacted to an UNHEALTHY
    // socket (CHANNEL_ERROR, TIMED_OUT, never connecting). A socket that connects
    // and stays silent looked fine and left the page frozen until a manual reload.
    //
    // So the poll now runs unconditionally while work is in flight, and realtime
    // just makes the update land sooner when it happens to work. One request every
    // 10s, only on this page, only while a stage is actually running: cheaper than
    // making someone reload to find out whether their pipeline finished.
    const POLL_MS = 10_000;

    // Ask what the status IS, and reload only when it differs from what is rendered.
    //
    // This used to call router.refresh() on the same timer, which did not reliably
    // re-render the server component: a run would finish, the database would be
    // correct, and the page would keep saying "adapting" until someone reloaded by
    // hand. Polling that changes nothing is worse than no polling, because it looks
    // like it is working. A reload is heavy, so it only happens on a real change.
    const checkForChange = async () => {
      const failed = () => {
        if (cancelled) return;
        failuresRef.current += 1;
        if (failuresRef.current >= 3) setPollBroken(true);
      };

      try {
        const res = await fetch(`/api/requests/${requestId}/status`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          failed();
          return;
        }
        const body = (await res.json()) as { status: string | null; latestEventAt: string | null };
        if (cancelled) return;
        failuresRef.current = 0;
        setPollBroken(false);
        const changed =
          (body.status && body.status !== status) ||
          (body.latestEventAt && body.latestEventAt !== renderedEventAt);
        if (changed) window.location.reload();
      } catch {
        // Surfaced rather than swallowed. A poll that has stopped working is the
        // same defect as the router.refresh() era: the page looks like it is
        // keeping itself current and is in fact frozen.
        failed();
      }
    };
    fallbackId = setInterval(checkForChange, POLL_MS);

    // The access token has to reach the realtime socket BEFORE subscribing.
    // postgres_changes enforces RLS, and this project's policies require
    // auth.role() = 'authenticated' - so a socket that connects on the bare anon
    // key has every event silently filtered out. It still reports SUBSCRIBED,
    // which is exactly why this was invisible: confirmed by diagnostic, the same
    // subscription delivers on the service-role key and delivers nothing on the
    // anon key. The browser client reads its session from cookies asynchronously,
    // so awaiting it here is what makes the difference.
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);

      // Unique per mount: a reused channel name whose previous instance hasn't
      // finished being removed can fail to attach, and removeChannel is async.
      channel = supabase
        .channel(`request-${requestId}-working-${Math.random().toString(36).slice(2)}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "requests", filter: `id=eq.${requestId}` },
          () => void checkForChange()
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "event_log", filter: `request_id=eq.${requestId}` },
          () => void checkForChange()
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      clearInterval(tickId);
      if (fallbackId) clearInterval(fallbackId);
      if (channel) supabase.removeChannel(channel);
    };
    // `stalled` is a dependency too: when a retry clears it, this has to re-subscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, requestId, stalled]);

  if (!label) return null;

  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const elapsedText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  // Deliberately does not claim the work is running once it's gone quiet: this app
  // has no liveness signal from n8n, so "still working" is an inference from a
  // status field, never an observation. Saying otherwise is what made an offline
  // n8n look like a healthy long-running job.
  if (quiet) {
    return (
      <div
        role="status"
        className="mt-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3"
      >
        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-white">
          !
        </span>
        <div className="text-sm text-warning">
          <p className="font-medium">{label}, but nothing has reported back in a while.</p>
          <p className="mt-0.5 text-xs text-warning/90">
            Something is probably down. We advise you try again later.
          </p>
          {/* Without this the request sits claiming to be busy forever: a run that dies
              inside n8n without reaching one of its own handlers logs nothing, and the
              status is all the UI has to go on. Caught live at 'adapting' for nearly
              two hours with no channel posts and no events. */}
          {canReset && <ResetStalledButton requestId={requestId} />}
        </div>
      </div>
    );
  }

  // The poll has stopped answering, so the promise that this page keeps itself
  // current is no longer true. Saying so is the whole point: the work may well be
  // finished already and this tab would never find out.
  if (pollBroken) {
    return (
      <div
        role="status"
        className="mt-4 flex items-start gap-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-3"
      >
        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-warning text-[10px] font-bold text-white">
          !
        </span>
        <div className="text-sm text-warning">
          <p className="font-medium">{label}, but this page has stopped checking for updates.</p>
          <p className="mt-0.5 text-xs text-warning/90">
            The run itself is unaffected and may already have finished. Your session may
            simply have expired in this tab. Refresh to see where it actually is.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-white"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="mt-4 flex items-center gap-3 rounded-xl border border-accent/20 bg-accent-soft px-4 py-3"
    >
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      <div className="text-sm text-accent">
        <p className="font-medium">
          {label}. This page updates itself automatically, no need to refresh.
        </p>
        {/* Named explicitly, because a finished-looking draft under a "writing the
            draft" spinner reads as a system that has hung rather than one that is
            on its next round. */}
        {typeof visibleRound === "number" && (
          <p className="mt-0.5 text-xs font-medium text-accent">
            The draft below is round {visibleRound} and is complete. It is being revised
            now, and will be replaced once the next round has been evaluated.
          </p>
        )}
        <p className="mt-0.5 text-xs text-accent/80">
          Working for {elapsedText}. This stage can take a few minutes, so a wait on its own
          doesn&apos;t mean anything broke. If nothing reports back within 5 minutes,
          this turns into a warning rather than leaving you guessing.
        </p>
      </div>
    </div>
  );
}
