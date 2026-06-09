import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { useSetup } from '@/contexts/SetupContext';
import { SETUP_STEPS } from '../stepIndex';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { FileText, Link2, Upload, Sparkles, Loader2, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';

interface SubjectMinutes {
  grade: string;
  subject: string;
  weekly_minutes: number;
}
interface TeacherMinutes {
  role: string;
  planning_minutes: number;
  duty_free_minutes?: number;
  notes?: string;
}
interface ExtractedContract {
  subjects?: SubjectMinutes[];
  teachers?: TeacherMinutes[];
  source_summary?: string;
}

const StepContractualMinutes = () => {
  const { schoolId, setStep } = useSetup();
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [tab, setTab] = useState<'upload' | 'url' | 'skip'>('upload');
  const [url, setUrl] = useState('');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedContract | null>(null);
  const [parsing, setParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!schoolId) return;
    (async () => {
      const { data: row } = await supabase
        .from('schools')
        .select('contractual_minutes_url, contractual_minutes_file_path, contractual_minutes_extracted, contractual_minutes_status, workspace_id')
        .eq('id', schoolId)
        .maybeSingle();
      if (!row) return;
      setUrl((row as any).contractual_minutes_url ?? '');
      setFilePath((row as any).contractual_minutes_file_path ?? null);
      if ((row as any).contractual_minutes_file_path) {
        const name = String((row as any).contractual_minutes_file_path).split('/').pop() ?? null;
        setFileName(name);
      }
      setStatus((row as any).contractual_minutes_status ?? null);
      setExtracted((row as any).contractual_minutes_extracted ?? null);
      if ((row as any).contractual_minutes_url) setTab('url');
      else if ((row as any).contractual_minutes_file_path) setTab('upload');
    })();
  }, [schoolId]);

  async function persist(patch: Record<string, unknown>) {
    if (!schoolId) return;
    setSaveStatus('saving');
    const { error } = await supabase.from('schools').update(patch as any).eq('id', schoolId);
    if (error) {
      setSaveStatus('idle');
      toast.error('Could not save contractual minutes');
      return;
    }
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 1500);
  }

  async function handleFileChosen(file: File) {
    if (!schoolId) { toast.error('Set up your school first.'); return; }
    if (file.size > 20 * 1024 * 1024) { toast.error('PDF too large (max 20MB).'); return; }
    const { data: schoolRow } = await supabase.from('schools').select('workspace_id').eq('id', schoolId).maybeSingle();
    const workspaceId = (schoolRow as any)?.workspace_id;
    if (!workspaceId) { toast.error('Workspace not found'); return; }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${workspaceId}/${schoolId}/${Date.now()}_${safeName}`;
    setSaveStatus('saving');
    const { error } = await supabase.storage.from('contractual-docs').upload(path, file, { upsert: false });
    if (error) {
      setSaveStatus('idle');
      toast.error(`Upload failed: ${error.message}`);
      return;
    }
    setFilePath(path);
    setFileName(file.name);
    setStatus('pending');
    await persist({
      contractual_minutes_file_path: path,
      contractual_minutes_url: null,
      contractual_minutes_status: 'pending',
    });
    toast.success('Uploaded. Click "Parse with AI" to extract minutes.');
  }

  async function handleRemoveFile() {
    if (!filePath) return;
    await supabase.storage.from('contractual-docs').remove([filePath]);
    setFilePath(null);
    setFileName(null);
    setStatus(null);
    setExtracted(null);
    await persist({
      contractual_minutes_file_path: null,
      contractual_minutes_extracted: null,
      contractual_minutes_status: null,
    });
  }

  async function saveUrl() {
    await persist({
      contractual_minutes_url: url || null,
      contractual_minutes_file_path: null,
      contractual_minutes_status: url ? 'pending' : null,
    });
    setStatus(url ? 'pending' : null);
    if (url) toast.success('URL saved. Click "Parse with AI".');
  }

  async function parseWithAi() {
    if (!schoolId) return;
    if (!filePath && !url) { toast.error('Upload a PDF or paste a URL first.'); return; }
    setParsing(true);
    try {
      const { data, error } = await supabase.functions.invoke('parse-contractual-minutes', {
        body: { school_id: schoolId },
      });
      if (error) throw error;
      const result = (data as any)?.extracted as ExtractedContract | undefined;
      if (!result) throw new Error('No data returned');
      setExtracted(result);
      setStatus('parsed');
      toast.success('Contract parsed — review and edit below.');
    } catch (err: any) {
      setStatus('error');
      toast.error(err?.message ?? 'Parsing failed');
    } finally {
      setParsing(false);
    }
  }

  function updateSubject(idx: number, patch: Partial<SubjectMinutes>) {
    if (!extracted?.subjects) return;
    const next = { ...extracted, subjects: extracted.subjects.map((s, i) => i === idx ? { ...s, ...patch } : s) };
    setExtracted(next);
    persist({ contractual_minutes_extracted: next });
  }
  function updateTeacher(idx: number, patch: Partial<TeacherMinutes>) {
    if (!extracted?.teachers) return;
    const next = { ...extracted, teachers: extracted.teachers.map((t, i) => i === idx ? { ...t, ...patch } : t) };
    setExtracted(next);
    persist({ contractual_minutes_extracted: next });
  }
  function removeSubject(idx: number) {
    if (!extracted?.subjects) return;
    const next = { ...extracted, subjects: extracted.subjects.filter((_, i) => i !== idx) };
    setExtracted(next);
    persist({ contractual_minutes_extracted: next });
  }
  function removeTeacher(idx: number) {
    if (!extracted?.teachers) return;
    const next = { ...extracted, teachers: extracted.teachers.filter((_, i) => i !== idx) };
    setExtracted(next);
    persist({ contractual_minutes_extracted: next });
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-card-foreground">Contractual Minutes</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload your district or union contract PDF (or paste a link). AI extracts the required weekly subject minutes
            and teacher planning/duty-free minutes, then uses them to build a schedule that meets your obligations.
          </p>
        </div>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="upload"><FileText className="h-3.5 w-3.5 mr-1.5" /> Upload PDF</TabsTrigger>
          <TabsTrigger value="url"><Link2 className="h-3.5 w-3.5 mr-1.5" /> Paste URL</TabsTrigger>
          <TabsTrigger value="skip">Skip for now</TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-4 space-y-3">
          {filePath ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-background p-3">
              <div className="flex items-center gap-3 min-w-0">
                <FileText className="h-5 w-5 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{fileName ?? 'Contract document'}</p>
                  <p className="text-xs text-muted-foreground">Stored privately for this school.</p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleRemoveFile}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/20 p-8 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">Click to upload PDF</span>
              <span className="text-xs text-muted-foreground">Max 20MB. Stays private to your workspace.</span>
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileChosen(f); e.currentTarget.value = ''; }}
          />
        </TabsContent>

        <TabsContent value="url" className="mt-4 space-y-3">
          <FieldLabel tooltip="A public link to your district's contractual minutes document">Document URL</FieldLabel>
          <div className="flex gap-2">
            <Input
              type="url"
              placeholder="https://district.example.org/contract.pdf"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={saveUrl}
            />
            <Button variant="outline" onClick={saveUrl}>Save</Button>
          </div>
          <p className="text-xs text-muted-foreground">PDF, HTML, or plaintext.</p>
        </TabsContent>

        <TabsContent value="skip" className="mt-4">
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
            You can skip this and add it later. Without contractual minutes, the scheduler uses defaults from School Info.
          </div>
        </TabsContent>
      </Tabs>

      {(filePath || url) && tab !== 'skip' && (
        <div className="flex items-center gap-3">
          <Button onClick={parseWithAi} disabled={parsing} className="gap-2">
            {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {parsing ? 'Parsing…' : extracted ? 'Re-parse with AI' : 'Parse with AI'}
          </Button>
          {status === 'parsed' && <Badge variant="outline" className="gap-1 text-emerald-700 dark:text-emerald-400 border-emerald-500/40"><CheckCircle2 className="h-3 w-3" /> Parsed</Badge>}
          {status === 'pending' && <Badge variant="outline">Ready to parse</Badge>}
          {status === 'error' && <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Failed</Badge>}
        </div>
      )}

      {extracted && (
        <div className="space-y-6">
          {extracted.source_summary && (
            <div className="rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <strong className="text-foreground">AI summary:</strong> {extracted.source_summary}
            </div>
          )}

          {extracted.subjects && extracted.subjects.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Required weekly subject minutes</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left">Grade</th>
                      <th className="px-3 py-2 text-left">Subject</th>
                      <th className="px-3 py-2 text-left">Minutes / week</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {extracted.subjects.map((s, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-1.5"><Input className="h-8" value={s.grade} onChange={(e) => updateSubject(i, { grade: e.target.value })} /></td>
                        <td className="px-3 py-1.5"><Input className="h-8" value={s.subject} onChange={(e) => updateSubject(i, { subject: e.target.value })} /></td>
                        <td className="px-3 py-1.5"><Input className="h-8 w-24" type="number" value={s.weekly_minutes} onChange={(e) => updateSubject(i, { weekly_minutes: Number(e.target.value) })} /></td>
                        <td className="px-3 py-1.5 text-right"><Button variant="ghost" size="sm" onClick={() => removeSubject(i)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {extracted.teachers && extracted.teachers.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Teacher contractual minutes</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs">
                    <tr>
                      <th className="px-3 py-2 text-left">Role</th>
                      <th className="px-3 py-2 text-left">Planning / week</th>
                      <th className="px-3 py-2 text-left">Duty-free / week</th>
                      <th className="px-3 py-2 text-left">Notes</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {extracted.teachers.map((t, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-3 py-1.5"><Input className="h-8" value={t.role} onChange={(e) => updateTeacher(i, { role: e.target.value })} /></td>
                        <td className="px-3 py-1.5"><Input className="h-8 w-24" type="number" value={t.planning_minutes} onChange={(e) => updateTeacher(i, { planning_minutes: Number(e.target.value) })} /></td>
                        <td className="px-3 py-1.5"><Input className="h-8 w-24" type="number" value={t.duty_free_minutes ?? 0} onChange={(e) => updateTeacher(i, { duty_free_minutes: Number(e.target.value) })} /></td>
                        <td className="px-3 py-1.5"><Input className="h-8" value={t.notes ?? ''} onChange={(e) => updateTeacher(i, { notes: e.target.value })} /></td>
                        <td className="px-3 py-1.5 text-right"><Button variant="ghost" size="sm" onClick={() => removeTeacher(i)}><Trash2 className="h-3.5 w-3.5" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => setStep(SETUP_STEPS.TEACHERS)}>Back</Button>
        <Button onClick={() => setStep(SETUP_STEPS.ADMIN_ROTATION)}>Continue</Button>
      </div>
    </div>
  );
};

export default StepContractualMinutes;
