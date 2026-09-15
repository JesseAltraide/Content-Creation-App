import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";

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
    </main>
  );
}
