import { createAdminClient } from "@/lib/supabase/admin";
import type { Notice } from "@/components/notification-bell";

// The states that mean a person has to do something. Deliberately the same set the
// notification emails use, so the bell and the inbox never disagree about what is
// waiting: one list, read twice.
export const NOTIFIABLE_STATUSES = [
  "awaiting_source_selection",
  "awaiting_angle_selection",
  "pending_approval",
  "ready_to_schedule",
  "needs_human_attention",
] as const;

export async function getNotices(userId: string): Promise<Notice[]> {
  const admin = createAdminClient();

  // Only the author's own requests. A reviewer can read someone else's work, but
  // nothing in these states is waiting on a reviewer: every one of them resolves
  // through an action only the author can take.
  const { data } = await admin
    .from("requests")
    .select("id, status, raw_idea, primary_keyword, updated_at, notified_at")
    .eq("user_id", userId)
    .in("status", NOTIFIABLE_STATUSES)
    .limit(20);

  return (data ?? [])
    .map((r) => ({
      id: r.id as string,
      status: r.status as string,
      label: ((r.raw_idea as string | null)?.trim() ||
        (r.primary_keyword as string | null) ||
        "Untitled request") as string,
      // notified_at is when the sweep saw this state; updated_at is the row's own
      // clock. Whichever is later is the closest thing to "when this started waiting
      // for you", and neither is reliably present on its own.
      at: (r.notified_at ?? r.updated_at ?? new Date().toISOString()) as string,
    }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
