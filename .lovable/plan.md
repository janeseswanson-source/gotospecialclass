## Why the browser shows a blank page

The published JS bundle throws `supabaseUrl is required` on load. Root cause: `.env` is git-ignored, so when the project builds from GitHub, `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are `undefined`, and `createClient(undefined, undefined)` crashes before React mounts. The Lovable preview works because the sandbox has the local `.env` file.

This started exactly when you pushed work via GitHub — that path doesn't carry the local `.env`.

## Fix

Make the Supabase URL and publishable key work without `.env`:

1. **`vite.config.ts`** — add a `define` block that injects the publishable Supabase URL and anon key as compile-time fallbacks (only used when `import.meta.env.*` is missing). These are publishable values (already in the existing client bundle), so it's safe.

2. **`src/integrations/supabase/client.ts`** — change the two `const` lines to fall back to the injected constants when the env vars are undefined. This is a minimal, two-line edit to an otherwise auto-generated file; needed because that file is the only consumer.

3. Re-publish so the new bundle (with the baked-in fallback) is served at `gotospecialclass.lovable.app`.

## Not in scope this turn

- Generator off-grid block alignment (separate, larger change).
- Fix-with-AI / drag-drop logic (already patched in previous turns).

## Technical detail

```ts
// vite.config.ts (added)
define: {
  __SUPABASE_URL__: JSON.stringify(process.env.VITE_SUPABASE_URL ?? "https://xfvablheccsoskokihkf.supabase.co"),
  __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "<anon key>"),
}

// client.ts
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? __SUPABASE_URL__;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? __SUPABASE_PUBLISHABLE_KEY__;
```

After these edits I'll trigger a fresh publish.
