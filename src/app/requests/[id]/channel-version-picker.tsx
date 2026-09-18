"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PASS_MARK } from "@/lib/channel-post-format";

export type ChannelVersion = {
  version: number;
  chosen: boolean;
  createdAt: string;
  score: number | null;
};

// Every version a channel has ever had is already in the database, and until now the
// only one reachable was whichever the workflow happened to mark chosen last. That is
// fine when each round improves on the one before it, which is exactly what this
// pipeline does not guarantee: LinkedIn on one live request went 88, 90, 88, 91, 77,
// and the 77 was the only text anybody could schedule.
//
// So the history is shown and the choice is handed over. Nothing is deleted or
// reordered by picking: chosen moves, and it can move back.
export default function ChannelVersionPicker({
  requestId,
  channel,
  versions,
  isOwner,
  pendingSendAt,
}: {
  requestId: string;
  channel: string;
  versions: ChannelVersion[];
  isOwner: boolean;
  /**
   * When this channel has a send still pending, its time. Switching cancels it,
   * because the scheduled row points at the post being replaced, so the author is
   * told before they click rather than discovering it in the queue afterwards.
   */
  pendingSendAt?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One version is not a history. Two or more is a choice worth offering.
  if (versions.length < 2) return null;

  const current = versions.find((v) => v.chosen);

  const use = async (version: number) => {
    setBusy(version);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/use-channel-version`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, version }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not switch version.");
        setBusy(null);
        return;
      }
      // Full reload rather than router.refresh(), for the reason recorded against the
      // polling fix: client navigation has repeatedly failed to re-render the server
      // components on this page.
      window.location.reload();
    } catch {
      setError("Could not switch version.");
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-muted hover:text-foreground"
      >
        {open ? "Hide" : "Show"} all {versions.length} versions
        {current ? ` (using version ${current.version}${current.score !== null ? `, ${current.score}/100` : ""})` : ""}
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-1.5">
          {versions.map((v) => {
            const schedulable = v.score !== null && v.score >= PASS_MARK;
            return (
              <div
                key={v.version}
                className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
                  v.chosen ? "border-accent bg-accent-soft" : "border-border"
                }`}
              >
                <div className="min-w-0">
                  <span className="font-medium">Version {v.version}</span>
                  <span className="ml-2 text-muted">
                    {v.score !== null ? `${v.score}/100` : "not scored"}
                    {/* Said plainly, because the score alone does not tell someone
                        whether picking this version gets them any closer to sending. */}
                    {v.score !== null && !schedulable ? ` · below the ${PASS_MARK} needed to schedule` : ""}
                  </span>
                </div>
                {v.chosen ? (
                  <span className="shrink-0 font-medium text-accent">In use</span>
                ) : (
                  isOwner && (
                    <Button
                      variant="secondary"
                      onClick={() => use(v.version)}
                      disabled={busy !== null}
                    >
                      {busy === v.version ? "Switching..." : "Use this one"}
                    </Button>
                  )
                )}
              </div>
            );
          })}
          {error && <p className="text-xs text-danger">{error}</p>}
          {pendingSendAt ? (
            <p className="text-xs text-warning">
              This channel is scheduled for{" "}
              {new Date(pendingSendAt).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              . Switching version cancels that, because the schedule points at the
              version being replaced. You will need to schedule the new one.
            </p>
          ) : null}
          <p className="text-xs text-muted">
            Switching only changes which version is up for scheduling and editing.
            Nothing is deleted, and you can switch back.
          </p>
        </div>
      )}
    </div>
  );
}
