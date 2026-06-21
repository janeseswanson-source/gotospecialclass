// Branded master-schedule spreadsheet export.
//
// Uses ExcelJS (not the community `xlsx`, which silently drops all cell
// styling) so the workbook is genuinely on-brand: navy/gold/cream palette,
// subject-tinted cells, merged title band, frozen header, clean borders.
//
// Produces: a "Master Schedule" grid sheet (Time × Days) plus one sheet per
// specialist (their personal week) — "the entire master schedule, or any
// specialist's schedule, in a beautiful way."
import ExcelJS from "exceljs";
import { supabase } from "@/integrations/supabase/client";
import { formatTime } from "@/lib/utils";
import { NAVY, GOLD, CREAM, WHITE, MUTE, GRIDLINE, ZEBRA, subjectColors, parseMin } from "@/lib/exportColors";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const DAY_FULL: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };

function thinBorder(color = GRIDLINE) {
  return {
    top: { style: "thin" as const, color: { argb: color } },
    bottom: { style: "thin" as const, color: { argb: color } },
    left: { style: "thin" as const, color: { argb: color } },
    right: { style: "thin" as const, color: { argb: color } },
  };
}

interface Blk {
  day_of_week: string; start_time: string; end_time: string;
  subject: string | null; grade: string | null; week_label: string | null;
  specialist_id: string | null; teacher_id: string | null;
}

function buildBrandHeader(ws: ExcelJS.Worksheet, lastCol: number, title: string, sub: string) {
  const colLetter = ws.getColumn(lastCol).letter;
  // Title band (navy)
  ws.mergeCells(`A1:${colLetter}1`);
  const t = ws.getCell("A1");
  t.value = title;
  t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  t.font = { name: "Arial", size: 16, bold: true, color: { argb: WHITE } };
  t.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  ws.getRow(1).height = 36;
  // Subtitle band (gold rule on cream)
  ws.mergeCells(`A2:${colLetter}2`);
  const s = ws.getCell("A2");
  s.value = sub;
  s.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
  s.font = { name: "Arial", size: 9, italic: true, color: { argb: MUTE } };
  s.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  s.border = { bottom: { style: "medium", color: { argb: GOLD } } };
  ws.getRow(2).height = 22;
}

function headerCell(cell: ExcelJS.Cell, text: string) {
  cell.value = text;
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  cell.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE } };
  cell.alignment = { vertical: "middle", horizontal: "center" };
  cell.border = thinBorder(NAVY);
}

