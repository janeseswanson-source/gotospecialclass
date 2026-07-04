import { useState, useEffect, useRef, useCallback } from 'react';
import { SaveStatusIndicator, type SaveStatus } from '@/components/setup/SaveStatusIndicator';
import { SETUP_STEPS } from '../stepIndex';
import { useFlushOnUnmount } from '@/hooks/useFlushOnUnmount';
import { useSetup } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Plus, Trash2, Loader2, Check, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import NlImportDialog from '@/components/setup/NlImportDialog';

interface SpecialEvent {
  id: string;
  name: string;
  type: string;
  date: string;
  startTime: string;
  endTime: string;
}

const eventSuggestions = ['Assembly', 'Concert', 'Art Show', 'Picture Day', 'Testing Window', 'Performance', 'Special Schedule Day'];

const StepEvents = () => {
  const { setStep, schoolId } = useSetup();
  const [events, setEvents] = useState<SpecialEvent[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [nlOpen, setNlOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const isLoaded = useRef(false);

  useEffect(() => {
    if (!schoolId) return;
    const load = async () => {
      const { data } = await supabase
        .from('special_events')
        .select('*')
        .eq('school_id', schoolId);
      if (data && data.length > 0) {
        setEvents(data.map(e => ({
          id: e.id,
          name: e.name,
          type: e.event_type || 'event',
          date: e.event_date || '',
          startTime: e.start_time || '',
          endTime: e.end_time || '',
        })));
      }
      isLoaded.current = true;
    };
    load();
  }, [schoolId]);

  const autoSave = useCallback(async (eventsToSave: SpecialEvent[]) => {
    if (!schoolId || !isLoaded.current) return;
    setSaveStatus('saving');
    try {
      const validEvents = eventsToSave.filter(e => e.name.trim());
      const currentIds = validEvents.map(e => e.id);

      // Delete events no longer in the list
      const { data: existing } = await supabase
        .from('special_events')
        .select('id')
        .eq('school_id', schoolId);
      const existingIds = (existing || []).map(r => r.id);
      const toDelete = existingIds.filter(id => !currentIds.includes(id));
      if (toDelete.length > 0) {
        await supabase.from('special_events').delete().in('id', toDelete);
      }

      // Upsert remaining events with their client IDs
      if (validEvents.length > 0) {
        const rows = validEvents.map(e => ({
          id: e.id,
          school_id: schoolId,
          name: e.name,
          event_type: e.type || 'event',
          event_date: e.date || null,
          start_time: e.startTime || null,
          end_time: e.endTime || null,
        }));
        const { error } = await supabase.from('special_events').upsert(rows, { onConflict: 'id' });
        if (error) console.error('Save events error:', error);
      }
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch {
      setSaveStatus('idle');
    }
  }, [schoolId]);

  const latestRef = useRef(events);
  latestRef.current = events;
  useFlushOnUnmount(saveTimer, () => { if (isLoaded.current) autoSave(latestRef.current); });

  useEffect(() => {
    if (!isLoaded.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => autoSave(events), 1000);
  }, [events, autoSave]);

  const add = (name = '') => setEvents(prev => [...prev, { id: crypto.randomUUID(), name, type: 'event', date: '', startTime: '', endTime: '' }]);
  const remove = (id: string) => setEvents(prev => prev.filter(e => e.id !== id));
  const update = (id: string, field: string, value: string) => setEvents(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-card-foreground">Special Events (Optional)</h2>
          <p className="text-sm text-muted-foreground">Add school-wide events (assemblies, field days) that block scheduling on specific dates</p>
        </div>
        <SaveStatusIndicator status={saveStatus} />
      </div>

      <div className="flex flex-wrap gap-2">
        {eventSuggestions.map(name => (
          <button key={name} onClick={() => add(name)}
            disabled={events.some(e => e.name === name)}
            className="rounded-full border border-border bg-secondary/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent/10 hover:text-accent transition-colors disabled:opacity-40">
            + {name}
          </button>
        ))}
      </div>

      {events.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-border bg-muted/20 p-6 text-center">
          <p className="text-sm text-muted-foreground">No events yet — this step is optional.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Add one-off assemblies or field days, or describe them in plain English. You can skip this and continue.</p>
        </div>
      )}

      {events.map(e => (
        <div key={e.id} className="flex items-end gap-3 rounded-lg border border-border bg-background p-3">
          <div className="flex-[2] space-y-1">
            <FieldLabel className="text-xs" tooltip="Name of the special event (e.g. Art Show)">Event Name</FieldLabel>
            <Input className="h-8 text-xs" value={e.name} onChange={(ev) => update(e.id, 'name', ev.target.value)} />
          </div>
          <div className="flex-1 space-y-1">
            <FieldLabel className="text-xs" tooltip="Date of the event">Date</FieldLabel>
            <Input className="h-8 text-xs" type="date" value={e.date} onChange={(ev) => update(e.id, 'date', ev.target.value)} />
          </div>
          <div className="flex-1 space-y-1">
            <FieldLabel className="text-xs" tooltip="Time window when scheduling is blocked">Start Time</FieldLabel>
            <Input className="h-8 text-xs" type="time" value={e.startTime} onChange={(ev) => update(e.id, 'startTime', ev.target.value)} />
          </div>
          <div className="flex-1 space-y-1">
            <FieldLabel className="text-xs" tooltip="End of the blocked time window">End Time</FieldLabel>
            <Input className="h-8 text-xs" type="time" value={e.endTime} onChange={(ev) => update(e.id, 'endTime', ev.target.value)} />
          </div>
          <Button size="sm" variant="ghost" onClick={() => remove(e.id)}>
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => add('')}><Plus className="h-3 w-3 mr-1" /> Add Event</Button>
        <Button size="sm" variant="outline" onClick={() => setNlOpen(true)}>
          <Sparkles className="h-3 w-3 mr-1" /> Describe in plain English
        </Button>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => setStep(SETUP_STEPS.CLUBS)}>Back</Button>
        <Button onClick={() => setStep(SETUP_STEPS.CONFLICTS)}>Continue</Button>
      </div>

      <NlImportDialog
        open={nlOpen}
        onOpenChange={setNlOpen}
        kind="events"
        onImport={async (rows) => {
          const newEvents: SpecialEvent[] = rows.map((r: any) => ({
            id: crypto.randomUUID(),
            name: String(r.name || '').trim(),
            type: 'event',
            date: r.date || '',
            startTime: r.start_time || '',
            endTime: r.end_time || '',
          })).filter(e => e.name);
          setEvents(prev => [...prev, ...newEvents]);
          return { ok: newEvents.length, skipped: rows.length - newEvents.length };
        }}
      />
    </div>
  );
};

export default StepEvents;
