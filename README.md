# GoToSpecialClass

AI-powered "specials" rotation scheduling for K–6 elementary schools. A workspace
owner runs a setup wizard (school hours, recess/lunch, specialists, teachers,
contractual minutes, admin/PLC rotations, clubs, events, conflict strategy), then
generates a conflict-free weekly specials rotation. The Master Schedule page is an
editable grid with drag-and-drop, an AI chat editor, AI conflict resolution,
per-block explanations, version compare, and PDF exports.

## Stack

- **Frontend:** Vite · React 18 · TypeScript · shadcn/ui · Tailwind
- **Backend:** Supabase (Postgres + Auth + RLS + Deno Edge Functions)
- **AI:** Google Gemini via the Lovable AI Gateway
- **Scheduling core:** multi-strategy solver + seeded Monte Carlo + simulated
  annealing + a weighted scorer (`supabase/functions/generate-schedule/`)

## Development

This project is built and hosted on [Lovable](https://lovable.dev); changes pushed
to this repo are reflected there.

```sh
npm install      # install dependencies
npm run dev      # start the Vite dev server
npm run build    # production build
npm run lint     # eslint
npm run test     # frontend unit tests (vitest)
```

### Edge function tests (Deno)

The scheduler and shared helpers have a Deno test suite:

```sh
deno test --no-check supabase/functions/generate-schedule/
deno test supabase/functions/_shared/constraints_test.ts
```

## Project structure

- `src/pages/schedule/` — Master Schedule grid, exports, AI chat panel
- `src/pages/setup/` — multi-step setup wizard
- `src/lib/` — schedule grid math, conflict detection, subject theming
- `supabase/functions/` — edge functions:
  - `generate-schedule` — the constraint solver
  - `schedule-chat` + `apply-schedule-edits` — AI editor (propose → confirm → apply)
  - `resolve-conflicts-ai` / `verify-schedule` / `explain-schedule` — AI assists
  - `replan-subgraph` — partial regeneration into a new version
  - `_shared/constraints.ts` — single source of truth for placement validity
- `supabase/migrations/` — schema + RLS policies
