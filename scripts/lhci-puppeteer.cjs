// LHCI puppeteer hook — runs once before the authenticated Lighthouse collection.
// Injects the seeded Supabase session (from scripts/ci-auth-setup.mjs) into the
// app origin's localStorage so the auth-gated routes render instead of bouncing to
// /login. localStorage is shared across pages of the same origin in the browser
// context, so the subsequent audit pages pick it up.
const fs = require("node:fs");

module.exports = async (browser) => {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(".ci-auth/session.json", "utf8"));
  } catch {
    console.log("[lhci-puppeteer] no .ci-auth/session.json — running unauthenticated");
    return;
  }
  if (data.skipped) {
    console.log(`[lhci-puppeteer] auth seed skipped (${data.reason}) — running unauthenticated`);
    return;
  }

  const page = await browser.newPage();
  // Load the origin root (redirects to /login, but the origin is established so we
  // can write localStorage for it).
  await page.goto(data.appUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ({ key, session, schoolId }) => {
      localStorage.setItem(key, JSON.stringify(session));
      // Nudge the app to pre-select the seeded school if it persists a choice.
      if (schoolId) localStorage.setItem("selectedSchoolId", schoolId);
    },
    { key: data.storageKey, session: data.session, schoolId: data.schoolId },
  );
  await page.close();
  console.log("[lhci-puppeteer] injected authenticated session");
};
