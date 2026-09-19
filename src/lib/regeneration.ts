import { createAdminClient } from "@/lib/supabase/admin";

// One cap, one place. This was duplicated between the regenerate route and the
// review-actions UI, and select-angle now needs it too: a re-pick of an angle that
// has already been generated against spends an attempt from the same budget, since
// it costs exactly the same work as pressing Regenerate.
export const REGENERATION_CAP = 5;

/**
 * How many times a human has already asked for this thing to be made again.
 *
 * Counted from the event log rather than a column, because the obvious column does
 * not work: channel posts are versioned per adaptation RUN and restart at 1 every
 * time, so "current.version >= 8" never binds once adaptation has been retried. A
 * channel sat on nine posts with the cap untouched.
 *
 * Every form of regeneration draws on the same budget of five, whatever it is called
 * in the interface: regenerating the article, re-picking an angle already generated
 * from, retrying adaptation, and rewriting a channel post against the suggestions.
 * They cost roughly the same and they are the same decision, so counting them
 * separately just means five of each.
 */
export async function countHumanRegenerations(
  requestId: string,
  kind: "adaptation" | { channel: string }
): Promise<number> {
  const admin = createAdminClient();

  if (kind === "adaptation") {
    const { count } = await admin
      .from("event_log")
      .select("id", { count: "exact", head: true })
      .eq("request_id", requestId)
      .eq("stage", "adapt_and_evaluate_trigger")
      .eq("status", "success")
      .like("detail", "Retried adaptation%");
    return count ?? 0;
  }

  // "Switched x to version 2 by hand" is also a channel_revision event and is NOT a
  // regeneration: it costs nothing and generates nothing. Matched on the wording the
  // revise route writes so the two cannot be confused.
  const { count } = await admin
    .from("event_log")
    .select("id", { count: "exact", head: true })
    .eq("request_id", requestId)
    .eq("stage", "channel_revision")
    .eq("status", "success")
    .like("detail", `${kind.channel} revised against%`);
  return count ?? 0;
}
