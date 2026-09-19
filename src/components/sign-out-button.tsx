"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { hardRefresh } from "@/lib/hard-refresh";

export default function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    hardRefresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="text-sm font-medium text-muted hover:text-foreground"
    >
      Sign out
    </button>
  );
}
