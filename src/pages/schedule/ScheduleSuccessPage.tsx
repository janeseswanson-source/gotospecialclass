import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { PartyPopper, CalendarDays, BookOpen, FileText } from 'lucide-react';
import { getRandomQuote } from '@/lib/quotes';

export default function ScheduleSuccessPage() {
  const navigate = useNavigate();
  const quote = getRandomQuote();

  return (
    <div className="flex flex-col items-center justify-center py-16 animate-fade-in space-y-8 max-w-lg mx-auto text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/10">
        <PartyPopper className="h-10 w-10 text-success" />
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-foreground">Schedule Built! 🎉</h1>
        <p className="text-muted-foreground">
          Your specialist schedule has been generated and is ready to view.
        </p>
      </div>

      {quote && (
        <div className="rounded-xl border border-border bg-card p-6 w-full">
          <p className="text-sm italic text-muted-foreground">"{quote.text}"</p>
          {quote.author && <p className="mt-2 text-xs font-medium text-primary">— {quote.author}</p>}
        </div>
      )}

      <div className="grid gap-3 w-full sm:grid-cols-3">
        <Button onClick={() => navigate('/app/schedule')} className="gap-2">
          <CalendarDays className="h-4 w-4" /> Master Schedule
        </Button>
        <Button variant="outline" onClick={() => navigate('/app/planner')} className="gap-2">
          <BookOpen className="h-4 w-4" /> Planner
        </Button>
        <Button variant="outline" onClick={() => navigate('/app/exports')} className="gap-2">
          <FileText className="h-4 w-4" /> Exports
        </Button>
      </div>
    </div>
  );
}
