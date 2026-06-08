import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import DataTable from '@/components/admin/DataTable';
import { Badge } from '@/components/ui/badge';

const AdminSchoolsPage = () => {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-all-schools'],
    queryFn: async () => {
      const { data } = await supabase.from('schools').select('*').order('created_at', { ascending: false });
      return data || [];
    },
  });

  const columns = [
    { key: 'name', header: 'Name' },
    { key: 'grades_served', header: 'Grades', render: (r: any) => (r.grades_served?.length || 0) + ' grades' },
    { key: 'setup_complete', header: 'Setup', render: (r: any) => <Badge variant={r.setup_complete ? 'default' : 'outline'}>{r.setup_complete ? 'Complete' : `Step ${r.setup_step || 0}`}</Badge> },
    { key: 'school_year', header: 'Year' },
    { key: 'created_at', header: 'Created', render: (r: any) => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Schools</h1>
        <p className="text-sm text-muted-foreground">Schools onboarded across the platform.</p>
      </div>
      {isLoading ? <p className="text-muted-foreground">Loading...</p> : <DataTable data={data || []} columns={columns} searchKey="name" searchPlaceholder="Search schools..." />}
    </div>
  );
};

export default AdminSchoolsPage;
