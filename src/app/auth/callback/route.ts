import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);

    // A magic link is how someone gets in the first time (Supabase creates the
    // account on the first OTP request), so this is also the sign-up path. Send
    // anyone who has never set a password to do that now, so they can sign in
    // normally afterwards rather than needing an email every time. password_set is
    // our own flag, written by /set-password - Supabase exposes no reliable
    // "has a password" field to check instead.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user && !user.user_metadata?.password_set) {
      return NextResponse.redirect(`${origin}/set-password`);
    }
  }

  return NextResponse.redirect(`${origin}/`);
}
