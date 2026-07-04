// Smoke tests for the setup-wizard AI parsers. Each drives a TINY fixture through
// the SAME fast-model + forced-tool (or JSON) mechanism the edge function uses and
// asserts it returns rows the step can commit. These call the real Anthropic API,
// so they SKIP gracefully when ANTHROPIC_API_KEY is absent (CI without a key, local
// dev). Heavy npm SDK imports are dynamic (inside each test) so the module loads
// and skips cleanly when there's no key. Run with:
//   deno test --allow-env --allow-net --node-modules-dir=auto supabase/functions/_tests/
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const hasKey = !!Deno.env.get("ANTHROPIC_API_KEY");
const opts = { ignore: !hasKey, sanitizeResources: false, sanitizeOps: false } as const;

/** Forced-tool call on the fast model (official SDK) — dynamically imported. */
async function toolCall(system: string, user: string, tool: any) {
  const { anthropicClient, MODELS, firstToolUse } = await import("../_shared/anthropic.ts");
  const resp = await anthropicClient().messages.create({
    model: MODELS.fast,
    max_tokens: 2000,
    system,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: user }],
  });
  return firstToolUse(resp.content as any[], tool.name)?.input as any;
}

/** JSON generation on the fast model (AI SDK) — dynamically imported. */
async function jsonCall(prompt: string): Promise<any> {
  const { generateText } = await import("npm:ai");
  const { anthropicModel } = await import("../_shared/anthropic-aisdk.ts");
  const { MODELS } = await import("../_shared/anthropic.ts");
  const { text } = await generateText({ model: anthropicModel(MODELS.fast), prompt });
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
}

Deno.test("parse-specialist-template: extracts a specialist row", opts, async () => {
  const tsv = "Name\tSubject\tDays\tRoom\nMs. Rivera\tPhys Ed\tMWF\tGym";
  const out = await toolCall(
    "Normalize a specialist roster. subject ∈ Art,Music,PE,Library,STEAM,Technology,Science Lab,Garden,Other. working_days ⊆ Mon..Fri.",
    `Specialist sheet:\n\n${tsv}`,
    {
      name: "extract_specialists",
      description: "One entry per specialist.",
      input_schema: {
        type: "object",
        properties: {
          specialists: { type: "array", items: { type: "object", properties: { name: { type: "string" }, subject: { type: "string" }, working_days: { type: "array", items: { type: "string" } } }, required: ["name", "subject", "working_days"] } },
        },
        required: ["specialists"],
      },
    },
  );
  assert(Array.isArray(out.specialists) && out.specialists.length >= 1, "expected ≥1 specialist");
  assert(out.specialists[0].name.toLowerCase().includes("rivera"));
  assertEquals(out.specialists[0].subject, "PE");
});

Deno.test("parse-teacher-roster: extracts a teacher row", opts, async () => {
  const text = "Homeroom teachers:\nMrs. Khan - Kindergarten - Room 12 (no specials before 9)\nMr. Lee - 3rd grade - Room 20";
  const out = await toolCall(
    "Normalize a classroom-teacher roster. grade ∈ PreK,K,1..8 or a combo. Extract name, grade, room, preferences.",
    `Teacher roster:\n\n${text}`,
    {
      name: "extract_teachers",
      description: "One entry per teacher.",
      input_schema: {
        type: "object",
        properties: {
          teachers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, grade: { type: "string" }, room: { type: "string" }, preferences: { type: "string" } }, required: ["name"] } },
        },
        required: ["teachers"],
      },
    },
  );
  assert(Array.isArray(out.teachers) && out.teachers.length >= 2, "expected 2 teachers");
  assert(out.teachers.some((t: any) => /khan/i.test(t.name)));
});

Deno.test("parse-calendar: extracts a holiday event", opts, async () => {
  const out = await toolCall(
    "Extract school calendar events. event_type ∈ holiday,no_school,early_release,teacher_workday,event. Dates as YYYY-MM-DD.",
    "From the 2025-2026 calendar: Winter Break is Dec 22-26, 2025 (no school). Early release Nov 26.",
    {
      name: "extract_calendar_events",
      description: "Calendar events.",
      input_schema: {
        type: "object",
        properties: {
          events: { type: "array", items: { type: "object", properties: { title: { type: "string" }, event_type: { type: "string" }, event_date: { type: "string" }, end_date: { type: "string" } }, required: ["title", "event_type", "event_date"] } },
        },
        required: ["events"],
      },
    },
  );
  assert(Array.isArray(out.events) && out.events.length >= 1, "expected ≥1 event");
  assert(out.events.some((e: any) => /break|holiday|no.?school/i.test(`${e.title} ${e.event_type}`)));
});

Deno.test("parse-contractual-minutes: extracts a per-subject minute requirement", opts, async () => {
  const out = await toolCall(
    "Extract weekly contractual instructional minutes per subject from a contract snippet.",
    "Per the CBA, students receive 90 minutes of Art and 100 minutes of Music per week.",
    {
      name: "extract_contractual_minutes",
      description: "Per-subject weekly minutes.",
      input_schema: {
        type: "object",
        properties: {
          requirements: { type: "array", items: { type: "object", properties: { subject: { type: "string" }, minutes_per_week: { type: "number" } }, required: ["subject", "minutes_per_week"] } },
        },
        required: ["requirements"],
      },
    },
  );
  assert(Array.isArray(out.requirements) && out.requirements.length >= 1, "expected ≥1 requirement");
  assert(out.requirements.some((r: any) => /art/i.test(r.subject) && r.minutes_per_week >= 60));
});

Deno.test("parse-clubs-nl: extracts a club from free text", opts, async () => {
  const parsed = await jsonCall(
    `Extract clubs. Each: {"name","day_of_week","start_time","end_time","grades":[],"leader","location"}. STRICT JSON {"rows":[...]}.\n\nRobotics on Tuesdays 12:15-12:45 for grades 3-5, led by Mr. Chen in Room 14.`,
  );
  assert(Array.isArray(parsed.rows) && parsed.rows.length >= 1, "expected ≥1 club");
  assert(/robot/i.test(parsed.rows[0].name));
});

Deno.test("parse-recess-nl: extracts a grade-band recess window", opts, async () => {
  const parsed = await jsonCall(
    `Extract recess/lunch windows. Each: {"grade_band","am_recess_start","am_recess_end","lunch_start","lunch_end","pm_recess_start","pm_recess_end"} (HH:MM|null). STRICT JSON {"rows":[...]}.\n\nK-2 recess 10:00-10:20, lunch 11:30-12:00.`,
  );
  assert(Array.isArray(parsed.rows) && parsed.rows.length >= 1, "expected ≥1 band");
  const r = parsed.rows[0];
  assert(String(r.grade_band).includes("K") || String(r.grade_band).includes("2"));
  assertEquals(r.lunch_start, "11:30");
});
