"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import CopyLinkButton from "@/components/copy-link-button";
import { assessSourceUrl, blockSourceUrl } from "@/lib/source-quality";

export default function SourceSelection({
  requestId,
  sources,
}: {
  requestId: string;
  sources: { id: string; url: string; title: string | null }[];
}) {
  const [selected, setSelected] = useState<string[]>(sources.map((s) => s.id));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Judged from the URL because that is all that exists at this point: scraped_text
  // is not written until after this selection is made, so nothing about the page body
  // can be checked at the moment the human is actually choosing.
  const issues = new Map(sources.map((s) => [s.id, assessSourceUrl(s.url)]));
  // The server refuses these outright, so offering them as a choice sets the human up
  // to pick one and be told no. Caught live: a search returned two http:// results
  // among eight, and continuing failed with a 400 that was easy to miss.
  const blocked = new Map(sources.map((s) => [s.id, blockSourceUrl(s.url)]));
  const weakSelected = selected.filter((id) => issues.get(id)?.severity === "weak").length;

  function toggle(id: string) {
    if (blocked.get(id)) return;
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
    // Not router.refresh(). Client navigation has repeatedly failed to re-render the
    // server components on this page (the same reason the polling had to stop using
    // it), and here that reads as the button saying "Continuing" and nothing else
    // happening, which is exactly how this was reported.
    window.location.reload();
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
                disabled={!!blocked.get(s.id)}
                className="mt-1 h-4 w-4 accent-accent disabled:cursor-not-allowed disabled:opacity-40"
              />
              {/* min-w-0 is load-bearing: a flex child defaults to min-width:auto, so
                  without it this span can't shrink below its content and the long
                  URL pushes the whole card wider than the page instead of truncating. */}
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{s.title || s.url}</span>
                {blocked.get(s.id) && (
                  <span className="mt-0.5 block text-xs text-danger">
                    Can&apos;t be fetched: {blocked.get(s.id)}
                  </span>
                )}
                {!blocked.get(s.id) && issues.get(s.id) && (
                  <span
                    className={`mt-0.5 block text-xs ${
                      issues.get(s.id)!.severity === "weak" ? "text-danger" : "text-warning"
                    }`}
                  >
                    {issues.get(s.id)!.label}: {issues.get(s.id)!.message}
                  </span>
                )}
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
      {weakSelected > 0 && (
        <p className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-xs text-warning">
          {weakSelected} of the sources you have selected {weakSelected === 1 ? "is" : "are"} unlikely
          to yield quotable text. You can still continue, but the draft will lean on whatever is
          left, and claims drawn from these are usually the ones that end up undateable or unverifiable.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <Button onClick={handleContinue} disabled={submitting || selected.length === 0} className="mt-4">
        {submitting ? "Continuing…" : `Continue with ${selected.length} source(s)`}
      </Button>
    </Card>
  );
}
