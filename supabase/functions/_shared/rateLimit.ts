// Per-user rate limiting for LLM-backed edge functions, backed by ai_usage_log.
//
// enforceRateLimit() logs the attempt (so the Admin AI-costs page always sees
// demand) and counts the caller's attempts for a feature in a rolling window; if
// that exceeds the limit it returns { allowed: false } with a Retry-After hint and
// the function should respond 429. Fail-OPEN: if the counter query itself errors,
// we allow the call rather than hard-blocking a paying user on an infra blip.
//
// Requires a SERVICE-ROLE client (bypasses RLS to write/read the log). Typed as
// `any` because different functions import the client from `npm:` vs `esm.sh`, and
// those SupabaseClient generic types are not cross-assignable — only `.from(...)`
// is used here regardless.
// deno-lint-ignore no-explicit-any
type SupabaseAdminLike = any;

export interface RateLimitResult {
  allowed: boolean;
  /** Attempts counted in the window (including this one). */
  count: number;
  limit: number;
  /** Seconds until the oldest in-window attempt ages out (429 Retry-After). */
  retryAfterSec: number;
}

export interface RateLimitOptions {
  userId: string;
  workspaceId?: string | null;
  feature: string;
  /** Max attempts allowed within the window. */
  limit: number;
  /** Rolling window in minutes (default 60). */
  windowMinutes?: number;
}

export async function enforceRateLimit(
  admin: SupabaseAdminLike,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const windowMinutes = opts.windowMinutes ?? 60;
  const windowStart = new Date(Date.now() - windowMinutes * 60_000).toISOString();

  // Log THIS attempt first so it's counted and the admin feed reflects it.
  await admin.from("ai_usage_log").insert({
    user_id: opts.userId,
    workspace_id: opts.workspaceId ?? null,
    feature: opts.feature,
    tokens_used: 0,
    cost_estimate: 0,
  });

  const { count, error } = await admin
    .from("ai_usage_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", opts.userId)
    .eq("feature", opts.feature)
    .gte("created_at", windowStart);

  if (error || count == null) {
    // Fail open — never hard-block on a counter read failure.
    return { allowed: true, count: 0, limit: opts.limit, retryAfterSec: 0 };
  }

  const allowed = count <= opts.limit;
  return {
    allowed,
    count,
    limit: opts.limit,
    retryAfterSec: allowed ? 0 : Math.max(60, windowMinutes * 60),
  };
}

/** Standard 429 Response body + headers for an over-limit result. */
export function rateLimitResponse(result: RateLimitResult, corsHeaders: Record<string, string>): Response {
  return new Response(
    JSON.stringify({
      error: `You've hit the limit of ${result.limit} requests per hour for this feature. Try again shortly.`,
      rate_limited: true,
      retry_after_sec: result.retryAfterSec,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(result.retryAfterSec),
      },
    },
  );
}
