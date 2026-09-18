import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({ announcementIds: z.array(z.string().uuid()).min(1) });

// Dismissal is per user, not global: the point is that everyone sees the change
// once, so one person clicking through must not clear it for the rest of the team.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Nothing to dismiss." }, { status: 400 });
  }

  const admin = createAdminClient();
  // Composite primary key makes a repeat dismissal a no-op rather than an error.
  const { error } = await admin.from("settings_announcement_reads").upsert(
    parsed.data.announcementIds.map((announcementId) => ({
      announcement_id: announcementId,
      user_id: user.id,
    })),
    { onConflict: "announcement_id,user_id", ignoreDuplicates: true }
  );

  if (error) {
    return NextResponse.json({ error: "Couldn't dismiss that. Try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
