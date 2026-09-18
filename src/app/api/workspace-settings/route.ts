import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getManagerState, announceSettingsChange } from "@/lib/content-manager";

const bodySchema = z.object({
  notificationEmail: z.string().trim().email("Enter a valid email address."),
});

export async function POST(request: Request) {
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

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("workspace_settings")
    .update({ notification_email: parsed.data.notificationEmail, updated_at: new Date().toISOString() })
    .eq("id", true);

  if (error) {
    return NextResponse.json({ error: "Failed to save. Try again." }, { status: 500 });
  }

  await announceSettingsChange({
    kind: "workspace",
    summary: "The workspace notification email was updated.",
    authorUserId: user.id,
    authorEmail: user.email,
  });

  return NextResponse.json({ ok: true });
}
