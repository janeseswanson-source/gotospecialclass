// Shared Anthropic (Claude) access for edge functions — OFFICIAL SDK surface.
//
// anthropicClient() returns the @anthropic-ai/sdk client for non-streaming
// reasoning tasks (polish pass, conflict resolution, parsing) via
// messages.create with tool use. The streaming chat editor uses the Vercel
// AI SDK provider instead — that lives in ./anthropic-aisdk.ts so functions
// that only need the official SDK don't pull in the AI-SDK dependency.
//
import Anthropic from "npm:@anthropic-ai/sdk@0.105.0";

// Model tiers. Pick by task shape, not habit:
//   deep — hardest reasoning (document extraction, deep review narration). Opus 4.8,
//          overridable via the CLAUDE_MODEL_DEEP env secret.
//   chat — the interactive schedule editor: tool-loop heavy, engine does the hard
//          combinatorics, so Sonnet 4.6 is the right cost/latency point.
//   fast — cheap classification/summarization.
export const MODELS = {
  deep: Deno.env.get("CLAUDE_MODEL_DEEP")?.trim() || "claude-opus-4-8",
  chat: "claude-sonnet-4-6",
  fast: "claude-haiku-4-5",
} as const;

// Back-compat alias — existing callers that want "the smart one" keep working.
export const CLAUDE_MODEL = MODELS.deep;

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

/**
 * Extract structured data from an uploaded PDF or image using Claude vision +
 * a forced tool call. Claude reads PDFs and handwriting natively, so this
 * powers the take-in template / calendar / roster parsers. Returns the tool
 * input object (or {} if the model returned nothing usable).
 */
export async function extractFromFile(opts: {
  fileBase64: string;
  mimeType: string;
  system: string;
  userText: string;
  tool: { name: string; description: string; input_schema: any };
  maxTokens?: number;
  /** Model tier — defaults to `deep` for back-compat. Document extraction with a
   *  forced tool is well within `fast`'s reach, so parsers pass MODELS.fast. */
  model?: string;
}): Promise<Record<string, any>> {
  const isPdf = opts.mimeType === "application/pdf";
  const fileBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: opts.fileBase64 } }
    : { type: "image", source: { type: "base64", media_type: opts.mimeType, data: opts.fileBase64 } };
  const resp = await anthropicClient().messages.create({
    model: opts.model ?? CLAUDE_MODEL,
    max_tokens: opts.maxTokens ?? 4000,
    system: opts.system,
    tools: [opts.tool as any],
    tool_choice: { type: "tool", name: opts.tool.name },
    messages: [{ role: "user", content: [{ type: "text", text: opts.userText }, fileBlock as any] }],
  });
  return (firstToolUse(resp.content as any[], opts.tool.name)?.input ?? {}) as Record<string, any>;
}
