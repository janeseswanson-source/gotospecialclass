import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { CalendarEvent } from '@/contexts/SetupContext';

export interface UploadAndParseInput {
  file?: File | null;
  url?: string | null;
}

export interface UploadAndParseResult {
  uploadId: string | null;
  events: CalendarEvent[];
}

export function useCalendarUpload(schoolId: string | null) {
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);

  const uploadAndParse = async (
    input: UploadAndParseInput
  ): Promise<UploadAndParseResult | null> => {
    if (!schoolId) {
      toast.error('School not set up yet. Please complete School Info first.');
      return null;
    }

    const { file, url } = input;
    const useFile = !!file;
    const useUrl = !useFile && !!url?.trim();

    if (!useFile && !useUrl) {
      toast.error(file === null ? 'No file selected' : 'Please enter a calendar URL');
      return null;
    }

    if (useFile && file) {
      if (file.type !== 'application/pdf') {
        toast.error('Please select a PDF file');
        return null;
      }
      if (file.size > 20 * 1024 * 1024) {
        toast.error('File too large. Maximum size is 20MB.');
        return null;
      }
    }

    try {
      setUploading(true);
      let filePath: string | null = null;
      let recordFileName: string;
      let recordFilePath: string;
      let recordFileSize: number;

      if (useFile && file) {
        filePath = `${schoolId}/${Date.now()}_${file.name}`;
        const { error: storageError } = await supabase.storage
          .from('calendar-uploads')
          .upload(filePath, file);
        if (storageError) {
          toast.error('Failed to upload file');
          setUploading(false);
          return null;
        }
        recordFileName = file.name;
        recordFilePath = filePath;
        recordFileSize = file.size;
      } else {
        recordFileName = url!;
        recordFilePath = url!;
        recordFileSize = 0;
      }

      const { data: uploadRecord, error: insertError } = await supabase
        .from('calendar_uploads')
        .insert({
          school_id: schoolId,
          file_name: recordFileName,
          file_path: recordFilePath,
          file_size: recordFileSize,
        })
        .select('id')
        .single();

      if (insertError || !uploadRecord) {
        toast.error('Failed to record upload');
        setUploading(false);
        return null;
      }

      setUploading(false);
      setParsing(true);

      const body = useFile
        ? { file_path: filePath, school_id: schoolId, upload_id: uploadRecord.id }
        : { calendar_url: url, school_id: schoolId, upload_id: uploadRecord.id };

      const { data: parseResult, error: parseError } = await supabase.functions.invoke(
        'parse-calendar',
        { body }
      );

      if (parseError) {
        console.error('[CalendarParser]', parseError);
        toast.error('AI parsing failed. You can add events manually.');
        setParsing(false);
        return null;
      }

      const events: CalendarEvent[] = (parseResult?.events || []).map((e: any) => ({
        id: crypto.randomUUID(),
        type: e.event_type,
        title: e.title,
        date: e.event_date,
        endDate: e.end_date || e.event_date,
        aiExtracted: true,
      }));

      setParsing(false);
      toast.success(`AI extracted ${events.length} events from your calendar`);
      return { uploadId: uploadRecord.id, events };
    } catch (err) {
      console.error('[CalendarParser]', err);
      toast.error('Something went wrong. You can add events manually.');
      setUploading(false);
      setParsing(false);
      return null;
    }
  };

  return { uploading, parsing, uploadAndParse };
}
