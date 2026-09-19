"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { hardRefresh } from "@/lib/hard-refresh";

export default function BackToAngleSelectionButton({
  requestId,
  hasPassingDraft,
  otherAngles,
}: {
  requestId: string;
  /** From pending_approval there is a real draft to lose, so it asks first. */
  hasPassingDraft?: boolean;
  /** Angles other than the one already generated from, so the offer is honest. */
  otherAngles?: number;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/back-to-angle-selection`, {
      method: "POST",
    });
    const body = await res.json();
    setSubmitting(false);
    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    // Not router.refresh(): client navigation has repeatedly failed to re-render
    // the server components on this page, which shows up as an action that
    // appears to do nothing. Same reason the polling and the source picker
    // reload outright.
    hardRefresh();
  }

  if (hasPassingDraft && !confirming) {
    return (
      <div className="mt-3">
        <Button variant="secondary" onClick={() => setConfirming(true)} disabled={submitting}>
          Try a different angle
        </Button>
        {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3">
      {hasPassingDraft && (
        <p className="mb-2 text-sm text-warning">
          This goes back to the angle list and the current draft stops being the one under
          review. The draft is not deleted and nothing else is lost.{" "}
          {otherAngles
            ? `There ${otherAngles === 1 ? "is 1 other angle" : `are ${otherAngles} other angles`} to choose from. Picking a different one costs nothing; re-picking the same one spends a regeneration.`
            : "There are no other angles proposed, so you would be re-picking the same one, which spends a regeneration."}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button onClick={handleClick} disabled={submitting}>
          {submitting ? "Going back…" : hasPassingDraft ? "Yes, back to the angles" : "Try a different angle"}
        </Button>
        {hasPassingDraft && (
          <Button variant="ghost" onClick={() => setConfirming(false)} disabled={submitting}>
            Cancel
          </Button>
        )}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  );
}
