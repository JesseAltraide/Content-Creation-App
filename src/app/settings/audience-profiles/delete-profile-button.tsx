"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export default function DeleteProfileButton({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    const res = await fetch(`/api/audience-profiles/${profileId}`, { method: "DELETE" });
    setDeleting(false);
    if (!res.ok) {
      setError("In use by a request — can't delete.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="shrink-0 text-right">
      <Button variant="ghost" onClick={handleDelete} disabled={deleting} className="!text-danger">
        {deleting ? "Removing…" : "Remove"}
      </Button>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
