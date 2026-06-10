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
  define: {
    __SUPABASE_URL_FALLBACK__: JSON.stringify(
      process.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL
    ),
    __SUPABASE_PUBLISHABLE_KEY_FALLBACK__: JSON.stringify(
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY || FALLBACK_SUPABASE_PUBLISHABLE_KEY
    ),
  },
}));
