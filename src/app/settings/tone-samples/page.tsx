import { createClient } from "@/lib/supabase/server";
import ChannelToneSection from "./channel-tone-section";
import SettingsNav from "../settings-nav";

const CHANNELS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "newsletter", label: "Newsletter" },
] as const;

export default async function ToneSamplesPage() {
  const supabase = await createClient();
  const { data: samples } = await supabase
    .from("tone_samples")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <SettingsNav active="/settings/tone-samples" />

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Tone samples</h1>
      <p className="mt-1 text-sm text-muted">
        Real previous posts, per channel — the same brand reads differently on LinkedIn than on
        X, so voice is learned separately for each. Paste real post text, or upload a file
        containing it; a written description of your tone isn&apos;t used, since real samples
        give the evaluator something concrete to grade against.
      </p>

      <div className="mt-8 flex flex-col gap-8">
        {CHANNELS.map((c) => (
          <ChannelToneSection
            key={c.value}
            channel={c.value}
            label={c.label}
            samples={(samples ?? []).filter((s) => s.channel === c.value)}
          />
        ))}
      </div>
    </main>
  );
}
