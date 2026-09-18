"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Plain links, not router.push. Client-side navigation has repeatedly failed to
// re-render server components in this app (the same reason the polling had to stop
// calling router.refresh and start reloading), and a filter chip that silently does
// nothing is worse than a full navigation. Links also make the filter shareable and
// give it real browser history.
export default function StatusFilter({
  counts,
  total,
}: {
  /** Status to number of requests, in the order they should appear. */
  counts: { status: string; label: string; count: number }[];
  total: number;
}) {
  const params = useSearchParams();
  const active = params.get("status");
  const tab = params.get("tab");

  // Keeps the tab, so filtering while looking at "Open for review" does not silently
  // drop you back into your own list.
  const href = (status: string | null) => {
    const next = new URLSearchParams();
    if (tab) next.set("tab", tab);
    if (status) next.set("status", status);
    const query = next.toString();
    return query ? `/?${query}` : "/";
  };

  const chip = (isActive: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${
      isActive
        ? "bg-accent text-accent-foreground"
        : "bg-background text-muted hover:text-foreground"
    }`;

  return (
    <div className="mt-4 flex flex-wrap items-center gap-1.5">
      <Link href={href(null)} prefetch={false} className={chip(!active)}>
        All {total}
      </Link>
      {counts.map((c) => (
        <Link
          key={c.status}
          href={href(c.status)}
          prefetch={false}
          className={chip(active === c.status)}
        >
          {c.label} {c.count}
        </Link>
      ))}
    </div>
  );
}
