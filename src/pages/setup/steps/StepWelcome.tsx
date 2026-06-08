import { useRef, useState } from 'react';
import { SETUP_STEPS } from '../stepIndex';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Wand2, Download, Upload, CheckCircle2, FileText, AlertTriangle, XCircle, Info, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { downloadTemplate } from '@/lib/templateDownload';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';

function fileToRows(file: File): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls') {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target?.result, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          resolve(data.map(r => r.map(c => String(c).trim())));
        } catch (err) { reject(err); }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const rows: string[][] = [];
        let current = '';
        let inQuotes = false;
        let row: string[] = [];
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inQuotes) {
            if (ch === '"' && text[i + 1] === '"') { current += '"'; i++; }
            else if (ch === '"') { inQuotes = false; }
            else { current += ch; }
          } else {
            if (ch === '"') { inQuotes = true; }
            else if (ch === ',') { row.push(current.trim()); current = ''; }
            else if (ch === '\n' || ch === '\r') {
              if (ch === '\r' && text[i + 1] === '\n') i++;
              row.push(current.trim()); current = '';
              if (row.some(c => c)) rows.push(row);
              row = [];
            } else { current += ch; }
          }
        }
        row.push(current.trim());
        if (row.some(c => c)) rows.push(row);
        resolve(rows);
      };
      reader.readAsText(file);
    }
  });
}

