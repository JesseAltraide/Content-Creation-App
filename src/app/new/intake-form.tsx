"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { isFetchableUrl } from "@/lib/intake-validation";

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
  toneSampleCounts,
}: {
  audienceProfiles: { id: string; name: string }[];
  toneSampleCounts: Record<string, number>;
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
  const [confirmedGenericTone, setConfirmedGenericTone] = useState<string[]>([]);
  const [describedTone, setDescribedTone] = useState<Record<string, string>>({});
  const [describingChannel, setDescribingChannel] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<{ kind: string; message: string }[]>([]);
  const [resonanceBlock, setResonanceBlock] = useState<{
    score: number;
    reason: string;
    profileName: string;
  } | null>(null);

  function toggleChannel(value: string) {
    setChannels((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  }

  const channelsMissingTone = channels.filter((c) => (toneSampleCounts[c] ?? 0) === 0);
  const toneResolved = channelsMissingTone.every(
    (c) => confirmedGenericTone.includes(c) || (describedTone[c]?.trim().length ?? 0) >= 20
  );

  // Mirrors the server schema field for field, using the same URL check it uses, so
  // the button cannot be enabled for input the route would reject. Listed rather than
  // just disabled: a dead button with no explanation is its own kind of bug, and the
  // person is left clicking it wondering what is wrong.
  const parsedUrls = urlsText
    .split(/\r?\n/)
    .map((u) => u.trim())
    .filter(Boolean);
  const missing: string[] = [];
  if (inputPath === "raw_idea" && rawIdea.trim().length < 10) {
    missing.push("a content idea (at least 10 characters)");
  }
  if (inputPath === "url") {
    if (parsedUrls.length === 0) missing.push("at least one source URL");
    else if (!parsedUrls.every(isFetchableUrl)) missing.push("valid http(s) source URLs");
  }
  if (!primaryKeyword.trim()) missing.push("a primary keyword");
  if (channels.length === 0) missing.push("at least one channel");
  // The tone gate has its own explanation block higher up the form, but that can be
  // off screen by the time someone reaches the button. Without this line the button
  // is disabled with nothing beside it saying why.
  if (!toneResolved) {
    const names = channelsMissingTone
      .filter((c) => !confirmedGenericTone.includes(c) && (describedTone[c]?.trim().length ?? 0) < 20)
      .join(", ");
    missing.push(`a tone decision for ${names} (see the tone panel above)`);
  }

  const canSubmit = missing.length === 0;

  async function handleSubmit(e: React.FormEvent, acknowledgedWarnings = false) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);
    setResonanceBlock(null);
    if (acknowledgedWarnings) setWarnings([]);

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
        confirmedGenericToneChannels: confirmedGenericTone,
        describedToneByChannel: describedTone,
        acknowledgedWarnings,
      }),
    });

    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      // The resonance block gets its own panel rather than a generic error line:
      // its whole job is to tell the author what to add, so the score, the profile
      // it was judged against and the reason all have to be visible.
      if (body.error === "low_resonance" && body.resonance) {
        setResonanceBlock(body.resonance);
        setErrors([]);
        return;
      }
      // Warnings, not a refusal: shown once, then the same submit goes through with
      // the acknowledgement set. Nothing has been created at this point, so going
      // back to fix the keyword or split the idea costs nothing.
      if (body.error === "intake_warnings" && Array.isArray(body.warnings)) {
        setWarnings(body.warnings);
        setErrors([]);
        return;
      }
      setResonanceBlock(null);
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

        {channelsMissingTone.length > 0 && (
          <div className="flex flex-col gap-3 rounded-lg bg-warning-soft px-3.5 py-3">
            <p className="text-sm font-medium text-warning">
              No tone samples yet for {channelsMissingTone.join(", ")}. Tone will be graded
              against nothing unless you choose one of the options below.
            </p>
            {channelsMissingTone.map((c) => {
              const usingGeneric = confirmedGenericTone.includes(c);
              const isDescribing = describingChannel === c;
              const hasDescription = (describedTone[c]?.trim().length ?? 0) >= 20;

              return (
                <div key={c} className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-warning">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`tone-choice-${c}`}
                        checked={usingGeneric}
                        onChange={() => {
                          setConfirmedGenericTone((prev) => [...new Set([...prev, c])]);
                          setDescribingChannel((prev) => (prev === c ? null : prev));
                          setDescribedTone((prev) => ({ ...prev, [c]: "" }));
                        }}
                        className="h-4 w-4 accent-warning"
                      />
                      Use a neutral professional default for {c}
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`tone-choice-${c}`}
                        checked={isDescribing || hasDescription}
                        onChange={() => {
                          setConfirmedGenericTone((prev) => prev.filter((x) => x !== c));
                          setDescribingChannel(c);
                        }}
                        className="h-4 w-4 accent-warning"
                      />
                      Describe the target tone instead
                    </label>
                  </div>
                  {(isDescribing || hasDescription) && (
                    <textarea
                      value={describedTone[c] ?? ""}
                      onChange={(e) =>
                        setDescribedTone((prev) => ({ ...prev, [c]: e.target.value }))
                      }
                      rows={2}
                      placeholder={`e.g. "confident but not salesy, short sentences, no corporate jargon". This becomes ${c}'s workspace tone sample going forward.`}
                      className="rounded-lg border border-warning/30 bg-surface px-3 py-2 text-sm outline-none focus:border-warning focus:ring-2 focus:ring-warning/20"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

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

        {resonanceBlock && (
          <div className="rounded-lg border border-danger/20 bg-danger-soft px-3.5 py-3 text-sm text-danger">
            <p className="font-medium">
              This idea scores {resonanceBlock.score}/15 against {resonanceBlock.profileName}, so it
              hasn&apos;t been submitted.
            </p>
            <p className="mt-1.5 text-danger/90">{resonanceBlock.reason}</p>
            <p className="mt-2 text-xs text-danger/80">
              Nothing has been researched or scraped yet. If there is an angle here for this
              audience, say what it is in the idea or context field above and submit again. Checked
              against the idea as written, not a charitable reading of it.
            </p>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning-soft px-3.5 py-3 text-sm text-warning">
            <p className="font-medium">
              {warnings.length === 1 ? "One thing worth checking" : "A couple of things worth checking"}{" "}
              before this goes off to research.
            </p>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-warning/90">
              {warnings.map((w) => (
                <li key={w.kind}>{w.message}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-warning/80">
              Nothing has been created yet, so fixing it above costs nothing. These are judgement
              calls, so if you meant it, carry on.
            </p>
            <div className="mt-3">
              <Button
                type="button"
                variant="secondary"
                disabled={submitting}
                onClick={(e) => handleSubmit(e as unknown as React.FormEvent, true)}
              >
                {submitting ? "Submitting…" : "Submit anyway"}
              </Button>
            </div>
          </div>
        )}

        {missing.length > 0 && (
          <p className="text-xs text-muted">
            Still needed: {missing.join(", ")}.
          </p>
        )}

        <Button type="submit" disabled={submitting || !canSubmit}>
          {submitting ? "Submitting…" : "Submit request"}
        </Button>
      </form>
    </Card>
  );
}
