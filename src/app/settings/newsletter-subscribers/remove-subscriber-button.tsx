"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function RemoveSubscriberButton({ subscriberId }: { subscriberId: string }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleRemove() {
    setSubmitting(true);
    try {
      await fetch(`/api/newsletter-subscribers/${subscriberId}`, { method: "DELETE" });
      router.refresh();
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
