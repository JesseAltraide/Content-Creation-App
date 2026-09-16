import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: requests } = await supabase
    .from("requests")
    .select("id, raw_idea, primary_keyword, input_path, channels, status, created_at")
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
    </main>
  );
}
