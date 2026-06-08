import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import DataTable from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/badge';

const AdminBillingPage = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-all-subscriptions'],
    queryFn: async () => { const { data } = await supabase.from('subscriptions').select('*, workspaces(name)').order('created_at', { ascending: false }); return data || []; },
  });

  const columns = [
    { key: 'workspace', header: 'Workspace', render: (r: any) => (r.workspaces as any)?.name || '—' },
    { key: 'plan', header: 'Plan', render: (r: any) => <span className="capitalize">{r.plan}</span> },
    { key: 'status', header: 'Status', render: (r: any) => <Badge variant={r.status === 'active' ? 'default' : 'outline'} className="capitalize">{r.status}</Badge> },
    { key: 'current_period_end', header: 'Expires', render: (r: any) => r.current_period_end ? new Date(r.current_period_end).toLocaleDateString() : '—' },
    { key: 'created_at', header: 'Created', render: (r: any) => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Billing</h1>
        <p className="text-sm text-muted-foreground">Payment records and subscription overview.</p>
      </div>
      {isLoading ? <p className="text-muted-foreground">Loading...</p> : <DataTable data={data || []} columns={columns} />}
    </div>
  );
};

export default AdminBillingPage;
