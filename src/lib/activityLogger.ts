import { supabase } from '@/integrations/supabase/client';

export async function logActivity(action: string, details?: Record<string, unknown>) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: membership } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle();

    await supabase.from('activity_log').insert([{
      user_id: user.id,
      workspace_id: membership?.workspace_id ?? null,
      action,
      details: (details ?? {}) as any,
    }]);
  } catch {
    // Non-blocking
  }
}
