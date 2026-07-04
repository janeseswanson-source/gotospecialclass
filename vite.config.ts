import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// Publishable Supabase values — safe to ship in client bundle. Used as
// build-time fallback when VITE_SUPABASE_* env vars are missing (e.g. when
// building from GitHub where .env is gitignored).
const FALLBACK_SUPABASE_URL = "https://xfvablheccsoskokihkf.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmdmFibGhlY2Nzb3Nrb2tpaGtmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwMTg3MjIsImV4cCI6MjA4ODU5NDcyMn0.ugpIEKlxaDOHt1PxLmBeHRqZ3sNJXknCILmIGjOYKjs";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Route chunks are already split via React.lazy; group stable vendors so they
    // cache across deploys and don't bloat any single feature chunk. Heavy,
    // point-of-use libs (pdf, exceljs, mermaid/shiki via streamdown) are pulled in
    // through dynamic import() and get their own async chunks automatically.
    rollupOptions: {
      output: {
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          "ui-vendor": [
            "@radix-ui/react-dialog",
            "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-tooltip",
            "cmdk",
            "vaul",
          ],
          "dnd-vendor": ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
          "charts-vendor": ["recharts"],
          "supabase-vendor": ["@supabase/supabase-js"],
        },
      },
    },
    // The initial route (index ≈ 124 KB gz) is the number that matters and is
    // enforced by React.lazy route-splitting. The remaining large chunks are all
    // dynamic-import()'d, off-critical-path libraries — @react-pdf (~1.45 MB) and
    // ExcelJS (~945 KB) — that only load when a coordinator exports. Set the warn
    // limit above those so the build stays clean without hiding real regressions.
    chunkSizeWarningLimit: 1600,
  },
  define: {
    __SUPABASE_URL_FALLBACK__: JSON.stringify(
      process.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL
    ),
    __SUPABASE_PUBLISHABLE_KEY_FALLBACK__: JSON.stringify(
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_SUPABASE_PUBLISHABLE_KEY
    ),
  },
}));
