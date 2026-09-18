import { createClient } from "@/lib/supabase/server";
import ChannelToneSection from "./channel-tone-section";
import SettingsNav from "../settings-nav";
import { getManagerState } from "@/lib/content-manager";
import { createClient as createUserClient } from "@/lib/supabase/server";

const CHANNELS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "newsletter", label: "Newsletter" },
] as const;

export default async function ToneSamplesPage() {

  const userClient = await createUserClient();
  const {
    data: { user },
  } = await userClient.auth.getUser();
  const manager = await getManagerState(user!.id);
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
        Real previous posts, per channel. The same brand reads differently on LinkedIn than on
        X, so voice is learned separately for each. Paste real post text or upload a file
        containing it; if a channel is brand new with nothing to sample yet, you can describe the
        target tone instead, which is weaker than a real sample but better than nothing.
      </p>

      <div className="mt-8 flex flex-col gap-8">
        {CHANNELS.map((c) => (
          <ChannelToneSection
canEdit={manager.canEditSettings}
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
