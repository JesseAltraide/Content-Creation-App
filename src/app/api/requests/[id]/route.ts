import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const admin = createAdminClient();

  // Cascades to sources, excerpts, angles, sections, evaluation_results, channel_posts,
  // scheduled_content, and event_log via the schema's ON DELETE CASCADE foreign keys.
  const { error } = await admin.from("requests").delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Failed to delete request." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
