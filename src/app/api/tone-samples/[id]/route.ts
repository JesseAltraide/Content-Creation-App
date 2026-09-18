import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getManagerState, announceSettingsChange } from "@/lib/content-manager";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Settings belong to the content manager (migration 009). Enforced here, not just
  // hidden in the UI: these define what the evaluator grades every draft against.
  const manager = await getManagerState(user.id);
  if (!manager.canEditSettings) {
    return NextResponse.json(
      { error: "Only the content manager can change workspace settings." },
      { status: 403 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("tone_samples").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete tone sample." }, { status: 500 });
  }

  await announceSettingsChange({
    kind: "tone",
    summary: "A tone sample was removed.",
    authorUserId: user.id,
    authorEmail: user.email,
  });

  return NextResponse.json({ ok: true });
}
