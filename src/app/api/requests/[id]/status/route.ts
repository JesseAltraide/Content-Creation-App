import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanViewRequest } from "@/lib/request-access";

// A tiny status read, existing so a polling client can decide whether anything has
// actually changed before reloading.
//
// The page used to poll by calling router.refresh(), which did not reliably re-render
// the server component: a run would finish, the database would be correct, and the
// page would keep showing "adapting" until someone reloaded by hand. Polling that
// changes nothing is worse than no polling, because it looks like it is working.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!(await userCanViewRequest(id, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("requests")
    .select("status, updated_at")
    .eq("id", id)
    .maybeSingle();

  // The latest event too: a stage can fail and be logged without the status changing
  // (a trigger failure, a gateway timeout), and the banner's wording depends on it.
  const { data: latestEvent } = await admin
    .from("event_log")
    .select("created_at")
    .eq("request_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    status: data?.status ?? null,
    updatedAt: data?.updated_at ?? null,
    latestEventAt: latestEvent?.created_at ?? null,
  });
}
