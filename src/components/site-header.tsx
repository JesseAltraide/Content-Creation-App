import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";
import SettingsAnnouncementPopup from "./settings-announcement-popup";
import ViewSwitcher from "./view-switcher";
import WelcomePopup from "./welcome-popup";
import { createAdminClient } from "@/lib/supabase/admin";
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
          <Link
            href="/settings/audience-profiles"
            className="text-sm font-medium text-muted hover:text-foreground"
          >
            Settings
          </Link>
          <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          {manager.isManagerAccount && !manager.unclaimed && (
            <ViewSwitcher viewingAsWriter={manager.viewingAsWriter} />
          )}
          <SignOutButton />
        </div>
      </div>
      </header>
    </>
  );
}
