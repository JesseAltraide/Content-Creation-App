"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const CHANNELS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "newsletter", label: "Newsletter" },
] as const;

const inputClass =
  "rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

function SegmentedButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-accent text-accent-foreground shadow-sm shadow-accent/20"
          : "bg-background text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

export default function IntakeForm({
  audienceProfiles,
}: {
  audienceProfiles: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [inputPath, setInputPath] = useState<"raw_idea" | "url">("raw_idea");
  const [rawIdea, setRawIdea] = useState("");
  const [urlsText, setUrlsText] = useState("");
  const [context, setContext] = useState("");
  const [primaryKeyword, setPrimaryKeyword] = useState("");
  const [desiredLength, setDesiredLength] = useState("");
  const [channels, setChannels] = useState<string[]>(["linkedin", "x", "newsletter"]);
  const [audienceProfileId, setAudienceProfileId] = useState("");
  const [xThreadLength, setXThreadLength] = useState("single");
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  function toggleChannel(value: string) {
    setChannels((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);

    const urls = urlsText
      .split("\n")
      .map((u) => u.trim())
      .filter(Boolean);

    const res = await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inputPath,
        rawIdea,
        urls,
        context,
        primaryKeyword,
        desiredLength,
        channels,
        audienceProfileId: audienceProfileId || null,
        xThreadLength,
      }),
    });

    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setErrors(
        body.issues?.map((i: { message: string }) => i.message) ?? [body.error ?? "Something went wrong."]
      );
      return;
    }

    router.push(`/requests/${body.request.id}`);
  }

  return (
    <Card className="mt-8 p-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex gap-1 rounded-lg bg-background p-1">
          <SegmentedButton active={inputPath === "raw_idea"} onClick={() => setInputPath("raw_idea")}>
            Raw idea
          </SegmentedButton>
          <SegmentedButton active={inputPath === "url"} onClick={() => setInputPath("url")}>
            Source URL(s)
          </SegmentedButton>
        </div>

        {inputPath === "raw_idea" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Content idea</span>
            <textarea
              value={rawIdea}
              onChange={(e) => setRawIdea(e.target.value)}
              rows={3}
              placeholder="What's the article about?"
              className={inputClass}
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Source URL(s)</span>
            <span className="text-xs text-muted">One per line. Two or more is recommended.</span>
            <textarea
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              rows={4}
              placeholder="https://example.com/article"
              className={`${inputClass} font-mono`}
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Optional context</span>
          <textarea
            value={context}
            onChange={(e) => setContext(e.target.value)}
            rows={2}
            placeholder="e.g. focus on the enterprise angle"
            className={inputClass}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Primary keyword *</span>
            <input
              value={primaryKeyword}
              onChange={(e) => setPrimaryKeyword(e.target.value)}
              className={inputClass}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Desired length</span>
            <input
              value={desiredLength}
              onChange={(e) => setDesiredLength(e.target.value)}
              placeholder="e.g. 800-1000 words"
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Channels *</span>
          <div className="flex gap-2">
            {CHANNELS.map((c) => (
              <button
                type="button"
                key={c.value}
                onClick={() => toggleChannel(c.value)}
                className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                  channels.includes(c.value)
                    ? "bg-accent text-accent-foreground shadow-sm shadow-accent/20"
                    : "bg-background text-muted hover:text-foreground"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {channels.includes("x") && (
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">X post length</span>
            <select
              value={xThreadLength}
              onChange={(e) => setXThreadLength(e.target.value)}
              className={inputClass}
            >
              <option value="single">Single post</option>
              <option value="mini">Mini-thread (~3 posts)</option>
              <option value="expansive">Expansive thread (~5 posts)</option>
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Audience profile</span>
          <select
            value={audienceProfileId}
            onChange={(e) => setAudienceProfileId(e.target.value)}
            className={inputClass}
          >
            <option value="">Auto-match best fit</option>
            {audienceProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        {errors.length > 0 && (
          <ul className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}

        <Button type="submit" disabled={submitting}>
          {submitting ? "Submitting…" : "Submit request"}
        </Button>
      </form>
    </Card>
  );
}
