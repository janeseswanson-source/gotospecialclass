import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveSchoolRow, minimalSchoolPayload } from "./schoolSave";
import { __resetSchemaFallbackMemo } from "./supabaseSchemaFallback";

const pgrst204 = (col: string) => ({
  message: `Could not find the '${col}' column of 'schools' in the schema cache`,
  details: "", hint: "", code: "PGRST204",
});

const PAYLOAD = {
  name: "King Kamehameha 111 Elementary",
  workspace_id: "ws1",
  start_time: "07:45",
  max_team_out_minutes: 120, // the column that broke production
};

/** Minimal Supabase stand-in: update(...).eq(...) and insert(...).select(...).single() */
function makeClient(opts: {
  failColumns?: string[];
  insertHardFail?: boolean;   // insert fails for a non-schema reason
  onUpdate?: (p: Record<string, unknown>) => void;
  onInsert?: (p: Record<string, unknown>) => void;
}) {
  const fails = new Set(opts.failColumns ?? []);
  const offending = (p: Record<string, unknown>) => [...fails].find((c) => c in p);

  return {
    from: () => ({
      update: (p: Record<string, unknown>) => {
        opts.onUpdate?.(p);
        const bad = offending(p);
        return { eq: async () => (bad ? { data: null, error: pgrst204(bad) } : { data: null, error: null }) };
      },
      insert: (p: Record<string, unknown>) => {
        opts.onInsert?.(p);
        const bad = offending(p);
        return {
          select: () => ({
            single: async () => {
              if (bad) return { data: null, error: pgrst204(bad) };
              if (opts.insertHardFail && "start_time" in p) {
                return { data: null, error: { message: "boom", details: "", hint: "", code: "23514" } };
              }
              return { data: { id: "new-school" }, error: null };
            },
          }),
        };
      },
    }),
  } as never;
}

beforeEach(() => __resetSchemaFallbackMemo());

describe("minimalSchoolPayload", () => {
  it("keeps only what a row needs to exist", () => {
    expect(minimalSchoolPayload(PAYLOAD)).toEqual({
      name: PAYLOAD.name, workspace_id: "ws1", setup_step: 1,
    });
  });
});

describe("saveSchoolRow — existing school", () => {
  it("updates and reports success", async () => {
    const res = await saveSchoolRow(makeClient({}), "s1", PAYLOAD);
    expect(res).toMatchObject({ ok: true, schoolId: "s1", droppedColumns: [], error: null });
  });

  it("drops an unknown column and still saves the rest", async () => {
    const seen: Record<string, unknown>[] = [];
    const res = await saveSchoolRow(
      makeClient({ failColumns: ["max_team_out_minutes"], onUpdate: (p) => seen.push(p) }),
      "s1",
      PAYLOAD,
    );
    expect(res.ok).toBe(true);
    expect(res.droppedColumns).toEqual(["max_team_out_minutes"]);
    expect(seen.at(-1)).toMatchObject({ name: PAYLOAD.name, start_time: "07:45" });
    expect(seen.at(-1)).not.toHaveProperty("max_team_out_minutes");
  });

  it("notifies once per dropped column", async () => {
    const onDrop = vi.fn();
    await saveSchoolRow(makeClient({ failColumns: ["max_team_out_minutes"] }), "s1", PAYLOAD, onDrop);
    expect(onDrop).toHaveBeenCalledWith("max_team_out_minutes");
  });
});

describe("saveSchoolRow — new school (the session-losing path)", () => {
  it("still returns a schoolId when an unknown column breaks the insert", async () => {
    const res = await saveSchoolRow(makeClient({ failColumns: ["max_team_out_minutes"] }), null, PAYLOAD);
    expect(res.ok).toBe(true);
    expect(res.schoolId).toBe("new-school"); // downstream steps can now persist
    expect(res.droppedColumns).toContain("max_team_out_minutes");
  });

  it("falls back to a bare row when the full insert fails for another reason", async () => {
    const inserts: Record<string, unknown>[] = [];
    const res = await saveSchoolRow(
      makeClient({ insertHardFail: true, onInsert: (p) => inserts.push(p) }),
      null,
      PAYLOAD,
    );
    expect(res.schoolId).toBe("new-school");
    // First attempt full, second attempt minimal.
    expect(inserts[0]).toHaveProperty("start_time");
    expect(inserts[1]).toEqual({ name: PAYLOAD.name, workspace_id: "ws1", setup_step: 1 });
  });

  it("reports failure only when even the bare row cannot be created", async () => {
    const client = {
      from: () => ({
        insert: () => ({
          select: () => ({ single: async () => ({ data: null, error: { message: "denied", details: "", hint: "", code: "42501" } }) }),
        }),
      }),
    } as never;
    const res = await saveSchoolRow(client, null, PAYLOAD);
    expect(res).toMatchObject({ ok: false, schoolId: null });
    expect(res.error?.message).toBe("denied");
  });
});
