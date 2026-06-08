import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Plus, GripVertical } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

const STAGES = ['lead', 'prospect', 'trial', 'customer', 'churned'] as const;
const STAGE_COLORS: Record<string, string> = { lead: 'bg-blue-100 text-blue-800', prospect: 'bg-yellow-100 text-yellow-800', trial: 'bg-purple-100 text-purple-800', customer: 'bg-green-100 text-green-800', churned: 'bg-red-100 text-red-800' };

const AdminCRMPage = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ contact_name: '', company_name: '', email: '', phone: '', stage: 'lead' as string, source: '', notes: '' });

  const { data: entries } = useQuery({
    queryKey: ['admin-crm'],
    queryFn: async () => { const { data } = await supabase.from('crm_entries').select('*').order('updated_at', { ascending: false }); return data || []; },
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('crm_entries').insert({ ...form, stage: form.stage as any });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Contact added'); setOpen(false); setForm({ contact_name: '', company_name: '', email: '', phone: '', stage: 'lead', source: '', notes: '' }); queryClient.invalidateQueries({ queryKey: ['admin-crm'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStageMutation = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: string }) => {
      const { error } = await supabase.from('crm_entries').update({ stage: stage as any }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-crm'] }),
  });

  const grouped = STAGES.reduce((acc, stage) => {
    acc[stage] = entries?.filter(e => e.stage === stage) || [];
    return acc;
  }, {} as Record<string, Tables<'crm_entries'>[]>);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">CRM</h1>
          <p className="text-sm text-muted-foreground">Leads, prospects, and client management.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" /> Add Contact</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Contact name" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
              <Input placeholder="Company" value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} />
              <Input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              <Input placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
              <Select value={form.stage} onValueChange={v => setForm(f => ({ ...f, stage: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="Source" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))} />
              <Textarea placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              <Button onClick={() => addMutation.mutate()} disabled={!form.contact_name} className="w-full">Add</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid grid-cols-5 gap-4 overflow-x-auto">
        {STAGES.map(stage => (
          <div key={stage} className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold capitalize">{stage}</h3>
              <Badge variant="outline" className="text-xs">{grouped[stage]?.length || 0}</Badge>
            </div>
            <div className="space-y-2 min-h-[200px] rounded-lg border border-dashed border-border p-2">
              {grouped[stage]?.map(entry => (
                <Card key={entry.id} className="cursor-pointer">
                  <CardContent className="p-3 space-y-1">
                    <p className="text-sm font-medium">{entry.contact_name || 'Unnamed'}</p>
                    {entry.company_name && <p className="text-xs text-muted-foreground">{entry.company_name}</p>}
                    {entry.email && <p className="text-xs text-muted-foreground">{entry.email}</p>}
                    <Select value={entry.stage || 'lead'} onValueChange={v => updateStageMutation.mutate({ id: entry.id, stage: v })}>
                      <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{STAGES.map(s => <SelectItem key={s} value={s} className="capitalize text-xs">{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AdminCRMPage;
