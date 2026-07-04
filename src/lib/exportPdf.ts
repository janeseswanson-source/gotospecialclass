import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { supabase } from "@/integrations/supabase/client";
import { BRAND, BRAND_HEX } from "@/brand/brand";
import { resolveDisplayQuote } from "@/lib/quoteService";

interface ExportPdfOptions {
  schoolId: string;
  generationId: string;
}

export async function exportSchedulePDF({ schoolId, generationId }: ExportPdfOptions) {
  const [{ data: blocks }, { data: specialists }, { data: teachers }, { data: school }] = await Promise.all([
    supabase.from("schedule_blocks").select("*").eq("generation_id", generationId),
    supabase.from("specialists").select("id, name, subject").eq("school_id", schoolId),
    supabase.from("classroom_teachers").select("id, name, grade").eq("school_id", schoolId),
    supabase.from("schools").select("name").eq("id", schoolId).single(),
  ]);

  if (!blocks?.length) return false;

  const specialistMap = new Map((specialists ?? []).map(s => [s.id, s]));
  const teacherMap = new Map((teachers ?? []).map(t => [t.id, t]));
  const schoolName = school?.name ?? "School";
  const generatedDate = new Date().toLocaleDateString();
  const quote = (await resolveDisplayQuote(schoolId)).text;

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const dayLabels: Record<string, string> = {
    Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday",
  };

  // US Letter landscape: 279.4 × 215.9 mm
  const pdf = new jsPDF("l", "mm", "letter");
  const pdfWidth = 269.4; // 279.4 - 10mm margins
  const pdfHeight = 205.9; // 215.9 - 10mm margins

  // Group blocks by specialist
  const specialistIds = [...new Set(blocks.filter(b => b.specialist_id).map(b => b.specialist_id!))];

  // Page 1: Master schedule (all blocks)
  await renderSchedulePage(pdf, {
    blocks,
    title: `${schoolName} — Master Schedule`,
    specialistMap,
    teacherMap,
    days,
    dayLabels,
    pdfWidth,
    pdfHeight,
    generatedDate,
    quote,
  });

  // Per-specialist pages
  for (let i = 0; i < specialistIds.length; i++) {
    const specId = specialistIds[i];
    const spec = specialistMap.get(specId);
    if (!spec) continue;
    const specBlocks = blocks.filter(b => b.specialist_id === specId);
    if (!specBlocks.length) continue;

    pdf.addPage("letter", "l");
    await renderSchedulePage(pdf, {
      blocks: specBlocks,
      title: `${spec.name} — ${spec.subject}`,
      subtitle: schoolName,
      specialistMap,
      teacherMap,
      days,
      dayLabels,
      pdfWidth,
      pdfHeight,
      generatedDate,
      quote,
    });
  }

  pdf.save(`${schoolName.replace(/\s+/g, "_")}_Master_Schedule.pdf`);
  return true;
}

interface RenderPageOptions {
  blocks: any[];
  title: string;
  subtitle?: string;
  specialistMap: Map<string, any>;
  teacherMap: Map<string, any>;
  days: string[];
  dayLabels: Record<string, string>;
  pdfWidth: number;
  pdfHeight: number;
  generatedDate: string;
  quote?: string;
}

