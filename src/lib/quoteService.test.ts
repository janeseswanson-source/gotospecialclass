import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client so the fallback path never touches the network.
const invoke = vi.fn();
const maybeSingle = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: any[]) => invoke(...a) },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({ maybeSingle: () => maybeSingle() }),
          }),
        }),
      }),
    }),
  },
}));

import { staticFallbackQuote, resolveDisplayQuote, generateQuote } from "./quoteService";
import { BRAND } from "@/brand/brand";

beforeEach(() => {
  invoke.mockReset();
  maybeSingle.mockReset();
});

describe("quote fallback path", () => {
  it("staticFallbackQuote is deterministic per seed and brand-attributed", () => {
    const a = staticFallbackQuote(0);
    const b = staticFallbackQuote(0);
    expect(a).toEqual(b);
    expect(a.author).toBe(BRAND.attribution);
    expect(a.text.length).toBeGreaterThan(0);
  });

  it("resolveDisplayQuote returns a static fallback when there is no school", async () => {
    const q = await resolveDisplayQuote(null, 1);
    expect(q).toEqual(staticFallbackQuote(1));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("resolveDisplayQuote falls back when the table lookup errors", async () => {
    maybeSingle.mockRejectedValueOnce(new Error("boom"));
    const q = await resolveDisplayQuote("school-1", 2);
    expect(q).toEqual(staticFallbackQuote(2));
  });

  it("resolveDisplayQuote returns the latest persisted quote when present", async () => {
    maybeSingle.mockResolvedValueOnce({ data: { text: "Persisted line." } });
    const q = await resolveDisplayQuote("school-1");
    expect(q).toEqual({ text: "Persisted line.", author: BRAND.attribution });
  });

  it("generateQuote falls back to a static line when the edge function fails", async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: "no key" } });
    const q = await generateQuote("school-1", "teachers");
    expect(q.author).toBe(BRAND.attribution);
    expect(q.text.length).toBeGreaterThan(0);
  });

  it("generateQuote returns the AI line when available", async () => {
    invoke.mockResolvedValueOnce({ data: { text: "Fresh AI line." }, error: null });
    const q = await generateQuote("school-1", "students");
    expect(q).toEqual({ text: "Fresh AI line.", author: BRAND.attribution });
  });
});
