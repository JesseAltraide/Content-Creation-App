"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function DeleteButton({
  requestId,
  title,
}: {
  requestId: string;
  title: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}`, { method: "DELETE" });
    if (!res.ok) {
      setDeleting(false);
      setError("Failed to delete.");
      return;
    }
    // A hard navigation rather than push+refresh: the list has to be re-fetched
    // without the deleted request, and a client push can leave it showing.
    window.location.href = "/";
  }

  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)} className="!text-danger">
        Delete request
      </Button>
    );
  }

  return (
    <Card className="border-danger/20 bg-danger-soft p-4 text-sm">
      <p className="text-danger">
        Permanently delete <span className="font-medium">&ldquo;{title}&rdquo;</span>? This
        removes all its sources, angles, drafts, evaluations, and scheduled content. This
        can&apos;t be undone.
      </p>
      {error && <p className="mt-1 text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button variant="danger" onClick={handleDelete} disabled={deleting}>
          {deleting ? "Deleting…" : "Yes, delete permanently"}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)} disabled={deleting}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
