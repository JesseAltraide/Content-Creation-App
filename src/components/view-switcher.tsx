"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// Lets the content manager switch between their two views without signing out,
// which is what "one login, two roles" means here: Supabase allows exactly one
// account per email, so the second role is a view rather than a second account.
export default function ViewSwitcher({ viewingAsWriter }: { viewingAsWriter: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function switchTo(view: "manager" | "writer") {
    setBusy(true);
    await fetch("/api/view-as", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view }),
    });
    setBusy(false);
    startTransition(() => router.refresh());
  }

  const disabled = busy || pending;

  return (
    <div className="flex items-center gap-1 rounded-lg bg-background p-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={() => switchTo("manager")}
        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
          viewingAsWriter ? "text-muted hover:text-foreground" : "bg-surface text-foreground shadow-sm"
        }`}
      >
        Manager
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => switchTo("writer")}
        className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
          viewingAsWriter ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
        }`}
      >
        Writer
      </button>
    </div>
  );
}
