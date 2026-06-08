import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { supabase } from "@/integrations/supabase/client";

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
}

async function renderSchedulePage(pdf: jsPDF, opts: RenderPageOptions) {
  const { blocks, title, subtitle, specialistMap, teacherMap, days, dayLabels, pdfWidth, pdfHeight, generatedDate } = opts;

  // Build time slots with end times
  const timeSlotSet = new Map<string, string>();
  for (const b of blocks) {
    if (!timeSlotSet.has(b.start_time) || b.end_time > timeSlotSet.get(b.start_time)!) {
      timeSlotSet.set(b.start_time, b.end_time);
    }
  }
  const timeSlots = [...timeSlotSet.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const container = document.createElement("div");
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:1100px;background:white;padding:24px;font-family:Arial,sans-serif;";
  container.innerHTML = `
    <h1 style="font-size:20px;margin-bottom:2px;color:#000;">${title}</h1>
    ${subtitle ? `<p style="font-size:11px;color:#666;margin-bottom:2px;">${subtitle}</p>` : ""}
    <p style="font-size:10px;color:#888;margin-bottom:12px;">Generated ${generatedDate}</p>
    <table style="width:100%;border-collapse:collapse;font-size:10px;">
      <thead>
        <tr>
          <th style="border:1px solid #000;padding:6px;background:#f0f0f0;color:#000;text-align:left;font-weight:bold;">Time</th>
          ${days.map(d => `<th style="border:1px solid #000;padding:6px;background:#f0f0f0;color:#000;text-align:center;font-weight:bold;">${dayLabels[d]}</th>`).join("")}
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
        addFooter(pdf, generatedDate, pageIndex + 1);

        yOffset += sliceHeight;
        pageIndex++;
      }
      return; // footer already added in loop
    }

    // Footer for single-page
    addFooter(pdf, generatedDate, 1);
  } finally {
    document.body.removeChild(container);
  }
}

function addFooter(pdf: jsPDF, generatedDate: string, pageNum: number) {
  const pageH = pdf.internal.pageSize.getHeight();
  const pageW = pdf.internal.pageSize.getWidth();
  pdf.setFontSize(7);
  pdf.setTextColor(150);
  pdf.text(`Generated ${generatedDate}`, 5, pageH - 3);
  pdf.text(`Page ${pageNum}`, pageW - 20, pageH - 3);
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
