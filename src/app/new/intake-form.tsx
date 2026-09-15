"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const CHANNELS = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "x", label: "X" },
  { value: "newsletter", label: "Newsletter" },
] as const;

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
    <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-6">
      <div className="flex gap-2">
        {(["raw_idea", "url"] as const).map((path) => (
          <button
            type="button"
            key={path}
            onClick={() => setInputPath(path)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              inputPath === path
                ? "bg-neutral-900 text-white"
                : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
            }`}
          >
            {path === "raw_idea" ? "Raw idea" : "Source URL(s)"}
          </button>
        ))}
      </div>

      {inputPath === "raw_idea" ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Content idea</span>
          <textarea
            value={rawIdea}
            onChange={(e) => setRawIdea(e.target.value)}
            rows={3}
            placeholder="What's the article about?"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
          />
        </label>
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Source URL(s)</span>
          <span className="text-xs text-neutral-500">One per line. Two or more is recommended.</span>
          <textarea
            value={urlsText}
            onChange={(e) => setUrlsText(e.target.value)}
            rows={4}
            placeholder="https://example.com/article"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-mono outline-none focus:border-neutral-500"
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
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Primary keyword *</span>
        <input
          value={primaryKeyword}
          onChange={(e) => setPrimaryKeyword(e.target.value)}
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Desired length</span>
        <input
          value={desiredLength}
          onChange={(e) => setDesiredLength(e.target.value)}
          placeholder="e.g. 800-1000 words"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Channels *</span>
        <div className="flex gap-2">
          {CHANNELS.map((c) => (
            <button
              type="button"
              key={c.value}
              onClick={() => toggleChannel(c.value)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                channels.includes(c.value)
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
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
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
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
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-500"
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
        <ul className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}
