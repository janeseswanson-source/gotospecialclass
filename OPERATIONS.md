# Operations Runbook

Production ops for GoToSpecialClass (Vite/React SPA + Supabase Postgres/Edge +
an off-platform CP-SAT solver service). Health at a glance: **Admin → Settings →
System status** (calls the `health` edge function).

## Observability

- **Frontend errors** → Sentry (opt-in via `VITE_SENTRY_DSN`). The React
  `ErrorBoundary` and server-side job failures both report (`src/lib/observability.ts`).
- **Edge errors** → Sentry via `_shared/observability.ts::reportEdgeError` (opt-in
  via the `SENTRY_DSN` function secret). Wrapped in parser catches + `run-generation-job`.
- **Structured logs** → `_shared/observability.ts::structuredLog(level, fn, fields)`
  emits one JSON line with `school_id` / `generation_id` / `duration_ms` for tracing.
- **Product analytics** → PostHog (opt-in via `VITE_POSTHOG_KEY`).
- **AI usage / rate limits** → `ai_usage_log` (Admin → AI Costs).

## Required secrets

| Secret | Where | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | edge | all LLM features |
| `CPSAT_SOLVER_URL` / `CPSAT_SOLVER_KEY` | edge | off-platform solver (falls back to JS solver if unset) |
| `SENTRY_DSN` | edge | edge error reporting |
| `VITE_SENTRY_DSN`, `VITE_POSTHOG_KEY` | build | frontend Sentry / PostHog |
| `SUPABASE_SERVICE_ROLE_KEY` | edge | privileged writes (job worker, rate-limit log) |

---

## Runbook: Solver is down

**Symptom:** System status shows **CP-SAT solver: unreachable**; new generations
fall back to the JS solver (slower, lower ceiling) or `generate-cpsat` returns a
`solver_unavailable` code.

1. Confirm on Admin → Settings → System status (shows reachability + version).
2. Check the solver host directly: `curl $CPSAT_SOLVER_URL/health`.
3. If the solver box is down, restart it; verify `/health` returns `{version}`.
4. **No fix needed for users** — `run-generation-job` auto-detects
   `isSolverUnavailable` and continues via the JS fallback (`fallback_used=true`,
   `fallback_reason` recorded on the job). Quality may dip until the solver returns.
5. If the URL/key rotated, update the `CPSAT_SOLVER_URL` / `CPSAT_SOLVER_KEY`
   secrets and redeploy the edge functions.

## Runbook: Anthropic key exhausted / invalid

**Symptom:** AI features return a friendly error ("out of credit" / "key invalid");
System status shows **Anthropic key: missing** or users report 402/401 from AI.

1. Errors are already actionable — `describeAnthropicError` maps 401/402/429 to a
   clear message; clients show it via `aiErrorToast` with Retry.
2. Check the Anthropic console billing/credit. Add credit or rotate the key.
3. Update the `ANTHROPIC_API_KEY` secret; redeploy edge functions.
4. Meanwhile everything degrades gracefully: quotes/lesson-starters use static
   fallbacks; parsers surface the error without corrupting setup data.
5. If it's a **rate-limit spike** (many 429s), it may be our own per-user limits
   (see below), not Anthropic — check `ai_usage_log` volume per user.

## Runbook: Stuck / wedged generation job

**Symptom:** A `generation_jobs` row sits in `running`/`polishing` and never reaches
a terminal state; the user's page spins.

1. Inspect: `select id, status, phase, attempts, error, updated_at from
   generation_jobs where status not in ('complete','failed','cancelled') order by
   updated_at;`
2. The worker self-chains and guards steps with `attempts` (optimistic
   concurrency), and its outer catch marks the job `failed` — a true wedge is rare.
3. If `updated_at` is stale (> a few minutes) with no progress, mark it failed so
   the client stops waiting:
   `update generation_jobs set status='failed', error='manually failed (stuck)'
    where id='<id>';` (the client's realtime subscription resolves immediately).
4. The user can simply regenerate — a new job is independent.
5. Check Sentry for the `run-generation-job` exception to find the root cause.

## Runbook: Rate limiting (429s)

Per-user hourly caps live in `_shared/rateLimit.ts` (chat 30/hr, parsers &
generators 20/hr), counted from `ai_usage_log`. A user hitting the cap gets a
friendly toast. To investigate: `select feature, count(*) from ai_usage_log where
user_id='<id>' and created_at > now() - interval '1 hour' group by feature;`.
Adjust the `limit` argument in the relevant function if a cap is too tight.

## Data lifecycle

`prune_old_generations()` (weekly via pg_cron) removes generations older than 60
days that are **not** accepted, **not** the current version, and **not** in a
refinement chain. To run manually: `select public.prune_old_generations();`. If
pg_cron isn't available on the plan, call it from an external scheduler.

## CI quality gates

`.github/workflows/ci.yml` runs on every PR:

| Job | Gate | Secrets needed |
|---|---|---|
| `engine-sync` | `_engine/` copies match canonical source | — |
| `backend-deno` | edge type-check + engine/RLS/parser tests | RLS + parser tests **execute** only with `SUPABASE_*` / `ANTHROPIC_API_KEY` set; otherwise they self-skip |
| `frontend` | vitest + production build | — |
| `lighthouse` | perf ≥ 0.85 on the SPA shell | — |
| `lighthouse-authed` | perf ≥ 0.85 on `/app/dashboard` + `/app/schedule` | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| `a11y` | axe: no critical/serious violations on the 5 main pages | same `SUPABASE_*` (authed pages skip without them) |
| `solver` | pytest for the CP-SAT service | — |

**Authenticated Lighthouse + axe** work by seeding a throwaway test user + school +
generation via `scripts/ci-auth-setup.mjs` (writes `.ci-auth/session.json`); the
Lighthouse puppeteer hook (`scripts/lhci-puppeteer.cjs`) and the Playwright suite
(`tests/a11y/`) inject that session into `localStorage` so the gated routes render.
Point them at a **staging** project via repo secrets — never production. Run
locally with:
```
SUPABASE_URL=… SUPABASE_ANON_KEY=… SUPABASE_SERVICE_ROLE_KEY=… npm run ci:auth-setup
npm run build && npm run test:a11y          # axe sweep
npm run build && npm run lhci:authed        # authed Lighthouse
```

## Deploy notes

- The SPA is code-split; a new deploy rotates chunk hashes. `lazyWithRetry`
  (`src/lib/lazyWithRetry.ts`) retries a failed dynamic import and does one guarded
  hard reload, so users on the previous bundle don't see a white screen.
- After changing any edge function or migration: `supabase db push` +
  `supabase functions deploy`. New functions this pass: `health`,
  `parse-teacher-roster`, `parse-recess-nl`, `generate-lesson-starter`, `generate-quote`.
