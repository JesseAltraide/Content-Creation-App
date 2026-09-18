"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export type Announcement = {
  id: string;
  kind: string;
  summary: string;
  author_email: string | null;
  created_at: string;
};

const KIND_LABELS: Record<string, string> = {
  audience: "Audience profiles",
  tone: "Tone samples",
  workspace: "Workspace settings",
  subscribers: "Newsletter subscribers",
};

// Shown once per user when the content manager changes the settings that define
// the brand. Not a toast: audience and tone are what every future draft is written
// and graded against, so someone who misses the change will keep writing to a
// standard that no longer applies. It stays until acknowledged, survives a
// refresh, and waits for anyone who was not logged in when it happened.
export default function SettingsAnnouncementPopup({
  announcements,
}: {
  announcements: Announcement[];
}) {
  const router = useRouter();
  const [dismissing, setDismissing] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (hidden || announcements.length === 0) return null;

  async function dismiss() {
    setDismissing(true);
    setHidden(true);
    try {
      await fetch("/api/settings-announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announcementIds: announcements.map((a) => a.id) }),
      });
      router.refresh();
    } finally {
      setDismissing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 className="text-base font-semibold tracking-tight">
          {announcements.length === 1
            ? "The workspace settings changed"
            : `${announcements.length} workspace settings changed`}
        </h2>
        <p className="mt-1 text-sm text-muted">
          These define what every new draft is written and graded against, so it is worth
          knowing before you start your next one.
        </p>

        <ul className="mt-4 flex flex-col gap-3">
          {announcements.map((a) => (
            <li key={a.id} className="rounded-lg bg-background p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                {KIND_LABELS[a.kind] ?? "Workspace settings"}
              </p>
              <p className="mt-1 text-sm text-foreground">{a.summary}</p>
              <p className="mt-1 text-xs text-muted">
                {a.author_email ? `${a.author_email}, ` : ""}
                {new Date(a.created_at).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex items-center gap-3">
          <Button onClick={dismiss} disabled={dismissing}>
            {dismissing ? "Closing…" : "Got it"}
          </Button>
          <Link
            href="/settings/audience-profiles"
            className="text-sm font-medium text-accent hover:underline"
          >
            View settings
          </Link>
        </div>
      </div>
    </div>
  );
}
