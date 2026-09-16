import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import SourceSelection from "./source-selection";
import RetryButton from "./retry-button";
import DeleteButton from "./delete-button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";

const SOURCE_STATUS_STYLES: Record<string, string> = {
  scraped: "bg-success-soft text-success",
  scrape_failed: "bg-danger-soft text-danger",
  rejected: "bg-black/5 text-muted",
  selected: "bg-accent-soft text-accent",
  pending_selection: "bg-warning-soft text-warning",
};

export default async function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: req } = await supabase.from("requests").select("*").eq("id", id).single();
  if (!req) notFound();

  const { data: sources } = await supabase
    .from("sources")
    .select("*")
    .eq("request_id", id)
    .order("created_at");

  const { data: events } = await supabase
    .from("event_log")
    .select("*")
    .eq("request_id", id)
    .order("created_at", { ascending: false });

  const latestEvent = events?.[0];
  const canRetry = req.status === "researching" && latestEvent?.status === "failed";

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {req.raw_idea || req.primary_keyword}
        </h1>
        <StatusBadge status={req.status} />
      </div>

      <Card className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 p-5 text-sm">
        <dt className="text-muted">Path</dt>
        <dd className="text-right">{req.input_path === "raw_idea" ? "Raw idea" : "Source URL"}</dd>
        <dt className="text-muted">Primary keyword</dt>
        <dd className="text-right">{req.primary_keyword}</dd>
        <dt className="text-muted">Channels</dt>
        <dd className="text-right">{req.channels.join(", ")}</dd>
      </Card>

      {canRetry && (
        <Card className="mt-8 border-danger/20 bg-danger-soft p-5">
          <p className="text-sm font-medium text-danger">
            {latestEvent!.stage}: {latestEvent!.detail}
          </p>
          <p className="mt-1 text-xs text-danger/80">
            Nothing has progressed since — safe to retry from here.
          </p>
          <RetryButton requestId={id} />
        </Card>
      )}

      {req.status === "awaiting_source_selection" && (
        <SourceSelection
          requestId={id}
          sources={(sources ?? []).filter((s) => s.status === "pending_selection")}
        />
      )}

      {sources && sources.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted">Sources</h2>
          <Card className="mt-2 divide-y divide-border p-1">
            {sources.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="truncate text-sm text-foreground">{s.url}</span>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    SOURCE_STATUS_STYLES[s.status] ?? "bg-black/5 text-muted"
                  }`}
                >
                  {s.status.replace(/_/g, " ")}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-muted">Activity</h2>
        <Card className="mt-2 divide-y divide-border p-1">
          {(events ?? []).map((ev) => (
            <div key={ev.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className={`text-sm ${ev.status === "failed" ? "text-danger" : "text-foreground"}`}>
                {ev.stage}: {ev.detail}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {new Date(ev.created_at).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </Card>
      </section>

      <section className="mt-10 border-t border-border pt-6">
        <DeleteButton requestId={id} title={req.raw_idea || req.primary_keyword} />
      </section>
    </main>
  );
}
