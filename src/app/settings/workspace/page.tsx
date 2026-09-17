import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import SettingsNav from "../settings-nav";
import NotificationEmailForm from "./notification-email-form";

export default async function WorkspaceSettingsPage() {
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("workspace_settings")
    .select("notification_email")
    .eq("id", true)
    .maybeSingle();

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <SettingsNav active="/settings/workspace" />

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Workspace</h1>
      <p className="mt-1 text-sm text-muted">
        Shared across the whole team — one workspace, not per-user settings (this app is built for
        one company).
      </p>

      <Card className="mt-4 p-5">
        <NotificationEmailForm currentEmail={settings?.notification_email ?? null} />
        <p className="mt-3 text-xs text-muted">
          Where scheduled-publish reminders and channel-adaptation notifications go. Required
          before content generation is allowed.
        </p>
      </Card>
    </main>
  );
}
