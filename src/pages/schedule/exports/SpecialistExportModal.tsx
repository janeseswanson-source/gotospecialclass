import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Download, AlertCircle } from 'lucide-react';
import { renderPdfBlob, triggerDownload } from './exportShared';
import { SpecialistPlanner, type RecessRow, type SchoolHours } from '@/pdf/SpecialistPlanner';
import { getMondayOf, enumerateWeeks, enumerateWeeksBetween, addDays } from '@/pdf/lib/weekDates';
import { getDayLabelFor, type SchoolCalendarEvent } from '@/pdf/lib/holidays';
import { resolveDisplayQuote } from '@/lib/quoteService';
import ExportQuoteCard from '@/components/schedule/ExportQuoteCard';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  specialists: { id: string; name: string; subject: string }[];
  blocks: any[];
  schoolId?: string | null;
  schoolName?: string;
  schoolYear?: string;
  recessConfig?: RecessRow[];
  /** grade_band key → friendly label (schools.recess_grade_bands). */
  bandLabels?: Record<string, string> | null;
  calendarEvents?: SchoolCalendarEvent[];
  /** Bell times incl. early release ("School Ends 1:15 Wed"). */
  schoolHours?: SchoolHours;
}

type Phase = 'options' | 'generating' | 'preview' | 'error';
type WeeksMode = 'this' | 'next4' | 'custom';
type AbMode = 'A' | 'B' | 'both';

function todayIso() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function isHolidayWeek(monday: Date, events?: SchoolCalendarEvent[]): boolean {
  let labeled = 0;
  for (let i = 0; i < 5; i++) if (getDayLabelFor(addDays(monday, i), events)) labeled++;
  return labeled === 5;
}

export const SpecialistExportModal = ({ open, onOpenChange, specialists, blocks, schoolId, schoolName, schoolYear, recessConfig = [], bandLabels, calendarEvents, schoolHours }: Props) => {
  const [selection, setSelection] = useState<string>('all');
  const [weeksMode, setWeeksMode] = useState<WeeksMode>('this');
  const [customStart, setCustomStart] = useState<string>(todayIso());
  const [customEnd, setCustomEnd] = useState<string>(todayIso());
  const [abMode, setAbMode] = useState<AbMode>('A');
  const [phase, setPhase] = useState<Phase>('options');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [slow, setSlow] = useState(false);
  const [quoteOverride, setQuoteOverride] = useState('');
  const slowTimer = useRef<number | null>(null);

  const hasAB = useMemo(
    () => blocks.some((b: any) => b.week_label === 'A' || b.week_label === 'B'),
    [blocks]
  );

  useEffect(() => {
    if (!open) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
      setBlob(null);
      setPhase('options');
      setSelection('all');
      setWeeksMode('this');
      setAbMode('A');
      setSlow(false);
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function computeWeeks(): Date[] {
    try {
      let weeks: Date[];
      if (weeksMode === 'this') weeks = [getMondayOf(new Date())];
      else if (weeksMode === 'next4') weeks = enumerateWeeks(new Date(), 4);
      else weeks = enumerateWeeksBetween(new Date(customStart), new Date(customEnd));
      const filtered = weeks.filter((w) => !isHolidayWeek(w, calendarEvents));
      return filtered.length ? filtered : weeks;
    } catch (e) {
      console.warn('Week computation failed, defaulting to this week', e);
      return [getMondayOf(new Date())];
    }
  }

  const handleGenerate = async () => {
    setPhase('generating');
    setSlow(false);
    slowTimer.current = window.setTimeout(() => setSlow(true), 30_000);
    try {
      const weeks = computeWeeks();
      const list = selection === 'all' ? specialists : specialists.filter((s) => s.id === selection);
      const labels: (undefined | 'A' | 'B')[] = hasAB
        ? (abMode === 'both' ? ['A', 'B'] : [abMode])
        : [undefined];

      const quote = quoteOverride.trim() || (await resolveDisplayQuote(schoolId)).text;
      const b = await renderPdfBlob(
        <SpecialistPlanner
          specialists={list}
          blocks={blocks}
          schoolName={schoolName}
          schoolYear={schoolYear}
          weeks={weeks}
          weekLabels={labels}
          recessConfig={recessConfig}
          bandLabels={bandLabels}
          calendarEvents={calendarEvents}
          schoolHours={schoolHours}
          quote={quote}
        />
      );


      const url = URL.createObjectURL(b);
      setBlob(b);
      setBlobUrl(url);
      setPhase('preview');
    } catch (err) {
      console.error('PDF generation failed', err);
      setPhase('error');
    } finally {
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
    }
  };

  const handleDownload = () => {
    if (!blob) return;
    const filename = selection === 'all'
      ? 'specialist-planners.pdf'
      : `specialist-planner-${(specialists.find((s) => s.id === selection)?.name || 'specialist').replace(/\s+/g, '-')}.pdf`;
    triggerDownload(blob, filename);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Specialist Weekly Planner (PDF)</DialogTitle>
        </DialogHeader>

        {phase === 'options' && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Which specialist?</label>
              <Select value={selection} onValueChange={setSelection}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All specialists (one PDF per person)</SelectItem>
                  {specialists.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name} — {s.subject}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {hasAB && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Which week to print?</label>
                <Select value={abMode} onValueChange={(v) => setAbMode(v as AbMode)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">A Week</SelectItem>
                    <SelectItem value="B">B Week</SelectItem>
                    <SelectItem value="both">Both (one PDF per week)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium">How many weeks?</label>
              <Select value={weeksMode} onValueChange={(v) => setWeeksMode(v as WeeksMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="this">This week only</SelectItem>
                  <SelectItem value="next4">Next 4 weeks</SelectItem>
                  <SelectItem value="custom">Custom date range</SelectItem>
                </SelectContent>
              </Select>
              {weeksMode === 'custom' && (
                <div className="flex gap-2 pt-1">
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>

            {schoolId && <ExportQuoteCard schoolId={schoolId} onQuoteChange={setQuoteOverride} />}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleGenerate}>Generate</Button>
            </DialogFooter>
          </div>
        )}

        {phase === 'generating' && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">{slow ? 'Still working...' : 'Generating your PDF...'}</p>
          </div>
        )}

        {phase === 'preview' && blobUrl && (
          <div className="space-y-3">
            <iframe src={blobUrl} title="PDF preview" className="w-full rounded border border-border" style={{ height: '70vh' }} />
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={handleDownload} className="gap-2"><Download className="h-4 w-4" /> Download PDF</Button>
            </DialogFooter>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-3 py-6">
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 mt-0.5" />
              <p>Couldn't generate the PDF. Try refreshing the schedule and try again.</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button asChild>
                <Link to="/app/help">Report Issue</Link>
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default SpecialistExportModal;
