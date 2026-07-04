import { Loader2 } from "lucide-react";

/**
 * Suspense fallback for lazy-loaded route chunks. Deliberately minimal (no
 * layout shift, brand-neutral) so it reads as "loading" for a beat and then
 * yields to the real page. Respects prefers-reduced-motion via the `motion-safe`
 * variant — the spinner only animates when motion is allowed.
 */
export function RouteFallback() {
  return (
    <div
      className="flex min-h-[60vh] w-full items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="h-6 w-6 text-muted-foreground motion-safe:animate-spin" aria-hidden />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default RouteFallback;
