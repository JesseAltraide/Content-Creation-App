import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import SourceSelection from "./source-selection";
import RetryButton from "./retry-button";
import DeleteButton from "./delete-button";

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {req.raw_idea || req.primary_keyword}
        </h1>
        <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium uppercase tracking-wide text-neutral-600">
          {req.status.replace(/_/g, " ")}
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">Path</dt>
        <dd>{req.input_path === "raw_idea" ? "Raw idea" : "Source URL"}</dd>
        <dt className="text-neutral-500">Primary keyword</dt>
        <dd>{req.primary_keyword}</dd>
        <dt className="text-neutral-500">Channels</dt>
        <dd>{req.channels.join(", ")}</dd>
      </dl>

      {canRetry && (
        <section className="mt-8 rounded-lg border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-700">
            {latestEvent!.stage}: {latestEvent!.detail}
          </p>
          <p className="mt-1 text-xs text-red-600">
            Nothing has progressed since — safe to retry from here.
          </p>
          <RetryButton requestId={id} />
        </section>
      )}

      {req.status === "awaiting_source_selection" && (
        <SourceSelection
          requestId={id}
          sources={(sources ?? []).filter((s) => s.status === "pending_selection")}
        />
      )}

      {sources && sources.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold">Sources</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-neutral-700">{s.url}</span>
                <span className="text-xs text-neutral-500">{s.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Activity</h2>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {(events ?? []).map((ev) => (
            <li key={ev.id} className="flex items-center justify-between gap-2">
              <span className={ev.status === "failed" ? "text-red-600" : "text-neutral-700"}>
                {ev.stage}: {ev.detail}
              </span>
              <span className="text-xs text-neutral-400">
                {new Date(ev.created_at).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 border-t border-neutral-200 pt-6">
        <DeleteButton requestId={id} title={req.raw_idea || req.primary_keyword} />
      </section>
    </main>
  );
}
