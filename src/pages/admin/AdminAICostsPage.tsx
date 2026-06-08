import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import StatsCard from '@/components/admin/StatsCard';
import DataTable from '@/components/admin/DataTable';
import { Cpu, DollarSign, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const AdminAICostsPage = () => {
  const { data: logs, isLoading } = useQuery({
    queryKey: ['admin-ai-usage'],
    queryFn: async () => { const { data } = await supabase.from('ai_usage_log').select('*').order('created_at', { ascending: false }); return data || []; },
  });

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
