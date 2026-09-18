import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Stored on the user rather than in a cookie so it follows them across devices,
// and so clearing site data does not resurface it. No table needed for a single
// boolean per user.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const { error } = await supabase.auth.updateUser({ data: { welcome_seen: true } });
  if (error) {
    return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
