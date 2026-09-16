import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  channel: z.enum(["linkedin", "x", "newsletter"]),
  content: z
    .string()
    .trim()
    .min(20, "That's too short to be a real post — paste the actual content.")
    .refine((s) => !/^https?:\/\/\S+$/i.test(s), {
      message: "That looks like a URL, not post content — paste the actual text.",
    }),
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
      { error: parsed.error.issues[0]?.message ?? "Invalid input." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("tone_samples")
    .insert({ channel: parsed.data.channel, content: parsed.data.content })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to save tone sample." }, { status: 500 });
  }

  return NextResponse.json({ sample: data }, { status: 201 });
}
