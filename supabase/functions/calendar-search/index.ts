import { createClient } from 'npm:@supabase/supabase-js@2';

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

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ url: null, message: 'Auto-search not configured yet' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const aiRes = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Lovable-API-Key': apiKey,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'google/gemini-3-flash-preview',
          messages: [
            {
              role: 'system',
              content:
                'You help locate official school district academic calendars. Given a school website and a school year, return your best guess for the URL of the official academic calendar (PDF preferred). Respond ONLY with strict JSON: {"url": string|null, "confidence": number between 0 and 1, "reason": string}.',
            },
            {
              role: 'user',
              content: `School website: ${schoolWebsite}\nSchool year: ${schoolYear}\n\nReturn the most likely calendar URL. If you cannot identify one with reasonable confidence, set url to null.`,
            },
          ],
          response_format: { type: 'json_object' },
        }),
      });

      clearTimeout(timeout);

      if (!aiRes.ok) {
        console.error('[CalendarSearch] gateway error', aiRes.status, await aiRes.text());
        return new Response(
          JSON.stringify({ url: null, message: 'Auto-search unavailable, try another method' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
      }

      const json = await aiRes.json();
      const content: string = json?.choices?.[0]?.message?.content ?? '{}';
      let parsed: { url?: string | null; confidence?: number; reason?: string } = {};
      try {
        parsed = JSON.parse(content);
      } catch {
        parsed = {};
      }

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
      clearTimeout(timeout);
      console.error('[CalendarSearch] timeout/error', err);
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
