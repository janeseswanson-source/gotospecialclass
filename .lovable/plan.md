## Problem

The preview is blank white. Vite is throwing:

```
Failed to resolve import "@/components/ui/toaster" from "src/App.tsx"
```

Every `@/...` import is broken — not just the toaster. That's why the whole app renders nothing.

## Root cause

After your recent GitHub push, four critical config files are missing from the repo root:

- `vite.config.ts` — defines the `@` → `./src` alias and the `lovable-tagger` / React SWC plugins
- `tsconfig.json`
- `tsconfig.app.json`
- `tsconfig.node.json`

Without `vite.config.ts`, Vite has no idea what `@/` means, so every `@/components/...`, `@/hooks/...`, `@/lib/...` import fails. The error happens to point at `toaster` because it's the first import in `App.tsx`, but it would fail on any of them.

The files were almost certainly in your local `.gitignore` (or never staged), so they didn't get pushed to GitHub, and the GitHub→Lovable sync then deleted them from the sandbox to match the repo.

## Fix

Recreate the four standard Lovable Vite config files at the project root:

1. **`vite.config.ts`** — React SWC plugin, `lovable-tagger` in dev, port 8080, `@` alias to `./src`.
2. **`tsconfig.json`** — references app + node tsconfigs, declares `@/*` path mapping.
3. **`tsconfig.app.json`** — standard Vite React app TS config with `@/*` paths and `include: ["src"]`.
4. **`tsconfig.node.json`** — TS config for `vite.config.ts` itself.

After write, restart the dev server so Vite picks up the new alias.

## Also recommended (to prevent recurrence)

On your local clone, check `.gitignore` — make sure these are NOT listed:
- `vite.config.ts`
- `tsconfig*.json`

Only `node_modules`, `dist`, and `.env*` (except the managed `.env`) should typically be ignored. Re-commit the configs from your local machine so they stay in GitHub.

## Out of scope

No source code changes — `App.tsx`, the toaster files, etc. are all fine. This is purely a missing-config problem.
