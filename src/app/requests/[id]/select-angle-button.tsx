"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function SelectAngleButton({
  requestId,
  angleId,
}: {
  requestId: string;
  angleId: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/select-angle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ angleId }),
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
    <div className="mt-4">
      <Button onClick={handleSelect} disabled={submitting}>
        {submitting ? "Selecting…" : "Select this angle"}
      </Button>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
