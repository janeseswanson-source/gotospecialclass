import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { buildBrandHeader, headerCell } from "./exportScheduleXlsx";
import { BRAND_ARGB } from "@/brand/brand";

function fillArgb(cell: ExcelJS.Cell): string | undefined {
  const f = cell.fill as ExcelJS.FillPattern | undefined;
  return f?.fgColor?.argb;
}
function fontArgb(cell: ExcelJS.Cell): string | undefined {
  return cell.font?.color?.argb;
}

describe("xlsx branded header uses the BRAND palette", () => {
  it("paints the title band navy/ink with white text and a gold rule subtitle", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Master Schedule");
    ws.columns = [{ width: 16 }, { width: 20 }, { width: 20 }];

    buildBrandHeader(ws, 3, "Master Schedule — Demo", "2025–26  ·  Specialist Ops!");

    const title = ws.getCell("A1");
    expect(fillArgb(title)).toBe(BRAND_ARGB.ink);
    expect(fontArgb(title)).toBe(BRAND_ARGB.white);

    const sub = ws.getCell("A2");
    expect(fillArgb(sub)).toBe(BRAND_ARGB.cream);
    expect(fontArgb(sub)).toBe(BRAND_ARGB.mute);
    // Gold bottom rule ties the subtitle to the identity.
    expect((sub.border?.bottom?.color as any)?.argb).toBe(BRAND_ARGB.gold);
  });

  it("paints day-header cells navy with white text", () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet");
    const cell = ws.getCell("A3");
    headerCell(cell, "Time");
    expect(fillArgb(cell)).toBe(BRAND_ARGB.ink);
    expect(fontArgb(cell)).toBe(BRAND_ARGB.white);
  });
});
