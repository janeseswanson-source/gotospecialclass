import { pdf } from "@react-pdf/renderer";
import { createElement } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SpecialistPlanner, type PlannerBlock, type RecessRow } from "@/pdf/SpecialistPlanner";
import { enumerateWeeks, getMondayOf } from "@/pdf/lib/weekDates";
import { logActivity } from "@/lib/activityLogger";

interface Options {
  schoolId: string;
  generationId: string;
  specialistId: string | "all";
  weeksCount: number;
  includeNotesBox: boolean;
  userId?: string | null;
}

export async function exportTeacherPlanner(opts: Options): Promise<boolean> {
  try {
    const { schoolId, generationId, specialistId, weeksCount, includeNotesBox, userId } = opts;

    let specQuery = supabase.from("specialists").select("id, name, subject").eq("school_id", schoolId);
    if (specialistId !== "all") specQuery = specQuery.eq("id", specialistId);

    const [{ data: rawBlocks }, { data: specs }, { data: teachers }, { data: school }, { data: recess }, { data: calEvents }] = await Promise.all([
      supabase.from("schedule_blocks").select("*").eq("generation_id", generationId),
      specQuery,
      supabase.from("classroom_teachers").select("id, name, grade").eq("school_id", schoolId),
      supabase.from("schools").select("name").eq("id", schoolId).maybeSingle(),
      supabase.from("recess_lunch_config").select("*").eq("school_id", schoolId),
      supabase.from("parsed_calendar_events").select("event_date, end_date, title, event_type").eq("school_id", schoolId).eq("approved", true),
    ]);

    if (!rawBlocks?.length || !specs?.length) return false;

    const specMap = new Map((specs ?? []).map((s) => [s.id, s]));
    const teachMap = new Map((teachers ?? []).map((t) => [t.id, t]));

    const blocks: PlannerBlock[] = (rawBlocks ?? []).map((b: any) => ({
      day_of_week: b.day_of_week,
      start_time: b.start_time,
      end_time: b.end_time,
      subject: b.subject,
      specialist_id: b.specialist_id,
      specialist_name: b.specialist_id ? specMap.get(b.specialist_id)?.name ?? null : null,
      teacher_name: b.teacher_id ? teachMap.get(b.teacher_id)?.name ?? null : null,
      grade: b.grade,
      week_label: b.week_label ?? null,
      notes: b.notes ?? null,
    }));

    const weeks = enumerateWeeks(getMondayOf(new Date()), weeksCount);
    const hasAB = blocks.some((b) => !!b.week_label);
    const weekLabels: (undefined | "A" | "B")[] = hasAB ? ["A", "B"] : [undefined];

    const element = createElement(SpecialistPlanner, {
      specialists: specs.map((s) => ({ id: s.id, name: s.name, subject: s.subject })),
      blocks,
      schoolName: school?.name,
      weeks,
      weekLabels,
      recessConfig: (recess ?? []) as RecessRow[],
      includeNotesBox,
      calendarEvents: calEvents ?? [],
    });

    const blob = await pdf(element as any).toBlob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `teacher-planner-${stamp}.pdf`;
    a.click();
    URL.revokeObjectURL(url);

    await supabase.from("export_records").insert({
      school_id: schoolId,
      generation_id: generationId,
      export_type: "teacher_planner_pdf",
      format: "pdf",
      created_by: userId ?? null,
    });
    logActivity("export_downloaded", { format: "pdf", type: "teacher_planner_pdf" });

    return true;
  } catch (err) {
    console.error("exportTeacherPlanner failed", err);
    return false;
  }
}
