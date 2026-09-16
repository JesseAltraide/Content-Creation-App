"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function DeleteButton({
  requestId,
  title,
}: {
  requestId: string;
  title: string;
}) {
  const router = useRouter();
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
    router.push("/");
    router.refresh();
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-md px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
      >
        Delete request
      </button>
    );
  }

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
      <p className="text-red-800">
        Permanently delete <span className="font-medium">&ldquo;{title}&rdquo;</span>? This
        removes all its sources, angles, drafts, evaluations, and scheduled content. This
        can&apos;t be undone.
      </p>
      {error && <p className="mt-1 text-red-600">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {deleting ? "Deleting…" : "Yes, delete permanently"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={deleting}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
