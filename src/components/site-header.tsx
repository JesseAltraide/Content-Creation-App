import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "./sign-out-button";

export default async function SiteHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">
            C
          </span>
          <span className="text-sm font-semibold tracking-tight">Content Agent</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-muted sm:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </div>
    </header>
  );
}
