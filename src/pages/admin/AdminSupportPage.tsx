import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, MessageSquare } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { format } from 'date-fns';

interface Ticket {
  id: string;
  user_id: string | null;
  subject: string;
  message: string;
  status: string;
  admin_reply: string | null;
  created_at: string;
}

export default function AdminSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);

  useEffect(() => { loadTickets(); }, []);

  async function loadTickets() {
    setLoading(true);
    const { data } = await supabase
      .from('support_tickets')
      .select('*')
      .order('created_at', { ascending: false });
    if (data) setTickets(data as Ticket[]);
    setLoading(false);
  }

  async function handleReply() {
    if (!selectedTicket || !reply.trim()) return;
    setReplying(true);
    const { error } = await supabase
      .from('support_tickets')
      .update({ admin_reply: reply.trim(), status: 'resolved' })
      .eq('id', selectedTicket.id);
    setReplying(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Reply sent' });
      setSelectedTicket(null);
      setReply('');
      loadTickets();
    }
  }

  const statusColor = (s: string) => s === 'open' ? 'destructive' : s === 'resolved' ? 'default' : 'secondary';

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <MessageSquare className="h-6 w-6" /> Support Tickets
        </h1>
        <p className="text-sm text-muted-foreground">Manage user support requests.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : tickets.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No tickets yet</CardContent></Card>
      ) : (
        <div className="space-y-3">
          {tickets.map(ticket => (
            <Card key={ticket.id} className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => { setSelectedTicket(ticket); setReply(ticket.admin_reply || ''); }}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{ticket.subject}</p>
                  <p className="text-xs text-muted-foreground truncate">{ticket.message}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">{format(new Date(ticket.created_at), 'MMM d, yyyy h:mm a')}</p>
                </div>
                <Badge variant={statusColor(ticket.status)}>{ticket.status}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!selectedTicket} onOpenChange={(o) => !o && setSelectedTicket(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedTicket?.subject}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4">
              <p className="text-sm">{selectedTicket?.message}</p>
            </div>
            <div>
              <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write your reply..." rows={4} />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleReply} disabled={replying} className="gap-2">
              {replying ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send Reply & Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
