// Branded Master Admin workbook export.
//
// Uses ExcelJS — NOT the community `xlsx` package, which silently drops every
// cell style on write (the old version of this file produced a colorless,
// unbranded sheet). Same navy/gold/cream identity, brand header, logo and
// embedded quote as exportScheduleXlsx, so every workbook we emit looks the same.
//
// Sheet 1 "Master Admin View": the whole-school week at a glance — Planning & Prep
// (admin rotation), every teaching rotation (Time × Mon–Fri, subject-tinted),
// recess/lunch bands. Sheets 2+ are the branded data sheets (Schools, Specialists,
// Schedule Blocks, Rotations, Classrooms, PLUS Rotations).
//
// Day-name gotcha: schedule_blocks.day_of_week stores SHORT codes ("Mon"…"Fri"),
// while the wizard's admin_rotation entries store FULL names ("Monday"…). The old
// export compared full names against short codes, so every day cell came out
// EMPTY. All matching below normalizes through DAY_SHORT/DAY_FULL.
import ExcelJS from "exceljs";
import { supabase } from "@/integrations/supabase/client";
import { formatTime } from "@/lib/utils";
import { NAVY, GOLD, CREAM, WHITE, MUTE, GRIDLINE, ZEBRA, subjectColors, parseMin } from "@/lib/exportColors";
import { BRAND } from "@/brand/brand";
import { resolveDisplayQuote } from "@/lib/quoteService";
import { buildBrandHeader, headerCell, addBrandLogo } from "@/lib/exportScheduleXlsx";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
const DAY_FULL: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
const DAY_SHORT: Record<string, string> = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri" };

function toShortDay(d: string | null | undefined): string | null {
  return d ? (DAY_SHORT[d.trim().toLowerCase()] ?? null) : null;
}

function thinBorder(color = GRIDLINE) {
  return {
    top: { style: "thin" as const, color: { argb: color } },
    bottom: { style: "thin" as const, color: { argb: color } },
    left: { style: "thin" as const, color: { argb: color } },
    right: { style: "thin" as const, color: { argb: color } },
  };
}

function splitName(full: string | null | undefined): [string, string] {
  if (!full) return ["", ""];
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return [parts[0], ""];
  return [parts[0], parts.slice(1).join(" ")];
}

/** A full-width cream band row (section separators: P&P, RECESS, LUNCH…). */
function bandRow(ws: ExcelJS.Worksheet, cols: number, label: string) {
  const row = ws.addRow([]);
  ws.mergeCells(row.number, 1, row.number, cols);
  const c = row.getCell(1);
  c.value = label;
  c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
  c.font = { name: "Arial", size: 9, bold: true, color: { argb: NAVY } };
  c.alignment = { vertical: "middle", horizontal: "center" };
  c.border = { top: { style: "thin", color: { argb: GOLD } }, bottom: { style: "thin", color: { argb: GOLD } } };
  row.height = 22;
  return row;
}

/** Branded data sheet: title band + navy header row + zebra data rows. */
function addDataSheet(
  wb: ExcelJS.Workbook,
  name: string,
  sub: string,
  headers: string[],
  rows: (string | number)[][],
  colWidth = 18,
) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 3 }] });
  ws.columns = headers.map(() => ({ width: colWidth }));
  buildBrandHeader(ws, headers.length, name, sub);
  const h = ws.getRow(3);
  headers.forEach((t, i) => headerCell(h.getCell(i + 1), t));
  h.height = 24;
  rows.forEach((r, ri) => {
    const row = ws.addRow(r.map((v) => v ?? ""));
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Arial", size: 9, color: { argb: NAVY } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ri % 2 ? ZEBRA : WHITE } };
      cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
      cell.border = thinBorder();
    });
  });
  return ws;
}

interface Blk {
  id: string; day_of_week: string; start_time: string; end_time: string;
  subject: string | null; grade: string | null; week_label: string | null;
  specialist_id: string | null; teacher_id: string | null; notes?: string | null;
}

