"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

function localInputValue(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function ScheduleChannelForm({
  requestId,
  channel,
  hasPendingSchedule,
}: {
  requestId: string;
  channel: "linkedin" | "x" | "newsletter";
  hasPendingSchedule: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  // datetime-local wants local wall-clock time, not an ISO/UTC string, so the offset
  // has to be subtracted before slicing. Without that, anyone west of UTC gets a min
  // in the future and anyone east gets one in the past.
  const [minValue, setMinValue] = useState(() => localInputValue(new Date()));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A page left open drifts: a min computed at render is stale an hour later, and the
  // picker would happily offer a slot that has since passed. Cheap enough to keep
  // current, and it costs nothing when the form is idle.
  useEffect(() => {
    const id = setInterval(() => setMinValue(localInputValue(new Date())), 30_000);
    return () => clearInterval(id);
  }, []);

  async function handleSchedule() {
    if (!value) {
      setError("Pick a date and time.");
      return;
    }
    // `min` is advisory: browsers vary on whether a typed (rather than picked) value
    // is rejected, and it is trivially removed from the DOM. This is the real client
    // guard, and the schedule route rejects a past time again server-side regardless
    // of what arrives.
    if (new Date(value).getTime() <= Date.now()) {
      setError("That time has already passed. Pick a time in the future.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, scheduledFor: new Date(value).toISOString() }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUnschedule() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/unschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          value={value}
          min={minValue}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <Button onClick={handleSchedule} disabled={submitting}>
          {submitting ? "Saving…" : hasPendingSchedule ? "Reschedule" : "Schedule"}
        </Button>
        {hasPendingSchedule && (
          <Button variant="ghost" onClick={handleUnschedule} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">
        Times are in your own timezone. Only times from now onwards can be chosen. Sending is checked once a day at 06:00 UTC, so this is the earliest it goes out rather than the exact moment.
      </p>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
