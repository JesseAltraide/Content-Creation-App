import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import SettingsNav from "../settings-nav";
import { getManagerState } from "@/lib/content-manager";
import { createClient as createUserClient } from "@/lib/supabase/server";
import ImportSubscribersForm from "./import-subscribers-form";
import RemoveSubscriberButton from "./remove-subscriber-button";

export default async function NewsletterSubscribersPage() {

  const userClient = await createUserClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  const manager = await getManagerState(user!.id);
  const supabase = await createClient();
  const { data: subscribers } = await supabase
    .from("newsletter_subscribers")
    .select("*")
    .order("created_at", { ascending: false });

  const active = (subscribers ?? []).filter((s) => !s.unsubscribed_at);
  const unsubscribed = (subscribers ?? []).filter((s) => s.unsubscribed_at);

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <SettingsNav active="/settings/newsletter-subscribers" />

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Newsletter subscribers</h1>
      <p className="mt-1 text-sm text-muted">
        This project has no real subscriber base yet. Import existing addresses to demonstrate
        real newsletter delivery against them, same as a production deployment would already have.
      </p>

      {manager.canEditSettings && (<ImportSubscribersForm />)}
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
          {active.length} active subscriber{active.length === 1 ? "" : "s"}
        </h2>

        {active.length === 0 && (
          <Card className="mt-2 p-6 text-center text-sm text-muted">No subscribers yet. Import some above.</Card>
        )}

        <Card className="mt-2 divide-y divide-border p-1">
          {active.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-sm text-foreground">{s.email}</span>
              <RemoveSubscriberButton subscriberId={s.id} />
            </div>
          ))}
        </Card>
      </section>

      {unsubscribed.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted">
            {unsubscribed.length} unsubscribed
          </h2>
          <Card className="mt-2 divide-y divide-border p-1">
            {unsubscribed.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-sm text-muted line-through">{s.email}</span>
                <span className="text-xs text-muted">
                  {new Date(s.unsubscribed_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}
    </main>
  );
}
