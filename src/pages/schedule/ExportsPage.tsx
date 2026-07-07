import { useState, useEffect, lazy, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSchool } from "@/contexts/SchoolContext";
import { CsvIcon, PdfIcon, DocIcon } from "@/components/icons/FileTypeIcons";
import ExportCard from "@/components/schedule/ExportCard";
import ExportQuoteCard from "@/components/schedule/ExportQuoteCard";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { logActivity } from "@/lib/activityLogger";
import { formatTime } from "@/lib/utils";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";

// Heavy export libs (jsPDF/html2canvas, ExcelJS, xlsx, @react-pdf) load only when
// an export is actually triggered, keeping the Exports route chunk lean.
const TeacherPlannerModal = lazy(() => import("@/components/schedule/TeacherPlannerModal"));

export default function ExportsPage() {
  const { user } = useAuth();
  const { selectedSchoolId, loading: schoolLoading } = useSchool();
  const [genId, setGenId] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [plannerOpen, setPlannerOpen] = useState(false);
  const [exportQuote, setExportQuote] = useState("");

  useEffect(() => {
    if (!user || schoolLoading || !selectedSchoolId) { setDataLoading(false); return; }
    loadContext();
  }, [user, selectedSchoolId, schoolLoading]);

  async function loadContext() {
    setDataLoading(true);
    const { data: gen } = await supabase.from("schedule_generations").select("id").eq("school_id", selectedSchoolId!).order("version", { ascending: false }).limit(1).maybeSingle();
    if (gen) setGenId(gen.id);
    setDataLoading(false);
  }

  async function getBlocks() {
    if (!genId) return null;
    const { data: blocks } = await supabase.from("schedule_blocks").select("*").eq("generation_id", genId);
    if (!blocks?.length) { toast({ title: "No data to export", variant: "destructive" }); return null; }
    return blocks;
  }

  async function exportCSV() {
    const blocks = await getBlocks();
    if (!blocks || !selectedSchoolId) return;
    const headers = ["Day", "Start", "End", "Subject", "Grade", "Room", "Override"];
    const rows = blocks.map((b) => [b.day_of_week, formatTime(b.start_time), formatTime(b.end_time), b.subject ?? "", b.grade ?? "", b.room ?? "", b.is_override ? "Yes" : "No"]);
    downloadFile([headers, ...rows].map(r => r.join(",")).join("\n"), "master-schedule.csv", "text/csv");
    await recordExport("master_csv", "csv");
  }


  async function exportPDF() {
    if (!genId || !selectedSchoolId) return;
    const { exportSchedulePDF } = await import("@/lib/exportPdf");
    const success = await exportSchedulePDF({ schoolId: selectedSchoolId, generationId: genId });
    if (!success) { toast({ title: "No data to export", variant: "destructive" }); return; }
    toast({ title: "PDF exported!" });
    await recordExport("master_pdf", "pdf");
  }

  async function exportWord() {
    const blocks = await getBlocks();
    if (!blocks || !selectedSchoolId) return;
    const headers = ["Day", "Start", "End", "Subject", "Grade", "Room"];
    const rows = blocks.map(b => `<tr>${[b.day_of_week, formatTime(b.start_time), formatTime(b.end_time), b.subject ?? "", b.grade ?? "", b.room ?? ""].map(c => `<td style="border:1px solid #ccc;padding:4px;font-size:11px">${c}</td>`).join("")}</tr>`);
    const html = `<html><head><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse;width:100%}th{background:#f0f0f0;color:#000;padding:6px;font-size:11px;border:1px solid #000;font-weight:bold}</style></head><body><h2>Master Schedule</h2><table><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr>${rows.join("")}</table></body></html>`;
    downloadFile(html, "master-schedule.doc", "application/msword");
    await recordExport("master_word", "docx");
  }

  async function exportMasterAdminWorkbook() {
    if (!selectedSchoolId) return;
    try {
      const { exportMasterAdminXlsx } = await import("@/lib/exportMasterAdminXlsx");
      await exportMasterAdminXlsx({ schoolId: selectedSchoolId, generationId: genId });
      toast({ title: "Master Admin XLSX downloaded" });
      await recordExport("master_admin_xlsx", "csv");
    } catch (e: any) {
      toast({ title: e?.message ?? "Export failed", variant: "destructive" });
    }
  }

  async function exportBrandedWorkbook() {
    if (!selectedSchoolId) return;
    try {
      const { exportScheduleXlsx } = await import("@/lib/exportScheduleXlsx");
      const ok = await exportScheduleXlsx({ schoolId: selectedSchoolId, generationId: genId, quote: exportQuote });
      if (!ok) { toast({ title: "Generate a schedule first.", variant: "destructive" }); return; }
      toast({ title: "Branded spreadsheet downloaded ✓" });
      await recordExport("branded_xlsx", "csv");
    } catch (e: any) {
      toast({ title: e?.message ?? "Export failed", variant: "destructive" });
    }
  }

  function downloadFile(content: string, filename: string, mimeType: string) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: `${filename} exported!` });
  }

  async function recordExport(exportType: string, format: "pdf" | "csv" | "docx") {
    if (!selectedSchoolId) return;
    await supabase.from("export_records").insert({
      school_id: selectedSchoolId,
      generation_id: genId,
      export_type: exportType,
      format,
      created_by: user?.id ?? null,
    });
    logActivity("export_downloaded", { format, type: exportType });
  }

  const isLoading = schoolLoading || dataLoading;
  const hasSchedule = !!genId;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Export Center</h1>
        <p className="text-sm text-muted-foreground">Download your schedules in various formats. Print-friendly, minimal color.</p>
      </div>

      {hasSchedule && !isLoading && (
        <ExportQuoteCard schoolId={selectedSchoolId} onQuoteChange={setExportQuote} />
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Available Exports</h2>
        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-52" />
                  </div>
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <ExportCard title="Branded Master Schedule (Excel)" description="The full grid plus each specialist's week, in an on-brand, color-coded workbook." icon={CsvIcon} format="XLSX" disabled={!hasSchedule} onExport={exportBrandedWorkbook} />
            <ExportCard title="Master Schedule CSV" description="Comma-separated for spreadsheets." icon={CsvIcon} format="CSV" disabled={!hasSchedule} onExport={exportCSV} />
            <ExportCard title="Print Schedule (PDF)" description="Clean, print-friendly layout via browser print." icon={PdfIcon} format="PDF" disabled={!hasSchedule} onExport={exportPDF} />
            <ExportCard title="Word Document" description="Editable .doc format for customizing." icon={DocIcon} format="DOC" disabled={!hasSchedule} onExport={exportWord} />
            <ExportCard
              title="Teacher Planner (PDF)"
              description="Week-at-a-glance per specialist with space for handwritten notes. Print and put in a three-ring binder."
              icon={PdfIcon}
              format="PDF"
              disabled={!hasSchedule}
              onExport={() => setPlannerOpen(true)}
            />
            <ExportCard
              title="Master Admin Workbook (XLSX)"
              description="The whole school in one workbook: the weekly grid plus sheets for your school, specialists, classes, and rotations."
              icon={CsvIcon}
              format="XLSX"
              disabled={!hasSchedule}
              onExport={exportMasterAdminWorkbook}
            />
          </div>
        )}
      </div>

      {!isLoading && !hasSchedule && (
        <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-3">
          <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Exports unlock once you have a schedule. <Link to="/app/prep" className="text-primary underline">Go to Prep &amp; Generate</Link> to create your first one.
          </p>
        </div>
      )}

      <Suspense fallback={null}>
        {plannerOpen && (
          <TeacherPlannerModal
            open={plannerOpen}
            onOpenChange={setPlannerOpen}
            schoolId={selectedSchoolId}
            generationId={genId}
          />
        )}
      </Suspense>
    </div>
  );
}
