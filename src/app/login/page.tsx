"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const supabase = createClient();

    if (usePassword) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setSubmitting(false);
      if (error) setError(error.message);
      else window.location.href = "/";
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setSubmitting(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <Card className="w-full max-w-sm p-8">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-base font-bold text-accent-foreground">
            C
          </span>
          <span className="text-lg font-semibold tracking-tight">Content Agent</span>
        </div>
        <p className="mt-4 text-sm text-muted">
          Sign in with your work email. New here? Enter your email and the link will
          take you to set a password.
        </p>

        {sent ? (
          <p className="mt-6 text-sm">
            Check <span className="font-medium">{email}</span> for your link. If this is
            your first time, it will take you to set a password.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
            {usePassword && (
              <input
                type="password"
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            )}
            <Button type="submit" disabled={submitting} className="mt-1 w-full">
              {submitting ? "Signing in…" : usePassword ? "Sign in" : "Send magic link"}
            </Button>
            <button
              type="button"
              onClick={() => setUsePassword((v) => !v)}
              className="text-xs font-medium text-muted underline decoration-border underline-offset-2 hover:text-foreground"
            >
              {usePassword ? "Use a magic link instead" : "Use a password instead"}
            </button>
            {error && <p className="text-sm text-danger">{error}</p>}
          </form>
        )}
      </Card>
    </main>
  );
}
