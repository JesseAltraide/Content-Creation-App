import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import SettingsNav from "../settings-nav";
import { getManagerState } from "@/lib/content-manager";
import { createClient as createUserClient } from "@/lib/supabase/server";
import NotificationEmailForm from "./notification-email-form";
import ClaimManagerButton from "./claim-manager-button";

export default async function WorkspaceSettingsPage() {

  const userClient = await createUserClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  const manager = await getManagerState(user!.id);
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("workspace_settings")
    .select("notification_email")
    .eq("id", true)
    .maybeSingle();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <SettingsNav active="/settings/workspace" />

      <Card className="mt-4 p-5">
        <h2 className="text-sm font-semibold">Content manager</h2>
        {manager.unclaimed ? (
          <>
            <p className="mt-1 text-sm text-muted">
              Nobody owns the workspace settings yet, so everyone can currently edit them.
              Claiming it makes you the only person who can change the audience profiles, tone
              samples and subscriber list. Everyone else keeps read access.
            </p>
            <div className="mt-3">
              <ClaimManagerButton />
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">
            {manager.canEditSettings
              ? "You own the workspace settings. When you change the audience or tone, everyone else is notified, since that changes what every future draft is graded against."
              : "Another user owns the workspace settings. You can read them but not change them."}
          </p>
        )}
      </Card>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Workspace</h1>
      <p className="mt-1 text-sm text-muted">
        Shared across the whole team: one workspace, not per-user settings (this app is built for
        one company).
      </p>

      <Card className="mt-4 p-5">
        {manager.canEditSettings && (<NotificationEmailForm currentEmail={settings?.notification_email ?? null} />)}
      {!manager.canEditSettings && (
        <Card className="mt-4 p-4">
          <p className="text-sm text-muted">
            Read only. These settings define what every draft is written and graded against,
            so only the content manager can change them.
          </p>
        </Card>
      )}

        <p className="mt-3 text-xs text-muted">
          Where scheduled-publish reminders and channel-adaptation notifications go. Required
          before content generation is allowed.
        </p>
      </Card>
    </main>
  );
}
