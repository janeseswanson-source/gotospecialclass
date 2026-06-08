import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import DataTable from '@/components/admin/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Plus, Copy, Download, Layers } from 'lucide-react';

const AdminLicensesPage = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [plan, setPlan] = useState('pro');
  const [maxSchools, setMaxSchools] = useState('5');
  const [durationDays, setDurationDays] = useState('365');
  const [bulkCount, setBulkCount] = useState('10');
  const [bulkPlan, setBulkPlan] = useState('pro');
  const [bulkMaxSchools, setBulkMaxSchools] = useState('5');
  const [bulkDurationDays, setBulkDurationDays] = useState('365');

  const { data: licenses, isLoading } = useQuery({
    queryKey: ['admin-all-licenses'],
    queryFn: async () => { const { data } = await supabase.from('license_keys').select('*').order('created_at', { ascending: false }); return data || []; },
  });

  const generateKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `${seg()}-${seg()}-${seg()}-${seg()}`;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('license_keys').insert({ key: generateKey(), plan, max_schools: parseInt(maxSchools), duration_days: parseInt(durationDays) });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('License key generated'); setOpen(false); queryClient.invalidateQueries({ queryKey: ['admin-all-licenses'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const count = Math.min(Math.max(parseInt(bulkCount) || 1, 1), 100);
      const keys = Array.from({ length: count }, () => ({
        key: generateKey(),
        plan: bulkPlan,
        max_schools: parseInt(bulkMaxSchools),
        duration_days: parseInt(bulkDurationDays),
      }));
      const { error } = await supabase.from('license_keys').insert(keys);
      if (error) throw error;
      return count;
    },
    onSuccess: (count) => { toast.success(`${count} license keys generated`); setBulkOpen(false); queryClient.invalidateQueries({ queryKey: ['admin-all-licenses'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const copyKey = (key: string) => { navigator.clipboard.writeText(key); toast.success('Copied to clipboard'); };

  const exportCSV = () => {
    if (!licenses?.length) return;
    const headers = ['Key', 'Plan', 'Status', 'Max Schools', 'Duration Days', 'Created'];
    const rows = licenses.map((l: any) => [
      l.key, l.plan, l.status, l.max_schools, l.duration_days,
      new Date(l.created_at).toLocaleDateString(),
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'license-keys.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const columns = [
    { key: 'key', header: 'Key', render: (r: any) => (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs">{r.key}</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => copyKey(r.key)}><Copy className="h-3 w-3" /></Button>
      </div>
    )},
    { key: 'plan', header: 'Plan', render: (r: any) => <span className="capitalize">{r.plan}</span> },
    { key: 'status', header: 'Status', render: (r: any) => <Badge variant={r.status === 'active' ? 'default' : r.status === 'redeemed' ? 'secondary' : 'destructive'} className="capitalize">{r.status}</Badge> },
    { key: 'max_schools', header: 'Schools' },
    { key: 'created_at', header: 'Created', render: (r: any) => new Date(r.created_at).toLocaleDateString() },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">License Management</h1>
          <p className="text-sm text-muted-foreground">Generate, inspect, and manage license keys.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={exportCSV} disabled={!licenses?.length}>
            <Download className="mr-2 h-4 w-4" /> Export CSV
          </Button>

          <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <DialogTrigger asChild><Button variant="outline"><Layers className="mr-2 h-4 w-4" /> Bulk Generate</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Bulk Generate License Keys</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-foreground">Number of keys</label>
                  <Input type="number" min="1" max="100" value={bulkCount} onChange={e => setBulkCount(e.target.value)} />
                </div>
                <Select value={bulkPlan} onValueChange={setBulkPlan}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pro">Pro</SelectItem><SelectItem value="enterprise">Enterprise</SelectItem></SelectContent></Select>
                <Input type="number" placeholder="Max schools" value={bulkMaxSchools} onChange={e => setBulkMaxSchools(e.target.value)} />
                <Input type="number" placeholder="Duration (days)" value={bulkDurationDays} onChange={e => setBulkDurationDays(e.target.value)} />
                <Button onClick={() => bulkMutation.mutate()} className="w-full" disabled={bulkMutation.isPending}>
                  {bulkMutation.isPending ? 'Generating...' : `Generate ${bulkCount} Keys`}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Generate Key</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Generate License Key</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <Select value={plan} onValueChange={setPlan}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pro">Pro</SelectItem><SelectItem value="enterprise">Enterprise</SelectItem></SelectContent></Select>
                <Input type="number" placeholder="Max schools" value={maxSchools} onChange={e => setMaxSchools(e.target.value)} />
                <Input type="number" placeholder="Duration (days)" value={durationDays} onChange={e => setDurationDays(e.target.value)} />
                <Button onClick={() => createMutation.mutate()} className="w-full">Generate</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>
      {isLoading ? <p className="text-muted-foreground">Loading...</p> : <DataTable data={licenses || []} columns={columns} searchKey="key" searchPlaceholder="Search by key..." />}
    </div>
  );
};

export default AdminLicensesPage;
