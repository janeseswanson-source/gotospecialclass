import { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Sparkles, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const GRADE_ORDER = ['Pre-K', 'K', '1', '2', '3', '4', '5', '6', '7', '8'];

export const parseGradesLoose = (g: any): string[] => {
  if (Array.isArray(g)) return g.map(String).map(s => s.trim()).filter(Boolean);
  if (!g) return [];
  const s = String(g);
  if (s.includes(',')) return s.split(',').map(x => x.trim()).filter(Boolean);
  const m = s.match(/^([A-Za-z0-9-]+)\s*[–-]\s*([A-Za-z0-9-]+)$/);
  if (m) {
    const a = GRADE_ORDER.indexOf(m[1]);
    const b = GRADE_ORDER.indexOf(m[2]);
    if (a >= 0 && b >= 0) return GRADE_ORDER.slice(Math.min(a, b), Math.max(a, b) + 1);
  }
  return [s];
};

interface ParsedClubRow {
  include: boolean;
  name: string;
  day_of_week: string;
  start_time: string;
  end_time: string;
  grades: string[];
  leader: string;
  location: string;
}

interface ParsedEventRow {
  include: boolean;
  name: string;
  date: string;
  start_time: string;
  end_time: string;
  grades: string[];
  notes: string;
}

type Kind = 'clubs' | 'events';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: Kind;
  onImport: (rows: any[]) => Promise<{ ok: number; skipped: number }>;
}

const NlImportDialog = ({ open, onOpenChange, kind, onImport }: Props) => {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const placeholder = kind === 'clubs'
    ? 'e.g. Robotics club on Tuesdays at 12:15 for grades 3-5, led by Mr. Chen in Room 14. Also Yearbook on Wed and Fri 12:30, grades 4-6.'
    : 'e.g. Spring Concert on May 15 from 9:00 to 10:30 for all grades. Picture Day Oct 4 8:30-11:00.';

  const reset = () => { setText(''); setRows([]); setError(null); };

  const parse = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('parse-clubs-nl', {
        body: { description: text, kind },
      });
      if (fnErr) throw fnErr;
      const parsed = (data?.rows ?? []) as any[];
      if (parsed.length === 0) {
        setError('No items detected. Try rewording or adding times/days.');
        setRows([]);
      } else if (kind === 'clubs') {
        setRows(parsed.map((r: any): ParsedClubRow => ({
          include: true,
          name: r.name || '',
          day_of_week: r.day_of_week || '',
          start_time: r.start_time || '',
          end_time: r.end_time || '',
          grades: parseGradesLoose(r.grades),
          leader: r.leader || '',
          location: r.location || '',
        })));
      } else {
        setRows(parsed.map((r: any): ParsedEventRow => ({
          include: true,
          name: r.name || '',
          date: r.date || '',
          start_time: r.start_time || '',
          end_time: r.end_time || '',
          grades: parseGradesLoose(r.grades),
          notes: r.notes || '',
        })));
      }
    } catch (err: any) {
      console.error('[NlImportDialog] parse failed', err);
      setError(err?.message || 'Failed to parse');
    } finally {
      setLoading(false);
    }
  };

  const updateRow = (i: number, patch: Partial<any>) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };

  const includedCount = useMemo(() => rows.filter(r => r.include).length, [rows]);

  const doImport = async () => {
    const selected = rows.filter(r => r.include && r.name.trim());
    if (selected.length === 0) {
      toast.error('Nothing selected to import');
      return;
    }
    setImporting(true);
    try {
      const { ok, skipped } = await onImport(selected);
      toast.success(`Imported ${ok} ${kind}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
      reset();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const title = kind === 'clubs' ? 'Import clubs from description' : 'Import events from description';

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> {title}
          </DialogTitle>
          <DialogDescription>
            Describe in plain English — AI will extract structured rows you can review and import.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            rows={4}
            maxLength={5000}
            disabled={loading || importing}
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{text.length}/5000</span>
            <Button onClick={parse} disabled={loading || !text.trim() || importing} size="sm">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Sparkles className="h-3.5 w-3.5 mr-1.5" />}
              {loading ? 'Parsing…' : 'Parse with AI'}
            </Button>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs flex items-start gap-2 text-destructive">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {rows.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                {includedCount} of {rows.length} selected · review and edit before importing
              </div>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                {rows.map((r, i) => (
                  <div key={i} className="rounded-lg border border-border bg-background p-3 space-y-2">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={r.include}
                        onCheckedChange={(v) => updateRow(i, { include: !!v })}
                        className="mt-1"
                      />
                      <Input
                        value={r.name}
                        onChange={(e) => updateRow(i, { name: e.target.value })}
                        placeholder="Name"
                        className="h-8 text-sm flex-1"
                      />
                    </div>
                    {kind === 'clubs' ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-7">
                        <Input className="h-7 text-xs" placeholder="Day (Mon)" value={r.day_of_week} onChange={(e) => updateRow(i, { day_of_week: e.target.value })} />
                        <Input className="h-7 text-xs" type="time" value={r.start_time} onChange={(e) => updateRow(i, { start_time: e.target.value })} />
                        <Input className="h-7 text-xs" type="time" value={r.end_time} onChange={(e) => updateRow(i, { end_time: e.target.value })} />
                        <Input className="h-7 text-xs" placeholder="Grades (3,4,5)" value={r.grades.join(',')} onChange={(e) => updateRow(i, { grades: parseGradesLoose(e.target.value) })} />
                        <Input className="h-7 text-xs sm:col-span-2" placeholder="Leader name" value={r.leader} onChange={(e) => updateRow(i, { leader: e.target.value })} />
                        <Input className="h-7 text-xs sm:col-span-2" placeholder="Location" value={r.location} onChange={(e) => updateRow(i, { location: e.target.value })} />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pl-7">
                        <Input className="h-7 text-xs" type="date" value={r.date} onChange={(e) => updateRow(i, { date: e.target.value })} />
                        <Input className="h-7 text-xs" type="time" value={r.start_time} onChange={(e) => updateRow(i, { start_time: e.target.value })} />
                        <Input className="h-7 text-xs" type="time" value={r.end_time} onChange={(e) => updateRow(i, { end_time: e.target.value })} />
                        <Input className="h-7 text-xs" placeholder="Grades" value={r.grades.join(',')} onChange={(e) => updateRow(i, { grades: parseGradesLoose(e.target.value) })} />
                        <Input className="h-7 text-xs sm:col-span-4" placeholder="Notes" value={r.notes} onChange={(e) => updateRow(i, { notes: e.target.value })} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={importing}>Cancel</Button>
          <Button onClick={doImport} disabled={importing || includedCount === 0}>
            {importing && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Import {includedCount > 0 ? includedCount : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default NlImportDialog;
