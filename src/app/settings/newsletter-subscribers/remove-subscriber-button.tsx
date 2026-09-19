"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { hardRefresh } from "@/lib/hard-refresh";

export default function RemoveSubscriberButton({ subscriberId }: { subscriberId: string }) {
  const [submitting, setSubmitting] = useState(false);

  async function handleRemove() {
    setSubmitting(true);
    try {
      await fetch(`/api/newsletter-subscribers/${subscriberId}`, { method: "DELETE" });
      hardRefresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Button variant="ghost" onClick={handleRemove} disabled={submitting}>
      Remove
    </Button>
  );
}
