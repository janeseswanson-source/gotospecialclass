import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildConstraintContext, violations as constraintViolations, describeViolation } from "../_shared/constraints.ts";
import { anthropicClient, anthropicApiKey, CLAUDE_MODEL, firstToolUse, describeAnthropicError } from "../_shared/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ResolveBody {
  generation_id: string;
  conflicts?: Array<{ type?: string; message: string; suggestion?: string }>;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toMin(t?: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

type Iv = [number, number];
/** True if [s,e) overlaps any interval in `ivs`. Half-open: touching is OK. */
function overlapsAny(ivs: Iv[] | undefined, s: number, e: number): boolean {
  if (!ivs) return false;
  for (const [a, b] of ivs) if (s < b && e > a) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) return json(401, { error: "Unauthorized" });

    const body = (await req.json()) as ResolveBody;
    if (!body?.generation_id) return json(400, { error: "generation_id required" });

    const { data: gen, error: genErr } = await supabase
      .from("schedule_generations")
      .select("id, school_id, warnings")
      .eq("id", body.generation_id)
      .maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });

    const schoolId = gen.school_id;

    const [blocksRes, specRes, teachRes, recessRes, clubsRes, eventsRes, schoolRes] =
      await Promise.all([
        supabase.from("schedule_blocks").select("*").eq("generation_id", body.generation_id),
        supabase
          .from("specialists")
          .select("id, name, subject, working_days, location, class_duration")
          .eq("school_id", schoolId),
        supabase
          .from("classroom_teachers")
          .select("id, name, grade, room")
          .eq("school_id", schoolId),
        supabase.from("recess_lunch_config").select("*").eq("school_id", schoolId),
        supabase
          .from("clubs")
          .select("id, name, day_of_week, start_time, end_time, grades")
          .eq("school_id", schoolId),
        supabase
          .from("special_events")
          .select("name, event_date, start_time, end_time")
          .eq("school_id", schoolId),
        supabase
          .from("schools")
          .select("name, start_time, end_time, grades_served, class_duration, passing_time, early_release_day, early_release_end_time, recess_grade_bands")
          .eq("id", schoolId)
          .maybeSingle(),
      ]);

    const blocks = blocksRes.data ?? [];
    const specialists = specRes.data ?? [];
    const teachers = teachRes.data ?? [];
    const school = schoolRes.data ?? {};
    const conflicts =
      body.conflicts && body.conflicts.length > 0
        ? body.conflicts
        : (Array.isArray(gen.warnings) ? (gen.warnings as Array<{ type?: string; message: string; suggestion?: string }>) : []);

    if (!conflicts.length) {
      return json(200, { resolved: 0, applied: 0, message: "No conflicts to resolve." });
    }

    if (!anthropicApiKey()) return json(500, { error: "Claude isn't set up yet — add the ANTHROPIC_API_KEY secret to enable AI conflict fixing." });

    // ── Compute free slots for no_coverage hints ──
    const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const dayStart = toMin((school as any).start_time) ?? 8 * 60;
    const dayEnd = toMin((school as any).end_time) ?? 15 * 60;
    const defaultDur = (school as any).class_duration ?? 45;

    // Busy time intervals per specialist/teacher, keyed `${id}|${day}`.
    // Interval-based (not exact-start) so a 45-min block correctly blocks
    // any overlapping candidate slot, regardless of differing durations.
    const busySpec: Record<string, Iv[]> = {};
    const busyTeach: Record<string, Iv[]> = {};
    for (const b of blocks) {
      const s = toMin(b.start_time);
      const e = toMin(b.end_time);
      if (s === null || e === null) continue;
      if (b.specialist_id) (busySpec[`${b.specialist_id}|${b.day_of_week}`] ??= []).push([s, e]);
      if (b.teacher_id) (busyTeach[`${b.teacher_id}|${b.day_of_week}`] ??= []).push([s, e]);
    }

    // Identify uncovered grades from conflicts
    const noCoverageGrades = new Set<string>();
    for (const c of conflicts) {
      if (c.type === "no_coverage") {
        const m = c.message.match(/Grade\s+(\S+)\s+has\s+no/i);
        if (m) noCoverageGrades.add(m[1]);
      }
    }

    // For each uncovered grade, propose candidate (day, start, specialist, teacher) tuples
    const coverageHints: Array<{
      grade: string;
      teacher_id: string;
      teacher_name: string;
      specialist_id: string;
      specialist_name: string;
      subject: string;
      candidate_slots: Array<{ day: string; start_time: string; end_time: string }>;
    }> = [];

    for (const grade of noCoverageGrades) {
      const gradeTeachers = teachers.filter((t: any) => t.grade === grade);
      for (const t of gradeTeachers) {
        for (const s of specialists) {
          const workDays: string[] = (s as any).working_days ?? DAYS;
          const dur = (s as any).class_duration ?? defaultDur;
          const candidates: Array<{ day: string; start_time: string; end_time: string }> = [];
          for (const day of workDays) {
            if (!DAYS.includes(day)) continue;
            for (let mins = dayStart; mins + dur <= dayEnd; mins += 15) {
              const endMins = mins + dur;
              // Reject the whole candidate window if it overlaps any existing
              // block for this specialist or this class — not just an exact
              // start-minute collision.
              if (overlapsAny(busySpec[`${s.id}|${day}`], mins, endMins)) continue;
              if (overlapsAny(busyTeach[`${t.id}|${day}`], mins, endMins)) continue;
              const hh = String(Math.floor(mins / 60)).padStart(2, "0");
              const mm = String(mins % 60).padStart(2, "0");
              const start = `${hh}:${mm}:00`;
              const eh = String(Math.floor(endMins / 60)).padStart(2, "0");
              const em = String(endMins % 60).padStart(2, "0");
              candidates.push({ day, start_time: start, end_time: `${eh}:${em}:00` });
              if (candidates.length >= 3) break;
            }
            if (candidates.length >= 5) break;
          }
          if (candidates.length > 0) {
            coverageHints.push({
              grade,
              teacher_id: t.id,
              teacher_name: t.name,
              specialist_id: s.id,
              specialist_name: s.name,
              subject: s.subject,
              candidate_slots: candidates,
            });
          }
        }
      }
    }

    const compactBlocks = blocks.map((b: any) => ({
      id: b.id,
      day: b.day_of_week,
      start: b.start_time,
      end: b.end_time,
      subject: b.subject,
      grade: b.grade,
      room: b.room,
      week: b.week_label,
      specialist_id: b.specialist_id,
      teacher_id: b.teacher_id,
    }));

    // ── Build per-conflict filtered context ──────────────────────────
    // For each conflict, identify implicated specialist/teacher IDs and
    // produce a trimmed block list + candidate free slots so the model
    // only reasons about what's relevant, reducing hallucinations.
    const contextPerConflict = conflicts.map((c: any) => {
      const implSpecIds = new Set<string>();
      const implTeachIds = new Set<string>();

      // Parse IDs out of the conflict message / type
      const msgLower = (c.message ?? "").toLowerCase();
      for (const s of specialists) {
        if (msgLower.includes((s as any).name.toLowerCase())) implSpecIds.add((s as any).id);
      }
      for (const t of teachers) {
        if (msgLower.includes((t as any).name.toLowerCase())) implTeachIds.add((t as any).id);
      }
      // Also use blocks involved in double-bookings by extracting time/day signals
      const timePat = /\b(\d{2}:\d{2})\b/g;
      const dayPat = /\b(Mon|Tue|Wed|Thu|Fri)\b/;
      const dayMatch = c.message?.match(dayPat)?.[1];
      const timeMatches = [...(c.message ?? "").matchAll(timePat)].map(m => m[1]);

      // Collect blocks that are adjacent (±2) in time on the same day to implicated ids
      const relevantBlocks: typeof compactBlocks = [];
      const seen = new Set<string>();
      for (const b of compactBlocks) {
        const isImplSpec = b.specialist_id && implSpecIds.has(b.specialist_id);
        const isImplTeach = b.teacher_id && implTeachIds.has(b.teacher_id);
        const isOnDay = dayMatch ? b.day === dayMatch : true;
        if ((isImplSpec || isImplTeach) && isOnDay) {
          if (!seen.has(b.id)) { seen.add(b.id); relevantBlocks.push(b); }
          // Add grade-matched blocks from that day as context window
          for (const cb of compactBlocks) {
            if (cb.day === b.day && cb.grade === b.grade && !seen.has(cb.id)) {
              seen.add(cb.id); relevantBlocks.push(cb);
            }
          }
        }
      }
      // If no relevant blocks found (e.g. no_coverage), include all blocks for implicated grades
      if (relevantBlocks.length === 0) {
        const gradeMatch = c.message?.match(/Grade\s+(\S+)/i)?.[1];
        if (gradeMatch) {
          for (const b of compactBlocks) {
            if (b.grade === gradeMatch && !seen.has(b.id)) { seen.add(b.id); relevantBlocks.push(b); }
          }
        }
      }

      // Filter specialists/teachers: implicated + free candidates during conflict window
      const relevantSpecialists = (specialists as any[]).filter(s =>
        implSpecIds.has(s.id) ||
        // Include free specialists during the conflict window
        (dayMatch && timeMatches.length > 0 && !overlapsAny(
          busySpec[`${s.id}|${dayMatch}`],
          toMin(timeMatches[0])!,
          toMin(timeMatches[0])! + (defaultDur),
        ))
      );
      const relevantTeachers = (teachers as any[]).filter(t => implTeachIds.has(t.id));

      // Candidate free slots: for implicated specs, find open slots on the conflict day
      const candidateFreeSlots: Array<{ specialist_id: string; day: string; start_time: string; end_time: string }> = [];
      if (dayMatch) {
        for (const s of relevantSpecialists) {
          for (let mins = dayStart; mins + defaultDur <= dayEnd; mins += 15) {
            const endMins = mins + defaultDur;
            if (overlapsAny(busySpec[`${s.id}|${dayMatch}`], mins, endMins)) continue;
            const hh = String(Math.floor(mins / 60)).padStart(2, "0");
            const mm = String(mins % 60).padStart(2, "0");
            const eh = String(Math.floor(endMins / 60)).padStart(2, "0");
            const em = String(endMins % 60).padStart(2, "0");
            candidateFreeSlots.push({ specialist_id: s.id, day: dayMatch, start_time: `${hh}:${mm}:00`, end_time: `${eh}:${em}:00` });
            if (candidateFreeSlots.length >= 5) break;
          }
          if (candidateFreeSlots.length >= 5) break;
        }
      }

      return {
        conflict: c,
        relevant_blocks: relevantBlocks,
        relevant_specialists: relevantSpecialists,
        relevant_teachers: relevantTeachers,
        candidate_free_slots: candidateFreeSlots,
        coverage_hints: coverageHints.filter(h => {
          const gradeMatch = c.message?.match(/Grade\s+(\S+)/i)?.[1];
          return !gradeMatch || h.grade === gradeMatch;
        }),
      };
    });

    const system = `You are an expert K-6 elementary specials-rotation scheduler.
You receive pre-filtered context for each conflict. Each element in context_per_conflict contains only
the blocks, specialists, teachers, and free slots relevant to that specific conflict.

Rules:
- A specialist cannot teach two blocks at the same time on the same day/week.
- A teacher (class) cannot be in two specialist blocks at the same time on the same day/week.
- Blocks must not overlap recess, lunch, clubs, admin/PLC, or special events for the affected grade.
- Only modify regular specialist blocks (Art, Music, PE, Tech, Library, etc.). Do not touch Admin, PLC, Planning, Lunch, Recess.
- Prefer MOVING a block to an open slot over deleting. Delete only as a last resort.
- For each "no_coverage" conflict you MUST output one or more "inserts" using the coverage_hints provided.
- Keep block durations equal to the specialist's class_duration (or school default).
- Use 24h HH:MM:SS time format.
- Address EVERY conflict using ONLY the data provided for it in context_per_conflict.

Respond with ONLY a JSON object matching:
{
  "updates": [{ "block_id": string, "day_of_week"?: "Mon"|"Tue"|"Wed"|"Thu"|"Fri", "start_time"?: string, "end_time"?: string, "specialist_id"?: string|null, "room"?: string|null, "week_label"?: string|null, "reason": string }],
  "deletes": [{ "block_id": string, "reason": string }],
  "inserts": [{ "day_of_week": "Mon"|"Tue"|"Wed"|"Thu"|"Fri", "start_time": string, "end_time": string, "specialist_id": string, "teacher_id": string, "grade": string, "subject": string, "room"?: string|null, "week_label"?: string|null, "reason": string }],
  "summary": string
}`;

    const user = JSON.stringify({
      context_per_conflict: contextPerConflict,
      recess_lunch: recessRes.data ?? [],
      clubs: clubsRes.data ?? [],
      events: eventsRes.data ?? [],
      school,
    });

    type Plan = {
      updates?: Array<Record<string, any>>;
      deletes?: Array<{ block_id: string; reason?: string }>;
      inserts?: Array<Record<string, any>>;
      summary?: string;
    };

    // Claude returns the resolution plan as a forced tool call — structured
    // output with no fragile JSON-from-prose parsing.
    const RESOLVE_TOOL = {
      name: "apply_resolution",
      description: "Apply the schedule changes that resolve the listed conflicts. Only touch regular specialist blocks; prefer moving over deleting.",
      input_schema: {
        type: "object",
        properties: {
          updates: { type: "array", items: { type: "object", properties: {
            block_id: { type: "string" }, day_of_week: { type: ["string", "null"] }, start_time: { type: ["string", "null"] },
            end_time: { type: ["string", "null"] }, specialist_id: { type: ["string", "null"] }, room: { type: ["string", "null"] },
            week_label: { type: ["string", "null"] }, reason: { type: "string" },
          }, required: ["block_id", "reason"] } },
          deletes: { type: "array", items: { type: "object", properties: { block_id: { type: "string" }, reason: { type: "string" } }, required: ["block_id"] } },
          inserts: { type: "array", items: { type: "object", properties: {
            day_of_week: { type: "string" }, start_time: { type: "string" }, end_time: { type: "string" },
            specialist_id: { type: "string" }, teacher_id: { type: "string" }, grade: { type: "string" }, subject: { type: "string" },
            room: { type: ["string", "null"] }, week_label: { type: ["string", "null"] }, reason: { type: "string" },
          }, required: ["day_of_week", "start_time", "end_time", "specialist_id", "teacher_id", "grade", "subject"] } },
          summary: { type: "string" },
        },
        required: ["summary"],
      },
    };

    let plan: Plan | null = null;
    const MAX_ATTEMPTS = 2;
    let lastErr: { status: number; message: string } | null = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const resp = await anthropicClient().messages.create({
          model: CLAUDE_MODEL,
          max_tokens: 8000,
          system,
          tools: [RESOLVE_TOOL as any],
          tool_choice: { type: "tool", name: "apply_resolution" },
          messages: [{ role: "user", content: user }],
        });
        plan = (firstToolUse(resp.content as any[], "apply_resolution")?.input ?? null) as Plan | null;
        if (plan) break;
      } catch (err) {
        lastErr = describeAnthropicError(err);
        if (lastErr.status === 429 || lastErr.status === 402 || lastErr.status === 401) return json(lastErr.status, { error: lastErr.message });
        if (attempt < MAX_ATTEMPTS) { await new Promise((r) => setTimeout(r, 400 * attempt)); continue; }
      }
    }

    if (!plan) {
      return json(lastErr?.status ?? 502, { error: lastErr?.message ?? "AI did not return a usable plan" });
    }

    const validBlockIds = new Set(blocks.map((b: any) => b.id));
    const validSpecIds = new Set(specialists.map((s: any) => s.id));
    const validTeacherIds = new Set(teachers.map((t: any) => t.id));
    const teacherById: Record<string, any> = Object.fromEntries(teachers.map((t: any) => [t.id, t]));
    const specById: Record<string, any> = Object.fromEntries(specialists.map((s: any) => [s.id, s]));

    const updates = (plan.updates ?? []).filter((u) => u?.block_id && validBlockIds.has(u.block_id));
    const deletes = (plan.deletes ?? []).filter((d) => d?.block_id && validBlockIds.has(d.block_id));
    const insertsRaw = plan.inserts ?? [];

    let applied = 0;
    const errors: string[] = [];
    const skipped: string[] = [];

    // Effective in-memory view of the schedule that we mutate as we accept
    // edits, so every subsequent edit is validated against the real
    // post-edit layout (interval overlap), not the stale original.
    type EffBlock = { id: string; day: string; start: number; end: number; spec: string | null; teacher: string | null };
    const effective: EffBlock[] = blocks
      .map((b: any) => {
        const s = toMin(b.start_time);
        const e = toMin(b.end_time);
        return s === null || e === null
          ? null
          : { id: b.id, day: b.day_of_week, start: s, end: e, spec: b.specialist_id ?? null, teacher: b.teacher_id ?? null };
      })
      .filter((x): x is EffBlock => x !== null);

    // Would a block occupying [start,end) on `day` for this specialist/teacher
    // collide with any effective block other than `ignoreId`?
    const collides = (day: string, start: number, end: number, spec: string | null, teacher: string | null, ignoreId?: string): boolean => {
      for (const e of effective) {
        if (e.id === ignoreId || e.day !== day) continue;
        if (!(start < e.end && e.start < end)) continue;
        if ((spec && e.spec === spec) || (teacher && e.teacher === teacher)) return true;
      }
      return false;
    };

    // Edit-time constraint context (school hours, recess/lunch, PLC/Admin
    // grade-range locks) mirroring the generator. Built from the ORIGINAL
    // blocks — PLC/Admin locks are never moved during resolution, so the lock
    // set is stable. Specialist/teacher overlap is still enforced by
    // `collides` against the running effective view, so here we only surface
    // the block-intrinsic + grade-lock violations (empty allBlocks).
    const constraintCtx = buildConstraintContext(school, recessRes.data ?? [], blocks);
    const blockById: Record<string, any> = Object.fromEntries(blocks.map((b: any) => [b.id, b]));
    const ruleViolations = (day: string | null, startTime?: string | null, endTime?: string | null, grade?: string | null, week?: string | null): string[] => {
      if (!day || !startTime || !endTime) return [];
      return constraintViolations(
        { day_of_week: day, start_time: startTime, end_time: endTime, grade: grade ?? null, week_label: week ?? null },
        [],
        constraintCtx,
      ).map(describeViolation);
    };

    const deleteIds = new Set(deletes.map((d) => d.block_id));
    // Apply deletes to the effective view first (they free up space).
    for (let i = effective.length - 1; i >= 0; i--) {
      if (deleteIds.has(effective[i].id)) effective.splice(i, 1);
    }

    for (const u of updates) {
      const cur = effective.find((e) => e.id === u.block_id);
      // Merge requested changes onto current state to validate the result.
      const newDay = u.day_of_week ?? cur?.day ?? null;
      const newStart = u.start_time ? toMin(u.start_time) : cur?.start ?? null;
      const newEnd = u.end_time ? toMin(u.end_time) : cur?.end ?? null;
      let newSpec = cur?.spec ?? null;
      if (u.specialist_id !== undefined && (u.specialist_id === null || validSpecIds.has(u.specialist_id))) {
        newSpec = u.specialist_id;
      }
      const newTeacher = cur?.teacher ?? null;
      if (newDay === null || newStart === null || newEnd === null || newEnd <= newStart) {
        skipped.push(`update ${u.block_id}: invalid time`);
        continue;
      }
      if (collides(newDay, newStart, newEnd, newSpec, newTeacher, u.block_id)) {
        skipped.push(`update ${u.block_id}: would overlap an existing block`);
        continue;
      }
      // Recess/lunch/PLC/hours: reject edits that violate the same rules the
      // generator enforces, not just specialist/teacher overlap.
      const origU = blockById[u.block_id];
      const ruleVio = ruleViolations(
        newDay,
        u.start_time ?? origU?.start_time,
        u.end_time ?? origU?.end_time,
        origU?.grade ?? null,
        u.week_label !== undefined ? u.week_label : (origU?.week_label ?? null),
      );
      if (ruleVio.length) {
        skipped.push(`update ${u.block_id}: ${ruleVio.join("; ")}`);
        continue;
      }
      const patch: Record<string, any> = { is_override: true };
      if (u.day_of_week) patch.day_of_week = u.day_of_week;
      if (u.start_time) patch.start_time = u.start_time;
      if (u.end_time) patch.end_time = u.end_time;
      if (u.room !== undefined) patch.room = u.room;
      if (u.week_label !== undefined) patch.week_label = u.week_label;
      if (u.specialist_id !== undefined && (u.specialist_id === null || validSpecIds.has(u.specialist_id))) {
        patch.specialist_id = u.specialist_id;
      }
      if (u.reason) patch.placement_reason = String(u.reason).slice(0, 500);
      const { error } = await supabase.from("schedule_blocks").update(patch).eq("id", u.block_id);
      if (error) { errors.push(`update ${u.block_id}: ${error.message}`); continue; }
      applied++;
      // Reflect the accepted update in the effective view.
      if (cur) { cur.day = newDay; cur.start = newStart; cur.end = newEnd; cur.spec = newSpec; }
    }

    if (deletes.length) {
      const ids = deletes.map((d) => d.block_id);
      const { error } = await supabase.from("schedule_blocks").delete().in("id", ids);
      if (error) errors.push(`delete: ${error.message}`);
      else applied += ids.length;
    }

    // Validate and apply inserts against the post-update/-delete layout.
    const validInserts: any[] = [];
    for (const ins of insertsRaw) {
      if (!ins?.day_of_week || !DAYS.includes(ins.day_of_week)) continue;
      if (!ins.start_time || !ins.end_time) continue;
      if (!ins.specialist_id || !validSpecIds.has(ins.specialist_id)) continue;
      if (!ins.teacher_id || !validTeacherIds.has(ins.teacher_id)) continue;
      const startM = toMin(ins.start_time);
      const endM = toMin(ins.end_time);
      if (startM === null || endM === null || endM <= startM) continue;
      if (startM < dayStart || endM > dayEnd) continue;
      if (collides(ins.day_of_week, startM, endM, ins.specialist_id, ins.teacher_id)) {
        skipped.push(`insert ${ins.grade ?? "?"} ${ins.day_of_week} ${ins.start_time}: would overlap`);
        continue;
      }
      const teachForGrade = teacherById[ins.teacher_id];
      const insVio = ruleViolations(ins.day_of_week, ins.start_time, ins.end_time, ins.grade ?? teachForGrade?.grade ?? null, ins.week_label ?? null);
      if (insVio.length) {
        skipped.push(`insert ${ins.grade ?? "?"} ${ins.day_of_week} ${ins.start_time}: ${insVio.join("; ")}`);
        continue;
      }
      const spec = specById[ins.specialist_id];
      const teach = teacherById[ins.teacher_id];
      validInserts.push({
        generation_id: body.generation_id,
        day_of_week: ins.day_of_week,
        start_time: ins.start_time,
        end_time: ins.end_time,
        specialist_id: ins.specialist_id,
        teacher_id: ins.teacher_id,
        grade: ins.grade ?? teach?.grade ?? null,
        subject: ins.subject ?? spec?.subject ?? null,
        room: ins.room ?? spec?.location ?? teach?.room ?? null,
        week_label: ins.week_label ?? null,
        is_override: true,
        placement_reason: ins.reason ? String(ins.reason).slice(0, 500) : null,
      });
      // Reserve the slot so later inserts can't double-book it.
      effective.push({ id: `__ins_${effective.length}`, day: ins.day_of_week, start: startM, end: endM, spec: ins.specialist_id, teacher: ins.teacher_id });
    }

    let insertedCount = 0;
    if (validInserts.length) {
      const { error } = await supabase.from("schedule_blocks").insert(validInserts);
      if (error) errors.push(`insert: ${error.message}`);
      else {
        insertedCount = validInserts.length;
        applied += insertedCount;
      }
    }

    // Clear warnings on the generation; the client will reload and recompute fresh ones
    await supabase
      .from("schedule_generations")
      .update({ warnings: [] })
      .eq("id", body.generation_id);

    return json(200, {
      resolved: conflicts.length,
      applied,
      updates: updates.length,
      deletes: deletes.length,
      inserts: insertedCount,
      summary: plan.summary ?? "",
      errors,
      skipped,
    });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