export async function exportScheduleXlsx(opts: {
  schoolId: string;
  generationId: string | null;
  schoolName?: string;
  schoolYear?: string;
}): Promise<boolean> {
  const { schoolId, generationId } = opts;
  if (!generationId) return false;

  const [{ data: school }, { data: specsData }, { data: teachData }, { data: blocksData }, { data: recessData }] = await Promise.all([
    supabase.from("schools").select("name, school_year, start_time, end_time").eq("id", schoolId).maybeSingle(),
    supabase.from("specialists").select("id, name, subject").eq("school_id", schoolId),
    supabase.from("classroom_teachers").select("id, name, grade").eq("school_id", schoolId),
    supabase.from("schedule_blocks").select("day_of_week, start_time, end_time, subject, grade, week_label, specialist_id, teacher_id").eq("generation_id", generationId),
    supabase.from("recess_lunch_config").select("*").eq("school_id", schoolId),
  ]);

  const blocks = (blocksData ?? []) as Blk[];
  if (!blocks.length) return false;
  const specs = specsData ?? [];
  const teachers = teachData ?? [];
  const specById = new Map(specs.map((s: any) => [s.id, s]));
  const teachById = new Map(teachers.map((t: any) => [t.id, t]));
  const schoolName = opts.schoolName ?? school?.name ?? "School";
  const schoolYear = opts.schoolYear ?? school?.school_year ?? "";

  // Recess/lunch windows (start → {end,label}) from all band rows.
  const bands = new Map<number, { end: number; label: string }>();
  for (const r of recessData ?? []) {
    if (r.am_recess_start && r.am_recess_end) bands.set(parseMin(r.am_recess_start), { end: parseMin(r.am_recess_end), label: "Recess" });
    if (r.pm_recess_start && r.pm_recess_end) bands.set(parseMin(r.pm_recess_start), { end: parseMin(r.pm_recess_end), label: "Recess" });
    if (r.lunch_start && r.lunch_end) bands.set(parseMin(r.lunch_start), { end: parseMin(r.lunch_end), label: "Lunch" });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "GoToSpecialClass";
  wb.created = new Date();

  const isTeaching = (b: Blk) => b.specialist_id && !/lunch|planning|plc|recess/i.test(b.subject ?? "") && (b.grade ?? "").toLowerCase() !== "lunch";

  // ── Sheet 1: Master Schedule grid ──
  const ms = wb.addWorksheet("Master Schedule", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }], properties: { defaultRowHeight: 18 } });
  ms.columns = [{ width: 16 }, ...DAYS.map(() => ({ width: 32 }))];
  buildBrandHeader(ms, DAYS.length + 1, `Master Schedule — ${schoolName}`, `${schoolYear ? schoolYear + "  ·  " : ""}${school?.start_time ? formatTime(school.start_time) : ""}–${school?.end_time ? formatTime(school.end_time) : ""}  ·  GoToSpecialClass`);

  // Day header row (row 3 is spacer-free; put headers at row 3)
  const hdr = ms.getRow(3);
  headerCell(hdr.getCell(1), "Time");
  DAYS.forEach((d, i) => headerCell(hdr.getCell(i + 2), DAY_FULL[d]));
  hdr.height = 26;

  // Distinct teaching start times.
  const starts = Array.from(new Set(blocks.filter(isTeaching).map((b) => b.start_time))).sort();
  const bandStarts = Array.from(bands.keys());
  const allStartMins = Array.from(new Set([...starts.map(parseMin), ...bandStarts])).sort((a, b) => a - b);

  for (const startMin of allStartMins) {
    const band = bands.get(startMin);
    const hasClass = blocks.some((b) => isTeaching(b) && parseMin(b.start_time) === startMin);
    const row = ms.addRow([]);
    if (band && !hasClass) {
      // Full-width recess/lunch band.
      ms.mergeCells(row.number, 1, row.number, DAYS.length + 1);
      const c = row.getCell(1);
      const hh = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      c.value = `${formatTime(hh(startMin))}–${formatTime(hh(band.end))}  ·  ${band.label.toUpperCase()}`;
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
      c.font = { name: "Arial", size: 9, bold: true, color: { argb: NAVY } };
      c.alignment = { vertical: "middle", horizontal: "center" };
      c.border = { top: { style: "thin", color: { argb: GOLD } }, bottom: { style: "thin", color: { argb: GOLD } } };
      row.height = 24;
      continue;
    }
    // Time cell.
    const startBlk = blocks.find((b) => parseMin(b.start_time) === startMin && isTeaching(b));
    const tc = row.getCell(1);
    tc.value = startBlk ? `${formatTime(startBlk.start_time)}\n${formatTime(startBlk.end_time)}` : formatTime(blocks.find(b=>parseMin(b.start_time)===startMin)?.start_time ?? "");
    tc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
    tc.font = { name: "Arial", size: 9, bold: true, color: { argb: NAVY } };
    tc.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    tc.border = thinBorder();

    let maxLines = 1;
    DAYS.forEach((day, i) => {
      const cell = row.getCell(i + 2);
      const cellBlocks = blocks.filter((b) => isTeaching(b) && b.day_of_week === day && parseMin(b.start_time) === startMin);
      if (cellBlocks.length === 0) {
        cell.border = thinBorder();
        return;
      }
      // Dedupe rotations by subject+teacher so repeats collapse like the
      // reference layout.
      const seen = new Set<string>();
      const rows = cellBlocks.filter((b) => {
        const k = `${(b.subject ?? "").toLowerCase()}|${b.teacher_id ?? ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const head = rows[0];
      const headSpec = head.specialist_id ? specById.get(head.specialist_id) : null;
      const headSubj = head.subject ?? headSpec?.subject ?? "";
      const { accent, fill } = subjectColors(headSubj);
      const rich: ExcelJS.RichText[] = [];
      // Header line: grade chip (bold accent) + week label if any.
      if (head.grade) {
        rich.push({ text: `${head.grade}`, font: { name: "Arial", size: 9, bold: true, color: { argb: accent } } });
        rich.push({ text: "  ", font: { name: "Arial", size: 9 } });
      }
      if (head.week_label) {
        rich.push({ text: `(Week ${head.week_label})`, font: { name: "Arial", size: 8, italic: true, color: { argb: MUTE } } });
      }
      // One row per rotation: "Subject  Teacher"
      rows.forEach((b) => {
        const spec = b.specialist_id ? specById.get(b.specialist_id) : null;
        const teach = b.teacher_id ? teachById.get(b.teacher_id) : null;
        const subj = b.subject ?? spec?.subject ?? "";
        const teacherName = teach?.name ?? spec?.name ?? "";
        rich.push({ text: "\n", font: { size: 7 } });
        rich.push({ text: subj.padEnd(8, " "), font: { name: "Arial", size: 9, bold: true, color: { argb: accent } } });
        if (teacherName) {
          rich.push({ text: `  ${teacherName}`, font: { name: "Arial", size: 9, color: { argb: NAVY } } });
        }
      });
      cell.value = { richText: rich };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 2 };
      cell.border = thinBorder();
      const lines = rows.length + 1;
      if (lines > maxLines) maxLines = lines;
    });
    // Generous row height so cells breathe (taller base + more per rotation line).
    row.height = Math.max(36, maxLines * 19);
  }

  // ── Per-specialist sheets ──
  for (const spec of specs) {
    const mine = blocks.filter((b) => b.specialist_id === spec.id && isTeaching(b));
    if (mine.length === 0) continue;
    const safe = (spec.name as string).replace(/[\\/?*[\]:]/g, "").slice(0, 28) || "Specialist";
    const ws = wb.addWorksheet(safe, { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }], properties: { defaultRowHeight: 18 } });
    ws.columns = [{ width: 16 }, ...DAYS.map(() => ({ width: 28 }))];
    buildBrandHeader(ws, DAYS.length + 1, `${spec.name} — ${spec.subject}`, `${schoolName}${schoolYear ? "  ·  " + schoolYear : ""}  ·  GoToSpecialClass`);
    const h = ws.getRow(3);
    headerCell(h.getCell(1), "Time");
    DAYS.forEach((d, i) => headerCell(h.getCell(i + 2), DAY_FULL[d]));
    h.height = 26;

    const myStarts = Array.from(new Set(mine.map((b) => b.start_time))).sort();
    const { accent, fill } = subjectColors(spec.subject);
    myStarts.forEach((st, ri) => {
      const row = ws.addRow([]);
      const tc = row.getCell(1);
      const ex = mine.find((b) => b.start_time === st)!;
      tc.value = `${formatTime(ex.start_time)}\n${formatTime(ex.end_time)}`;
      tc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
      tc.font = { name: "Arial", size: 9, bold: true, color: { argb: NAVY } };
      tc.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      tc.border = thinBorder();
      DAYS.forEach((day, i) => {
        const cell = row.getCell(i + 2);
        const b = mine.find((x) => x.day_of_week === day && x.start_time === st);
        if (b) {
          const teach = b.teacher_id ? teachById.get(b.teacher_id) : null;
          cell.value = `${b.grade ? `Gr ${b.grade}` : ""}${teach ? `\n${teach.name}` : ""}${b.week_label ? `  (${b.week_label})` : ""}`;
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
          cell.font = { name: "Arial", size: 10, color: { argb: accent }, bold: true };
        } else {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ri % 2 ? ZEBRA : WHITE } };
        }
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = thinBorder();
      });
      row.height = 42;
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${schoolName.replace(/\s+/g, "_")}_Master_Schedule.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
