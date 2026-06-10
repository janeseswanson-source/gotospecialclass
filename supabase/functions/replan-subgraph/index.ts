import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    const body = await req.json() as {
      generation_id: string;
      scope: { specialist_ids?: string[]; grade?: string; day?: string };
    };
    if (!body?.generation_id) return json(400, { error: "generation_id required" });
    if (!body?.scope) return json(400, { error: "scope required" });

    const { data: gen, error: genErr } = await supabase
      .from("schedule_generations")
      .select("id, school_id")
      .eq("id", body.generation_id)
      .maybeSingle();
    if (genErr || !gen) return json(404, { error: "Generation not found" });

    const schoolId = gen.school_id;
    const scope = body.scope;

    // Load all blocks for this generation
    const { data: allBlocks, error: blocksErr } = await supabase
      .from("schedule_blocks")
      .select("*")
      .eq("generation_id", body.generation_id);
    if (blocksErr) return json(500, { error: blocksErr.message });

    const blocks = allBlocks ?? [];

    // Identify disturbed blocks matching the scope
    const disturbedIds = new Set<string>();
    for (const b of blocks) {
      if (b.grade === "Lunch" || b.grade === "Planning" || b.grade === "Makeup") continue;
      const matchSpec = scope.specialist_ids?.length ? scope.specialist_ids.includes(b.specialist_id) : true;
      const matchGrade = scope.grade ? b.grade === scope.grade : true;
      const matchDay = scope.day ? b.day_of_week === scope.day : true;
      if (matchSpec && matchGrade && matchDay && b.specialist_id) {
        disturbedIds.add(b.id);
      }
    }

    if (disturbedIds.size === 0) {
      return json(200, { replanned: 0, message: "No blocks matched the scope." });
    }

    // Locked block IDs = everything NOT disturbed (except system blocks).
    // generate-schedule creates a NEW generation (version) and copies these
    // locked blocks forward into it, regenerating only the disturbed scope
    // around them. We deliberately DO NOT delete the disturbed blocks from the
    // current generation: that would mutate/corrupt the old version, and if the
    // regen below failed the old schedule would be left damaged. Leaving it
    // untouched makes replan atomic — the old version stays a pristine prior
    // version, and the new version only materializes if generation succeeds.
    const lockedBlockIds = blocks
      .filter(b => !disturbedIds.has(b.id) && b.subject !== "Specialist Lunch")
      .map(b => b.id);

    // Call generate-schedule with locked_block_ids
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const regenResp = await fetch(`${supabaseUrl}/functions/v1/generate-schedule`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        school_id: schoolId,
        locked_block_ids: lockedBlockIds,
        replan_generation_id: body.generation_id,
      }),
    });

    if (!regenResp.ok) {
      const errBody = await regenResp.text();
      return json(regenResp.status, { error: `Replan failed: ${errBody.slice(0, 300)}` });
    }

    const regenData = await regenResp.json();
    return json(200, {
      replanned: disturbedIds.size,
      new_generation_id: regenData.generation_id,
      blocks_count: regenData.blocks_count,
      warnings_count: regenData.warnings_count,
    });
  } catch (e: any) {
    return json(500, { error: e?.message ?? "Unknown error" });
  }
});
