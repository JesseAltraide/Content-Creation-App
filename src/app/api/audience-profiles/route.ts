import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  description: z
    .string()
    .trim()
    .min(10, "Description must be a real description (at least 10 characters).")
    .refine((s) => s.split(/[.!?]+/).filter(Boolean).length <= 3, {
      message: "Keep it to 3 sentences or less.",
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
    .from("audience_profiles")
    .insert({ name: parsed.data.name, description: parsed.data.description })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create audience profile." }, { status: 500 });
  }

  return NextResponse.json({ profile: data }, { status: 201 });
}
