// Guard: a column added by a migration must be reflected in the generated
// Supabase types before any code writes it.
//
// Why this test exists: migration 20260718000000 added schools.max_team_out_minutes
// and the Setup wizard immediately started sending that column. Migrations here
// are applied MANUALLY via Lovable, that one wasn't, and PostgREST rejected every
// School Info save with PGRST204 — a coordinator lost her whole wizard session.
// `src/integrations/supabase/types.ts` is generated FROM the live schema, so a
// migration column missing from it is direct evidence the migration is unapplied.

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const TYPES_FILE = join(process.cwd(), "src", "integrations", "supabase", "types.ts");

/** Migrations older than this predate the rule; we don't retro-enforce. */
const NOTIFY_RULE_FROM = "20260718000000";

/**
 * Columns whose migration is written but NOT YET APPLIED to the live database
 * (Lovable applies migrations by hand — see LOVABLE_DEPLOY.md).
 *
 * Being on this list is a promise that every write of the column goes through
 * `saveWithSchemaFallback()`, so an unapplied migration degrades to "saved
 * everything else" instead of losing the user's work.
 *
 * DELETE the entry the moment Lovable applies the migration and regenerates
 * types — the test below fails if a listed column turns out to be typed, so
 * this list cannot rot.
 */
// Columns whose migration is written but not yet applied to the live database.
// Everything listed here MUST be written through saveWithSchemaFallback(), so
// an un-migrated column costs that one setting instead of the whole save.
// Delete the entry once Lovable applies the migration and types are regenerated.
const KNOWN_PENDING = new Set<string>([
  "schools.max_team_out_minutes", // 20260718000000 — pending as of 2026-08-09
  // 20260808010000 — teacher duty day; written by StepSchoolInfo via saveSchoolRow
  "schools.teacher_day_start_time",
  "schools.teacher_day_end_time",
  "schools.teacher_planning_block_minutes",
  "schools.teacher_planning_block_when",
  // 20260808020000 — rotation start date; same write path
  "schools.rotations_start_date",
  "schools.rotations_week_anchor",
]);

const ADD_COLUMN_RE =
  /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?["']?(\w+)["']?([\s\S]*?);/gi;
const COLUMN_CLAUSE_RE = /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+["']?(\w+)["']?/gi;

interface AddedColumn { table: string; column: string; file: string }

/** Read normalising CRLF -> LF: this repo checks out with CRLF on Windows and
 *  the structural regexes below are newline-anchored. */
function read(path: string): string {
  return readFileSync(path, "utf8").split("\r\n").join("\n");
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
}

function addedColumns(): AddedColumn[] {
  const out: AddedColumn[] = [];
  for (const file of migrationFiles()) {
    const sql = read(join(MIGRATIONS_DIR, file));
    for (const m of sql.matchAll(ADD_COLUMN_RE)) {
      const table = m[1];
      for (const c of m[2].matchAll(COLUMN_CLAUSE_RE)) {
        out.push({ table, column: c[1], file });
      }
    }
  }
  return out;
}

/** Column names inside a table's `Row: { ... }` block in the generated types. */
function typedColumns(): Map<string, Set<string>> {
  const src = read(TYPES_FILE);
  const byTable = new Map<string, Set<string>>();
  // `      tablename: {\n        Row: {\n          col: type\n ... }`
  const tableRe = /^ {6}(\w+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm;
  for (const t of src.matchAll(tableRe)) {
    const cols = new Set<string>();
    for (const line of t[2].split("\n")) {
      const c = /^\s{10}(\w+)\??:/.exec(line);
      if (c) cols.add(c[1]);
    }
    byTable.set(t[1], cols);
  }
  return byTable;
}

describe("schema drift", () => {
  it("parses migrations and generated types (sanity)", () => {
    expect(migrationFiles().length).toBeGreaterThan(50);
    const typed = typedColumns();
    expect(typed.get("schools")?.has("start_time")).toBe(true);
  });

  it("every migration-added column exists in the generated types", () => {
    const typed = typedColumns();
    const drift = addedColumns().filter(({ table, column }) => {
      const cols = typed.get(table);
      // Unknown table = one this test can't see (view / private schema); skip.
      if (!cols) return false;
      return !cols.has(column) && !KNOWN_PENDING.has(`${table}.${column}`);
    });

    expect(
      drift,
      drift
        .map(
          (d) =>
            `${d.table}.${d.column} is added by ${d.file} but is MISSING from src/integrations/supabase/types.ts — ` +
            `the migration is unapplied, or types were never regenerated. Either apply it (and regenerate types), or ` +
            `add "${d.table}.${d.column}" to KNOWN_PENDING and route every write of it through saveWithSchemaFallback().`,
        )
        .join("\n"),
    ).toEqual([]);
  });

  it("KNOWN_PENDING has no stale entries", () => {
    const typed = typedColumns();
    const applied = [...KNOWN_PENDING].filter((key) => {
      const [table, column] = key.split(".");
      return typed.get(table)?.has(column) ?? false;
    });
    expect(
      applied,
      `These columns are now in the generated types, so their migrations HAVE been applied.\n` +
        `Remove them from KNOWN_PENDING in this file (and from the pending table in LOVABLE_DEPLOY.md):\n  ${applied.join("\n  ")}`,
    ).toEqual([]);
  });

  it("migrations that add columns end with a PostgREST schema-cache reload", () => {
    const offenders: string[] = [];
    for (const file of migrationFiles()) {
      if (file.slice(0, 14) < NOTIFY_RULE_FROM.slice(0, 14)) continue;
      const sql = read(join(MIGRATIONS_DIR, file));
      if (!/ADD\s+COLUMN/i.test(sql)) continue;
      if (!/NOTIFY\s+pgrst\s*,\s*'reload schema'/i.test(sql)) offenders.push(file);
    }
    expect(
      offenders,
      `These migrations add columns but never tell PostgREST to reload its schema cache.\n` +
        `Add \`NOTIFY pgrst, 'reload schema';\` as the last line of:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
