import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  // Mirror vite.config's build-time defines so modules that import the Supabase
  // client (via `__SUPABASE_*_FALLBACK__`) can be imported in unit tests.
  define: {
    __SUPABASE_URL_FALLBACK__: JSON.stringify(
      process.env.VITE_SUPABASE_URL || "https://xfvablheccsoskokihkf.supabase.co"
    ),
    __SUPABASE_PUBLISHABLE_KEY_FALLBACK__: JSON.stringify(
      process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "test-anon-key"
    ),
  },
});
