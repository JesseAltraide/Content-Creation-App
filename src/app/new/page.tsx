import { createClient } from "@/lib/supabase/server";
import IntakeForm from "./intake-form";

export default async function NewRequestPage() {
  const supabase = await createClient();
  const { data: audienceProfiles } = await supabase
    .from("audience_profiles")
    .select("id, name")
    .order("name");

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">New content request</h1>
      <p className="mt-1 text-sm text-muted">
        Start from a raw idea, or from source material you already have.
      </p>
      <IntakeForm audienceProfiles={audienceProfiles ?? []} />
    </main>
  );
}
