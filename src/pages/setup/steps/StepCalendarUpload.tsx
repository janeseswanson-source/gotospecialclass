import { useState, useEffect, useMemo } from 'react';
import { SETUP_STEPS } from '../stepIndex';
import { useSetup, CalendarEvent } from '@/contexts/SetupContext';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Plus, Trash2, Sparkles, Check, Loader2, Link2, Search, ExternalLink } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { FieldLabel } from '@/components/ui/field-label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { useCalendarUpload } from '@/hooks/useCalendarUpload';
import { useCalendarSearch } from '@/hooks/useCalendarSearch';

const eventTypes = ['holiday', 'teacher_workday', 'no_school', 'early_release', 'closure', 'event', 'first_day', 'last_day'];

type ImportMode = 'auto' | 'file' | 'url';

function getDefaultSchoolYear(): string {
  const now = new Date();
  const y = now.getFullYear();
  // School year flips July 1
  return now.getMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

function getSchoolYearOptions(): string[] {
  const current = getDefaultSchoolYear();
  const [startStr] = current.split('-');
  const next = `${Number(startStr) + 1}-${Number(startStr) + 2}`;
  return [current, next];
}

function formatDate(d: string): string {
  if (!d) return '';
  try {
    return new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}

const StepCalendarUpload = () => {
  const {
    setStep, schoolId, data,
    calendarEvents: events, setCalendarEvents: setEvents,
    calendarUploadId: uploadId, setCalendarUploadId: setUploadId,
    calendarParsed: parsed, setCalendarParsed: setParsed,
    calendarFileName, setCalendarFileName,
  } = useSetup();

  const [file, setFile] = useState<File | null>(null);
  const [calendarUrl, setCalendarUrl] = useState('');
  const [importMode, setImportMode] = useState<ImportMode>('auto');
  const [saving, setSaving] = useState(false);
  const { uploading, parsing, uploadAndParse } = useCalendarUpload(schoolId);
  const { searching, search } = useCalendarSearch();

  // Auto-Search state
  const schoolYearOptions = useMemo(() => getSchoolYearOptions(), []);
  const [schoolYear, setSchoolYear] = useState<string>(schoolYearOptions[0]);
  const [searchWebsite, setSearchWebsite] = useState<string>('');
  const [searchResult, setSearchResult] = useState<{ url: string | null; message?: string } | null>(null);

  useEffect(() => {
    if (data?.website && !searchWebsite) setSearchWebsite(data.website);
  }, [data?.website]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved events on mount if context is empty
  useEffect(() => {
    if (schoolId && events.length === 0 && !parsed) {
      supabase
        .from('parsed_calendar_events')
        .select('*')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: true })
        .then(({ data }) => {
          if (data && data.length > 0) {
            const loaded: CalendarEvent[] = data.map(e => ({
              id: e.id,
              type: e.event_type,
              title: e.title,
              date: e.event_date || '',
              endDate: e.end_date || e.event_date || '',
              aiExtracted: true,
            }));
            setEvents(loaded);
            setParsed(true);
            setUploadId(data[0].upload_id);
          }
        });

      supabase
        .from('calendar_uploads')
        .select('file_name')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data && data.length > 0) {
            setCalendarFileName(data[0].file_name);
          }
        });
    }
  }, [schoolId]);

  // One-shot seed of district calendar URL from coordinator_prep when empty.
  useEffect(() => {
    if (calendarUrl || !schoolId) return;
    (async () => {
      try {
        const { data: school } = await supabase.from('schools').select('workspace_id').eq('id', schoolId).maybeSingle();
        if (!school?.workspace_id) return;
        const { data: prep } = await supabase
          .from('coordinator_prep')
          .select('district_calendar_url')
          .eq('workspace_id', school.workspace_id)
          .eq('school_id', schoolId)
          .maybeSingle();
        if (prep?.district_calendar_url && !calendarUrl) {
          setCalendarUrl(prep.district_calendar_url);
        }
      } catch (err) {
        console.warn('[PrepPrefill] calendar url seed failed', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f && f.type === 'application/pdf') {
      if (f.size > 20 * 1024 * 1024) {
        toast.error('File too large. Maximum size is 20MB.');
        return;
      }
      setFile(f);
      setCalendarFileName(f.name);
      setParsed(false);
      setEvents([]);
      setUploadId(null);
    } else if (f) {
      toast.error('Please select a PDF file');
    }
  };

  const handleUploadAndParse = async () => {
    const result = await uploadAndParse(
      importMode === 'file' ? { file } : { url: calendarUrl }
    );
    if (result) {
      setUploadId(result.uploadId);
      setEvents(result.events);
      setParsed(true);
    }
  };

  const handleStartSearch = async () => {
    if (!searchWebsite.trim()) return;
    setSearchResult(null);
    const res = await search(searchWebsite.trim(), schoolYear);
    setSearchResult(res);
  };

  const handleUseFoundUrl = async (url: string) => {
    setCalendarUrl(url);
    if (schoolId) {
      supabase
        .from('schools')
        .update({ discovered_calendar_url: url })
        .eq('id', schoolId)
        .then(({ error }) => {
          if (error) console.warn('[CalendarSearch] failed to persist discovered URL', error);
        });
    }
    const result = await uploadAndParse({ url });
    if (result) {
      setUploadId(result.uploadId);
      setEvents(result.events);
      setParsed(true);
    }
  };

  const addManualEvent = () => {
    setEvents([...events, { id: crypto.randomUUID(), type: 'holiday', title: '', date: '', endDate: '' }]);
  };

  const updateEvent = (id: string, field: string, value: string) => {
    setEvents(events.map(e => e.id === id ? { ...e, [field]: value } : e));
  };

  const removeEvent = (id: string) => {
    setEvents(events.filter(e => e.id !== id));
  };

  const handleApproveAndSave = async () => {
    if (!schoolId || events.length === 0) {
      toast.error('No events to save');
      return;
    }

    setSaving(true);
    try {
      await supabase
        .from('parsed_calendar_events')
        .delete()
        .eq('school_id', schoolId);

      const rows = events
        .filter(e => e.title && e.date)
        .map(e => ({
          school_id: schoolId,
          ...(uploadId ? { upload_id: uploadId } : {}),
          title: e.title,
          event_type: e.type as any,
          event_date: e.date,
          end_date: e.endDate || null,
          approved: true,
        }));

      const { error } = await supabase.from('parsed_calendar_events').insert(rows);
      if (error) {
        toast.error('Failed to save events');
      } else {
        toast.success(`${rows.length} events saved and approved`);
        setStep(SETUP_STEPS.RECESS_LUNCH);
      }
    } catch (err) {
      toast.error('Failed to save events');
    } finally {
      setSaving(false);
    }
  };

  // Sorted events for display
  const sortedEvents = useMemo(
    () => [...events].sort((a, b) => (a.date || '').localeCompare(b.date || '')),
    [events],
  );
  const datedEvents = sortedEvents.filter(e => e.date);
  const summary = datedEvents.length > 0
    ? `${datedEvents.length} events scheduled • First: ${formatDate(datedEvents[0].date)} • Last: ${formatDate(datedEvents[datedEvents.length - 1].date)}`
    : null;

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-6">
      <h2 className="text-lg font-bold text-card-foreground">Calendar Upload</h2>
      <p className="text-sm text-muted-foreground">Find your district calendar automatically, upload a PDF, or paste a link. AI will extract key dates.</p>

      <Tabs value={importMode} onValueChange={(v) => setImportMode(v as ImportMode)} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="auto" className="gap-2">
            <Sparkles className="h-4 w-4" /> Auto-Search
            <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1">Recommended</Badge>
          </TabsTrigger>
          <TabsTrigger value="file" className="gap-2">
            <Upload className="h-4 w-4" /> Upload PDF
          </TabsTrigger>
          <TabsTrigger value="url" className="gap-2">
            <Link2 className="h-4 w-4" /> Paste Link
          </TabsTrigger>
        </TabsList>

        {/* Auto-Search */}
        <TabsContent value="auto" className="space-y-4 mt-4">
          <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-1">
            <h3 className="text-sm font-semibold text-card-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> AI Calendar Parser
            </h3>
            <p className="text-xs text-muted-foreground">We'll search for your district's official calendar.</p>
          </div>

          {!data?.website && !searchWebsite ? (
            <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
              Add your school website on{' '}
              <button
                type="button"
                onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)}
                className="text-primary hover:underline font-medium"
              >
                Step 2 (School Info)
              </button>{' '}
              first, or enter one below.
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <FieldLabel tooltip="School year for which to find the calendar">School Year</FieldLabel>
              <Select value={schoolYear} onValueChange={setSchoolYear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {schoolYearOptions.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <FieldLabel tooltip="Your school or district website URL">School Website</FieldLabel>
              <Input
                value={searchWebsite}
                onChange={(e) => setSearchWebsite(e.target.value)}
                placeholder="https://www.yourschool.org"
              />
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              onClick={handleStartSearch}
              disabled={searching || !searchWebsite.trim()}
              className="gap-2"
            >
              {searching ? <><Loader2 className="h-4 w-4 animate-spin" /> Searching...</> : <><Search className="h-4 w-4" /> Start Search</>}
            </Button>
          </div>

          {searching && (
            <div className="flex flex-col items-center justify-center py-4 gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Searching for your district calendar...</p>
            </div>
          )}

          {searchResult && !searching && searchResult.url && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium text-card-foreground">
                <Check className="h-4 w-4 text-primary" /> Calendar found
              </div>
              <a
                href={searchResult.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary hover:underline break-all flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3 shrink-0" /> {searchResult.url}
              </a>
              <Button
                size="sm"
                onClick={() => handleUseFoundUrl(searchResult.url!)}
                disabled={uploading || parsing}
                className="gap-2"
              >
                {uploading || parsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Use this calendar
              </Button>
            </div>
          )}

          {searchResult && !searching && !searchResult.url && (
            <div className="rounded-lg border border-border bg-secondary/30 p-4 space-y-2">
              <p className="text-sm text-card-foreground">{searchResult.message ?? 'No calendar found, try another method.'}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setImportMode('file')}>Upload PDF instead</Button>
                <Button size="sm" variant="outline" onClick={() => setImportMode('url')}>Paste Link instead</Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Upload PDF */}
        <TabsContent value="file" className="space-y-4 mt-4">
          {!file && (
            <label className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-secondary/30 p-4 cursor-pointer hover:bg-secondary/50 transition-colors">
              <Upload className="h-5 w-5 text-muted-foreground mb-1.5" />
              <span className="text-sm font-medium text-card-foreground">Click to upload PDF calendar</span>
              <span className="text-xs text-muted-foreground mt-0.5">PDF files only, up to 20MB</span>
              <input type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
            </label>
          )}

          {file && !parsed && (
            <div className="flex items-center gap-3 rounded-lg border border-border bg-secondary/30 p-3">
              <FileText className="h-5 w-5 text-primary shrink-0" />
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium text-card-foreground truncate block">{file.name}</span>
                <span className="text-xs text-muted-foreground">{((file.size || 0) / 1024).toFixed(0)} KB</span>
              </div>
              <label className="text-xs text-primary hover:underline cursor-pointer shrink-0">
                Replace
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
              </label>
            </div>
          )}

          {parsed && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/20 p-2.5">
              <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate">Uploaded: {file?.name || calendarFileName || 'calendar.pdf'}</span>
              <label className="text-xs text-primary hover:underline cursor-pointer shrink-0 ml-auto">
                Replace
                <input type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
              </label>
            </div>
          )}
        </TabsContent>

        {/* Paste Link */}
        <TabsContent value="url" className="space-y-2 mt-4">
          <FieldLabel tooltip="Paste an .ics link or district calendar webpage URL">Calendar URL</FieldLabel>
          <Input
            value={calendarUrl}
            onChange={(e) => setCalendarUrl(e.target.value)}
            placeholder="https://www.district.edu/calendar.ics or calendar page URL"
          />
          <p className="text-xs text-muted-foreground">Paste an .ics link or a district calendar webpage URL</p>
        </TabsContent>
      </Tabs>

      {/* Parse button (file / url tabs) */}
      {((importMode === 'file' && file) || (importMode === 'url' && calendarUrl.trim())) && !parsed && (
        <div className="flex justify-center">
          <Button
            className="gap-2"
            disabled={uploading || parsing}
            onClick={handleUploadAndParse}
          >
            {uploading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
            ) : parsing ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> AI Parsing...</>
            ) : (
              <><Sparkles className="h-4 w-4" /> Parse with AI</>
            )}
          </Button>
        </div>
      )}

      {parsed && (
        <div className="flex items-center gap-2 rounded-lg bg-primary/10 border border-primary/20 p-3">
          <Check className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-foreground">AI extracted {events.filter(e => e.aiExtracted).length} events. Review and edit below, then approve.</span>
        </div>
      )}

      {parsing && (
        <div className="flex flex-col items-center justify-center py-8 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">AI is reading your calendar...</p>
          <p className="text-xs text-muted-foreground">This usually takes 10-30 seconds</p>
        </div>
      )}

      {/* Events list */}
      {!parsing && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-card-foreground">Current Calendar Entries</h3>
            <Button size="sm" variant="outline" onClick={addManualEvent}>
              <Plus className="h-3 w-3 mr-1" /> Add Event
            </Button>
          </div>
          {summary && (
            <p className="text-xs text-muted-foreground">{summary}</p>
          )}
          {events.length === 0 && (
            <p className="text-xs text-muted-foreground py-4 text-center">No calendar events yet. Use Auto-Search, upload a PDF, paste a URL, or add manually.</p>
          )}
          {sortedEvents.map((event) => (
            <div key={event.id} className="flex items-end gap-3 rounded-lg border border-border bg-background p-3">
              <div className="flex-1 space-y-1">
                <FieldLabel className="text-xs" tooltip="Category used by the scheduler to handle this day">
                  Type
                  {event.aiExtracted && <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1">AI</Badge>}
                </FieldLabel>
                <Select value={event.type} onValueChange={(v) => updateEvent(event.id, 'type', v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {eventTypes.map(t => <SelectItem key={t} value={t} className="text-xs">{t.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-[2] space-y-1">
                <FieldLabel className="text-xs" tooltip="Name of the calendar event (e.g. Spring Break)">Title</FieldLabel>
                <Input className="h-8 text-xs" value={event.title} onChange={(e) => updateEvent(event.id, 'title', e.target.value)} placeholder="Event name" />
              </div>
              <div className="flex-1 space-y-1">
                <FieldLabel className="text-xs" tooltip="Start date of the event">Start Date</FieldLabel>
                <Input className="h-8 text-xs" type="date" value={event.date} onChange={(e) => updateEvent(event.id, 'date', e.target.value)} />
              </div>
              <div className="flex-1 space-y-1">
                <FieldLabel className="text-xs" tooltip="End date — same as start for single-day events">End Date</FieldLabel>
                <Input className="h-8 text-xs" type="date" value={event.endDate} onChange={(e) => updateEvent(event.id, 'endDate', e.target.value)} />
              </div>
              <Button size="sm" variant="ghost" onClick={() => removeEvent(event.id)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="outline" onClick={() => setStep(SETUP_STEPS.SCHOOL_INFO)}>Back</Button>
        <div className="flex gap-2">
          {parsed && events.length > 0 && (
            <Button variant="default" onClick={handleApproveAndSave} disabled={saving} className="gap-1.5">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Approve & Save ({events.filter(e => e.title && e.date).length})
            </Button>
          )}
          <Button onClick={() => setStep(SETUP_STEPS.RECESS_LUNCH)}>
            {events.length > 0 ? 'Skip to Next' : 'Continue'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default StepCalendarUpload;
