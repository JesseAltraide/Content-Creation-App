"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export type Notice = {
  id: string;
  status: string;
  label: string;
  /** When the request last moved into this state, for ordering and for "2m ago". */
  at: string;
};

// What each state means to the person looking at it, in the words the emails use.
const COPY: Record<string, string> = {
  awaiting_source_selection: "Sources ready to pick",
  awaiting_angle_selection: "An angle is ready to choose",
  pending_approval: "A draft is ready to review",
  ready_to_schedule: "Ready to schedule",
  needs_human_attention: "Needs your attention",
};

function ago(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// The email is the notification you get when you are not here. This is the one you
// get when you are, and it does not wait for a scheduler: `requests` is already in
// the realtime publication (migration 006), so a status change reaches an open page
// immediately.
//
// Deliberately derived from the request rows themselves rather than from a separate
// notifications table. There is exactly one source of truth for whether something
// needs you, which is its status, and a second copy of that would be one more thing
// that can disagree with the first.
export default function NotificationBell({ initial }: { initial: Notice[] }) {
  const [notices, setNotices] = useState<Notice[]>(initial);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    const reload = async () => {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { notices?: Notice[] };
        if (!cancelled && Array.isArray(body.notices)) setNotices(body.notices);
      } catch {
        // Keeping whatever is on screen is the right failure: a stale list is much
        // better than an empty one that implies nothing needs you.
      }
    };

    // Realtime is the fast path, the poll is the one that actually guarantees
    // delivery. Both are here for the reason recorded against the working banner: a
    // socket has twice reported SUBSCRIBED in a real session and then delivered
    // nothing, which looks identical to having nothing to deliver.
    const poll = setInterval(reload, 60_000);

    let channel: ReturnType<typeof supabase.channel> | undefined;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (cancelled) return;
      if (session) supabase.realtime.setAuth(session.access_token);
      channel = supabase
        .channel(`notices-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table: "requests" }, () =>
          void reload()
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      clearInterval(poll);
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${notices.length > 0 ? ` (${notices.length})` : ""}`}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-black/5 hover:text-foreground"
      >
        {/* Inline rather than an icon dependency, which this project does not have. */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M8 1.5a4 4 0 0 0-4 4v2.2L2.6 10.2a.6.6 0 0 0 .5.9h9.8a.6.6 0 0 0 .5-.9L12 7.7V5.5a4 4 0 0 0-4-4Z"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path d="M6.4 13a1.7 1.7 0 0 0 3.2 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        {notices.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
            {notices.length}
          </span>
        )}
      </button>

      {open && (
        <>
          {/* Click anywhere else to dismiss, without trapping focus behind a modal. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-border bg-surface p-2 shadow-lg">
            {notices.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted">
                Nothing needs you right now. Anything waiting on you appears here as soon
                as it happens.
              </p>
            ) : (
              <ul className="flex flex-col">
                {notices.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/requests/${n.id}`}
                      prefetch={false}
                      onClick={() => setOpen(false)}
                      className="flex flex-col gap-0.5 rounded-lg px-2 py-2 hover:bg-black/5"
                    >
                      <span className="text-xs font-semibold text-foreground">
                        {COPY[n.status] ?? n.status}
                      </span>
                      <span className="truncate text-xs text-muted">{n.label}</span>
                      <span className="text-[11px] text-muted">{ago(n.at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
