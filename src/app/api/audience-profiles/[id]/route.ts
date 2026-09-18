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
  const { error } = await admin.from("audience_profiles").delete().eq("id", id);

  if (error) {
    // 23503 is Postgres's foreign_key_violation. requests.audience_profile_id and
    // resolved_audience_profile_id both reference this table with no ON DELETE
    // clause, so a profile any request was written against cannot be removed. That
    // is the right behaviour, not a bug to route around: the profile is the brief
    // those drafts were generated and graded against, and deleting it would strip
    // the context out from under them. Counted here so the message can say how
    // many rather than leaving the human to guess what is holding it.
    if (error.code === "23503") {
      const [{ count: chosen }, { count: resolved }] = await Promise.all([
        admin.from("requests").select("id", { count: "exact", head: true }).eq("audience_profile_id", id),
        admin.from("requests").select("id", { count: "exact", head: true }).eq("resolved_audience_profile_id", id),
      ]);
      const total = (chosen ?? 0) + (resolved ?? 0);
      return NextResponse.json(
        {
          error: `${total} request${total === 1 ? "" : "s"} were written against this audience profile, so it can't be deleted. Delete those requests first, or leave it in place.`,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to delete audience profile." }, { status: 500 });
  }

  await announceSettingsChange({
    kind: "audience",
    summary: "An audience profile was removed.",
    authorUserId: user.id,
    authorEmail: user.email,
  });

  return NextResponse.json({ ok: true });
}
