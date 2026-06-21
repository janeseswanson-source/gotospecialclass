// Shared Anthropic (Claude) access for edge functions — OFFICIAL SDK surface.
//
// anthropicClient() returns the @anthropic-ai/sdk client for non-streaming
// reasoning tasks (polish pass, conflict resolution, parsing) via
// messages.create with tool use. The streaming chat editor uses the Vercel
// AI SDK provider instead — that lives in ./anthropic-aisdk.ts so functions
// that only need the official SDK don't pull in the AI-SDK dependency.
//
// Model: Claude Opus 4.8 — Anthropic's smartest mainstream model, the right
// default for genuinely-smart schedule editing and review.
import Anthropic from "npm:@anthropic-ai/sdk@0.105.0";

export const CLAUDE_MODEL = "claude-opus-4-8";

export function anthropicApiKey(): string | null {
  return Deno.env.get("ANTHROPIC_API_KEY") ?? null;
}

/** Official SDK client. Throws a clear error if the key isn't configured. */
export function anthropicClient(): Anthropic {
  const apiKey = anthropicApiKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return new Anthropic({ apiKey });
}

/** Map an Anthropic SDK error to an actionable, user-facing message + status. */
export function describeAnthropicError(err: unknown): { status: number; message: string } {
  const e = err as { status?: number; message?: string };
  const status = typeof e?.status === "number" ? e.status : 500;
  if (status === 401) return { status: 401, message: "Claude API key is invalid. Check the ANTHROPIC_API_KEY secret." };
  if (status === 429) return { status: 429, message: "Claude rate limit reached. Try again shortly." };
  if (status === 400 && /credit|billing|insufficient/i.test(e?.message ?? "")) {
    return { status: 402, message: "Anthropic account is out of credit. Add credit in the Anthropic console." };
  }
  return { status: status >= 400 && status < 600 ? status : 500, message: e?.message ?? "Claude request failed" };
}

/** Pull the first tool_use block of a given name out of a messages.create response. */
export function firstToolUse(content: any[], name?: string): { id: string; input: any } | null {
  for (const block of content ?? []) {
    if (block?.type === "tool_use" && (!name || block.name === name)) {
      return { id: block.id, input: block.input };
    }
  }
  return null;
}

/** Concatenate all text blocks from a messages.create response. */
export function joinText(content: any[]): string {
  return (content ?? []).filter((b) => b?.type === "text").map((b) => b.text).join("").trim();
}
