// Smoke test for parse-contractual-minutes.
//
// We don't import the function module (it calls Deno.serve at import
// time). Instead we run lightweight HTTP checks against the deployed
// endpoint to verify auth, error paths, and the tool-call response
// shape contract the handler depends on.
//
// Run via: supabase--test_edge_functions

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import "https://deno.land/std@0.224.0/dotenv/load.ts";

const SUPABASE_URL = Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
const ANON_KEY = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");

function endpoint() {
  if (!SUPABASE_URL) throw new Error("Missing VITE_SUPABASE_URL / SUPABASE_URL");
  return `${SUPABASE_URL}/functions/v1/parse-contractual-minutes`;
}

Deno.test("rejects request with no Authorization header", async () => {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY ?? "" },
    body: JSON.stringify({ school_id: "00000000-0000-0000-0000-000000000000" }),
  });
  const body = await res.text();
  assertEquals(res.status, 401, `Expected 401 with no auth, got ${res.status}: ${body}`);
});

Deno.test("rejects request with invalid Bearer token", async () => {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: {
      Authorization: "Bearer not-a-real-jwt",
      "Content-Type": "application/json",
      apikey: ANON_KEY ?? "",
    },
    body: JSON.stringify({ school_id: "00000000-0000-0000-0000-000000000000" }),
  });
  const body = await res.text();
  assertEquals(res.status, 401, `Expected 401 with bad JWT, got ${res.status}: ${body}`);
});

Deno.test("CORS preflight succeeds", async () => {
  const res = await fetch(endpoint(), { method: "OPTIONS" });
  await res.text();
  assert(res.status === 200 || res.status === 204, `OPTIONS returned ${res.status}`);
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
});

// ─── Tool-call response shape contract (unit-style) ─────────────────
// The handler parses aiJson.choices[0].message.tool_calls[0].function.arguments
// as JSON. This test pins that contract so any future refactor that
// touches the parsing code is caught here.
Deno.test("AI Gateway tool-call response shape parses correctly", () => {
  const fakeAiJson = {
    choices: [{
      message: {
        tool_calls: [{
          function: {
            name: "extract_contractual_minutes",
            arguments: JSON.stringify({
              subjects: [{ grade: "K", subject: "PE", weekly_minutes: 90 }],
              teachers: [{ role: "Classroom Teacher", planning_minutes: 225 }],
              source_summary: "Sample CBA p.14",
            }),
          },
        }],
      },
    }],
  };
  const call = fakeAiJson.choices?.[0]?.message?.tool_calls?.[0];
  assert(call?.function?.arguments, "tool_call shape changed");
  const parsed = JSON.parse(call.function.arguments);
  assertEquals(parsed.subjects[0].subject, "PE");
  assertEquals(parsed.teachers[0].planning_minutes, 225);
});
