import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { REVIEWABLE_STATUSES } from "@/lib/request-access";
import RequestListTabs from "./request-list-tabs";
import LinkPendingDot from "@/components/link-pending-dot";
import StatusFilter from "./status-filter";
import { Suspense } from "react";

// The statuses where n8n is mid-run and the badge on this page will change without
// anything the human does. Kept next to the only consumer rather than in a shared
// module: the request detail page derives its own from the banner it renders.
const WORKING_STATUSES = new Set(["researching", "generating", "adapting", "revising"]);

// Human-readable names for the filter chips, in pipeline order so the row reads as a
// journey rather than an alphabetical list. Anything not named here still gets a chip,
// falling back to its raw status, so a new status cannot silently become unfilterable.
const STATUS_ORDER: [string, string][] = [
  ["draft", "Draft"],
  ["researching", "Researching"],
  ["awaiting_source_selection", "Pick sources"],
  ["awaiting_angle_selection", "Pick angle"],
  ["generating", "Generating"],
  ["revising", "Revising"],
  ["pending_approval", "Review draft"],
  ["approved", "Approved"],
  ["adapting", "Adapting"],
  ["ready_to_schedule", "Ready to schedule"],
  ["needs_human_attention", "Needs attention"],
  ["rejected", "Rejected"],
];

function statusChips(rows: { status: string }[]): { status: string; label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);

  const known = STATUS_ORDER.filter(([status]) => counts.has(status)).map(([status, label]) => ({
    status,
    label,
    count: counts.get(status)!,
  }));
  const namedStatuses = new Set(STATUS_ORDER.map(([s]) => s));
  const unknown = [...counts.entries()]
    .filter(([status]) => !namedStatuses.has(status))
    .map(([status, count]) => ({ status, label: status.replace(/_/g, " "), count }));

  return [...known, ...unknown];
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; tab?: string }>;
}) {
  const { status: statusFilter, tab } = await searchParams;
  const activeTab: "mine" | "review" = tab === "review" ? "review" : "mine";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Requests are private to their creator (migration 007). Filtered here in the
  // query rather than left to RLS, because most reads in this app go through the
  // service-role client, which ignores policies entirely. Rows with a null owner
  // predate ownership and stay visible to everyone rather than vanishing.
  const { data: requests } = await supabase
    .from("requests")
    .select("id, raw_idea, primary_keyword, input_path, channels, status, created_at")
    .or(`user_id.eq.${user!.id},user_id.is.null`)
    .order("created_at", { ascending: false });

  // Without this nobody would ever discover a colleague's request to review it:
  // team-readable requests are not yours, so they are excluded from the list
  // above by design. Everything at a reviewable stage that belongs to someone
  // else shows up here instead (see REVIEWABLE_STATUSES).
  const { data: toReview } = await supabase
    .from("requests")
    .select("id, raw_idea, primary_keyword, status, created_at")
    .in("status", REVIEWABLE_STATUSES)
    .not("user_id", "is", null)
    .neq("user_id", user!.id)
    .order("created_at", { ascending: false });

  // Filtered in memory rather than in the query, so the chips can show how many are in
  // each status. These lists are small enough that a second round trip per chip would
  // cost more than it saves.
  const allMine = requests ?? [];
  const allToReview = toReview ?? [];
  const visibleMine = statusFilter ? allMine.filter((r) => r.status === statusFilter) : allMine;
  const visibleToReview = statusFilter
    ? allToReview.filter((r) => r.status === statusFilter)
    : allToReview;

  // The chips count the list that is actually on screen. Counting both at once showed
  // "All 2" above a single visible request, because the second was someone else's work
  // sitting in the other tab.
  const countedRows = activeTab === "review" ? allToReview : allMine;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Content requests</h1>
          <p className="mt-1 text-sm text-muted">Research, generate, review, publish.</p>
        </div>
        <Link href="/new">
          <Button>New request</Button>
        </Link>
      </div>

      {/* Suspense because useSearchParams opts a client component into deferred
          rendering; without it the whole page would have to be client-rendered. */}
      <Suspense fallback={<div className="mt-4 h-7" />}>
        <StatusFilter counts={statusChips(countedRows)} total={countedRows.length} />
      </Suspense>

      <RequestListTabs
        activeTab={activeTab}
        statusFilter={statusFilter}
        reviewCount={allToReview.length}
        hasWorkInFlight={[...allMine, ...allToReview].some((r) => WORKING_STATUSES.has(r.status))}
        mine={
          <>
            {visibleMine.length === 0 && (
              <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
                  +
                </span>
                <p className="text-sm font-medium">
                  {statusFilter ? "Nothing in that status" : "No requests yet"}
                </p>
                <p className="text-sm text-muted">
                  {statusFilter
                    ? `You have ${allMine.length} request${allMine.length === 1 ? "" : "s"} in other statuses. Pick "All" to see them.`
                    : "Start one from a raw idea or a source URL."}
                </p>
              </Card>
            )}

            <ul className="flex flex-col gap-3">
              {visibleMine.map((r) => (
                <li key={r.id}>
                  <Link href={`/requests/${r.id}`}>
                    <Card className="flex items-center justify-between gap-4 px-5 py-4 transition-shadow hover:shadow-md">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {r.raw_idea || r.primary_keyword}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          {r.input_path === "raw_idea" ? "Raw idea" : "Source URL"} ·{" "}
                          {r.channels.join(", ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <LinkPendingDot />
                        <StatusBadge status={r.status} />
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        }
        toReview={
          <>
            <p className="text-xs text-muted">
              Other people&apos;s work that has reached review: awaiting approval, or ready to
              schedule. You can read it and suggest improvements. Only the author can edit or
              schedule.
            </p>

            {visibleToReview.length === 0 && (
              <Card className="mt-3 flex flex-col items-center gap-2 px-6 py-16 text-center">
                <p className="text-sm font-medium">
                  {statusFilter ? "Nothing to review in that status" : "Nothing to review right now"}
                </p>
                <p className="text-sm text-muted">
                  {statusFilter
                    ? `Pick "All" to see the ${allToReview.length} open for review.`
                    : "Other people's requests show up here once they reach approval or scheduling."}
                </p>
              </Card>
            )}

            <div className="mt-3 flex flex-col gap-2">
              {visibleToReview.map((r) => (
                <Link key={r.id} href={`/requests/${r.id}`}>
                  <Card className="flex items-center justify-between gap-4 p-4 hover:border-accent">
                    <span className="min-w-0 truncate text-sm font-medium">
                      {r.raw_idea || r.primary_keyword}
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <LinkPendingDot />
                      <StatusBadge status={r.status} />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        }
      />

    </main>
  );
}
