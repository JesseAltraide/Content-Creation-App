"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Two lists on one screen: your own work, and other people's work that has
// reached a reviewable stage. Tabs rather than stacked sections so the second
// list is not something you only find by scrolling past all of your own.
export default function RequestListTabs({
  mine,
  toReview,
  reviewCount,
  hasWorkInFlight,
}: {
  mine: React.ReactNode;
  toReview: React.ReactNode;
  reviewCount: number;
  /** Any request on this page currently mid-pipeline, so the badges will go stale. */
  hasWorkInFlight: boolean;
}) {
  const [tab, setTab] = useState<"mine" | "review">("mine");
  const router = useRouter();

  // These are server-rendered badges with no realtime subscription, so leaving this
  // page open while a run finishes showed a stale status indefinitely - you had to
  // know to reload. Polls only while something is actually in flight, and stops as
  // soon as the refresh brings back a page with nothing running.
  useEffect(() => {
    if (!hasWorkInFlight) return;
    const id = setInterval(() => router.refresh(), 10_000);
    return () => clearInterval(id);
  }, [hasWorkInFlight, router]);

  return (
    <div className="mt-8">
      <div className="flex gap-1 rounded-lg bg-background p-1">
        <button
          type="button"
          onClick={() => setTab("mine")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "mine" ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          My requests
        </button>
        <button
          type="button"
          onClick={() => setTab("review")}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            tab === "review" ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
          }`}
        >
          Open for review
          {reviewCount > 0 && (
            <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              {reviewCount}
            </span>
          )}
        </button>
      </div>

      <div className="mt-4">{tab === "mine" ? mine : toReview}</div>
    </div>
  );
}
