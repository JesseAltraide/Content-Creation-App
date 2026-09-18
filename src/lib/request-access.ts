import { createAdminClient } from "@/lib/supabase/admin";

// Once a request is final enough to be worth reviewing, the team can read it and
// comment on it. Before that it is the author's private work in progress. This is
// what lets per-request privacy (migration 007) and team review coexist: nothing
// is shared manually, visibility just follows the pipeline stage.
// pending_approval is included as well as ready_to_schedule: that is the point
// where feedback can still change the article itself rather than only the channel
// posts cut from it, so it is arguably the more useful moment to be reviewed.
export const REVIEWABLE_STATUSES = ["pending_approval", "ready_to_schedule"];

type Access = { exists: boolean; isOwner: boolean; canView: boolean; canModify: boolean };

async function loadAccess(requestId: string, userId: string): Promise<Access> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("requests")
    .select("user_id, status")
    .eq("id", requestId)
    .maybeSingle();

  if (!data) return { exists: false, isOwner: false, canView: false, canModify: false };

  // Null owner means the row predates migration 007. Treated as everyone's rather
  // than becoming unreachable.
  const isOwner = !data.user_id || data.user_id === userId;
  const reviewable = REVIEWABLE_STATUSES.includes(data.status);

  return {
    exists: true,
    isOwner,
    canView: isOwner || reviewable,
    // Reviewers read and comment, never edit. Every state-changing action stays
    // with the author, so a comment can never turn into someone else scheduling
    // or rewriting your post.
    canModify: isOwner,
  };
}

/** Read access: the author, or anyone once the request reaches a reviewable stage. */
export async function userCanViewRequest(requestId: string, userId: string): Promise<boolean> {
  return (await loadAccess(requestId, userId)).canView;
}

/**
 * Write access: the author only.
 *
 * Gating the request page alone would only hide other people's work, not protect
 * it: every action lives behind its own API route that takes a request id, so
 * without this someone could still approve, reject, edit or schedule a request
 * they can merely see. Checked against the service-role client because RLS does
 * not apply to it, which is what most of this app reads through.
 */
export async function userCanModifyRequest(requestId: string, userId: string): Promise<boolean> {
  return (await loadAccess(requestId, userId)).canModify;
}

export async function getRequestAccess(requestId: string, userId: string): Promise<Access> {
  return loadAccess(requestId, userId);
}
