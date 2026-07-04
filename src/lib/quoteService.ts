// Quote source of truth for the client: the AI `quotes` table (latest per school),
// with a graceful STATIC fallback (our own original lines) when there's no schedule
// yet or the AI key isn't configured. Attribution is always the brand.
import { supabase } from "@/integrations/supabase/client";
import { BRAND } from "@/brand/brand";
import { educatorQuotes } from "@/lib/quotes";

export type Audience = "teachers" | "students" | "both";
export interface DisplayQuote { text: string; author: string }

/** Our own original lines (attributed to the brand) for the no-data fallback. */
const OWN_QUOTES = educatorQuotes.filter((q) => q.author === "Specialist Ops!");

/** A rotating static fallback quote (deterministic when `seed` is given). */
export function staticFallbackQuote(seed?: number): DisplayQuote {
  const i = typeof seed === "number"
    ? ((seed % OWN_QUOTES.length) + OWN_QUOTES.length) % OWN_QUOTES.length
    : Math.floor(Math.random() * OWN_QUOTES.length);
  const q = OWN_QUOTES[i] ?? { text: "A great schedule is the invisible foundation of a thriving school.", author: BRAND.attribution };
  return { text: q.text, author: q.author };
}

/** The latest persisted AI quote for a school, or null if none yet. */
export async function fetchLatestQuote(schoolId: string): Promise<DisplayQuote | null> {
  const { data } = await supabase
    .from("quotes")
    .select("text")
    .eq("school_id", schoolId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.text ? { text: data.text, author: BRAND.attribution } : null;
}

/** Ask the AI for a fresh original line (persisted server-side). Falls back to a
 *  static line if the edge function is unavailable. */
export async function generateQuote(schoolId: string, audience: Audience = "teachers"): Promise<DisplayQuote> {
  try {
    const { data, error } = await supabase.functions.invoke("generate-quote", {
      body: { school_id: schoolId, audience, date: new Date().toISOString().slice(0, 10) },
    });
    if (error || !(data as any)?.text) throw new Error((data as any)?.error ?? error?.message ?? "no quote");
    return { text: (data as any).text as string, author: BRAND.attribution };
  } catch {
    return staticFallbackQuote();
  }
}

/** Latest AI quote, else a static fallback — what the banner/exports display. */
export async function resolveDisplayQuote(schoolId: string | null | undefined, seed?: number): Promise<DisplayQuote> {
  if (schoolId) {
    const latest = await fetchLatestQuote(schoolId).catch(() => null);
    if (latest) return latest;
  }
  return staticFallbackQuote(seed);
}
