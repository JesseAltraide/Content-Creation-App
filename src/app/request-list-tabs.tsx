"use client";

import { useEffect } from "react";
import Link from "next/link";
import { hardRefresh } from "@/lib/hard-refresh";

// Two lists on one screen: your own work, and other people's work that has
// reached a reviewable stage. Tabs rather than stacked sections so the second
// list is not something you only find by scrolling past all of your own.
export default function RequestListTabs({
  mine,
  toReview,
  reviewCount,
  hasWorkInFlight,
  activeTab,
  statusFilter,
}: {
  mine: React.ReactNode;
  toReview: React.ReactNode;
  reviewCount: number;
  /**
   * In the URL rather than in state, so the status chips above can count the list that
   * is actually on screen. They used to count both lists at once, which showed "All 2"
   * over a single visible request.
   */
  activeTab: "mine" | "review";
  /** Preserved when switching tabs, so a filtered view stays filtered. */
  statusFilter?: string;
  /** Any request on this page currently mid-pipeline, so the badges will go stale. */
  hasWorkInFlight: boolean;
}) {
  // These are server-rendered badges with no realtime subscription, so leaving this
  // page open while a run finishes showed a stale status indefinitely.
  //
  // Polls a digest of every id:status pair this page renders and reloads only when it
  // differs. The first version called router.refresh() on the same timer, which did
  // not reliably re-render the server component, so the badges stayed stale while the
  // polling ran happily every 10 seconds. Comparing first means a reload only happens
  // when something genuinely moved.
  useEffect(() => {
    if (!hasWorkInFlight) return;
    let cancelled = false;
    let seen: string | null = null;

    const check = async () => {
      try {
        const res = await fetch("/api/requests/statuses", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const { digest } = (await res.json()) as { digest: string };
        if (cancelled) return;
        if (seen === null) seen = digest;
        else if (digest !== seen) hardRefresh();
      } catch {
        // Next tick is 10 seconds away; a failed poll is not worth surfacing here.
      }
    };

    void check();
    const id = setInterval(check, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hasWorkInFlight]);

  const href = (tab: "mine" | "review") => {
    const params = new URLSearchParams();
    if (tab === "review") params.set("tab", "review");
    if (statusFilter) params.set("status", statusFilter);
    const query = params.toString();
    return query ? `/?${query}` : "/";
  };

  const tabClass = (isActive: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      isActive ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
    }`;

  return (
    <div className="mt-8">
      <div className="flex gap-1 rounded-lg bg-background p-1">
        <Link href={href("mine")} prefetch={false} className={tabClass(activeTab === "mine")}>
          My requests
        </Link>
        <Link
          href={href("review")}
          prefetch={false}
          className={`flex items-center gap-1.5 ${tabClass(activeTab === "review")}`}
        >
          Open for review
          {reviewCount > 0 && (
            <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              {reviewCount}
            </span>
          )}
        </Link>
      </div>

      <div className="mt-4">{activeTab === "mine" ? mine : toReview}</div>
    </div>
  );
}