export async function exportMasterAdminXlsx(opts: {
  schoolId: string;
  generationId: string | null;
  /** Motivational quote for the title band; the latest AI quote is resolved when omitted. */
  quote?: string;
}) {
  const { schoolId, generationId } = opts;

  const [{ data: school }, { data: specialists }, { data: teachers }, { data: blocksData }, { data: rotationsData }, { data: clubsData }, { data: recessData }] =
    await Promise.all([
      supabase.from("schools").select("*").eq("id", schoolId).maybeSingle(),
      supabase.from("specialists").select("*").eq("school_id", schoolId),
      supabase.from("classroom_teachers").select("*").eq("school_id", schoolId),
      generationId
        ? supabase.from("schedule_blocks").select("*").eq("generation_id", generationId)
        : Promise.resolve({ data: [] as any[] }),
      supabase.from("class_rotations").select("*").eq("school_id", schoolId),
      supabase.from("clubs").select("*").eq("school_id", schoolId),
      supabase.from("recess_lunch_config").select("*").eq("school_id", schoolId),
    ]);

  const quote = opts.quote ?? (await resolveDisplayQuote(schoolId).then((q) => q.text).catch(() => ""));
  const quoteTail = quote && quote.trim() ? `  ·  "${quote.trim()}"` : "";

  const sp = (specialists ?? []) as any[];
  const tc = (teachers ?? []) as any[];
  const blocks = (blocksData ?? []) as Blk[];
  const rotations = (rotationsData ?? []) as any[];
  const clubs = (clubsData ?? []) as any[];
  const specialistById = new Map(sp.map((s) => [s.id, s]));
  const teacherById = new Map(tc.map((t) => [t.id, t]));

  const schoolName = school?.name ?? "School";
  const schoolYear = (school as any)?.school_year ?? "";
  const daySpan = school?.start_time && school?.end_time
    ? `${formatTime(school.start_time)}–${formatTime(school.end_time)}`
    : "";
  const sub = `${schoolYear ? schoolYear + "  ·  " : ""}${daySpan ? daySpan + "  ·  " : ""}${BRAND.name}${quoteTail}`;

  const wb = new ExcelJS.Workbook();
  wb.creator = BRAND.name;
  wb.created = new Date();

  // ═══ Sheet 1: Master Admin View ═══
  const COLS = DAYS.length + 1; // Time + Mon–Fri
  const ws = wb.addWorksheet("Master Admin View", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = [{ width: 14 }, ...DAYS.map(() => ({ width: 30 }))];
  buildBrandHeader(ws, COLS, `Master Admin View — ${schoolName}`, sub);
  await addBrandLogo(wb, ws, COLS);

  const hdr = ws.getRow(3);
  headerCell(hdr.getCell(1), "Time");
  DAYS.forEach((d, i) => headerCell(hdr.getCell(i + 2), DAY_FULL[d]));
  hdr.height = 26;

  // ── Planning & Prep (the wizard's admin rotation) ──
  const adminRotation: any[] = Array.isArray((school as any)?.admin_rotation) ? (school as any).admin_rotation : [];
  if (adminRotation.length > 0) {
    bandRow(ws, COLS, "PLANNING & PREP");
    const row = ws.addRow([]);
    const t = row.getCell(1);
    t.value = "P&P";
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
    t.font = { name: "Arial", size: 9, bold: true, color: { argb: NAVY } };
    t.alignment = { vertical: "middle", horizontal: "center" };
    t.border = thinBorder();
    let maxEntries = 1;
    DAYS.forEach((day, i) => {
      const cell = row.getCell(i + 2);
      const entries = adminRotation.filter((ar) => toShortDay(ar.day) === day);
      cell.value = entries
        .map((ar) => {
          const label = ar.rotationLabel ? `${ar.rotationLabel}${ar.weekLabel ? ` (Wk ${ar.weekLabel})` : ""}` : "Rotation";
          const time = ar.startTime && ar.endTime ? `${formatTime(ar.startTime)}–${formatTime(ar.endTime)}` : "";
          return [label, time].filter(Boolean).join("\n");
        })
        .join("\n\n");
      cell.font = { name: "Arial", size: 9, color: { argb: NAVY } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
      cell.border = thinBorder();
      if (entries.length > maxEntries) maxEntries = entries.length;
    });
    row.height = Math.max(34, maxEntries * 30);
  }

  // ── Teaching rotations, grouped by (start,end), sorted by start ──
  const isTeaching = (b: Blk) =>
    !!b.specialist_id && !/lunch|planning|plc|recess|dismiss/i.test(b.subject ?? "") && (b.grade ?? "").toLowerCase() !== "lunch";
  const slotKeys = Array.from(new Set(blocks.filter(isTeaching).map((b) => `${b.start_time}|${b.end_time}`)))
    .sort((a, b) => parseMin(a.split("|")[0]) - parseMin(b.split("|")[0]));

  for (const key of slotKeys) {
    const [s, e] = key.split("|");
    const row = ws.addRow([]);
    const t = row.getCell(1);
    t.value = `${formatTime(s)}\n${formatTime(e)}`;
    t.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CREAM } };
    t.font = { name: "Arial", size: 9, bold: true, color: { argb: NAVY } };
    t.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    t.border = thinBorder();

    let maxLines = 1;
    DAYS.forEach((day, i) => {
      const cell = row.getCell(i + 2);
      const cellBlocks = blocks.filter(
        (b) => isTeaching(b) && b.day_of_week === day && b.start_time === s && b.end_time === e,
      );
      if (cellBlocks.length === 0) {
        cell.border = thinBorder();
        return;
      }
      // Dedupe by grade+subject+teacher (mirrors the on-screen stack cell).
      const seen = new Set<string>();
      const rows = cellBlocks.filter((b) => {
        const k = `${b.grade ?? ""}|${(b.subject ?? "").toLowerCase()}|${b.teacher_id ?? ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const head = rows[0];
      const headSubj = head.subject ?? specialistById.get(head.specialist_id!)?.subject ?? "";
      const { accent, fill } = subjectColors(headSubj);
      const rich: ExcelJS.RichText[] = [];
      rows.forEach((b, ri) => {
        const spec = b.specialist_id ? specialistById.get(b.specialist_id) : null;
        const teach = b.teacher_id ? teacherById.get(b.teacher_id) : null;
        const subj = b.subject ?? spec?.subject ?? "";
        if (ri > 0) rich.push({ text: "\n", font: { size: 6 } });
        if (b.grade) rich.push({ text: `${b.grade}  `, font: { name: "Arial", size: 9, bold: true, color: { argb: accent } } });
        rich.push({ text: subj, font: { name: "Arial", size: 9, bold: true, color: { argb: accent } } });
        if (b.week_label) rich.push({ text: `  (${b.week_label})`, font: { name: "Arial", size: 8, italic: true, color: { argb: MUTE } } });
        const who = [spec?.name, teach?.name].filter(Boolean).join(" · ");
        if (who) rich.push({ text: `\n${who}`, font: { name: "Arial", size: 9, color: { argb: NAVY } } });
      });
      cell.value = { richText: rich };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.alignment = { vertical: "top", horizontal: "left", wrapText: true, indent: 1 };
      cell.border = thinBorder();
      const lines = rows.length * 2;
      if (lines > maxLines) maxLines = lines;
    });
    row.height = Math.max(36, maxLines * 15);
  }

  // ── Recess / Lunch bands (from the wizard's recess & lunch config) ──
  const bandLabels: string[] = [];
  for (const r of (recessData ?? []) as any[]) {
    const gb = r.grade_band ? ` (${r.grade_band})` : "";
    if (r.am_recess_start && r.am_recess_end) bandLabels.push(`AM RECESS${gb}  ·  ${formatTime(r.am_recess_start)}–${formatTime(r.am_recess_end)}`);
    if (r.lunch_start && r.lunch_end) bandLabels.push(`LUNCH${gb}  ·  ${formatTime(r.lunch_start)}–${formatTime(r.lunch_end)}`);
    if (r.pm_recess_start && r.pm_recess_end) bandLabels.push(`PM RECESS${gb}  ·  ${formatTime(r.pm_recess_start)}–${formatTime(r.pm_recess_end)}`);
  }
  for (const label of bandLabels) bandRow(ws, COLS, label);

  // ═══ Data sheets ═══
  addDataSheet(wb, "Schools", sub,
    ["school_id", "school_name", "year", "start_time", "end_time", "early_release_day", "early_release_end", "grades_served", "class_duration", "passing_time", "conflict_strategies", "notes"],
    school
      ? [[
          (school as any).id, schoolName, schoolYear,
          school.start_time ?? "", school.end_time ?? "",
          (school as any).early_release_day ?? "", (school as any).early_release_end_time ?? "",
          Array.isArray(school.grades_served) ? school.grades_served.join("|") : "",
          (school as any).class_duration ?? "", (school as any).passing_time ?? "",
          Array.isArray((school as any).conflict_strategies) ? (school as any).conflict_strategies.join("|") : "",
          (school as any).notes ?? "",
        ]]
      : []);

  addDataSheet(wb, "Specialists", sub,
    ["specialist_id", "first_name", "last_name", "subject", "room", "working_days", "class_duration", "uses_cart", "is_part_time", "two_schools", "weekly_planning_min", "notes"],
    sp.map((s) => {
      const [first, last] = splitName(s.name);
      return [
        s.id, first, last, s.subject ?? "", s.location ?? s.room ?? "",
        Array.isArray(s.working_days) ? s.working_days.join("|") : "",
        s.class_duration ?? "", s.uses_cart ? "TRUE" : "FALSE",
        s.is_part_time ? "TRUE" : "FALSE", s.two_schools ? "TRUE" : "FALSE",
        s.weekly_planning_minutes ?? "", s.notes ?? "",
      ];
    }));

  addDataSheet(wb, "Schedule Blocks", sub,
    ["block_id", "day", "start_time", "end_time", "subject", "grade", "week", "specialist", "teacher", "notes"],
    blocks.map((b) => [
      b.id, DAY_FULL[b.day_of_week] ?? b.day_of_week, b.start_time ?? "", b.end_time ?? "",
      b.subject ?? "", b.grade ?? "", b.week_label ?? "",
      b.specialist_id ? (specialistById.get(b.specialist_id)?.name ?? "") : "",
      b.teacher_id ? (teacherById.get(b.teacher_id)?.name ?? "") : "",
      b.notes ?? "",
    ]), 14);

  addDataSheet(wb, "Rotations", sub,
    ["rotation_id", "rotation_type", "grade", "teacher", "specialist", "day", "week", "notes"],
    rotations.map((r) => [
      r.id, r.rotation_type ?? "", r.grade ?? "",
      teacherById.get(r.teacher_id)?.name ?? "",
      specialistById.get(r.specialist_id)?.name ?? "",
      r.day_of_week ?? "", r.week_label ?? "", r.notes ?? "",
    ]));

  addDataSheet(wb, "Classrooms", sub,
    ["classroom_id", "teacher_first_name", "teacher_last_name", "grade", "room", "team"],
    tc.map((t) => {
      const [first, last] = splitName(t.name);
      return [t.id, first, last, t.grade ?? "", t.room ?? "", t.team ?? ""];
    }));

  addDataSheet(wb, "PLUS Rotations", sub,
    ["plus_name", "day", "start_time", "end_time", "grades", "week", "notes"],
    [
      ...adminRotation.map((ar) => [
        ar.rotationLabel || "Admin Rotation", ar.day ?? "",
        ar.startTime ?? "", ar.endTime ?? "",
        Array.isArray(ar.grades) ? ar.grades.join("|") : "",
        ar.weekLabel ? `Week ${ar.weekLabel}` : "", "",
      ]),
      ...clubs.map((c) => [
        c.name ?? "", Array.isArray(c.days) ? c.days.join("|") : (c.day_of_week ?? c.day ?? ""),
        c.start_time ?? "", c.end_time ?? "",
        Array.isArray(c.grades) ? c.grades.join("|") : (c.grade ?? ""),
        "", c.notes ?? "",
      ]),
    ]);

  const safeName = schoolName.replace(/[^a-z0-9]+/gi, "_");
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `MasterAdminView_${safeName}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
