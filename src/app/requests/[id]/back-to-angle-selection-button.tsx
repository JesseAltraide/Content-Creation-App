"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function BackToAngleSelectionButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
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
    router.refresh();
  }

  return (
    <div className="mt-3 flex items-center gap-3">
      <Button onClick={handleClick} disabled={submitting}>
        {submitting ? "Going back…" : "Try a different angle"}
      </Button>
      {error && <span className="text-sm text-danger">{error}</span>}
    </div>
  );
}
