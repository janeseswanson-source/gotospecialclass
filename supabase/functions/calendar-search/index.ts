import { createClient } from 'npm:@supabase/supabase-js@2';
import { anthropicApiKey, anthropicClient, CLAUDE_MODEL, firstToolUse } from '../_shared/anthropic.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchBody {
  schoolWebsite?: string;
  schoolYear?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace('Bearer ', '');
    const { data: claims, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claims?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = (await req.json().catch(() => ({}))) as SearchBody;
    const schoolWebsite = (body.schoolWebsite ?? '').trim();
    const schoolYear = (body.schoolYear ?? '').trim();
    if (!schoolWebsite || !schoolYear) {
      return new Response(
        JSON.stringify({ error: 'schoolWebsite and schoolYear are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    if (!anthropicApiKey()) {
      return new Response(
        JSON.stringify({ url: null, message: 'Auto-search not configured yet' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    try {
      // Let Claude actually search the web for the district's calendar, then
      // report a structured result. tool_choice can't force a custom tool
      // while a server tool is present, so we use "any" (must use *some* tool)
      // and read the report_calendar call from the final turn.
      const REPORT_TOOL = {
        name: 'report_calendar',
        description: 'Report the official academic calendar URL you found.',
        input_schema: {
          type: 'object',
          properties: {
            url: { type: ['string', 'null'], description: 'Direct URL to the official academic calendar (PDF preferred), or null if not found.' },
            confidence: { type: 'number', description: '0 to 1' },
            reason: { type: 'string' },
          },
          required: ['url', 'confidence'],
        },
      };

      const resp = await anthropicClient().messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 1500,
        system:
          'You locate official school/district academic calendars. Use web search to find the real calendar page or PDF for the given school and year, then call report_calendar with the best direct URL. Prefer an official district domain and a PDF. If you cannot find a credible one, report url=null.',
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 4 } as any,
          REPORT_TOOL as any,
        ],
        tool_choice: { type: 'any' } as any,
        messages: [
          { role: 'user', content: `School website: ${schoolWebsite}\nSchool year: ${schoolYear}\n\nFind the official academic calendar URL.` },
        ],
      });

      const parsed = (firstToolUse(resp.content as any[], 'report_calendar')?.input ?? {}) as { url?: string | null; confidence?: number; reason?: string };
      const url = typeof parsed.url === 'string' && parsed.url.startsWith('http') ? parsed.url : null;
      const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;

      if (!url || confidence < 0.6) {
        return new Response(
          JSON.stringify({ url: null, message: 'No calendar found, try another method', confidence }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      return new Response(
        JSON.stringify({ url, confidence, reason: parsed.reason ?? null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    } catch (err) {
      console.error('[CalendarSearch] error', err);
      return new Response(
        JSON.stringify({ url: null, message: 'No calendar found, try another method' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
  } catch (err) {
    console.error('[CalendarSearch] fatal', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
