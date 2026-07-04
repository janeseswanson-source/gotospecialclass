// Minimal Sentry reporter for edge functions — no SDK, just a fetch to the Sentry
// store endpoint parsed from a SENTRY_DSN secret. Fully OPT-IN: with no DSN set,
// reportEdgeError() is a no-op (safe for local/dev). Fire-and-forget so it never
// blocks or fails the function's own response.
//
// Set the secret to enable:  supabase secrets set SENTRY_DSN=https://…@…/…

/**
 * Emit ONE structured JSON log line (parsed by the platform log viewer). Include
 * the common ops fields — function, school_id, generation_id, duration_ms — so
 * logs are filterable and a slow/failed request is traceable end to end.
 */
export function structuredLog(
  level: "info" | "warn" | "error",
  fn: string,
  fields: { school_id?: string; generation_id?: string; user_id?: string; duration_ms?: number; msg?: string; [k: string]: unknown },
): void {
  try {
    const line = JSON.stringify({ level, fn, ts: new Date().toISOString(), ...fields });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    console.log(`[${level}] ${fn}`, fields);
  }
}

interface Dsn { host: string; projectId: string; publicKey: string }

function parseDsn(dsn: string): Dsn | null {
  // https://<publicKey>@<host>/<projectId>
  const m = dsn.match(/^https:\/\/([^@]+)@([^/]+)\/(.+)$/);
  if (!m) return null;
  return { publicKey: m[1], host: m[2], projectId: m[3] };
}

/**
 * Report a caught error to Sentry (if SENTRY_DSN is configured). Attaches the
 * function name + any structured context as tags/extra. Never throws.
 */
export function reportEdgeError(
  error: unknown,
  context?: { function?: string; school_id?: string; generation_id?: string; user_id?: string; [k: string]: unknown },
): void {
  try {
    const dsn = Deno.env.get("SENTRY_DSN");
    if (!dsn) return;
    const parsed = parseDsn(dsn);
    if (!parsed) return;

    const err = error as { name?: string; message?: string; stack?: string };
    const event = {
      event_id: crypto.randomUUID().replace(/-/g, ""),
      timestamp: new Date().toISOString(),
      platform: "other",
      level: "error",
      server_name: context?.function ?? "edge-function",
      environment: Deno.env.get("SUPABASE_ENV") ?? "production",
      tags: {
        function: context?.function ?? "unknown",
        ...(context?.school_id ? { school_id: context.school_id } : {}),
      },
      extra: context ?? {},
      exception: {
        values: [{
          type: err?.name ?? "Error",
          value: (err?.message ?? String(error)).slice(0, 1000),
          stacktrace: err?.stack ? { frames: [{ function: err.stack.split("\n")[1]?.trim() ?? "" }] } : undefined,
        }],
      },
    };

    const url = `https://${parsed.host}/api/${parsed.projectId}/store/`;
    const auth = `Sentry sentry_version=7, sentry_client=edge/1.0, sentry_key=${parsed.publicKey}`;
    // Fire-and-forget: swallow all failures.
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Sentry-Auth": auth },
      body: JSON.stringify(event),
    }).catch(() => {});
  } catch {
    // never let observability break the function
  }
}
