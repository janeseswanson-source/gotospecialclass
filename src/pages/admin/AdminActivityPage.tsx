import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import DataTable from '@/components/admin/DataTable';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const AdminActivityPage = () => {
  const [actionFilter, setActionFilter] = useState('all');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-activity-log', actionFilter],
    queryFn: async () => {
      let q = supabase.from('activity_log').select('*').order('created_at', { ascending: false }).limit(100);
      if (actionFilter !== 'all') q = q.eq('action', actionFilter);
      const { data } = await q;
      return data || [];
    },
  });

  // Get unique actions for filter
  const { data: allActions } = useQuery({
    queryKey: ['admin-activity-actions'],
    queryFn: async () => {
      const { data } = await supabase.from('activity_log').select('action');
      const unique = [...new Set(data?.map(d => d.action) || [])];
      return unique;
    },
  });

  const columns = [
    { key: 'action', header: 'Action' },
    { key: 'user_id', header: 'User', render: (r: any) => r.user_id ? <span className="font-mono text-xs">{r.user_id.slice(0, 8)}...</span> : '—' },
    { key: 'details', header: 'Details', render: (r: any) => r.details ? <span className="text-xs">{JSON.stringify(r.details).slice(0, 60)}</span> : '—' },
    { key: 'created_at', header: 'Time', render: (r: any) => new Date(r.created_at).toLocaleString() },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Support / Activity</h1>
        <p className="text-sm text-muted-foreground">Recent user actions and support log.</p>
      </div>
      <div className="flex gap-3">
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Filter by action" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {allActions?.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {isLoading ? <p className="text-muted-foreground">Loading...</p> : <DataTable data={data || []} columns={columns} searchKey="action" searchPlaceholder="Search actions..." />}
    </div>
  );
};

export default AdminActivityPage;
