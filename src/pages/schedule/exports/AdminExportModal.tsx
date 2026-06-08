import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Download, AlertCircle } from 'lucide-react';
import { renderPdfBlob, triggerDownload } from './exportShared';
import { AdminOverview } from '@/pdf/AdminOverview';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  specialists: { id: string; name: string; subject: string }[];
  blocks: any[];
  schoolName?: string;
  schoolYear?: string;
  teachers?: any[];
  clubs?: any[];
  recessConfig?: any[];
}

type Phase = 'generating' | 'preview' | 'error';

export const AdminExportModal = ({ open, onOpenChange, specialists, blocks, schoolName, schoolYear, teachers, clubs, recessConfig }: Props) => {
  const [phase, setPhase] = useState<Phase>('generating');
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [slow, setSlow] = useState(false);
  const slowTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!open) {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
      setBlob(null);
      setPhase('generating');
      setSlow(false);
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
      return;
    }

    let cancelled = false;
    (async () => {
      setPhase('generating');
      setSlow(false);
      slowTimer.current = window.setTimeout(() => setSlow(true), 30_000);
      try {
        const b = await renderPdfBlob(
          <AdminOverview
            specialists={specialists}
            blocks={blocks}
            schoolName={schoolName}
            schoolYear={schoolYear}
            teachers={teachers}
            clubs={clubs}
            recessConfig={recessConfig}
          />
        );
        if (cancelled) return;
        const url = URL.createObjectURL(b);
        setBlob(b);
        setBlobUrl(url);
        setPhase('preview');
      } catch (err) {
        console.error('PDF generation failed', err);
        if (!cancelled) setPhase('error');
      } finally {
        if (slowTimer.current) window.clearTimeout(slowTimer.current);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
