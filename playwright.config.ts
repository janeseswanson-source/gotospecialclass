import { defineConfig, devices } from "@playwright/test";

// Playwright config for the accessibility (axe) sweep. Boots the built app with
// `vite preview` and runs the a11y suite against it. The suite injects the seeded
// Supabase session (scripts/ci-auth-setup.mjs → .ci-auth/session.json) so the
// auth-gated pages render; it self-skips the authed pages when no seed is present.
export default defineConfig({
  testDir: "./tests/a11y",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  use: {
    baseURL: process.env.CI_APP_URL || "http://localhost:4173",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
