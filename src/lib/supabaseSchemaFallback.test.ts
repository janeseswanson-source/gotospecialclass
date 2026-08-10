import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  missingColumnFrom,
  saveWithSchemaFallback,
  droppedColumnsFor,
  __resetSchemaFallbackMemo,
} from "./supabaseSchemaFallback";

// Structural stand-ins: PostgrestError is a class (name/toJSON) but every
// consumer here only reads message/details/code.
const pgrst204 = (col: string) => ({
  message: `Could not find the '${col}' column of 'schools' in the schema cache`,
  details: "",
  hint: "",
  code: "PGRST204",
});

const undefinedColumn = (col: string) => ({
  message: `column "${col}" of relation "schools" does not exist`,
  details: "",
  hint: "",
  code: "42703",
});

const rlsDenied = {
  message: "new row violates row-level security policy",
  details: "",
  hint: "",
  code: "42501",
};

beforeEach(() => __resetSchemaFallbackMemo());

describe("missingColumnFrom", () => {
  it("extracts the column from a PGRST204 schema-cache miss", () => {
    expect(missingColumnFrom(pgrst204("max_team_out_minutes") as never)).toBe("max_team_out_minutes");
  });
  it("extracts the column from a 42703 undefined_column", () => {
    expect(missingColumnFrom(undefinedColumn("teacher_day_start_time") as never)).toBe("teacher_day_start_time");
  });
  it("strips a table prefix", () => {
    expect(missingColumnFrom({ ...pgrst204("x"), message: "Could not find the 'schools.foo' column" } as never)).toBe("foo");
  });
  it("returns null for unrelated errors", () => {
    expect(missingColumnFrom(rlsDenied as never)).toBeNull();
    expect(missingColumnFrom(null)).toBeNull();
  });
});

describe("saveWithSchemaFallback", () => {
  it("drops the unknown column and retries", async () => {
    const seen: Record<string, unknown>[] = [];
    const run = vi.fn(async (p: Record<string, unknown>) => {
      seen.push({ ...p });
      return "max_team_out_minutes" in p
        ? { data: null, error: pgrst204("max_team_out_minutes") }
        : { data: { id: "s1" }, error: null };
    });

    const res = await saveWithSchemaFallback("schools", { name: "KK3", max_team_out_minutes: 120 }, run);

    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: "s1" });
    expect(res.droppedColumns).toEqual(["max_team_out_minutes"]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(seen[1]).toEqual({ name: "KK3" }); // the rest of the payload survived
  });

  it("drops several unknown columns in sequence", async () => {
    const run = async (p: Record<string, unknown>) => {
      if ("a" in p) return { data: null, error: pgrst204("a") };
      if ("b" in p) return { data: null, error: undefinedColumn("b") };
      return { data: { ok: true }, error: null };
    };
    const res = await saveWithSchemaFallback("schools", { keep: 1, a: 1, b: 2 }, run);
    expect(res.error).toBeNull();
    expect(res.droppedColumns.sort()).toEqual(["a", "b"]);
  });

  it("passes real errors through untouched", async () => {
    const run = vi.fn(async () => ({ data: null, error: rlsDenied }));
    const res = await saveWithSchemaFallback("schools", { name: "x" }, run);
    expect(res.error).toBe(rlsDenied);
    expect(res.droppedColumns).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not loop when the named column is not in the payload", async () => {
    const run = vi.fn(async () => ({ data: null, error: pgrst204("something_else") }));
    const res = await saveWithSchemaFallback("schools", { name: "x" }, run);
    expect(res.error?.code).toBe("PGRST204");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("remembers a missing column so the next save pre-drops it", async () => {
    const run1 = async (p: Record<string, unknown>) =>
      "ghost" in p ? { data: null, error: pgrst204("ghost") } : { data: { ok: 1 }, error: null };
    await saveWithSchemaFallback("schools", { name: "a", ghost: 1 }, run1);
    expect(droppedColumnsFor("schools")).toEqual(["ghost"]);

    const run2 = vi.fn(async () => ({ data: { ok: 2 }, error: null }));
    const res = await saveWithSchemaFallback("schools", { name: "b", ghost: 1 }, run2);
    expect(res.error).toBeNull();
    expect(run2).toHaveBeenCalledTimes(1); // no wasted round-trip
    expect((run2.mock.calls[0] as unknown[])[0]).toEqual({ name: "b" });
  });

  it("reports each missing column to onDrop exactly once per session", async () => {
    const onDrop = vi.fn();
    const run = async (p: Record<string, unknown>) =>
      "ghost" in p ? { data: null, error: pgrst204("ghost") } : { data: null, error: null };
    await saveWithSchemaFallback("schools", { ghost: 1 }, run, { onDrop });
    await saveWithSchemaFallback("schools", { ghost: 1 }, run, { onDrop });
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith("ghost", "schools");
  });
});
