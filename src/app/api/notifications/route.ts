import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNotices } from "@/lib/notices";

// Read by the header bell when realtime says something moved, and on a slow poll as
// the guarantee behind it. Small and scoped to the caller: it never returns anything
// about another person's requests.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  return NextResponse.json({ notices: await getNotices(user.id) });
}
