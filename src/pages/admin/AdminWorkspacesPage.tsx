import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import DataTable from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/badge';

const AdminWorkspacesPage = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-all-workspaces'],
    queryFn: async () => {
      const { data } = await supabase.from('workspaces').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'is_active', header: 'Active', render: (r: any) => <Badge variant={r.is_active ? 'default' : 'outline'}>{r.is_active ? 'Yes' : 'No'}</Badge> },
    { key: 'access_source', header: 'Source', render: (r: any) => <span className="capitalize">{r.access_source || '—'}</span> },
    { key: 'created_at', header: 'Created', render: (r: any) => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Workspaces</h1>
        <p className="text-sm text-muted-foreground">All workspaces and their setup status.</p>
      </div>
      {isLoading ? <p className="text-muted-foreground">Loading...</p> : <DataTable data={data || []} columns={columns} searchKey="name" searchPlaceholder="Search workspaces..." />}
    </div>
  );
};

export default AdminWorkspacesPage;
