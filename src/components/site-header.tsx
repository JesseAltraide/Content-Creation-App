import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";
import SettingsAnnouncementPopup from "./settings-announcement-popup";
import WelcomePopup from "./welcome-popup";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUnreadAnnouncements, getManagerState } from "@/lib/content-manager";
import NotificationBell from "./notification-bell";
import { getNotices } from "@/lib/notices";

export default async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  // Rendered from the header so it reaches every authenticated page, not just the
  // one place someone happens to land after a settings change.
  const [announcements, manager, notices] = await Promise.all([
    getUnreadAnnouncements(user.id),
    getManagerState(user.id),
    // Server-rendered so the count is right on first paint; the component keeps it
    // current from there.
    getNotices(user.id),
  ]);

  // Only for someone who has never dismissed it. Fetched here rather than on the
  // home page so it also catches a new user who lands somewhere else first.
  const showWelcome = !user.user_metadata?.welcome_seen;
  const admin = createAdminClient();
  const [profilesRes, toneRes] = showWelcome
    ? await Promise.all([
        admin.from("audience_profiles").select("name, description"),
        admin.from("tone_samples").select("channel"),
      ])
    : [{ data: [] }, { data: [] }];
  const toneChannels = Array.from(
    new Set(((toneRes.data ?? []) as { channel: string }[]).map((t) => t.channel))
  );

  return (
    <>
      <SettingsAnnouncementPopup announcements={announcements} />
      {showWelcome && (
        <WelcomePopup
          profiles={(profilesRes.data ?? []) as { name: string; description: string }[]}
          toneChannels={toneChannels}
        />
      )}
      <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">
            C
          </span>
          <span className="text-sm font-semibold tracking-tight">Content Agent</span>
        </Link>
        <div className="flex items-center gap-4">
          <NotificationBell initial={notices} />
          <Link
            href="/settings/audience-profiles"
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            Settings
          </Link>
          <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          {manager.isManagerAccount && !manager.unclaimed && (
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
