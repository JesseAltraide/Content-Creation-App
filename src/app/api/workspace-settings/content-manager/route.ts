import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getManagerState, announceSettingsChange } from "@/lib/content-manager";

// Claiming an unclaimed workspace. Deliberately one-way from the app's side: the
// first person to claim it becomes the content manager, and handing the role to
// someone else is a deliberate database change rather than a button, because
// there is no second role to authorise a transfer and self-service reassignment
// would just be "anyone can take it" wearing a hat.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const manager = await getManagerState(user.id);
  if (!manager.unclaimed) {
    return NextResponse.json(
      { error: "This workspace already has a content manager." },
      { status: 409 }
    );
  }

  const admin = createAdminClient();
  // Conditional on still being unclaimed, so two people clicking at once cannot
  // both succeed.
  const { data: updated } = await admin
    .from("workspace_settings")
    .update({ content_manager_user_id: user.id })
    .eq("id", true)
    .is("content_manager_user_id", null)
    .select()
    .maybeSingle();

  if (!updated) {
    return NextResponse.json(
      { error: "Someone else just claimed it. Refresh to see the latest." },
      { status: 409 }
    );
  }

  await announceSettingsChange({
    kind: "workspace",
    summary: `${user.email} is now the content manager and owns the audience profiles and tone samples.`,
    authorUserId: user.id,
    authorEmail: user.email,
  });

  return NextResponse.json({ ok: true });
}
