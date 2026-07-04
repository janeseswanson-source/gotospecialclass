// Resilient React.lazy: a fresh deploy rotates chunk hashes, so a user with the
// old index still loaded can hit "Failed to fetch dynamically imported module"
// when they navigate. This wrapper retries the import a couple times (fresh
// network fetch), reports to Sentry, and — as a last resort for a genuine stale
// bundle — does ONE guarded hard reload to pull the new index.
import { lazy, type ComponentType } from "react";
import { captureError } from "@/lib/observability";

const RELOAD_GUARD = "lazyChunkReloadedAt";

function looksLikeChunkError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message ?? String(err);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Failed to fetch/i.test(msg);
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  factory: () => Promise<{ default: T }>,
  retries = 2,
) {
  return lazy(async () => {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const mod = await factory();
        // A clean load clears the reload guard so future stale deploys can reload again.
        try { sessionStorage.removeItem(RELOAD_GUARD); } catch { /* ignore */ }
        return mod;
      } catch (err) {
        if (attempt === retries) {
          captureError(err, { kind: "lazy_chunk_load" });
          // Genuine stale-bundle case: hard-reload once (guarded against a loop).
          if (looksLikeChunkError(err) && typeof window !== "undefined") {
            let alreadyReloaded = false;
            try {
              const last = Number(sessionStorage.getItem(RELOAD_GUARD) ?? "0");
              alreadyReloaded = Date.now() - last < 30_000; // don't reload twice in 30s
              if (!alreadyReloaded) sessionStorage.setItem(RELOAD_GUARD, String(Date.now()));
            } catch { /* ignore */ }
            if (!alreadyReloaded) {
              window.location.reload();
              // Return a never-resolving promise so Suspense holds until the reload.
              return new Promise<{ default: T }>(() => {});
            }
          }
          throw err;
        }
        // Back off briefly before retrying the import.
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }
    // Unreachable, but satisfies the type.
    throw new Error("lazyWithRetry: exhausted retries");
  });
}
