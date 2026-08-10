// Survive a not-yet-applied migration.
//
// Migrations in this project are applied MANUALLY via Lovable (see
// LOVABLE_DEPLOY.md), so the frontend can ship a column write days before the
// column exists. That happened: the Setup wizard sent `max_team_out_minutes`
// on every School Info save, PostgREST answered PGRST204 ("Could not find the
// 'max_team_out_minutes' column of 'schools' in the schema cache"), the whole
// save failed, and a coordinator lost her entire wizard session.
//
// A missing column must degrade to "we saved everything else", never to
// "nothing saved". saveWithSchemaFallback strips the offending column and
// retries; real failures (RLS, network, constraint violations) pass straight
// through untouched.

/** The only parts of a PostgrestError this module reads. Structural rather
 *  than the concrete class so callers (and tests) can pass plain objects. */
export interface DbError {
  message: string;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

/** Columns we have already learned are absent, per table, for this session. */
const missingByTable = new Map<string, Set<string>>();

const PGRST204_RE = /could not find the ['"`]?([\w.]+)['"`]? column/i;
const UNDEFINED_COLUMN_RE = /column ['"`]?([\w.]+)['"`]? (?:of relation \S+ )?does not exist/i;

/** The column name PostgREST/Postgres is complaining about, or null. */
export function missingColumnFrom(error: DbError | null | undefined): string | null {
  if (!error) return null;
  const msg = `${error.message ?? ""} ${error.details ?? ""}`;
  // PGRST204 = schema cache miss; 42703 = undefined_column. Lovable's proxy
  // sometimes strips `code`, so we also match on the message alone.
  const m = PGRST204_RE.exec(msg) ?? UNDEFINED_COLUMN_RE.exec(msg);
  if (!m) return null;
  // "schools.max_team_out_minutes" -> "max_team_out_minutes"
  return m[1].includes(".") ? m[1].split(".").pop()! : m[1];
}

export interface SchemaFallbackResult<T> {
  data: T | null;
  error: DbError | null;
  /** Columns dropped from the payload to make the write succeed. */
  droppedColumns: string[];
}

export interface SchemaFallbackOptions {
  /** Safety valve — each iteration drops exactly one column. */
  maxDrops?: number;
  /** Called once per newly-discovered missing column. */
  onDrop?: (column: string, table: string) => void;
}

/**
 * Run a Supabase write, dropping unknown columns until it succeeds.
 *
 * `run` receives the (possibly reduced) payload so the caller keeps full
 * control of the query shape:
 *
 *   saveWithSchemaFallback('schools', payload, (p) =>
 *     supabase.from('schools').update(p).eq('id', id))
 */
export async function saveWithSchemaFallback<T>(
  table: string,
  payload: Record<string, unknown>,
  run: (p: Record<string, unknown>) => PromiseLike<{ data: T | null; error: DbError | null }>,
  opts: SchemaFallbackOptions = {},
): Promise<SchemaFallbackResult<T>> {
  const maxDrops = opts.maxDrops ?? 8;
  const known = missingByTable.get(table) ?? new Set<string>();
  const current: Record<string, unknown> = { ...payload };
  const dropped: string[] = [];

  // Pre-drop what we already learned this session — the second save costs one
  // round-trip, not two.
  for (const col of known) {
    if (col in current) {
      delete current[col];
      dropped.push(col);
    }
  }

  for (let attempt = 0; attempt <= maxDrops; attempt++) {
    const { data, error } = await run(current);
    if (!error) return { data, error: null, droppedColumns: dropped };

    const col = missingColumnFrom(error);
    // Not a schema problem, or it names something we aren't even sending →
    // a real error the caller must see.
    if (!col || !(col in current)) return { data: null, error, droppedColumns: dropped };

    delete current[col];
    dropped.push(col);
    if (!known.has(col)) {
      known.add(col);
      missingByTable.set(table, known);
      opts.onDrop?.(col, table);
    }
  }

  return {
    data: null,
    error: {
      message: `Gave up after dropping ${maxDrops} unknown columns from ${table}.`,
      details: dropped.join(", "),
      hint: "Apply the pending database migrations.",
      code: "SCHEMA_DRIFT",
    },
    droppedColumns: dropped,
  };
}

/**
 * Same contract as `saveWithSchemaFallback`, for writes that send MANY rows
 * (upserts of specialist/teacher cards). A missing column is missing for the
 * whole table, so it is dropped from every row at once.
 */
export async function saveRowsWithSchemaFallback<T>(
  table: string,
  rows: Array<Record<string, unknown>>,
  run: (r: Array<Record<string, unknown>>) => PromiseLike<{ data: T | null; error: DbError | null }>,
  opts: SchemaFallbackOptions = {},
): Promise<SchemaFallbackResult<T>> {
  // Reuse the single-payload engine by treating the row list as one payload
  // whose "columns" are the union of the rows' keys.
  const union: Record<string, unknown> = {};
  for (const r of rows) for (const k of Object.keys(r)) union[k] = true;

  return saveWithSchemaFallback<T>(
    table,
    union,
    (reduced) => {
      const keep = new Set(Object.keys(reduced));
      const projected = rows.map((r) =>
        Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))),
      );
      return run(projected);
    },
    opts,
  );
}

/** Columns discovered missing on this table this session (for banners/telemetry). */
export function droppedColumnsFor(table: string): string[] {
  return [...(missingByTable.get(table) ?? [])];
}

/** Test seam. */
export function __resetSchemaFallbackMemo(): void {
  missingByTable.clear();
}
