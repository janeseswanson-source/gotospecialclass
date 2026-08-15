// Contract compliance report — advisory, never blocking.
//
// The PM asked "Should we add contract info from the district contract here?"
// and supplied her HSTA numbers. This measures the generated week against
// them per person, and always shows what it could NOT account for, because
// the first thing a coordinator does with a number like this is check the
// arithmetic.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Info, CheckCircle2, Printer, ScrollText } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import {
  computeCompliance, HSTA_PROFILE,
  type CompliancePerson, type PersonCompliance, type ContractCategory, type ComplianceBlock,
} from '@/lib/contractCompliance';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function toMin(t?: string | null): number {
  if (!t) return 0;
  const [h, m] = t.slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** A stacked bar of the four buckets plus whatever is unaccounted. */
function BucketBar({ r }: { r: PersonCompliance }) {
  const total = Math.max(1, r.dutyTotal);
  const seg = (v: number, cls: string, label: string) =>
    v > 0 ? <div key={label} className={cls} style={{ width: `${(v / total) * 100}%` }} title={`${label}: ${v} min`} /> : null;
  return (
    <div className="flex h-3 w-full overflow-hidden rounded bg-muted">
      {seg(r.instructional, 'bg-primary', 'Instructional')}
      {seg(r.prep, 'bg-accent', 'Prep')}
      {seg(r.lunch, 'bg-emerald-500', 'Lunch')}
      {seg(r.other, 'bg-amber-400', 'Other')}
      {seg(r.unaccounted, 'bg-muted-foreground/30', 'Unaccounted')}
    </div>
  );
}

export default function CompliancePage() {
  const { user } = useAuth();
  const { selectedSchoolId, loading: schoolLoading } = useSchool();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PersonCompliance[]>([]);
  const [hasSchedule, setHasSchedule] = useState(false);

  useEffect(() => {
    if (!user || schoolLoading || !selectedSchoolId) { setLoading(false); return; }
    let cancelled = false;

    (async () => {
      setLoading(true);
      const [{ data: school }, { data: gen }, { data: specs }, { data: teachers }] = await Promise.all([
        supabase.from('schools').select('*').eq('id', selectedSchoolId).maybeSingle(),
        supabase.from('schedule_generations').select('id').eq('school_id', selectedSchoolId)
          .order('version', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('specialists').select('*').eq('school_id', selectedSchoolId),
        supabase.from('classroom_teachers').select('*').eq('school_id', selectedSchoolId),
      ]);

      let blocks: ComplianceBlock[] = [];
      if (gen?.id) {
        const { data } = await supabase.from('schedule_blocks').select('*').eq('generation_id', gen.id);
        blocks = (data ?? []) as ComplianceBlock[];
      }
      if (cancelled) return;
      setHasSchedule(blocks.length > 0);

      // Duty window: the teacher day when the school has set one, else the
      // student day (mirrors the engine's teacherDayStartMin/EndMin).
      const s = (school ?? {}) as Record<string, unknown>;
      const dayStart = toMin((s.teacher_day_start_time as string) ?? (s.start_time as string) ?? '08:00');
      const dayEnd = toMin((s.teacher_day_end_time as string) ?? (s.end_time as string) ?? '15:00');
      const perDay = Math.max(0, dayEnd - dayStart);
      const rotStart = toMin((s.rotations_start_time as string) || (s.start_time as string) || '08:00');
      const preRotationPerWeek = Math.max(0, rotStart - dayStart) * DAYS.length;

      const accompanied = new Set(
        (specs ?? []).filter((x) => (x as { teacher_accompanies?: boolean }).teacher_accompanies).map((x) => x.id),
      );
      const defaultCat = (v: unknown, fallback: ContractCategory): ContractCategory =>
        v === 'self_contained' || v === 'departmental' ? v : fallback;

      const people: CompliancePerson[] = [
        ...(specs ?? []).map((sp) => ({
          id: sp.id,
          name: sp.name,
          role: 'specialist' as const,
          category: defaultCat((sp as { contract_category?: unknown }).contract_category, 'departmental'),
        })),
        ...(teachers ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          role: 'teacher' as const,
          category: defaultCat((t as { contract_category?: unknown }).contract_category, 'self_contained'),
          accompaniedSpecialistIds: accompanied,
        })),
      ];

      setRows(computeCompliance({
        blocks, people, profile: HSTA_PROFILE,
        dutyMinutesFor: (p) => perDay * (p.role === 'specialist' ? DAYS.length : DAYS.length),
        preRotationMinutesPerWeek: preRotationPerWeek,
      }));
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [user, selectedSchoolId, schoolLoading]);

  if (loading || schoolLoading) {
    return <div className="space-y-4"><Skeleton className="h-12 w-full" /><Skeleton className="h-96 w-full" /></div>;
  }

  const withFindings = rows.filter((r) => r.findings.length > 0);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="print:hidden">
        <PageHeader
          title="Contract Compliance"
          subtitle={`Measured against ${HSTA_PROFILE.name}. Advisory only — nothing here blocks a schedule.`}
          actions={
            <Button variant="outline" size="sm" onClick={() => window.print()} disabled={rows.length === 0}>
              <Printer className="mr-1.5 h-4 w-4" /> Print
            </Button>
          }
        />
      </div>

      {!hasSchedule && (
        <div className="rounded-xl border-2 border-dashed border-border bg-card p-10 text-center">
          <ScrollText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Generate a schedule first — this report measures the week you've actually built.
          </p>
          <Button asChild className="mt-4"><Link to="/app/schedule">Go to Master Schedule</Link></Button>
        </div>
      )}

      {hasSchedule && (
        <>
          <div className="rounded-lg border border-border bg-muted/20 p-4 text-xs text-muted-foreground">
            Specialists and classroom teachers are held to <strong className="text-foreground">different</strong> weekly
            limits on purpose: {HSTA_PROFILE.categories.departmental.instructionalMax} instructional minutes for
            departmental staff versus {HSTA_PROFILE.categories.self_contained.instructionalMax} for self-contained,
            with the difference returned as “other” time. Prep ({HSTA_PROFILE.categories.departmental.prepMin}) and
            lunch ({HSTA_PROFILE.categories.departmental.lunchMin}) are the same for both.
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex flex-wrap items-center gap-4 border-b border-border px-4 py-2 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-primary" /> Instructional</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent" /> Prep</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-500" /> Lunch</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-amber-400" /> Other</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-muted-foreground/30" /> Unaccounted</span>
            </div>
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <li key={`${r.personId}-${r.personName}`} className="space-y-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{r.personName}</span>
                    <span className="text-[11px] text-muted-foreground">{r.limits.label}</span>
                  </div>
                  <BucketBar r={r} />
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                    <span>Instruction <strong className="text-foreground">{r.instructional}</strong>/{r.limits.instructionalMax}</span>
                    <span>Prep <strong className="text-foreground">{r.prep}</strong>/{r.limits.prepMin}</span>
                    <span>Lunch <strong className="text-foreground">{r.lunch}</strong>/{r.limits.lunchMin}</span>
                    <span>Other <strong className="text-foreground">{r.other}</strong>/{r.limits.otherMin}</span>
                    <span>Unaccounted <strong className="text-foreground">{r.unaccounted}</strong> of {r.dutyTotal} duty min</span>
                  </div>
                  {r.findings.map((f, i) => (
                    <p key={i} className={`flex items-start gap-1.5 text-[11px] ${f.severity === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}`}>
                      {f.severity === 'warning'
                        ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        : <Info className="mt-0.5 h-3 w-3 shrink-0" />}
                      {f.message}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </div>

          {withFindings.length === 0 && rows.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-primary">
              <CheckCircle2 className="h-4 w-4" /> No contract findings for this week.
            </p>
          )}
        </>
      )}
    </div>
  );
}
