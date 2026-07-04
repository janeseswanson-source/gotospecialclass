// Accessibility (axe) sweep on the five main pages. Fails on CRITICAL / SERIOUS
// violations (the "criticals" the task targets); moderate/minor are reported but
// non-blocking. Authenticated pages use the seeded session from
// scripts/ci-auth-setup.mjs; when no seed is present they're skipped so a keyless
// run still exercises the public landing page.
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";

interface Seed {
  skipped: boolean;
  storageKey?: string;
  session?: unknown;
  schoolId?: string;
}

function loadSeed(): Seed {
  try {
    return JSON.parse(readFileSync(".ci-auth/session.json", "utf8"));
  } catch {
    return { skipped: true };
  }
}

const seed = loadSeed();
const authed = !seed.skipped && !!seed.session;

/** Inject the Supabase session into localStorage BEFORE app scripts run. */
async function injectSession(page: Page) {
  if (!authed) return;
  await page.addInitScript(
    ({ key, session, schoolId }) => {
      try {
        localStorage.setItem(key as string, JSON.stringify(session));
        if (schoolId) localStorage.setItem("selectedSchoolId", schoolId as string);
      } catch { /* ignore */ }
    },
    { key: seed.storageKey, session: seed.session, schoolId: seed.schoolId },
  );
}

async function runAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  if (blocking.length) {
    console.log(`\n[a11y:${label}] critical/serious violations:`);
    for (const v of blocking) {
      console.log(`  • ${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`);
      console.log(`    ${v.helpUrl}`);
    }
  }
  expect(blocking, `${label} has ${blocking.length} critical/serious a11y violations`).toEqual([]);
}

const PAGES: { label: string; path: string; needsAuth: boolean }[] = [
  { label: "landing", path: "/", needsAuth: false },
  { label: "dashboard", path: "/app/dashboard", needsAuth: true },
  { label: "master-schedule", path: "/app/schedule", needsAuth: true },
  { label: "specialist-planner", path: "/app/planner", needsAuth: true },
  { label: "lesson-planner", path: "/app/lesson-planner", needsAuth: true },
];

for (const p of PAGES) {
  test(`a11y: ${p.label}`, async ({ page }) => {
    test.skip(p.needsAuth && !authed, "no seeded session — set SUPABASE_* secrets to run authed a11y");
    await injectSession(page);
    await page.goto(p.path, { waitUntil: "networkidle" });
    // Give lazy route chunks + first data fetch a beat to settle.
    await page.waitForTimeout(1500);
    await runAxe(page, p.label);
  });
}
