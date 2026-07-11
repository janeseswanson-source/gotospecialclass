import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useSchool } from '@/contexts/SchoolContext';
import { supabase } from '@/integrations/supabase/client';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Search, Send, HelpCircle, MessageSquare, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

const FAQ_ITEMS = [
  { q: 'How do I start setting up my school?', a: 'Navigate to the Setup Wizard from the sidebar. The happy path is 7 steps: welcome, school info, recess/lunch, specialists, teachers, conflict strategies, and a final review. Optional extras (calendar, contractual minutes, admin rotation, clubs, events) live in a collapsible "Extras" group and can be added any time — before or after generating.' },
  { q: 'What are conflict strategies?', a: 'Conflict strategies handle situations when there are more grades than specialist time slots. Options include A/B Week rotation, Quick 30-minute classes, Big Group splits, Lunch Clubs, and Make-Up sessions. The system can auto-recommend the best combination.' },
  { q: 'How do I generate a schedule?', a: 'Go to Prep & Generate. Review the readiness checklist, configure your conflict strategies, then click "Generate Schedule." The system will create an optimized master schedule based on your configuration.' },
  { q: 'Can I edit the generated schedule?', a: 'Yes! On the Master Schedule page, click any block to edit its time, specialist, teacher, or room assignment. Changes are saved as overrides.' },
  { q: 'How do I export my schedule?', a: 'Visit the Exports page to download your schedule as PDF, CSV, Excel, or Word document. You can export the full master schedule, individual specialist views, or teacher prep schedules.' },
  { q: 'How do I invite team members?', a: 'Go to Settings → Team Members. Enter their email and choose a role (admin, teacher, or viewer). They\'ll receive an invite link to join your workspace.' },
  { q: 'What happens if I re-generate the schedule?', a: 'Each generation creates a new version. Previous versions are preserved and you can view generation history on the Prep page.' },
  { q: 'Can I manage multiple schools?', a: 'Yes, your workspace supports multiple schools. Each school has its own setup, specialists, teachers, and schedules.' },
  { q: 'How do I upload a school calendar?', a: 'In the Setup Wizard\'s Calendar step, upload a PDF or image of your school calendar. AI will automatically parse holidays, early releases, and other events.' },
  { q: 'What roles are available for team members?', a: 'Roles include Owner (full control), Admin (manage settings and members), Specialist Teacher, Classroom Teacher, Office Staff, and Viewer (read-only access).' },
];

export default function HelpPage() {
  const { user } = useAuth();
  const { workspaceId } = useSchool();
  const [search, setSearch] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const filtered = search
    ? FAQ_ITEMS.filter(item =>
        item.q.toLowerCase().includes(search.toLowerCase()) ||
        item.a.toLowerCase().includes(search.toLowerCase())
      )
    : FAQ_ITEMS;

  async function handleSubmitTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setSubmitting(true);
    const { error } = await supabase.from('support_tickets').insert({
      user_id: user?.id,
      workspace_id: workspaceId || null,
      subject: subject.trim(),
      message: message.trim(),
    });
    setSubmitting(false);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Ticket submitted', description: 'We\'ll get back to you soon.' });
      setSubject('');
      setMessage('');
    }
  }

  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <HelpCircle className="h-6 w-6" /> Help Center
        </h1>
        <p className="text-sm text-muted-foreground">Find answers or contact support.</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search FAQ..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* FAQ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frequently Asked Questions</CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No results found. Try a different search or contact support below.</p>
          ) : (
            <Accordion type="single" collapsible className="w-full">
              {filtered.map((item, i) => (
                <AccordionItem key={i} value={`faq-${i}`}>
                  <AccordionTrigger className="text-sm text-left">{item.q}</AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground">{item.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </CardContent>
      </Card>

      {/* Contact Support */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <MessageSquare className="h-4 w-4" /> Contact Support
          </CardTitle>
          <CardDescription>Can't find what you need? Send us a message.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmitTicket} className="space-y-4">
            <div>
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief description of your issue" className="mt-1" required />
            </div>
            <div>
              <Label>Message</Label>
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Describe your issue in detail..." className="mt-1" rows={4} required />
            </div>
            <Button type="submit" disabled={submitting} className="gap-2">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit Ticket
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
