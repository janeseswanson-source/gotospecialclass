// Admin status card — pings the /health edge function and shows each external
// dependency's state (solver + version, Anthropic key, database, realtime, Sentry).
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, AlertTriangle, RefreshCw, Loader2, MinusCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface Health {
  status: 'ok' | 'degraded';
  checked_at: string;
  solver: { configured: boolean; ok: boolean; version?: string; status?: number; detail?: string; error?: string };
  anthropic: { configured: boolean };
  database: { ok: boolean; error?: string };
  realtime: { ok: boolean | null; detail?: string };
  sentry: { configured: boolean };
}

type Tone = 'ok' | 'bad' | 'warn' | 'na';

function StatusRow({ label, tone, detail }: { label: string; tone: Tone; detail?: string }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'bad' ? XCircle : tone === 'warn' ? AlertTriangle : MinusCircle;
  const color = tone === 'ok' ? 'text-emerald-500' : tone === 'bad' ? 'text-destructive' : tone === 'warn' ? 'text-amber-500' : 'text-muted-foreground';
  return (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-border/60 last:border-0">
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className={cn('flex items-center gap-1.5 text-xs font-medium', color)}>
        {detail && <span className="text-muted-foreground">{detail}</span>}
        <Icon className="h-4 w-4" aria-hidden />
        <span className="sr-only">{tone === 'ok' ? 'healthy' : tone === 'bad' ? 'error' : tone === 'warn' ? 'warning' : 'not applicable'}</span>
      </span>
    </div>
  );
}

export default function SystemStatusCard() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('health');
      if (fnErr) throw fnErr;
      setHealth(data as Health);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to reach /health');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            System status
            {health && (
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold uppercase',
                health.status === 'ok' ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400')}>
                {health.status}
              </span>
            )}
          </CardTitle>
          <CardDescription>
            External dependencies {health && <>· checked {new Date(health.checked_at).toLocaleTimeString()}</>}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-1.5">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" /> {error}
          </div>
        ) : loading && !health ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking dependencies…</div>
        ) : health ? (
          <div>
            <StatusRow
              label="CP-SAT solver"
              tone={!health.solver.configured ? 'na' : health.solver.ok ? 'ok' : 'bad'}
              detail={!health.solver.configured ? 'JS fallback' : health.solver.version ? `v${health.solver.version}` : health.solver.ok ? 'reachable' : 'unreachable'}
            />
            <StatusRow label="Anthropic (Claude) key" tone={health.anthropic.configured ? 'ok' : 'bad'} detail={health.anthropic.configured ? 'present' : 'missing'} />
            <StatusRow label="Database" tone={health.database.ok ? 'ok' : 'bad'} detail={health.database.ok ? 'reachable' : health.database.error} />
            <StatusRow label="Realtime publication" tone={health.realtime.ok === true ? 'ok' : health.realtime.ok === false ? 'warn' : 'na'} detail={health.realtime.ok === null ? 'client-verified' : health.realtime.ok ? 'active' : 'missing table'} />
            <StatusRow label="Sentry error tracking" tone={health.sentry.configured ? 'ok' : 'na'} detail={health.sentry.configured ? 'enabled' : 'not configured'} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
