import { createAdminClient } from "@/lib/supabase/admin";

export type OnboardingStatus = {
  complete: boolean;
  hasAudienceProfile: boolean;
  hasToneSample: boolean;
  hasNotificationEmail: boolean;
};

// "On startup... the app asks the person to set the tone, the email, the audience
// first, before allowing generation" - checked here, server-side, and enforced both
// on the /new page (so the human sees why) and inside POST /api/requests (so it's a
// real gate, not just a UI hint - same "hard rule, server-enforced" discipline as
// every other gate in this build). No role check: the Content Manager role was
// dropped (Decision #96) - any authenticated user can complete setup.
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const admin = createAdminClient();

  const [{ count: audienceCount }, { count: toneCount }, { data: settings }] = await Promise.all([
    admin.from("audience_profiles").select("id", { count: "exact", head: true }),
    admin.from("tone_samples").select("id", { count: "exact", head: true }),
    admin.from("workspace_settings").select("notification_email").eq("id", true).maybeSingle(),
  ]);

  const hasAudienceProfile = (audienceCount ?? 0) > 0;
  const hasToneSample = (toneCount ?? 0) > 0;
  const hasNotificationEmail = !!settings?.notification_email;

  return {
    complete: hasAudienceProfile && hasToneSample && hasNotificationEmail,
    hasAudienceProfile,
    hasToneSample,
    hasNotificationEmail,
  };
}
