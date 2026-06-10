// Applies a batch of schedule edits PROPOSED by the AI chat (schedule-chat),
// after the user reviews and clicks "Apply". Every op is re-validated here with
// the SAME shared constraint validator the generator uses — the client is never
// trusted to have validated correctly, and the DB state may have changed since
// the proposal was made. Invalid ops are skipped and reported, not applied.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildConstraintContext,
  violations as constraintViolations,
  describeViolation,
  type ConstraintBlock,
} from "../_shared/constraints.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type EditOp =
  | { kind: "move"; block_id: string; day_of_week: string; start_time: string; end_time: string }
  | { kind: "swap"; a_id: string; a_day: string; a_start: string; a_end: string; b_id: string; b_day: string; b_start: string; b_end: string }
  | { kind: "delete"; block_id: string }
  | { kind: "insert"; day_of_week: string; start_time: string; end_time: string; subject: string; specialist_id: string | null; teacher_id: string | null; grade: string | null; room: string | null; week_label: string | null };

interface Eff extends ConstraintBlock {
  id: string;
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
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return json(401, { error: "Unauthorized" });

    const body = (await req.json()) as { generation_id?: string; ops?: EditOp[] };
    const generationId = body?.generation_id;
    const ops = Array.isArray(body?.ops) ? body.ops : [];
    if (!generationId) return json(400, { error: "generation_id required" });
    if (ops.length === 0) return json(200, { applied: 0, skipped: [], message: "No changes to apply." });

