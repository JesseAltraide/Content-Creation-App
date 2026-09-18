import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { userCanModifyRequest } from "@/lib/request-access";
import { triggerEditTriage } from "@/lib/n8n";

// This route either calls a model, triggers an n8n workflow, or keeps working in
// after() once the response has gone out. Serverless kills the function at its
// duration limit whether or not that work finished, and work cut off halfway is
// exactly what leaves a row stranded mid-stage. Stated explicitly rather than left
// to the platform default.
export const maxDuration = 300;

// No comment/reason required, unlike regenerate-with-comment (Decision #63) - the
// edit itself is the explanation; the human is directly stating what the content
// should say, not asking Claude to guess at a change.
const bodySchema = z.object({
  channel: z.enum(["linkedin", "x", "newsletter"]),
  editedBody: z.string().trim().min(1, "Edited content can't be empty."),
});

// Editing a channel post is allowed regardless of the request's own pipeline stage
// (Decision #43) - the article locks permanently at adaptation, but channel posts
// stay editable even after approval/scheduling. This route doesn't touch
// requests.status at all; Workflow E's triage pipeline decides whether the edit
// needs re-evaluation, and its own response tells the human what happened.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: requestId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  // Ownership (migration 007). 404 not 403: telling someone a request exists
  // but is not theirs still leaks that it exists.
  if (!(await userCanModifyRequest(requestId, user.id))) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const body = await request.json();
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid edit." },
      { status: 400 }
    );
  }

  const result = await triggerEditTriage(requestId, parsed.data.channel, parsed.data.editedBody);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Couldn't reach the edit triage pipeline. Try again." },
      { status: 502 }
    );
  }

  return NextResponse.json(result.data ?? { ok: true });
}
