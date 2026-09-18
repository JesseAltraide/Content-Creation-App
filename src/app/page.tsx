import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { REVIEWABLE_STATUSES } from "@/lib/request-access";

export default async function HomePage() {
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

      {(!requests || requests.length === 0) && (
        <Card className="mt-8 flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent">
            +
          </span>
          <p className="text-sm font-medium">No requests yet</p>
          <p className="text-sm text-muted">Start one from a raw idea or a source URL.</p>
        </Card>
      )}

      <ul className="mt-8 flex flex-col gap-3">
        {(requests ?? []).map((r) => (
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
                <StatusBadge status={r.status} />
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    
      {toReview && toReview.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-muted">Ready to schedule, from the team</h2>
          <p className="mt-1 text-xs text-muted">
            Final drafts from other people. You can read them and suggest improvements. Only the
            author can edit or schedule.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {toReview.map((r) => (
              <Link key={r.id} href={`/requests/${r.id}`}>
                <Card className="flex items-center justify-between gap-4 p-4 hover:border-accent">
                  <span className="min-w-0 truncate text-sm font-medium">
                    {r.raw_idea || r.primary_keyword}
                  </span>
                  <StatusBadge status={r.status} />
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

</main>
  );
}
