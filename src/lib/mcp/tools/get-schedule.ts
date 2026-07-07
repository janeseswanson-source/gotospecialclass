// Fetch the most recent generated schedule blocks for a school.
import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_schedule",
  title: "Get current schedule",
  description:
    "Return the schedule blocks (day, time, subject, teacher, specialist, grade, room) from the most recent generation for a school. Optionally pass generation_id to fetch a specific one.",
  inputSchema: {
    school_id: z.string().uuid().describe("The school id."),
    generation_id: z
      .string()
      .uuid()
      .optional()
      .describe("Optional specific schedule_generations.id. Defaults to the latest for the school."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ school_id, generation_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const sb = supabaseForUser(ctx);

    let genId = generation_id;
    if (!genId) {
      const { data: gen, error: gerr } = await sb
        .from("schedule_generations")
        .select("id")
        .eq("school_id", school_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (gerr) return { content: [{ type: "text", text: gerr.message }], isError: true };
      if (!gen) {
        return {
          content: [{ type: "text", text: "No schedule has been generated for this school yet." }],
          structuredContent: { generation_id: null, blocks: [] },
        };
      }
      genId = gen.id;
    }

    const { data, error } = await sb
      .from("schedule_blocks")
      .select("day_of_week, start_time, end_time, subject, grade, room, week_label, teacher_id, specialist_id")
      .eq("generation_id", genId)
      .order("day_of_week")
      .order("start_time");
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify({ generation_id: genId, blocks: data ?? [] }, null, 2) }],
      structuredContent: { generation_id: genId, blocks: data ?? [] },
    };
  },
});
