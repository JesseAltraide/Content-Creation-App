"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// Full reload rather than router.refresh(), for the reason recorded against the
// polling fix: client-side navigation has repeatedly failed to re-render the server
// components on this page, and a button that appears to do nothing is worse than a
// slow one.
export default function UseVersionButton({
  requestId,
  channel,
  version,
  score,
}: {
  requestId: string;
  channel: string;
  version: number;
  score: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setBusy(true);
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
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("Could not switch version.");
      setBusy(false);
    }
  };

  return (
    <div className="mt-2">
      <Button variant="secondary" onClick={go} disabled={busy}>
        {busy ? "Switching..." : `Go back to the ${score}/100 version`}
      </Button>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
