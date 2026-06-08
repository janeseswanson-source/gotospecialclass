import { supabase } from '@/integrations/supabase/client';

export async function downloadTemplate(templateKey: string, fallbackPath: string) {
  try {
    const { data } = await supabase
      .from('admin_templates')
      .select('file_path')
      .eq('template_key', templateKey)
      .maybeSingle();

    if (data?.file_path) {
      const { data: urlData } = supabase.storage.from('templates').getPublicUrl(data.file_path);
      window.open(urlData.publicUrl, '_blank');
      return;
    }
  } catch (err) {
    console.warn('Failed to fetch admin template, using default', err);
  }
  window.open(fallbackPath, '_blank');
}
