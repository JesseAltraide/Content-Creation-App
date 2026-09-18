import { createAdminClient } from "@/lib/supabase/admin";

// Gating the request page alone would only hide other people's work, not protect
// it: every action lives behind its own API route that takes a request id, so
// without this someone could still approve, reject, edit or schedule a request
// they cannot see. Checked against the service-role client because RLS does not
// apply to it, which is what most of this app reads through.
//
// Null owner means the row predates migration 007, and stays open to everyone
// rather than becoming unreachable.
export async function userCanAccessRequest(requestId: string, userId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("requests")
    .select("user_id")
    .eq("id", requestId)
    .maybeSingle();

  if (!data) return false;
  return !data.user_id || data.user_id === userId;
}
