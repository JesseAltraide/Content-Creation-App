import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { VIEW_AS_COOKIE } from "@/lib/content-manager";

const bodySchema = z.object({ view: z.enum(["manager", "writer"]) });

// Stores a view preference only. This cookie can never grant anything: whether an
// account is the content manager is read from the database, and the cookie is
// only consulted to take that privilege away from someone who has it. That is why
// it is safe for the value to be user-controlled.
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
    return NextResponse.json({ error: "Unknown view." }, { status: 400 });
  }

  const response = NextResponse.json({ ok: true });
  if (parsed.data.view === "writer") {
    response.cookies.set(VIEW_AS_COOKIE, "writer", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
  } else {
    response.cookies.delete(VIEW_AS_COOKIE);
  }
  return response;
}
