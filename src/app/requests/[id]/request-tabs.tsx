"use client";

import { useState } from "react";

export type TabKey =
  | "angle"
  | "draft"
  | "linkedin"
  | "x"
  | "newsletter"
  | "schedule"
  | "sources";

// The request page grew long enough that reaching the publishing queue meant
// scrolling past the full article, three channel previews and every evaluation
// breakdown. Tabs split it without hiding anything that matters: the status badge,
// pipeline bar and every error/working banner stay pinned above this strip in
// page.tsx, so a failure can never end up behind an unselected tab.
export default function RequestTabs({
  tabs,
  panels,
}: {
  tabs: { key: TabKey; label: string; badge?: string; tone?: "danger" | "success" }[];
  panels: Record<string, React.ReactNode>;
}) {
  const [active, setActive] = useState<TabKey>(tabs[0]?.key ?? "draft");
  // A tab that disappears (a channel that hasn't been adapted yet) must not leave
  // the panel area blank.
  const current = tabs.some((t) => t.key === active) ? active : tabs[0]?.key;

  if (tabs.length === 0) return null;

  return (
    <section className="mt-8">
      <div className="flex gap-1 overflow-x-auto rounded-lg bg-background p-1">
        {tabs.map((tab) => {
          const isActive = tab.key === current;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {tab.label}
              {tab.badge && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    tab.tone === "danger"
                      ? "bg-danger-soft text-danger"
                      : tab.tone === "success"
                        ? "bg-success-soft text-success"
                        : "bg-black/5 text-muted"
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4">{current ? panels[current] : null}</div>
    </section>
  );
}
