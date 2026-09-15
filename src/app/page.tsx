import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: requests } = await supabase
    .from("requests")
    .select("id, raw_idea, primary_keyword, status, created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Content requests</h1>
        <Link
          href="/new"
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
        >
          New request
        </Link>
      </div>

      {(!requests || requests.length === 0) && (
        <p className="mt-8 text-sm text-neutral-500">
          No requests yet. Start one from a raw idea or a source URL.
        </p>
      )}

      <ul className="mt-8 flex flex-col divide-y divide-neutral-200">
        {(requests ?? []).map((r) => (
          <li key={r.id}>
            <Link href={`/requests/${r.id}`} className="flex items-center justify-between py-3">
              <span className="text-sm font-medium">{r.raw_idea || r.primary_keyword}</span>
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide text-neutral-600">
                {r.status.replace(/_/g, " ")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
