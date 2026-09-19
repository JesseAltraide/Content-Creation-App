import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { userCanModifyRequest } from "@/lib/request-access";
import { logEvent } from "@/lib/events";

// The drafts equivalent of use-channel-version. Same rule, same reasoning: every
// attempt is kept, the highest score is what you see, and an explicit choice beats
// the score because the author has to be able to disagree with the number.
//
// By row id, not version number. Re-picking an angle restarts section numbering at 1,
// so a request can hold two drafts both called v1.
const Body = z.object({
  sectionId: z.string().uuid(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  if (!(await userCanModifyRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const admin = createAdminClient();

  const { data: sections } = await admin
    .from("sections")
    .select("id, version, locked")
    .eq("request_id", requestId);

  const target = (sections ?? []).find((s) => s.id === parsed.data.sectionId);
  if (!target) {
    return NextResponse.json({ error: "That draft no longer exists." }, { status: 404 });
  }

  // Once the article is approved it is locked and the channel posts are derived from
  // it, so swapping the draft underneath them would leave the two describing
  // different articles.
  if ((sections ?? []).some((s) => s.locked)) {
    return NextResponse.json(
      { error: "This article is locked because it has been approved, so the draft can't be changed." },
      { status: 409 }
    );
  }

  // Clear first, then set: a unique index allows exactly one chosen draft per request
  // once migration 016 is applied, so the other order collides with the row being
  // replaced.
  const { error: clearError } = await admin
    .from("sections")
    .update({ chosen: false })
    .eq("request_id", requestId);
  if (clearError) {
    return NextResponse.json(
      {
        error:
          "Couldn't switch draft. If this is a fresh deployment, migration 016_section_chosen.sql may not have been applied yet.",
      },
      { status: 500 }
    );
  }

  const { error: setError } = await admin
    .from("sections")
    .update({ chosen: true })
    .eq("id", target.id);
  if (setError) {
    return NextResponse.json({ error: "Couldn't switch draft." }, { status: 500 });
  }

  await logEvent({
    requestId,
    stage: "evaluation",
    status: "success",
    detail: `Switched the article to draft version ${target.version} by hand.`,
  });

  return NextResponse.json({ ok: true });
}
