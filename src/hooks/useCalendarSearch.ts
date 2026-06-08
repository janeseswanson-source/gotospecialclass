import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface CalendarSearchResult {
  url: string | null;
  message?: string;
  confidence?: number;
  reason?: string | null;
}

export function useCalendarSearch() {
  const [searching, setSearching] = useState(false);

  const search = async (
    schoolWebsite: string,
    schoolYear: string,
  ): Promise<CalendarSearchResult> => {
    setSearching(true);
    try {
      const { data, error } = await supabase.functions.invoke('calendar-search', {
        body: { schoolWebsite, schoolYear },
      });
      if (error) {
        console.error('[CalendarSearch]', error);
        toast.error('Auto-search failed. Try uploading a PDF or pasting a link.');
        return { url: null, message: 'Auto-search failed' };
      }
      return (data ?? { url: null }) as CalendarSearchResult;
    } catch (err) {
      console.error('[CalendarSearch]', err);
      toast.error('Auto-search failed. Try another method.');
      return { url: null, message: 'Auto-search failed' };
    } finally {
      setSearching(false);
    }
  };

  return { searching, search };
}
