import { useEffect, useState } from 'react';
import { SETUP_PATHS, PREP_SHEET_PATH } from '@/lib/setupPaths';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, Users, School, BookOpen, Wand2, Download, CreditCard, CheckCircle2, AlertCircle, ShieldCheck, Trash2, ClipboardList, X, Sparkles, Loader2, ListChecks } from 'lucide-react';
import OnboardingChecklist from '@/components/dashboard/OnboardingChecklist';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { seedDemoSchool, wipeDemoSchools } from '@/lib/seedDemoSchool';
import SeedDemoDialog from '@/components/dashboard/SeedDemoDialog';
import SampleSchedulePreview from '@/components/schedule/SampleSchedulePreview';

const MetricCard = ({ label, value, icon: Icon, color }: { label: string; value: string; icon: any; color: string }) => (
  <div className="rounded-xl border border-border bg-card p-5 animate-hover-lift">
    <div className="flex items-center gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${color}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-bold text-card-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  </div>
);

const MetricCardSkeleton = () => (
  <div className="rounded-xl border border-border bg-card p-5">
    <div className="flex items-center gap-3">
      <Skeleton className="h-10 w-10 rounded-lg" />
      <div className="space-y-2">
        <Skeleton className="h-6 w-12" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  </div>
);

const QuickAction = ({ label, desc, icon: Icon, to, color }: { label: string; desc: string; icon: any; to: string; color: string }) => (
  <Link to={to} className="flex items-start gap-4 rounded-xl border border-border bg-card p-5 transition-all hover:shadow-md hover:-translate-y-0.5">
    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${color}`}>
      <Icon className="h-5 w-5" />
    </div>
    <div>
      <p className="font-semibold text-card-foreground text-sm">{label}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
    </div>
  </Link>
);

const StatusCard = ({ label, status, ok }: { label: string; status: string; ok: boolean }) => (
  <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
    <span className="text-sm text-muted-foreground">{label}</span>
    <span className={`flex items-center gap-1.5 text-xs font-medium ${ok ? 'text-success' : 'text-accent'}`}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
      {status}
    </span>
  </div>
);

const StatusCardSkeleton = () => (
  <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
    <Skeleton className="h-4 w-28" />
    <Skeleton className="h-4 w-16" />
  </div>
);

interface DashboardData {
  schoolCount: number;
  specialistCount: number;
  classroomCount: number;
  teacherCount: number;
  setupStep: number;
  setupComplete: boolean;
  hasCalendar: boolean;
  hasSchedule: boolean;
  billingActive: boolean;
  schoolYear: string;
  generationCount: number;
  exportCount: number;
  lastGenerated: string | null;
  verifyQualityScore: number | null;
  verifySummary: string | null;
  recentActivity: Array<{ id: string; action: string; details: any; created_at: string }>;
}

const DashboardPage = () => {
  const { user } = useAuth();
  const { schools, selectedSchool, workspaceId, loading: schoolLoading, refresh, setSelectedSchoolId } = useSchool();
  const navigate = useNavigate();
  const demoCount = schools.filter((s: any) => s.is_demo).length;
  const showDemoSeed = import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_SEED === 'true';
  const [seeding, setSeeding] = useState(false);
  const [wipingDemo, setWipingDemo] = useState(false);

  const [demoDialogOpen, setDemoDialogOpen] = useState(false);

  const handleSeedDemo = async (options?: import('@/lib/seedDemoSchool').SeedDemoOptions) => {
    if (!workspaceId || !user || seeding) return;
    setSeeding(true);
    try {
      const { schoolId } = await seedDemoSchool(workspaceId, user.id, options);
      await refresh();
      setSelectedSchoolId(schoolId);
      setDemoDialogOpen(false);
      toast.success('Demo school created!', {
        action: { label: 'Open', onClick: () => navigate('/app/schedule') },
      });
    } catch (err: any) {
      toast.error(err?.message || 'Failed to seed demo school');
    } finally {
      setSeeding(false);
    }
  };

  const handleWipeDemo = async () => {
    if (!workspaceId || wipingDemo) return;
    setWipingDemo(true);
    try {
      const n = await wipeDemoSchools(workspaceId);
      toast.success(`Removed ${n} demo school${n === 1 ? '' : 's'}`);
      await refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to remove demo schools');
    } finally {
      setWipingDemo(false);
    }
  };

  const [isAdmin, setIsAdmin] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [data, setData] = useState<DashboardData>({
    schoolCount: 0, specialistCount: 0, classroomCount: 0, teacherCount: 0,
    setupStep: 0, setupComplete: false, hasCalendar: false, hasSchedule: false,
    billingActive: false, schoolYear: '2025–2026', generationCount: 0, exportCount: 0,
    lastGenerated: null, verifyQualityScore: null, verifySummary: null, recentActivity: [],
  });

  useEffect(() => {
    if (!user) return;
    supabase.rpc('has_role', { _user_id: user.id, _role: 'admin' }).then(({ data }) => setIsAdmin(!!data));
  }, [user]);

  useEffect(() => {
    if (schoolLoading || !workspaceId) return;
    const load = async () => {
      setDataLoading(true);
      const schoolIds = schools.map(s => s.id);

      const [subsRes] = await Promise.all([
        supabase.from('subscriptions').select('status').eq('workspace_id', workspaceId).limit(1).maybeSingle(),
      ]);

      let specialistCount = 0, classroomCount = 0, hasCalendar = false, hasSchedule = false;
      let generationCount = 0, exportCount = 0, lastGenerated: string | null = null;
      let verifyQualityScore: number | null = null, verifySummary: string | null = null;
      let recentActivity: DashboardData['recentActivity'] = [];

      if (schoolIds.length > 0) {
        const [specRes, teacherRes, calRes, genRes, exportRes, activityRes] = await Promise.all([
          supabase.from('specialists').select('id', { count: 'exact', head: true }).in('school_id', schoolIds),
          supabase.from('classroom_teachers').select('id', { count: 'exact', head: true }).in('school_id', schoolIds),
          supabase.from('calendar_uploads').select('id', { count: 'exact', head: true }).in('school_id', schoolIds),
          supabase.from('schedule_generations').select('id, created_at, verify_quality_score, verify_summary').in('school_id', schoolIds).order('created_at', { ascending: false }),
          supabase.from('export_records').select('id', { count: 'exact', head: true }).in('school_id', schoolIds),
          workspaceId ? supabase.from('activity_log').select('id, action, details, created_at').eq('workspace_id', workspaceId).order('created_at', { ascending: false }).limit(8) : Promise.resolve({ data: [] }),
        ]);
        specialistCount = specRes.count || 0;
        classroomCount = teacherRes.count || 0;
        hasCalendar = (calRes.count || 0) > 0;
        hasSchedule = (genRes.data?.length || 0) > 0;
        generationCount = genRes.data?.length || 0;
        exportCount = exportRes.count || 0;
        lastGenerated = genRes.data?.[0]?.created_at || null;
        verifyQualityScore = (genRes.data?.[0] as any)?.verify_quality_score ?? null;
        verifySummary = (genRes.data?.[0] as any)?.verify_summary ?? null;
        recentActivity = (activityRes.data ?? []).map((a: any) => ({ id: a.id, action: a.action, details: a.details ?? {}, created_at: a.created_at }));
      }

      setData({
        schoolCount: schools.length,
        specialistCount,
        classroomCount,
        teacherCount: classroomCount,
        setupStep: selectedSchool?.setup_step || 0,
        setupComplete: selectedSchool?.setup_complete || false,
        hasCalendar,
        hasSchedule,
        billingActive: subsRes.data?.status === 'active' || !subsRes.data,
        schoolYear: selectedSchool?.school_year || '2025–2026',
        generationCount,
        exportCount,
        lastGenerated,
        verifyQualityScore,
        verifySummary,
        recentActivity,
      });
      setDataLoading(false);
    };
    load();
  }, [schools, selectedSchool, workspaceId, schoolLoading]);

  const isLoading = schoolLoading || dataLoading;
  // Brand-new account: ONE welcome hero carries every option — the metrics,
  // progress bar, quick actions, status cards, and danger zone (all zeros /
  // "Pending" / disabled) only add noise before a school exists.
  const isNewSchool = !isLoading && data.schoolCount === 0 && !data.setupComplete;
  const progressPct = data.setupComplete ? 100 : Math.round((data.setupStep / 10) * 100);
  const [wiping, setWiping] = useState(false);

  // Coordinator Prep suggestion banner
  const dismissKey = workspaceId ? `coordinator-prep-dismissed:${workspaceId}` : null;
  const [showPrepBanner, setShowPrepBanner] = useState(false);
  useEffect(() => {
    if (!workspaceId || !dismissKey) return;
    if (localStorage.getItem(dismissKey) === '1') { setShowPrepBanner(false); return; }
    (async () => {
      const { data: prep } = await supabase
        .from('coordinator_prep')
        .select('id')
        .eq('workspace_id', workspaceId)
        .limit(1)
        .maybeSingle();
      setShowPrepBanner(!prep);
    })();
  }, [workspaceId, dismissKey]);

  const dismissPrepBanner = () => {
    if (dismissKey) localStorage.setItem(dismissKey, '1');
    setShowPrepBanner(false);
  };



  const handleWipe = async () => {
    if (!workspaceId) return;
    setWiping(true);
    try {
      const { data: schoolRows } = await supabase
        .from('schools').select('id').eq('workspace_id', workspaceId);
      const ids = (schoolRows ?? []).map(s => s.id);

      if (ids.length > 0) {
        const { data: gens } = await supabase
          .from('schedule_generations').select('id').in('school_id', ids);
        const genIds = (gens ?? []).map(g => g.id);
        if (genIds.length > 0) {
          await supabase.from('schedule_blocks').delete().in('generation_id', genIds);
        }
        await supabase.from('schedule_generations').delete().in('school_id', ids);
        await supabase.from('export_records').delete().in('school_id', ids);
        await supabase.from('parsed_calendar_events').delete().in('school_id', ids);
        await supabase.from('calendar_uploads').delete().in('school_id', ids);
        await supabase.from('classroom_teachers').delete().in('school_id', ids);
        await supabase.from('specialists').delete().in('school_id', ids);
        await supabase.from('clubs').delete().in('school_id', ids);
        await supabase.from('special_events').delete().in('school_id', ids);
        await supabase.from('recess_lunch_config').delete().in('school_id', ids);
        const { error } = await supabase.from('schools').delete().in('id', ids);
        if (error) throw error;
      }

      localStorage.removeItem('selected_school_id');
      toast.success('All workspace data wiped');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Wipe failed');
    } finally {
      setWiping(false);
    }
  };



  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Welcome back! Here's your scheduling overview.</p>
        </div>
        {isLoading ? (
          <Skeleton className="h-7 w-24 rounded-full" />
        ) : (
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {data.schoolYear}
          </span>
        )}
      </div>

      {!isLoading && data.schoolCount === 0 && !data.setupComplete && (
        <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-8 text-center animate-fade-in">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <Wand2 className="h-7 w-7 text-primary" />
          </div>
          <h2 className="text-lg font-bold text-foreground">Welcome to Specialist Ops!</h2>
          <p className="mt-2 max-w-md mx-auto text-sm text-muted-foreground">
            Two ways to set up — pick whichever feels easier. Either one gets you to your first schedule in minutes.
          </p>
          {/* Same two paths the wizard offers, worded identically (setupPaths.ts).
              The dashboard used to omit the AI path entirely. */}
          <div className="mt-5 flex flex-col sm:flex-row items-stretch justify-center gap-3 max-w-xl mx-auto">
            <Link to="/app/setup" className="flex-1 inline-flex flex-col items-center gap-1 rounded-lg bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
              <span className="inline-flex items-center gap-2"><Wand2 className="h-4 w-4" /> {SETUP_PATHS[0].title}</span>
              <span className="text-[11px] font-normal opacity-90">{SETUP_PATHS[0].blurb}</span>
            </Link>
            <Link to="/app/setup" className="flex-1 inline-flex flex-col items-center gap-1 rounded-lg border border-primary/40 bg-card px-6 py-3 text-sm font-medium text-primary hover:bg-primary/5 transition-colors">
              <span className="inline-flex items-center gap-2"><ListChecks className="h-4 w-4" /> {SETUP_PATHS[1].title}</span>
              <span className="text-[11px] font-normal text-muted-foreground">{SETUP_PATHS[1].blurb}</span>
            </Link>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {PREP_SHEET_PATH.title}{' '}
            <Link to={PREP_SHEET_PATH.uploadHref} className="text-primary underline underline-offset-2 hover:opacity-80">
              {PREP_SHEET_PATH.uploadLabel}
            </Link>
          </p>
          <p className="mt-4 text-xs text-muted-foreground">
            Not sure what you'll get?{" "}
            <SampleSchedulePreview
              trigger={<button className="text-primary underline underline-offset-2 hover:opacity-80">See a sample schedule first</button>}
            />
            {showDemoSeed && (
              <>
                {" "}· or{" "}
                <button
                  className="text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                  disabled={seeding}
                  onClick={() => handleSeedDemo()}
                >
                  {seeding ? 'seeding a demo school…' : 'explore with a demo school'}
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {!isLoading && showPrepBanner && !isNewSchool && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 flex items-start gap-4 animate-fade-in">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground">Prefer paper? Try the Take-In Template.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Print one sheet, fill in your school info and specialists by hand, then upload it — Claude reads it and fills your setup automatically. No wizard required.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild size="sm">
                <Link to="/app/coordinator-prep">
                  <ClipboardList className="h-4 w-4 mr-2" />
                  Open the template
                </Link>
              </Button>
              <Button size="sm" variant="ghost" onClick={dismissPrepBanner}>
                Skip for now
              </Button>
            </div>
          </div>
          <button
            onClick={dismissPrepBanner}
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!isLoading && showDemoSeed && !isNewSchool && (
        <div className="rounded-xl border border-accent/30 bg-accent/5 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground">Try with sample data</h2>
                <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                  {demoCount > 0
                    ? `You have ${demoCount} demo school${demoCount === 1 ? '' : 's'}.`
                    : 'Spin up a fully configured demo school with realistic teachers, specialists, and rotations. Great for exploring the app or testing changes.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => handleSeedDemo()} disabled={seeding}>
                {seeding ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                {seeding ? 'Seeding…' : demoCount > 0 ? 'Seed another' : 'Seed Demo School'}
              </Button>
              <Button variant="outline" onClick={() => setDemoDialogOpen(true)} disabled={seeding}>
                Customize…
              </Button>
              {demoCount > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" disabled={wipingDemo}>
                      <Trash2 className="h-4 w-4 mr-2" />
                      Remove all demo schools
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove demo schools?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Remove {demoCount} demo school{demoCount === 1 ? '' : 's'}? Your real schools stay safe.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleWipeDemo} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        Yes, remove demos
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </div>
        </div>
      )}

      {showDemoSeed && (
        <SeedDemoDialog
          open={demoDialogOpen}
          onOpenChange={setDemoDialogOpen}
          onSubmit={(opts) => handleSeedDemo(opts)}
          submitting={seeding}
        />
      )}

      {!isLoading && !isNewSchool && <OnboardingChecklist />}

      {!isNewSchool && (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
            <MetricCardSkeleton />
          </>
        ) : (
          <>
            <MetricCard label="Schools" value={String(data.schoolCount)} icon={School} color="bg-primary/10 text-primary" />
            <MetricCard label="Specialists" value={String(data.specialistCount)} icon={Users} color="bg-accent/10 text-accent" />
            <MetricCard label="Classrooms" value={String(data.classroomCount)} icon={BookOpen} color="bg-purple/10 text-purple" />
            <MetricCard label="Teachers" value={String(data.teacherCount)} icon={Users} color="bg-success/10 text-success" />
          </>
        )}
      </div>
      )}

      {/* Usage Analytics + Schedule Health */}
      {!isLoading && !isNewSchool && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">Schedules Generated</p>
            <p className="text-2xl font-bold text-card-foreground mt-1">{data.generationCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">Total Exports</p>
            <p className="text-2xl font-bold text-card-foreground mt-1">{data.exportCount}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">Last Generated</p>
            <p className="text-sm font-medium text-card-foreground mt-1">
              {data.lastGenerated ? new Date(data.lastGenerated).toLocaleDateString() : 'Never'}
            </p>
          </div>
          {/* Schedule Health */}
          <div className={`rounded-xl border bg-card p-5 ${data.verifyQualityScore !== null ? (data.verifyQualityScore >= 80 ? 'border-emerald-500/40' : data.verifyQualityScore >= 60 ? 'border-amber-500/40' : 'border-destructive/40') : 'border-border'}`}>
            <p className="text-xs text-muted-foreground">Schedule Health</p>
            {data.verifyQualityScore !== null ? (
              <>
                <p className={`text-2xl font-bold mt-1 ${data.verifyQualityScore >= 80 ? 'text-emerald-600 dark:text-emerald-400' : data.verifyQualityScore >= 60 ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'}`}>
                  {data.verifyQualityScore}/100
                </p>
                {data.verifySummary && (
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{data.verifySummary}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground mt-1 italic">Not verified yet</p>
            )}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      {!isLoading && data.recentActivity.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-card-foreground mb-3">Recent Activity</h2>
          <div className="space-y-2">
            {data.recentActivity.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <div className="mt-0.5 h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0 mt-2" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground">
                    {a.action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                    {(a.details as any)?.school_name ? ` — ${(a.details as any).school_name}` : ''}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{new Date(a.created_at).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {isNewSchool ? null : isLoading ? (
        <div className="rounded-xl border border-border bg-card p-6 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-card-foreground">Setup Progress</h2>
            <span className="text-xs text-muted-foreground">{progressPct}% complete</span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary">
            <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          {!data.setupComplete && (
            <div className="mt-4">
              <Link to="/app/setup" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
                <Wand2 className="h-4 w-4" />
                {data.setupStep > 0 ? 'Continue Setup' : 'Start Setup Wizard'}
              </Link>
            </div>
          )}
        </div>
      )}

      {!isNewSchool && (
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="font-semibold text-foreground">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <QuickAction label="Setup Wizard" desc="Configure your school" icon={Wand2} to="/app/setup" color="bg-primary/10 text-primary" />
            <QuickAction label="Master Schedule" desc="View & edit schedules" icon={CalendarDays} to="/app/schedule" color="bg-accent/10 text-accent" />
            <QuickAction label="Export Center" desc="Download schedules" icon={Download} to="/app/exports" color="bg-purple/10 text-purple" />
            <QuickAction label="Billing" desc="Manage plan & license" icon={CreditCard} to="/app/billing" color="bg-success/10 text-success" />
            {isAdmin && (
              <QuickAction label="Admin Panel" desc="Manage platform" icon={ShieldCheck} to="/admin" color="bg-destructive/10 text-destructive" />
            )}
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="font-semibold text-foreground">Status</h2>
          <div className="space-y-2">
            {isLoading ? (
              <>
                <StatusCardSkeleton />
                <StatusCardSkeleton />
                <StatusCardSkeleton />
                <StatusCardSkeleton />
              </>
            ) : (
              <>
                <StatusCard label="Calendar Uploaded" status={data.hasCalendar ? 'Done' : 'Pending'} ok={data.hasCalendar} />
                <StatusCard label="Setup Complete" status={data.setupComplete ? 'Complete' : data.setupStep > 0 ? 'In progress' : 'Not started'} ok={data.setupComplete} />
                <StatusCard label="Billing" status={data.billingActive ? 'Free Plan' : 'Inactive'} ok={data.billingActive} />
                <StatusCard label="Schedule Generated" status={data.hasSchedule ? 'Done' : 'Pending'} ok={data.hasSchedule} />
              </>
            )}
          </div>
        </div>
      </div>
      )}

      {!isLoading && !isNewSchool && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h2 className="font-semibold text-foreground flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-destructive" />
                Start Fresh
              </h2>
              <p className="mt-1 text-sm text-muted-foreground max-w-xl">
                This cannot be undone! Only select this if you want a completely fresh, blank slate to start over. Don't worry — your account and team stay safe!
              </p>
              <p className="mt-2 text-sm italic text-muted-foreground max-w-xl">
                It's like wiping your whiteboard completely clean at the end of the school year.
              </p>
            </div>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={wiping || data.schoolCount === 0}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  {wiping ? 'Erasing…' : 'Erase & Start Over'}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Ready to start fresh?</AlertDialogTitle>
                  <AlertDialogDescription>
                    We'll erase {data.schoolCount} school{data.schoolCount === 1 ? '' : 's'} and everything inside — teachers, specialists, schedules, exports, clubs, events, calendar uploads. Your account and team stay put. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleWipe}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Yes, erase everything
                  </AlertDialogAction>

                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardPage;
