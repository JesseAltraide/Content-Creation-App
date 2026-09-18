"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

// Where the email link lands a user who has never set a password. The magic link
// itself is what authenticates them (Supabase creates the account on first OTP
// request), so by the time this page renders they already have a session - this is
// only about giving them a password so they can sign in normally from then on.
export default function SetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords don't match.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    // password_set is our own flag, checked in /auth/callback to decide whether to
    // send someone here. Supabase has no reliable "has a password" field to read.
    const { error: updateError } = await supabase.auth.updateUser({
      password,
      data: { password_set: true },
    });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm p-6">
        <h1 className="text-lg font-semibold tracking-tight">Set your password</h1>
        <p className="mt-1 text-sm text-muted">
          You&apos;re signed in. Pick a password so you can sign in directly next time
          instead of waiting for an email link.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving…" : "Save password and continue"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
