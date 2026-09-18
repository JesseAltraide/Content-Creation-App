import { createAdminClient } from "@/lib/supabase/admin";

// Some actions cannot be protected by the atomic conditional write used everywhere
// else, because they deliberately do not change the request's status: Retry
// re-pings the same webhook precisely so nothing has moved on (see retry/route.ts
// and Error #7). That makes them spam-clickable, and the cost is real rather than
// cosmetic - each extra Retry is another Tavily search, another set of Firecrawl
// scrapes and another chain of Claude calls, plus concurrent n8n runs writing over
// each other on the same request.
//
// The event log already records every trigger, so it doubles as the debounce:
// if the same action was fired moments ago, the click is a repeat rather than an
// intent. Disabling the button client-side is not enough on its own, since it only
// covers one tab and loses the race against a fast double click.
export async function firedRecently(
  requestId: string,
  stages: string[],
  withinMs: number
): Promise<boolean> {
  const admin = createAdminClient();
  const since = new Date(Date.now() - withinMs).toISOString();

  const { data } = await admin
    .from("event_log")
    .select("id")
    .eq("request_id", requestId)
    .in("stage", stages)
    .gt("created_at", since)
    .limit(1);

  return (data?.length ?? 0) > 0;
}
