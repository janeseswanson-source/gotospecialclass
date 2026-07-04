// CI auth + data seed for the authenticated Lighthouse and axe (a11y) runs.
//
// Creates (idempotently) a test user + workspace + school + one schedule
// generation with a few blocks, signs the user in, and writes the Supabase
// session to .ci-auth/session.json. The Lighthouse puppeteer hook and the
// Playwright a11y suite both read that file and inject the session into the app's
// localStorage so the auth-gated routes (dashboard, master schedule, planners)
// actually render with data.
//
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// Exits 0 with a "skipped" marker when they're absent (so CI can no-op cleanly).
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const OUT_DIR = ".ci-auth";
const OUT = `${OUT_DIR}/session.json`;

const TEST_EMAIL = process.env.CI_TEST_EMAIL || "lhci@ci.test";
const TEST_PASSWORD = process.env.CI_TEST_PASSWORD || "Lhci-CI-Passw0rd!";

function writeSkip(reason) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify({ skipped: true, reason }));
  console.log(`[ci-auth-setup] skipped: ${reason}`);
}

if (!URL || !SERVICE || !ANON) {
  writeSkip("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY not set");
  process.exit(0);
}

const ref = new globalThis.URL(URL).host.split(".")[0];
const storageKey = `sb-${ref}-auth-token`;
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

async function ensureUser() {
  // Try to create; if it already exists, look it up.
  const { data: created, error } = await admin.auth.admin.createUser({
    email: TEST_EMAIL, password: TEST_PASSWORD, email_confirm: true,
  });
  if (created?.user) return created.user.id;
  if (error && !/already/i.test(error.message)) throw error;
  // Find existing.
  const { data: list } = await admin.auth.admin.listUsers();
  const found = list?.users?.find((u) => u.email === TEST_EMAIL);
  if (!found) throw new Error("could not create or find the CI test user");
  // Reset password so sign-in is deterministic.
  await admin.auth.admin.updateUserById(found.id, { password: TEST_PASSWORD });
  return found.id;
}

async function ensureData(userId) {
  // Workspace (reuse by owner if present).
  let workspaceId;
  const { data: ws } = await admin.from("workspaces").select("id").eq("owner_id", userId).limit(1).maybeSingle();
  if (ws?.id) workspaceId = ws.id;
  else {
    const { data: newWs, error } = await admin.from("workspaces").insert({ name: "CI Workspace", owner_id: userId }).select("id").single();
    if (error) throw error;
    workspaceId = newWs.id;
  }
  await admin.from("workspace_members").upsert({ workspace_id: workspaceId, user_id: userId, role: "owner" }, { onConflict: "workspace_id,user_id" });

  // School.
  let schoolId;
  const { data: school } = await admin.from("schools").select("id").eq("workspace_id", workspaceId).limit(1).maybeSingle();
  if (school?.id) schoolId = school.id;
  else {
    const { data: newSchool, error } = await admin.from("schools").insert({
      name: "CI Elementary", workspace_id: workspaceId, start_time: "08:00", end_time: "15:00",
      grades_served: ["K", "1", "2", "3", "4", "5"], setup_complete: true,
    }).select("id").single();
    if (error) throw error;
    schoolId = newSchool.id;
  }

  // A specialist + teacher so the planners have something to render.
  const { data: existingSpec } = await admin.from("specialists").select("id").eq("school_id", schoolId).limit(1).maybeSingle();
  if (!existingSpec) await admin.from("specialists").insert({ school_id: schoolId, name: "CI Art", subject: "Art" });
  const { data: existingTeacher } = await admin.from("classroom_teachers").select("id").eq("school_id", schoolId).limit(1).maybeSingle();
  if (!existingTeacher) await admin.from("classroom_teachers").insert({ school_id: schoolId, name: "CI Teacher", grade: "3" });

  // One generation with a couple of blocks (so master-schedule renders content).
  const { data: gen } = await admin.from("schedule_generations").select("id").eq("school_id", schoolId).order("version", { ascending: false }).limit(1).maybeSingle();
  let generationId = gen?.id;
  if (!generationId) {
    const { data: newGen, error } = await admin.from("schedule_generations").insert({ school_id: schoolId, version: 1, status: "complete" }).select("id").single();
    if (error) throw error;
    generationId = newGen.id;
    const spec = (await admin.from("specialists").select("id").eq("school_id", schoolId).limit(1).maybeSingle()).data;
    const teacher = (await admin.from("classroom_teachers").select("id").eq("school_id", schoolId).limit(1).maybeSingle()).data;
    await admin.from("schedule_blocks").insert([
      { generation_id: generationId, school_id: schoolId, day_of_week: "Mon", start_time: "09:00:00", end_time: "09:45:00", subject: "Art", grade: "3", specialist_id: spec?.id ?? null, teacher_id: teacher?.id ?? null },
      { generation_id: generationId, school_id: schoolId, day_of_week: "Wed", start_time: "10:00:00", end_time: "10:45:00", subject: "Art", grade: "4", specialist_id: spec?.id ?? null, teacher_id: teacher?.id ?? null },
    ]);
  }
  return { workspaceId, schoolId, generationId };
}

try {
  const userId = await ensureUser();
  const ids = await ensureData(userId);

  const auth = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data: signIn, error: sErr } = await auth.auth.signInWithPassword({ email: TEST_EMAIL, password: TEST_PASSWORD });
  if (sErr || !signIn.session) throw new Error(`sign-in failed: ${sErr?.message}`);

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    skipped: false,
    appUrl: process.env.CI_APP_URL || "http://localhost:4173",
    storageKey,
    session: signIn.session,
    ...ids,
  }, null, 2));
  console.log(`[ci-auth-setup] seeded + wrote ${OUT} (school ${ids.schoolId})`);
} catch (e) {
  console.error("[ci-auth-setup] FAILED:", e?.message || e);
  process.exit(1);
}
