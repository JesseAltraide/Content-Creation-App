import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { REVIEWABLE_STATUSES } from "@/lib/request-access";

// The list page's equivalent of the per-request status read: enough to tell whether
// any badge on screen is now wrong, and nothing more. Same reason it exists, too:
// router.refresh() on a timer was not re-rendering, so the list sat on stale badges.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Exactly the two sets the page itself renders, so the digest cannot drift from
  // what is on screen.
  const [{ data: mine }, { data: toReview }] = await Promise.all([
    supabase
      .from("requests")
      .select("id, status")
      .or(`user_id.eq.${user.id},user_id.is.null`),
    supabase
      .from("requests")
      .select("id, status")
      .in("status", REVIEWABLE_STATUSES)
      .not("user_id", "is", null)
      .neq("user_id", user.id),
  ]);

  const digest = [...(mine ?? []), ...(toReview ?? [])]
    .map((r) => `${r.id}:${r.status}`)
    .sort()
    .join("|");

  return NextResponse.json({ digest });
}
