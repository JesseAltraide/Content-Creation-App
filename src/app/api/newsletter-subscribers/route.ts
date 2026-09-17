import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Newsletter delivery assumes an existing subscriber base this project doesn't
// have (week4-full-flow.md line 293) - this import mechanism exists specifically
// so real delivery can be demonstrated against real addresses instead of an empty
// or fake list. A production deployment would already have subscribers.
const bodySchema = z.object({
  emails: z.array(z.string().trim().email()).min(1, "Add at least one valid email address."),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid emails." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const uniqueEmails = [...new Set(parsed.data.emails.map((e) => e.toLowerCase()))];

  // Re-importing an address that unsubscribed does NOT silently re-subscribe them -
  // ignoreDuplicates leaves the existing row (and its unsubscribed_at) untouched,
  // which is the only honest behavior for an opt-out that's supposed to be
  // "honored immediately" (week4-full-flow.md line 295).
  const { error } = await admin
    .from("newsletter_subscribers")
    .upsert(
      uniqueEmails.map((email) => ({ email })),
      { onConflict: "email", ignoreDuplicates: true }
    );

  if (error) {
    return NextResponse.json({ error: "Couldn't import subscribers — try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, imported: uniqueEmails.length });
}