async function renderSchedulePage(pdf: jsPDF, opts: RenderPageOptions) {
  const { blocks, title, subtitle, specialistMap, teacherMap, days, dayLabels, pdfWidth, pdfHeight, generatedDate, quote } = opts;

  // Build time slots with end times
  const timeSlotSet = new Map<string, string>();
  for (const b of blocks) {
    if (!timeSlotSet.has(b.start_time) || b.end_time > timeSlotSet.get(b.start_time)!) {
      timeSlotSet.set(b.start_time, b.end_time);
    }
  }
  const timeSlots = [...timeSlotSet.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-9999px;top:0;width:1100px;background:${BRAND_HEX.white};padding:24px;font-family:Arial,sans-serif;`;
  container.innerHTML = `
    <div style="background:${BRAND_HEX.ink};border-radius:6px 6px 0 0;padding:10px 16px;display:flex;align-items:baseline;justify-content:space-between;">
      <span style="font-size:15px;font-weight:800;letter-spacing:0.3px;color:${BRAND_HEX.white};">${BRAND.name}</span>
      <span style="font-size:10px;color:${BRAND_HEX.gold};">${BRAND.tagline}</span>
    </div>
    <div style="height:3px;background:${BRAND_HEX.gold};"></div>
    <h1 style="font-size:20px;margin:10px 0 2px;color:${BRAND_HEX.ink};">${title}</h1>
    ${subtitle ? `<p style="font-size:11px;color:${BRAND_HEX.mute};margin-bottom:2px;">${subtitle}</p>` : ""}
    <p style="font-size:10px;color:${BRAND_HEX.mute};margin-bottom:12px;">Generated ${generatedDate}</p>
    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <thead>
        <tr>
          <th style="border:1px solid ${BRAND_HEX.ink};padding:6px;background:${BRAND_HEX.ink};color:${BRAND_HEX.white};text-align:left;font-weight:bold;">Time</th>
          ${days.map(d => `<th style="border:1px solid ${BRAND_HEX.ink};padding:6px;background:${BRAND_HEX.ink};color:${BRAND_HEX.white};text-align:center;font-weight:bold;">${dayLabels[d]}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${timeSlots.map(([startTime, endTime]) => {
          const timeLabel = `${fmt(startTime)}–${fmt(endTime)}`;
          const cells = days.map(day => {
            const dayBlocks = blocks.filter(b => b.start_time === startTime && b.day_of_week === day);
            if (!dayBlocks.length) return `<td style="border:1px solid #999;padding:4px;color:#999;">—</td>`;
            return `<td style="border:1px solid #999;padding:4px;">${dayBlocks.map(b => {
              const specName = b.specialist_id ? specialistMap.get(b.specialist_id)?.name ?? "" : "";
              const teachName = b.teacher_id ? teacherMap.get(b.teacher_id)?.name ?? "" : "";
              const label = b.subject ?? specName;
              const sub = [teachName, b.grade].filter(Boolean).join(" · ");
              const room = b.room ? `<br/><span style="color:#777;font-size:8px;">Rm ${b.room}</span>` : "";
              return `<div><strong>${label}</strong>${sub ? `<br/><span style="color:#555;font-size:9px;">${sub}</span>` : ""}${room}</div>`;
            }).join("")}</td>`;
          });
          return `<tr><td style="border:1px solid #999;padding:4px;font-weight:bold;white-space:nowrap;font-size:9px;">${timeLabel}</td>${cells.join("")}</tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, { scale: 2, useCORS: true, logging: false });
    const imgData = canvas.toDataURL("image/png");
    const imgAspect = canvas.height / canvas.width;

    // Try to fit on current page; if too tall, split across pages
    const imgW = pdfWidth;
    const imgH = imgW * imgAspect;

    if (imgH <= pdfHeight) {
      // Fits on one page
      pdf.addImage(imgData, "PNG", 5, 5, imgW, imgH);
    } else {
      // Multi-page: slice the canvas into page-sized vertical chunks
      const scaleFactor = imgW / canvas.width; // mm per pixel
      const pageHeightPx = pdfHeight / scaleFactor; // pixels that fit per page
      let yOffset = 0;
      let pageIndex = 0;

      while (yOffset < canvas.height) {
        if (pageIndex > 0) pdf.addPage("letter", "l");
        const sliceHeight = Math.min(pageHeightPx, canvas.height - yOffset);

        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeight;
        const ctx = pageCanvas.getContext("2d")!;
        ctx.drawImage(canvas, 0, yOffset, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight);

        const sliceData = pageCanvas.toDataURL("image/png");
        const sliceH = sliceHeight * scaleFactor;
        pdf.addImage(sliceData, "PNG", 5, 5, imgW, sliceH);

        // Footer on each page
        addFooter(pdf, pageIndex + 1, quote);

        yOffset += sliceHeight;
        pageIndex++;
      }
      return; // footer already added in loop
    }

    // Footer for single-page
    addFooter(pdf, 1, quote);
  } finally {
    document.body.removeChild(container);
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function addFooter(pdf: jsPDF, pageNum: number, quote?: string) {
  const pageH = pdf.internal.pageSize.getHeight();
  const pageW = pdf.internal.pageSize.getWidth();
  const [gr, gg, gb] = hexToRgb(BRAND_HEX.gold);
  const [ir, ig, ib] = hexToRgb(BRAND_HEX.ink);
  const [mr, mg, mb] = hexToRgb(BRAND_HEX.mute);

  // Gold rule
  pdf.setDrawColor(gr, gg, gb);
  pdf.setLineWidth(0.5);
  pdf.line(5, pageH - 7, pageW - 5, pageH - 7);

  pdf.setFontSize(7);
  // Domain (left)
  pdf.setTextColor(ir, ig, ib);
  pdf.text(BRAND.domain, 5, pageH - 3);

  // Quote (center)
  if (quote) {
    pdf.setTextColor(mr, mg, mb);
    const q = pdf.splitTextToSize(`"${quote}"`, pageW - 90)[0] ?? "";
    pdf.text(q, pageW / 2, pageH - 3, { align: "center" });
  }

  // Page number (right)
  pdf.setTextColor(mr, mg, mb);
  pdf.text(`Page ${pageNum}`, pageW - 5, pageH - 3, { align: "right" });
}

function fmt(time: string): string {
  const parts = time.split(":");
  let h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? "0", 10);
  if (isNaN(h)) return time;
  const suffix = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m.toString().padStart(2, "0")} ${suffix}`;
}
