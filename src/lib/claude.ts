import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getClaude() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  }
  return client;
}

export const GENERATION_MODEL = "claude-sonnet-5";
export const EVALUATION_MODEL = "claude-opus-5";
export const TRIAGE_MODEL = "claude-haiku-4-5-20251001";
