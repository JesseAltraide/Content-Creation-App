import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanViewRequest } from "@/lib/request-access";

// Deliberately gated on VIEW access, not modify: the whole point is that someone
// other than the author can leave a suggestion. Commenting is the one thing a
// non-owner may do, and it changes nothing about the content itself.
const bodySchema = z.object({
  body: z.string().trim().min(1, "Write something first.").max(2000, "Keep it under 2000 characters."),
  channel: z.enum(["linkedin", "x", "newsletter"]).optional().nullable(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  if (!(await userCanViewRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid comment." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { error } = await admin.from("request_comments").insert({
    request_id: requestId,
    user_id: user.id,
    author_email: user.email,
    channel: parsed.data.channel ?? null,
    body: parsed.data.body,
  });

  if (error) {
    return NextResponse.json({ error: "Couldn't save your comment. Try again." }, { status: 500 });
  }

  // No event_log entry: the technical log tracks pipeline stages, and a comment is
  // human conversation, not a stage transition.
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;
  const commentId = new URL(request.url).searchParams.get("commentId");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!commentId) {
    return NextResponse.json({ error: "Which comment?" }, { status: 400 });
  }

  // You can delete your own comment and nobody else's, including the request
  // author: letting an author delete criticism of their own draft would quietly
  // defeat the point of review.
  const admin = createAdminClient();
  const { data: deleted } = await admin
    .from("request_comments")
    .delete()
    .eq("id", commentId)
    .eq("request_id", requestId)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (!deleted) {
    return NextResponse.json({ error: "That comment isn't yours to delete." }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
