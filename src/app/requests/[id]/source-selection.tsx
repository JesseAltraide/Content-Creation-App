"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SourceSelection({
  requestId,
  sources,
}: {
  requestId: string;
  sources: { id: string; url: string; title: string | null }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(sources.map((s) => s.id));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleContinue() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/requests/${requestId}/select-sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedSourceIds: selected }),
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
    <section className="mt-8 rounded-lg border border-neutral-200 p-4">
      <h2 className="text-sm font-semibold">Select sources to use</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Two or more is recommended for cross-referencing, but one is enough to proceed.
      </p>
      <ul className="mt-4 flex flex-col gap-2">
        {sources.map((s) => (
          <li key={s.id}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={() => toggle(s.id)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{s.title || s.url}</span>
                <span className="block truncate text-xs text-neutral-500">{s.url}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button
        onClick={handleContinue}
        disabled={submitting || selected.length === 0}
        className="mt-4 rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {submitting ? "Continuing…" : `Continue with ${selected.length} source(s)`}
      </button>
    </section>
  );
}
