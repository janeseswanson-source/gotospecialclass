import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Download, AlertCircle } from 'lucide-react';
import { renderPdfBlob, triggerDownload } from './exportShared';
import { AdminOverview } from '@/pdf/AdminOverview';
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
  teachers?: any[];
  clubs?: any[];
  recessConfig?: any[];
}

type Phase = 'options' | 'generating' | 'preview' | 'error';

export const AdminExportModal = ({ open, onOpenChange, specialists, blocks, schoolId, schoolName, schoolYear, teachers, clubs, recessConfig }: Props) => {
  const [phase, setPhase] = useState<Phase>('options');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [slow, setSlow] = useState(false);
  const [quoteOverride, setQuoteOverride] = useState('');
  const slowTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
      setBlob(null);
      setPhase('options');
      setQuoteOverride('');
      setSlow(false);
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleGenerate = async () => {
    setPhase('generating');
    setSlow(false);
    slowTimer.current = window.setTimeout(() => setSlow(true), 30_000);
    try {
      const quote = quoteOverride.trim() || (await resolveDisplayQuote(schoolId)).text;
      const b = await renderPdfBlob(
        <AdminOverview
          specialists={specialists}
          blocks={blocks}
          schoolName={schoolName}
          schoolYear={schoolYear}
          teachers={teachers}
          clubs={clubs}
          recessConfig={recessConfig}
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
    triggerDownload(blob, 'all-rotations-overview.pdf');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Admin: All Rotations Overview (PDF)</DialogTitle>
        </DialogHeader>

        {phase === 'options' && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              A print-ready overview of every rotation, lunch club, and session — on brand, ready for the binder.
            </p>
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

export default AdminExportModal;
