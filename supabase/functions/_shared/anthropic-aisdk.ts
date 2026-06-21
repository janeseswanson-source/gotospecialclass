// Vercel AI SDK Anthropic provider — for the STREAMING chat editor only.
// Kept separate from ./anthropic.ts so functions that use the official SDK
// (messages.create) don't pull in the AI-SDK provider dependency.
//
// v2 provider line — matches the project's AI SDK (ai@6 + @ai-sdk/*@2).
import { createAnthropic } from "npm:@ai-sdk/anthropic@2.0.83";
import { CLAUDE_MODEL, anthropicApiKey } from "./anthropic.ts";

/** AI SDK model handle for streamText() in the chat editor. */
export function anthropicModel(modelId: string = CLAUDE_MODEL) {
  const apiKey = anthropicApiKey();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return createAnthropic({ apiKey })(modelId);
}