interface Warning {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

interface AIResult {
  school_info?: {
    website?: string;
    calendar_url?: string;
    early_release_day?: string;
    early_release_end_time?: string;
    default_day_preference?: string;
    default_am_pm_preference?: string;
  };
  admin_rotation?: Array<{
    day: string;
    grades: string[];
    start_time?: string;
    end_time?: string;
    notes?: string;
  }>;
  specialists?: Array<{
    name?: string;
    subject: string;
    uses_cart?: boolean;
    two_schools?: boolean;
    is_part_time?: boolean;
    working_days?: string[];
    grade_preference?: string;
  }>;
  conflict_strategies?: string[];
  grade_preference?: string;
  makeup_policy?: string;
  warnings?: Warning[];
}

const StepWelcome = () => {
  const { data, updateData, setStep, setPrefilledSpecialists } = useSetup();
  const fileRef = useRef<HTMLInputElement>(null);
  const [aiResult, setAiResult] = useState<AIResult | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    try {
      setProcessing(true);
      const rows = await fileToRows(f);
      if (rows.length < 3) {
        toast.error('File has too few rows — is it filled out?');
        setProcessing(false);
        return;
      }

      // Find Q&A columns — template may have data in B/C instead of A/B
      // Detect which column contains "Ask" header
      let askCol = 0;
      let ansCol = 1;
      for (const row of rows.slice(0, 5)) {
        const idx = row.findIndex(c => c?.trim()?.toLowerCase() === 'ask');
        if (idx >= 0) {
          askCol = idx;
          ansCol = idx + 1;
          break;
        }
      }

      // Extract Q&A pairs using detected columns, skip header/instruction rows
      const qaRows = rows
        .map(r => [r[askCol] || '', r[ansCol] || ''])
        .filter(r => r[0]?.trim() && r[0].trim().toLowerCase() !== 'ask' && !r[0].startsWith('Prepare'));

      const { data: fnData, error: fnError } = await supabase.functions.invoke('process-onboarding-template', {
        body: { rows: qaRows },
      });

      if (fnError) {
        toast.error(fnError.message || 'AI processing failed');
        setProcessing(false);
        return;
      }

      if (fnData?.error) {
        toast.error(fnData.error);
        setProcessing(false);
        return;
      }

      const result = fnData as AIResult;
      setAiResult(result);

      // Map extracted data into SetupContext
      const updates: Partial<typeof data> = {};

      if (result.school_info) {
        if (result.school_info.website) updates.website = result.school_info.website;
        if (result.school_info.early_release_day) updates.earlyReleaseDay = result.school_info.early_release_day;
        if (result.school_info.early_release_end_time) updates.earlyReleaseEndTime = result.school_info.early_release_end_time;
        if (result.school_info.default_day_preference) updates.defaultDayPreference = result.school_info.default_day_preference;
        if (result.school_info.default_am_pm_preference) updates.defaultAmPmPreference = result.school_info.default_am_pm_preference;
      }

      if (result.admin_rotation?.length) {
        updates.adminRotation = result.admin_rotation.map(ar => ({
          day: ar.day,
          startTime: ar.start_time || '',
          endTime: ar.end_time || '',
          grades: ar.grades,
        }));
      }

      if (result.conflict_strategies?.length) {
        updates.conflictStrategies = result.conflict_strategies;
      }

      if (result.grade_preference) {
        updates.gradePreference = result.grade_preference as 'keep_together' | 'waterfall';
      }

      if (result.makeup_policy) {
        updates.makeupPolicy = result.makeup_policy;
      }

      if (Object.keys(updates).length > 0) {
        updateData(updates);
      }

      // Map specialists
      if (result.specialists?.length) {
        setPrefilledSpecialists(result.specialists.map(s => ({
          name: s.name || '',
          subject: s.subject || 'Other',
          days: s.working_days || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          planningMinutes: null,
          lunchMinutes: null,
          location: '',
          usesCart: s.uses_cart || false,
          twoSchools: s.two_schools || false,
          secondSchoolName: '',
          secondLocation: '',
        })));
      }

      const errorCount = result.warnings?.filter(w => w.severity === 'error').length || 0;
      const warningCount = result.warnings?.filter(w => w.severity === 'warning').length || 0;

      if (errorCount > 0) {
        toast.warning(`Template processed with ${errorCount} missing field(s)`);
      } else if (warningCount > 0) {
        toast.success(`Template processed with ${warningCount} note(s) to review`);
      } else {
        toast.success('Template processed successfully!');
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to process template');
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const severityIcon = (severity: string) => {
    switch (severity) {
      case 'error': return <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />;
      case 'warning': return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
      default: return <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
    }
  };

  return (
    <div className="rounded-xl border border-border bg-card p-8">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Wand2 className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold text-card-foreground">Welcome to the Setup Wizard</h2>
          <p className="text-sm text-muted-foreground">
            Let's configure your school's scheduling data. You can complete the tabs in any order — click any tab above to jump to a section.
          </p>
        </div>

        {/* Template Upload */}
        <div className="rounded-lg border border-border bg-secondary/30 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-card-foreground">📋 Quick Start with Template</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Download our onboarding template, fill it out with your school's information, then upload it. AI will extract and validate all answers automatically.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 border-accent text-accent hover:bg-accent/10"
              onClick={() => downloadTemplate('onboarding_template', '/templates/onboarding_template.xlsx')}
            >
              <Download className="h-3.5 w-3.5" /> Download Template
            </Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => fileRef.current?.click()}
              disabled={processing}
            >
              {processing ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Processing...</>
              ) : (
                <><Upload className="h-3.5 w-3.5" /> Upload Filled Template</>
              )}
            </Button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleTemplateUpload} />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Supports XLSX or CSV. AI will parse your answers and auto-fill the wizard fields.
          </p>

          {/* AI Validation Report */}
          {aiResult && (
            <div className="space-y-2 pt-2 border-t border-border">
              {/* Summary */}
              <div className="rounded-md border border-success/30 bg-success/10 p-3 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                <div className="text-xs text-card-foreground">
                  <p className="font-medium">Template analyzed successfully!</p>
                  <p className="text-muted-foreground mt-0.5">
                    {aiResult.specialists?.length ? `${aiResult.specialists.length} specialist(s) found. ` : ''}
                    {aiResult.admin_rotation?.length ? `${aiResult.admin_rotation.length} admin rotation block(s). ` : ''}
                    {aiResult.conflict_strategies?.length ? `${aiResult.conflict_strategies.length} conflict strategies. ` : ''}
                    {aiResult.school_info?.website ? 'School info imported. ' : ''}
                    Navigate to each tab to review.
                  </p>
                </div>
              </div>

              {/* Warnings */}
              {aiResult.warnings && aiResult.warnings.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50/50 dark:bg-amber-900/10 dark:border-amber-800 p-3 space-y-1.5">
                  <p className="text-xs font-medium text-card-foreground">Review these items:</p>
                  {aiResult.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5">
                      {severityIcon(w.severity)}
                      <span className="text-[11px] text-muted-foreground">
                        <strong className="text-card-foreground">{w.field}:</strong> {w.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="text-left space-y-2">
          <FieldLabel htmlFor="schoolName" tooltip="Enter your school name to get started — this will appear on all exports.">School Name</FieldLabel>
          <Input
            id="schoolName"
            value={data.schoolName}
            onChange={(e) => updateData({ schoolName: e.target.value })}
            placeholder="e.g. Lincoln Elementary"
            className="text-center"
          />
        </div>
        <Button onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)} disabled={!data.schoolName.trim()} className="w-full">
          Get Started
        </Button>
      </div>
    </div>
  );
};

export default StepWelcome;
