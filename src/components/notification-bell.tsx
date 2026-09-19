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

const SEEN_KEY = "content-agent:notices-seen";

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
  // What has already been looked at. Keyed by request AND status, so a request that
  // moves from "draft ready" to "needs attention" counts as new again: it is a
  // different thing to tell someone, even though it is the same request.
  const [seen, setSeen] = useState<Set<string>>(new Set());

  // Per browser, in localStorage, deliberately. A "read" marker is a property of the
  // person looking, not of the request, and the alternative is a table and a write on
  // every glance. The cost is that it does not follow you to another device, which for
  // a count that only says "look here" is a fair trade.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SEEN_KEY);
      if (raw) setSeen(new Set(JSON.parse(raw) as string[]));
    } catch {
      // Private windows and blocked site data both throw. An empty set just means
      // everything reads as unread, which is the safe direction to fail.
    }
  }, []);

  const keyOf = (n: Notice) => `${n.id}:${n.status}`;
  const unread = notices.filter((n) => !seen.has(keyOf(n)));

  // Opening the panel is what counts as reading them. Marking on click-through would
  // leave the badge lit for the ones you decided not to act on yet, which is the
  // behaviour being complained about.
  const markAllSeen = () => {
    const next = new Set(seen);
    for (const n of notices) next.add(keyOf(n));
    setSeen(next);
    try {
      // Only what is still live, so the list cannot grow without bound.
      window.localStorage.setItem(SEEN_KEY, JSON.stringify([...next].slice(-200)));
    } catch {
      // Nothing to do: the badge simply comes back on the next load.
    }
  };

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
        onClickCapture={() => { if (!open) markAllSeen(); }}
        aria-label={`Notifications${unread.length > 0 ? `, ${unread.length} unread` : ""}`}
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
        {unread.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-accent-foreground">
            {unread.length}
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
          {/* Capped and scrollable: eleven requests needing attention is a real state
              in this database, and at three lines each the panel ran off the page. */}
          <div className="absolute right-0 z-20 mt-2 max-h-80 w-72 overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg">
            {notices.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted">
                Nothing needs you right now.
              </p>
            ) : (
              <ul className="flex flex-col">
                {notices.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/requests/${n.id}`}
                      prefetch={false}
                      onClick={() => setOpen(false)}
                      className="flex flex-col gap-0.5 rounded-lg px-2 py-1.5 hover:bg-black/5"
                    >
                      {/* Status and age on one line, the request on the next. The age
                          was its own row purely because it was written that way. */}
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {COPY[n.status] ?? n.status}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted">{ago(n.at)}</span>
                      </span>
                      <span className="truncate text-xs text-muted">{n.label}</span>
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
