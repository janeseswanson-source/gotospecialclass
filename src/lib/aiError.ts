// Shared, friendly error surface for AI actions (parsers, quote/lesson starters).
// The edge functions already return actionable messages via describeAnthropicError;
// this maps a failed `supabase.functions.invoke` result to a human line and shows
// a toast with a one-tap Retry, so every AI action fails the same, recoverable way.
import { toast } from "sonner";

/** Human, non-scary message from an invoke error / thrown error / edge payload. */
export function describeAiError(err: unknown): string {
  const e = err as { message?: string; error?: string; status?: number; rate_limited?: boolean } | null;
  const raw = (e?.error || e?.message || "").toString();
  if (e?.rate_limited || /hit the limit|requests per hour|too many requests/i.test(raw)) {
    return "You've reached the hourly limit for this AI feature. Try again in a little while.";
  }
  if (/rate limit|429/i.test(raw)) return "The AI is busy right now — give it a few seconds and retry.";
  if (/api key|not set up|ANTHROPIC/i.test(raw)) return "AI isn't configured yet. Add the ANTHROPIC_API_KEY secret.";
  if (/credit|billing|insufficient|402/i.test(raw)) return "The AI account is out of credit. Add credit in the Anthropic console.";
  if (/invalid json|502/i.test(raw)) return "The AI returned something unexpected. Try rewording, then retry.";
  if (/timeout|network|failed to fetch/i.test(raw)) return "Network hiccup reaching the AI. Check your connection and retry.";
  return raw.trim() || "The AI request didn't go through. Try again.";
}

/** Show a friendly error toast for a failed AI action, with an optional Retry. */
export function aiErrorToast(err: unknown, opts?: { retry?: () => void; title?: string }): void {
  const message = describeAiError(err);
  toast.error(opts?.title ?? "AI couldn't finish that", {
    description: message,
    action: opts?.retry ? { label: "Retry", onClick: opts.retry } : undefined,
  });
}
