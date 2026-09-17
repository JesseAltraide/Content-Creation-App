import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Public route, clicked from an email link - no auth (see proxy.ts's PUBLIC_PATHS).
// Required alongside real newsletter sending, not optional (week4-full-flow.md
// line 295): a basic unsubscribe link, honored immediately. The subscriber row's
// own id is the link token - adequate for this project's scope (an internal tool
// sending to an imported list, not a public signup flow with adversarial actors),
// though a dedicated unguessable token would be the more defensible choice in a
// real production deployment.
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.redirect(new URL("/unsubscribed?ok=0", request.url));
  }

  const admin = createAdminClient();
  // Idempotent: unsubscribing twice (e.g. the link clicked more than once) is a
  // no-op the second time, never an error - IS NULL guards against overwriting an
  // already-recorded unsubscribe time.
  await admin
    .from("newsletter_subscribers")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("id", id)
    .is("unsubscribed_at", null);

  return NextResponse.redirect(new URL("/unsubscribed?ok=1", request.url));
}
