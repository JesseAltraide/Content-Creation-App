import Link from "next/link";

const TABS = [
  { href: "/settings/audience-profiles", label: "Audience profiles" },
  { href: "/settings/tone-samples", label: "Tone samples" },
] as const;

export default function SettingsNav({ active }: { active: string }) {
  return (
    <div className="flex items-center justify-between">
      <Link href="/" className="text-sm font-medium text-muted hover:text-foreground">
        ← Back to requests
      </Link>
      <div className="flex gap-1 rounded-lg bg-background p-1">
        {TABS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              active === t.href
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
