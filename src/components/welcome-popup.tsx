"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Profile = { name: string; description: string };

// Shown once to someone who has never created a request. A new writer otherwise
// starts with no idea who they are writing for, then finds out only when the
// resonance gate rejects their first idea, or worse, when the evaluator marks
// their draft down on Audience Fit. Telling them up front is cheaper than either.
export default function WelcomePopup({
  profiles,
  toneChannels,
}: {
  profiles: Profile[];
  toneChannels: string[];
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  if (hidden) return null;

  async function dismiss() {
    setBusy(true);
    setHidden(true);
    await fetch("/api/welcome-seen", { method: "POST" });
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold tracking-tight">Who you&apos;re writing for</h2>
        <p className="mt-1 text-sm text-muted">
          Everything you create here is written and graded against the workspace audience and
          tone. Worth a look before your first request.
        </p>

        <div className="mt-4 flex flex-col gap-3">
          {profiles.map((p) => (
            <div key={p.name} className="rounded-lg bg-background p-3">
              <p className="text-sm font-medium">{p.name}</p>
              <p className="mt-1 text-sm text-muted">{p.description}</p>
            </div>
          ))}

          {profiles.length === 0 && (
            <div className="rounded-lg bg-background p-3">
              <p className="text-sm text-muted">
                No audience profile has been set up yet, so generation is blocked until the
                content manager adds one.
              </p>
            </div>
          )}

          <div className="rounded-lg bg-background p-3">
            <p className="text-sm font-medium">Tone</p>
            <p className="mt-1 text-sm text-muted">
              {toneChannels.length > 0
                ? `Derived from real previous posts for ${toneChannels.join(", ")}. Drafts are written in that voice and scored against it.`
                : "No tone samples on file yet, so drafts fall back to a neutral default."}
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">
          An idea that has no clear connection to this audience is rejected before any research
          runs, so it is worth saying in the idea itself how your topic relates to them.
        </p>

        <div className="mt-5">
          <Button onClick={dismiss} disabled={busy}>
            {busy ? "Closing…" : "Got it"}
          </Button>
        </div>
      </div>
    </div>
  );
}
