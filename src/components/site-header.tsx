import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";
import SettingsAnnouncementPopup from "./settings-announcement-popup";
import { getUnreadAnnouncements, getManagerState } from "@/lib/content-manager";

export default async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Rendered from the header so it reaches every authenticated page, not just the
  // one place someone happens to land after a settings change.
  const [announcements, manager] = await Promise.all([
    getUnreadAnnouncements(user.id),
    getManagerState(user.id),
  ]);

  return (
    <>
      <SettingsAnnouncementPopup announcements={announcements} />
      <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">
            C
          </span>
          <span className="text-sm font-semibold tracking-tight">Content Agent</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/settings/audience-profiles"
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            Settings
          </Link>
          <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          {manager.managerUserId === user.id && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
              Content manager
            </span>
          )}
          <SignOutButton />
        </div>
      </div>
      </header>
    </>
  );
}