    // RLS gates this — if the user can't see the generation, gen is null.
    const { data: gen, error: genErr } = await supabase
      .from("schedule_generations")
      .select("id, school_id")
      .eq("id", generationId)
      .maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });

    const [blocksRes, recessRes, schoolRes] = await Promise.all([
      supabase.from("schedule_blocks").select("*").eq("generation_id", generationId),
      supabase.from("recess_lunch_config").select("*").eq("school_id", gen.school_id),
      supabase
        .from("schools")
        .select("start_time, end_time, early_release_day, early_release_end_time, recess_grade_bands")
        .eq("id", gen.school_id)
        .maybeSingle(),
    ]);

    const blocks = (blocksRes.data ?? []) as any[];
    const school = schoolRes.data ?? {};
    const ctx = buildConstraintContext(school, recessRes.data ?? [], blocks as ConstraintBlock[]);

    // Effective in-memory view that we mutate as edits are accepted, so each op
    // is validated against the real post-edit layout (interval overlap + rules).
    const effective: Eff[] = blocks.map((b) => ({
      id: b.id,
      day_of_week: b.day_of_week,
      start_time: b.start_time,
      end_time: b.end_time,
      specialist_id: b.specialist_id ?? null,
      teacher_id: b.teacher_id ?? null,
      grade: b.grade ?? null,
      week_label: b.week_label ?? null,
    }));
    const effById = new Map(effective.map((e) => [e.id, e]));

    let applied = 0;
    const skipped: string[] = [];
    // Ids of blocks that were moved/swapped/inserted — the client highlights
    // these in the grid so the user can SEE what the AI changed.
    const changedBlockIds: string[] = [];

    const describe = (codes: ReturnType<typeof constraintViolations>) => codes.map(describeViolation).join(" and ");

    for (const op of ops) {
      try {
        if (op.kind === "delete") {
          const idx = effective.findIndex((e) => e.id === op.block_id);
          if (idx === -1) { skipped.push(`delete ${op.block_id}: block no longer exists`); continue; }
          const { error } = await supabase.from("schedule_blocks").delete().eq("id", op.block_id);
          if (error) { skipped.push(`delete ${op.block_id}: ${error.message}`); continue; }
          effective.splice(idx, 1);
          effById.delete(op.block_id);
          applied++;
          continue;
        }

        if (op.kind === "move") {
          const cur = effById.get(op.block_id);
          if (!cur) { skipped.push(`move ${op.block_id}: block no longer exists`); continue; }
          if (!DAYS.includes(op.day_of_week)) { skipped.push(`move ${op.block_id}: invalid day`); continue; }
          const candidate: ConstraintBlock = { ...cur, day_of_week: op.day_of_week, start_time: op.start_time, end_time: op.end_time };
          const vios = constraintViolations(candidate, effective, ctx);
          if (vios.length) { skipped.push(`move ${op.block_id}: ${describe(vios)}`); continue; }
          const { error } = await supabase.from("schedule_blocks").update({
            day_of_week: op.day_of_week, start_time: op.start_time, end_time: op.end_time, is_override: true,
          }).eq("id", op.block_id);
          if (error) { skipped.push(`move ${op.block_id}: ${error.message}`); continue; }
          cur.day_of_week = op.day_of_week; cur.start_time = op.start_time; cur.end_time = op.end_time;
          changedBlockIds.push(op.block_id);
          applied++;
          continue;
        }

        if (op.kind === "swap") {
          const a = effById.get(op.a_id);
          const b = effById.get(op.b_id);
          if (!a || !b) { skipped.push(`swap ${op.a_id}/${op.b_id}: a block no longer exists`); continue; }
          // Validate both new placements against everyone EXCEPT the two being swapped.
          const others = effective.filter((e) => e.id !== a.id && e.id !== b.id);
          const candA: ConstraintBlock = { ...a, day_of_week: op.a_day, start_time: op.a_start, end_time: op.a_end };
          const candB: ConstraintBlock = { ...b, day_of_week: op.b_day, start_time: op.b_start, end_time: op.b_end };
          const viosA = constraintViolations(candA, [...others, candB], ctx);
          const viosB = constraintViolations(candB, [...others, candA], ctx);
          if (viosA.length || viosB.length) {
            skipped.push(`swap ${op.a_id}/${op.b_id}: ${describe([...viosA, ...viosB])}`);
            continue;
          }
          const { error: e1 } = await supabase.from("schedule_blocks").update({
            day_of_week: op.a_day, start_time: op.a_start, end_time: op.a_end, is_override: true,
          }).eq("id", a.id);
          if (e1) { skipped.push(`swap ${op.a_id}/${op.b_id}: ${e1.message}`); continue; }
          const { error: e2 } = await supabase.from("schedule_blocks").update({
            day_of_week: op.b_day, start_time: op.b_start, end_time: op.b_end, is_override: true,
          }).eq("id", b.id);
          if (e2) {
            // Roll back the first update so we don't leave a half-swap.
            await supabase.from("schedule_blocks").update({
              day_of_week: a.day_of_week, start_time: a.start_time, end_time: a.end_time,
            }).eq("id", a.id);
            skipped.push(`swap ${op.a_id}/${op.b_id}: ${e2.message}`);
            continue;
          }
          a.day_of_week = op.a_day; a.start_time = op.a_start; a.end_time = op.a_end;
          b.day_of_week = op.b_day; b.start_time = op.b_start; b.end_time = op.b_end;
          changedBlockIds.push(op.a_id, op.b_id);
          applied += 2;
          continue;
        }

        if (op.kind === "insert") {
          if (!DAYS.includes(op.day_of_week)) { skipped.push(`insert ${op.day_of_week}: invalid day`); continue; }
          const candidate: ConstraintBlock = {
            day_of_week: op.day_of_week, start_time: op.start_time, end_time: op.end_time,
            specialist_id: op.specialist_id, teacher_id: op.teacher_id, grade: op.grade, week_label: op.week_label,
          };
          const vios = constraintViolations(candidate, effective, ctx);
          if (vios.length) { skipped.push(`insert ${op.grade ?? "?"} ${op.day_of_week} ${op.start_time}: ${describe(vios)}`); continue; }
          const { data: inserted, error } = await supabase.from("schedule_blocks").insert({
            generation_id: generationId,
            day_of_week: op.day_of_week,
            start_time: op.start_time,
            end_time: op.end_time,
            subject: op.subject,
            specialist_id: op.specialist_id,
            teacher_id: op.teacher_id,
            grade: op.grade,
            room: op.room,
            week_label: op.week_label,
            is_override: true,
          }).select("id").single();
          if (error || !inserted) { skipped.push(`insert ${op.grade ?? "?"} ${op.day_of_week} ${op.start_time}: ${error?.message ?? "failed"}`); continue; }
          const eff: Eff = { id: inserted.id, ...candidate };
          effective.push(eff);
          effById.set(inserted.id, eff);
          changedBlockIds.push(inserted.id);
          applied++;
          continue;
        }
      } catch (opErr: any) {
        skipped.push(`${(op as any).kind ?? "op"}: ${opErr?.message ?? "unexpected error"}`);
      }
    }

    return json(200, { applied, skipped, changed_block_ids: changedBlockIds });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
