import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import StatsCard from '@/components/admin/StatsCard';
import DataTable from '@/components/admin/DataTable';
import { Cpu, DollarSign, Zap, Gauge, ServerCog, Timer } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

/** Median of a numeric list (0 for empty). */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const AdminAICostsPage = () => {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['admin-ai-usage'],
    queryFn: async () => { const { data } = await supabase.from('ai_usage_log').select('*').order('created_at', { ascending: false }); return data || []; },
  });

  // Solver engine mix: CP-SAT (primary) vs the metaheuristic fallback, from completed jobs.
  const { data: jobs } = useQuery({
    queryKey: ['admin-generation-jobs'],
    queryFn: async () => {
      const { data } = await supabase.from('generation_jobs')
        .select('status, fallback_used, started_at, finished_at')
        .eq('status', 'complete').order('finished_at', { ascending: false }).limit(1000);
      return data || [];
    },
  });
  const cpsatRuns = (jobs ?? []).filter((j: any) => !j.fallback_used).length;
  const fallbackRuns = (jobs ?? []).filter((j: any) => j.fallback_used).length;
  const totalRuns = cpsatRuns + fallbackRuns;
  const fallbackRate = totalRuns > 0 ? (fallbackRuns / totalRuns) * 100 : 0;
  const solveSeconds = (jobs ?? [])
    .filter((j: any) => j.started_at && j.finished_at)
    .map((j: any) => (new Date(j.finished_at).getTime() - new Date(j.started_at).getTime()) / 1000)
    .filter((s: number) => Number.isFinite(s) && s >= 0);
  const medianSolve = median(solveSeconds);
  const engineChart = [
    { engine: 'CP-SAT', runs: cpsatRuns },
    { engine: 'Fallback', runs: fallbackRuns },
  ];

  const totalTokens = logs?.reduce((s, l) => s + (l.tokens_used || 0), 0) || 0;
  const totalCost = logs?.reduce((s, l) => s + Number(l.cost_estimate || 0), 0) || 0;

  const byFeature = logs?.reduce((acc, l) => {
    acc[l.feature] = (acc[l.feature] || 0) + (l.tokens_used || 0);
    return acc;
  }, {} as Record<string, number>) || {};
  const chartData = Object.entries(byFeature).map(([feature, tokens]) => ({ feature, tokens }));

  const columns = [
    { key: 'feature', header: 'Feature' },
    { key: 'tokens_used', header: 'Tokens', render: (r: any) => (r.tokens_used || 0).toLocaleString() },
    { key: 'cost_estimate', header: 'Cost', render: (r: any) => `$${Number(r.cost_estimate || 0).toFixed(4)}` },
    { key: 'created_at', header: 'Date', render: (r: any) => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">AI Costs</h1>
        <p className="text-sm text-muted-foreground">AI usage tracking and cost analysis.</p>
      </div>

      {/* Solver engine: CP-SAT (primary, provably-optimal) vs metaheuristic fallback */}
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <StatsCard title="Fallback rate" value={`${fallbackRate.toFixed(1)}%`} icon={Gauge} />
          <StatsCard title="Median solve time" value={medianSolve > 0 ? `${medianSolve.toFixed(1)}s` : '—'} icon={Timer} />
          <StatsCard title="Completed generations" value={totalRuns} icon={ServerCog} />
        </div>
        {totalRuns > 0 && (
          <Card>
            <CardHeader><CardTitle>Solver engine — CP-SAT vs fallback</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={engineChart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="engine" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="runs" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <p className="mt-2 text-xs text-muted-foreground">
                {cpsatRuns} CP-SAT · {fallbackRuns} fallback (solver unreachable). A rising fallback rate means the CP-SAT service needs attention.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatsCard title="Total Tokens" value={totalTokens.toLocaleString()} icon={Cpu} />
        <StatsCard title="Total Cost" value={`$${totalCost.toFixed(2)}`} icon={DollarSign} />
        <StatsCard title="Requests" value={logs?.length || 0} icon={Zap} />
      </div>
      {chartData.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Tokens by Feature</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="feature" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="tokens" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
      {isLoading ? <p className="text-muted-foreground">Loading...</p> : <DataTable data={logs || []} columns={columns} searchKey="feature" searchPlaceholder="Search by feature..." />}
    </div>
  );
};

export default AdminAICostsPage;
