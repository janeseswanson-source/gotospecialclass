// Error monitoring (Sentry) + product analytics (PostHog).
//
// Both are fully OPT-IN via env vars — with no keys set, every function here is
// a safe no-op, so local dev and preview builds stay clean. To enable in
// production, set in the hosting environment:
//   VITE_SENTRY_DSN      = https://…ingest.sentry.io/…
//   VITE_POSTHOG_KEY     = phc_…
//   VITE_POSTHOG_HOST    = https://us.i.posthog.com   (optional; this is default)
import * as Sentry from "@sentry/react";
import posthog from "posthog-js";

const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? "https://us.i.posthog.com";

let sentryOn = false;
let posthogOn = false;

/** Initialize once at app startup (called from main.tsx). */
export function initObservability() {
  if (SENTRY_DSN && !sentryOn) {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: import.meta.env.MODE,
      // Conservative sampling so this is cheap to leave on.
      tracesSampleRate: 0.1,
      replaysOnErrorSampleRate: 0.0,
      replaysSessionSampleRate: 0.0,
    });
    sentryOn = true;
  }
  if (POSTHOG_KEY && !posthogOn) {
    posthog.init(POSTHOG_KEY, {
      api_host: POSTHOG_HOST,
      capture_pageview: true, // funnel coverage with zero per-page wiring
      capture_pageleave: true,
      autocapture: true,
    });
    posthogOn = true;
  }
}

/** Report a caught error (e.g. from the React error boundary). */
export function captureError(error: unknown, context?: Record<string, unknown>) {
  if (sentryOn) Sentry.captureException(error, context ? { extra: context } : undefined);
  else console.error("[observability] captureError:", error, context ?? "");
}

/** Track a product event. No-ops without a PostHog key. */
export function track(event: string, props?: Record<string, unknown>) {
  if (posthogOn) posthog.capture(event, props);
}

/** Associate events with a signed-in user (call after login / on session load). */
export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  if (sentryOn) Sentry.setUser({ id: userId });
  if (posthogOn) posthog.identify(userId, traits);
}

/** Clear identity on sign-out. */
export function resetUser() {
  if (sentryOn) Sentry.setUser(null);
  if (posthogOn) posthog.reset();
}
