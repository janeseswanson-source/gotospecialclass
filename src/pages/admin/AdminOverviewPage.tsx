import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import StatsCard from '@/components/admin/StatsCard';
import { Users, Building2, GraduationCap, Key, DollarSign, Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';

const AdminOverviewPage = () => {
  const { data: profiles } = useQuery({ queryKey: ['admin-profiles-count'], queryFn: async () => { const { count } = await supabase.from('profiles').select('*', { count: 'exact', head: true }); return count || 0; } });
  const { data: workspaces } = useQuery({ queryKey: ['admin-workspaces-count'], queryFn: async () => { const { count } = await supabase.from('workspaces').select('*', { count: 'exact', head: true }); return count || 0; } });
  const { data: schools } = useQuery({ queryKey: ['admin-schools-count'], queryFn: async () => { const { count } = await supabase.from('schools').select('*', { count: 'exact', head: true }); return count || 0; } });
  const { data: activeLicenses } = useQuery({ queryKey: ['admin-licenses-active'], queryFn: async () => { const { count } = await supabase.from('license_keys').select('*', { count: 'exact', head: true }).eq('status', 'redeemed'); return count || 0; } });
  const { data: activeSubs } = useQuery({ queryKey: ['admin-subs-active'], queryFn: async () => { const { count } = await supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active'); return count || 0; } });
  const { data: recentActivity } = useQuery({ queryKey: ['admin-recent-activity'], queryFn: async () => { const { data } = await supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(10); return data || []; } });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Overview</h1>
        <p className="text-sm text-muted-foreground">Platform KPIs and operational snapshot.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <StatsCard title="Total Users" value={profiles ?? 0} icon={Users} />
        <StatsCard title="Workspaces" value={workspaces ?? 0} icon={Building2} />
        <StatsCard title="Schools" value={schools ?? 0} icon={GraduationCap} />
        <StatsCard title="Redeemed Licenses" value={activeLicenses ?? 0} icon={Key} />
        <StatsCard title="Active Subs" value={activeSubs ?? 0} icon={DollarSign} />
      </div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Recent Activity</CardTitle></CardHeader>
        <CardContent>
          {recentActivity?.length ? (
            <div className="space-y-2">
              {recentActivity.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                  <span className="font-medium">{a.action}</span>
                  <span className="text-muted-foreground">{format(new Date(a.created_at), 'MMM d, h:mm a')}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">No recent activity.</p>}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminOverviewPage;
