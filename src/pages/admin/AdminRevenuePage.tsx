import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import StatsCard from '@/components/admin/StatsCard';
import { DollarSign, Key, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const AdminRevenuePage = () => {
  const { data: subs } = useQuery({ queryKey: ['admin-all-subs'], queryFn: async () => { const { data } = await supabase.from('subscriptions').select('*'); return data || []; } });
  const { data: licenses } = useQuery({ queryKey: ['admin-all-licenses'], queryFn: async () => { const { data } = await supabase.from('license_keys').select('*'); return data || []; } });

  const activeSubs = subs?.filter(s => s.status === 'active').length || 0;
  const planCounts = subs?.reduce((acc, s) => { acc[s.plan || 'free'] = (acc[s.plan || 'free'] || 0) + 1; return acc; }, {} as Record<string, number>) || {};
  const redeemedKeys = licenses?.filter(l => l.status === 'redeemed').length || 0;

  const chartData = Object.entries(planCounts).map(([plan, count]) => ({ plan, count }));

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Revenue</h1>
        <p className="text-sm text-muted-foreground">MRR, subscriptions, and revenue analytics.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <StatsCard title="Active Subscriptions" value={activeSubs} icon={DollarSign} />
        <StatsCard title="Redeemed Licenses" value={redeemedKeys} icon={Key} />
        <StatsCard title="Total Licenses" value={licenses?.length || 0} icon={TrendingUp} />
      </div>
      <Card>
        <CardHeader><CardTitle>Subscriptions by Plan</CardTitle></CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="plan" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-muted-foreground py-8 text-center">No subscription data yet.</p>}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminRevenuePage;
