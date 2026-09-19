"use client";

import { useEffect, useState } from "react";

/**
 * A timestamp rendered in the reader's own locale and timezone.
 *
 * Server and browser almost never agree on `toLocaleString()`: the server formats in
 * its own locale and UTC, the browser in yours. React compares the two during
 * hydration, finds different text, and throws "Hydration failed because the server
 * rendered text that didn't match". The console filled with them.
 *
 * So nothing locale-dependent is rendered on the server at all. The ISO date goes out
 * in the HTML, which is stable, readable and correct, and the local formatting takes
 * over once the component has mounted and there is nothing left to compare against.
 *
 * `suppressHydrationWarning` covers the one frame between the two.
 */
export default function LocalTime({
  value,
  mode = "datetime",
  className,
}: {
  value: string | null | undefined;
  /** "time" for the technical log, where the date is already obvious from context. */
  mode?: "datetime" | "time" | "date";
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const text = !mounted
    ? // Server and first client render: identical by construction.
      value.replace("T", " ").slice(0, 19) + " UTC"
    : mode === "time"
      ? date.toLocaleTimeString()
      : mode === "date"
        ? date.toLocaleDateString()
        : date.toLocaleString();

  return (
    <span className={className} suppressHydrationWarning>
      {text}
    </span>
  );
}
