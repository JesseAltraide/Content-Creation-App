"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSchedule() {
    if (!value) {
      setError("Pick a date and time.");
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
      setError(err instanceof Error ? err.message : "Network error - please try again.");
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
      setError(err instanceof Error ? err.message : "Network error - please try again.");
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
          onChange={(e) => setValue(e.target.value)}
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
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
