import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";

export const VIEW_AS_COOKIE = "view_as";

export type ManagerState = {
  managerUserId: string | null;
  /** True when this user may change workspace settings, after any view switch. */
  canEditSettings: boolean;
  /** No manager designated yet, so the workspace is still unclaimed. */
  unclaimed: boolean;
  /** True when this account really is the manager, ignoring the view switch. */
  isManagerAccount: boolean;
  /** True when a manager is deliberately looking at the app as a writer. */
  viewingAsWriter: boolean;
};

// One content manager owns the workspace settings that define the brand: audience
// profiles, tone samples, the notification email and the subscriber list. Everyone
// else reads them. Those settings are what the evaluator grades every draft
// against, so letting anyone edit them means the standard moves under people's
// feet mid-pipeline.
//
// An unclaimed workspace (no manager set) deliberately leaves editing open to
// everyone: locking settings before a manager exists would strand a fresh install,
// since the onboarding gate blocks all generation until settings are configured.
export async function getManagerState(userId: string): Promise<ManagerState> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("workspace_settings")
    .select("content_manager_user_id")
    .eq("id", true)
    .maybeSingle();

  const managerUserId = data?.content_manager_user_id ?? null;
  const isManagerAccount = !managerUserId || managerUserId === userId;

  // One account, two views. Supabase enforces one account per email, so "two
  // roles on one login" is a view switch rather than a second account: the
  // manager can look at the app as a writer sees it, without signing out.
  //
  // Safe to key off a cookie precisely because it can only ever REMOVE the
  // manager's own privileges. A user-controlled flag that granted privileges
  // would be a hole; one that drops them is just a preference. Nothing here can
  // give a non-manager edit access, since isManagerAccount is what actually
  // decides that and it comes from the database.
  const store = await cookies();
  const viewingAsWriter = isManagerAccount && store.get(VIEW_AS_COOKIE)?.value === "writer";

  return {
    managerUserId,
    unclaimed: !managerUserId,
    isManagerAccount,
    viewingAsWriter,
    canEditSettings: isManagerAccount && !viewingAsWriter,
  };
}

const KIND_LABELS: Record<string, string> = {
  audience: "Audience profiles",
  tone: "Tone samples",
  workspace: "Workspace settings",
  subscribers: "Newsletter subscribers",
};

// Called by the settings routes after a successful change. Failure here must never
// fail the change itself: not being told about an updated tone sample is a much
// smaller problem than the update being rejected because the notice could not be
// written.
export async function announceSettingsChange(input: {
  kind: "audience" | "tone" | "workspace" | "subscribers";
  summary: string;
  authorUserId: string;
  authorEmail?: string | null;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("settings_announcements").insert({
      author_user_id: input.authorUserId,
      author_email: input.authorEmail ?? null,
      kind: input.kind,
      summary: input.summary,
    });
  } catch {
    // Intentionally swallowed, see above.
  }
}

export function labelForKind(kind: string): string {
  return KIND_LABELS[kind] ?? "Workspace settings";
}

/** Announcements this user has not dismissed, newest first. */
export async function getUnreadAnnouncements(userId: string) {
  const admin = createAdminClient();
  const { data: announcements } = await admin
    .from("settings_announcements")
    .select("id, kind, summary, author_email, created_at")
    .order("created_at", { ascending: false })
    .limit(20);

  if (!announcements || announcements.length === 0) return [];

  const { data: reads } = await admin
    .from("settings_announcement_reads")
    .select("announcement_id")
    .eq("user_id", userId);

  const readIds = new Set((reads ?? []).map((r) => r.announcement_id));
  // The author already knows what they just changed.
  return announcements.filter((a) => !readIds.has(a.id));
}
