import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { getOnboardingStatus } from "@/lib/onboarding";
import IntakeForm from "./intake-form";

export default async function NewRequestPage() {
  const onboarding = await getOnboardingStatus();

  if (!onboarding.complete) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-12">
        <BackLink />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Finish setup first</h1>
        <p className="mt-1 text-sm text-muted">
          This workspace needs a few things configured before it can generate content — same
          settings the evaluator grades everything against, so they need to actually exist first.
        </p>
        <Card className="mt-4 divide-y divide-border p-1">
          <SetupItem
            done={onboarding.hasAudienceProfile}
            label="At least one audience profile"
            href="/settings/audience-profiles"
          />
          <SetupItem
            done={onboarding.hasToneSample}
            label="At least one tone sample"
            href="/settings/tone-samples"
          />
          <SetupItem
            done={onboarding.hasNotificationEmail}
            label="A notification email"
            href="/settings/workspace"
          />
        </Card>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: audienceProfiles } = await supabase
    .from("audience_profiles")
    .select("id, name")
    .order("name");

  const { data: toneSamples } = await supabase.from("tone_samples").select("channel");
  const toneSampleCounts: Record<string, number> = { linkedin: 0, x: 0, newsletter: 0 };
  for (const s of toneSamples ?? []) {
    toneSampleCounts[s.channel] = (toneSampleCounts[s.channel] ?? 0) + 1;
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <BackLink />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">New content request</h1>
      <p className="mt-1 text-sm text-muted">
        Start from a raw idea, or from source material you already have.
      </p>
      <IntakeForm audienceProfiles={audienceProfiles ?? []} toneSampleCounts={toneSampleCounts} />
    </main>
  );
}

function BackLink() {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-1 text-sm font-medium text-muted hover:text-foreground"
    >
      ← Back to requests
    </Link>
  );
}

function SetupItem({ done, label, href }: { done: boolean; label: string; href: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <span className="flex items-center gap-2 text-sm">
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${
            done ? "bg-success text-white" : "bg-black/5 text-muted"
          }`}
        >
          {done ? "✓" : ""}
        </span>
        {label}
      </span>
      {!done && (
        <Link href={href} className="text-sm font-medium text-accent hover:underline">
          Set up →
        </Link>
      )}
    </div>
  );
}
