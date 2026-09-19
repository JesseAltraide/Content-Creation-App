"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { hardRefresh } from "@/lib/hard-refresh";

export type DraftVersion = {
  /** The row id: version numbers restart at 1 when an angle is re-picked. */
  id: string;
  version: number;
  score: number | null;
  chosen: boolean;
};

// The same picker the channel posts have, for the article itself. Regenerating kept
// producing drafts and showing whichever was newest, so a regeneration that scored
// worse replaced a better draft and the better one became unreachable.
export default function DraftVersionPicker({
  requestId,
  versions,
  isOwner,
}: {
  requestId: string;
  versions: DraftVersion[];
  isOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One draft is not a history.
  if (versions.length < 2) return null;

  const current = versions.find((v) => v.chosen);

  const use = async (sectionId: string) => {
    setBusy(sectionId);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/use-draft-version`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not switch draft.");
        setBusy(null);
        return;
      }
      hardRefresh();
    } catch {
      setError("Could not switch draft.");
      setBusy(null);
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-muted hover:text-foreground"
      >
        {open ? "Hide" : "Show"} all {versions.length} drafts
        {current
          ? ` (showing version ${current.version}${current.score !== null ? `, ${current.score}/100` : ""})`
          : ""}
      </button>

      {open && (
        <div className="mt-2 flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {versions.map((v) => (
            <div
              key={v.id}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
                v.chosen ? "border-accent bg-accent-soft" : "border-border"
              }`}
            >
              <span className="min-w-0">
                <span className="font-medium">Version {v.version}</span>
                <span className="ml-2 text-muted">
                  {v.score !== null ? `${v.score}/100` : "not scored"}
                </span>
              </span>
              {v.chosen ? (
                <span className="shrink-0 font-medium text-accent">Showing</span>
              ) : (
                isOwner && (
                  <Button variant="secondary" onClick={() => use(v.id)} disabled={busy !== null}>
                    {busy === v.id ? "Switching..." : "Use this one"}
                  </Button>
                )
              )}
            </div>
          ))}
          {error && <p className="text-xs text-danger">{error}</p>}
          <p className="text-xs text-muted">
            The highest-scoring draft is shown by default. Switching only changes which
            one is up for approval; nothing is deleted, and you can switch back.
          </p>
        </div>
      )}
    </div>
  );
}
