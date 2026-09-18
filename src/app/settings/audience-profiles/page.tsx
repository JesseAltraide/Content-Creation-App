import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import NewProfileForm from "./new-profile-form";
import DeleteProfileButton from "./delete-profile-button";
import SettingsNav from "../settings-nav";
import { getManagerState } from "@/lib/content-manager";
import { createClient as createUserClient } from "@/lib/supabase/server";

export default async function AudienceProfilesPage() {

  const userClient = await createUserClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  const manager = await getManagerState(user!.id);
  const supabase = await createClient();
  const { data: profiles } = await supabase
    .from("audience_profiles")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <SettingsNav active="/settings/audience-profiles" />

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Audience profiles</h1>
      <p className="mt-1 text-sm text-muted">
        Workspace-level settings, reused across every content request. A request either targets
        one of these explicitly, or the resonance gate auto-matches the best fit against all of
        them.
      </p>

      {manager.canEditSettings && (<NewProfileForm />)}
      {!manager.canEditSettings && (
        <Card className="mt-4 p-4">
          <p className="text-sm text-muted">
            Read only. These settings define what every draft is written and graded against,
            so only the content manager can change them.
          </p>
        </Card>
      )}


      <section className="mt-8">
        <h2 className="text-sm font-semibold text-muted">
          {(profiles ?? []).length} profile{(profiles ?? []).length === 1 ? "" : "s"}
        </h2>

        {(!profiles || profiles.length === 0) && (
          <Card className="mt-2 p-6 text-center text-sm text-muted">
            No audience profiles yet. Add one above.
          </Card>
        )}

        <div className="mt-2 flex flex-col gap-3">
          {(profiles ?? []).map((p) => (
            <Card key={p.id} className="flex items-start justify-between gap-4 p-5">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="mt-1 text-sm text-muted">{p.description}</p>
              </div>
              {manager.canEditSettings && <DeleteProfileButton profileId={p.id} />}
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}
