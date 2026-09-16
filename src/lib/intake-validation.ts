import { z } from "zod";

const CHANNELS = ["linkedin", "x", "newsletter"] as const;

function isFetchableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const intakeSchema = z
  .object({
    inputPath: z.enum(["raw_idea", "url"]),
    rawIdea: z.string().optional(),
    urls: z.array(z.string()).optional(),
    context: z.string().optional(),
    primaryKeyword: z.string().trim().min(1, "Primary keyword is required."),
    desiredLength: z.string().optional(),
    channels: z.array(z.enum(CHANNELS)).min(1, "Select at least one channel."),
    audienceProfileId: z.string().uuid().optional().nullable(),
    xThreadLength: z.enum(["single", "mini", "expansive"]).default("single"),
    confirmedGenericToneChannels: z.array(z.enum(CHANNELS)).optional().default([]),
    describedToneByChannel: z.record(z.string(), z.string()).optional().default({}),
  })
  .superRefine((data, ctx) => {
    const idea = data.rawIdea?.trim() ?? "";
    const urls = (data.urls ?? []).map((u) => u.trim()).filter(Boolean);

    if (data.inputPath === "raw_idea") {
      if (idea.length < 10) {
        ctx.addIssue({
          code: "custom",
          message: "Content idea must be a real idea (at least 10 characters), not a placeholder.",
          path: ["rawIdea"],
        });
      }
    }

    if (data.inputPath === "url") {
      if (urls.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: "At least one source URL is required.",
          path: ["urls"],
        });
      }
      const invalid = urls.filter((u) => !isFetchableUrl(u));
      if (invalid.length > 0) {
        ctx.addIssue({
          code: "custom",
          message: `Not a valid http(s) URL: ${invalid.join(", ")}`,
          path: ["urls"],
        });
      }
    }

    if (idea.length === 0 && urls.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Provide either a content idea or at least one source URL.",
        path: ["rawIdea"],
      });
    }
  });

export type IntakeInput = z.infer<typeof intakeSchema>;

export function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of urls) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}
