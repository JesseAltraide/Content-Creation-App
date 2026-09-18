import { z } from "zod";
import { blockSourceUrl } from "@/lib/source-quality";

const CHANNELS = ["linkedin", "x", "newsletter"] as const;

// Exported so the form can disable submit on exactly what the schema would reject,
// rather than keeping a second, drifting copy of the rule.
//
// Delegates to blockSourceUrl because a stored URL is eventually fetched by n8n from a
// server: https only, no credentials, no private or link-local addresses, no odd
// ports. A protocol check alone would have accepted http://169.254.169.254/ and handed
// it to the scraper.
export function isFetchableUrl(value: string): boolean {
  return blockSourceUrl(value) === null;
}

/** The reason a URL was refused, for showing the person what to fix. */
export function urlRejectionReason(value: string): string | null {
  return blockSourceUrl(value);
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
    /** Set once the author has seen the intake warnings and chosen to proceed anyway. */
    acknowledgedWarnings: z.boolean().optional(),
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
      // Reported one at a time with its own reason: "not a valid URL" is useless when
      // the actual problem is that it is http, or points at a private address.
      for (const url of urls) {
        const reason = blockSourceUrl(url);
        if (reason) {
          ctx.addIssue({ code: "custom", message: `${url}: ${reason}`, path: ["urls"] });
        }
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
