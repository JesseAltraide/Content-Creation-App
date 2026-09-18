"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import CopyLinkButton from "@/components/copy-link-button";

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
    <Card className="mt-8 p-5">
      <h2 className="text-sm font-semibold">Select sources to use</h2>
      <p className="mt-1 text-xs text-muted">
        Two or more is recommended for cross-referencing, but one is enough to proceed.
      </p>
      <ul className="mt-4 flex flex-col gap-1">
        {sources.map((s) => (
          <li key={s.id}>
            <label className="flex items-start gap-3 rounded-lg px-2 py-2 text-sm hover:bg-background">
              <input
                type="checkbox"
                checked={selected.includes(s.id)}
                onChange={() => toggle(s.id)}
                className="mt-1 h-4 w-4 accent-accent"
              />
              {/* min-w-0 is load-bearing: a flex child defaults to min-width:auto, so
                  without it this span can't shrink below its content and the long
                  URL pushes the whole card wider than the page instead of truncating. */}
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{s.title || s.url}</span>
                <span className="flex items-center gap-1.5">
                  {/* stopPropagation: this sits inside the <label>, so a plain click
                      would toggle the checkbox instead of opening the source. */}
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 truncate text-xs text-muted underline decoration-border underline-offset-2 hover:text-foreground"
                    title={s.url}
                  >
                    {s.url}
                  </a>
                  <span onClick={(e) => e.stopPropagation()}>
                    <CopyLinkButton url={s.url} />
                  </span>
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <Button onClick={handleContinue} disabled={submitting || selected.length === 0} className="mt-4">
        {submitting ? "Continuing…" : `Continue with ${selected.length} source(s)`}
      </Button>
    </Card>
  );
}
