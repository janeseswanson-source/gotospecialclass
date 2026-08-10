// Persisting the School Info step, extracted so it is testable without a DOM.
//
// The wizard's first write is load-bearing: if it fails while `schoolId` is
// still null, `setSchoolId` never runs and EVERY later step silently no-ops
// (they all early-return on a missing schoolId), so the coordinator fills in
// specialists and teachers and none of it is stored. That is exactly how a
// real setup session was lost. `ensureSchoolRow` therefore guarantees a row
// exists whenever a school name has been typed, degrading through:
//
//   full insert -> insert minus unknown columns -> bare {name, workspace_id}
//
// and only then reports failure.

import type { SupabaseClient } from "@supabase/supabase-js";
import { saveWithSchemaFallback } from "./supabaseSchemaFallback";

export type SchoolPayload = Record<string, unknown>;

export interface SaveOutcome {
  ok: boolean;
  schoolId: string | null;
  /** Columns the database did not know about; the rest of the payload saved. */
  droppedColumns: string[];
  error: { message: string } | null;
}

/** Minimum viable row — everything else can be filled in by a later update. */
export function minimalSchoolPayload(payload: SchoolPayload): SchoolPayload {
  return {
    name: payload.name,
    workspace_id: payload.workspace_id,
    setup_step: 1,
  };
}

type Client = Pick<SupabaseClient, "from">;

/**
 * Update the school row, or create it if we don't have one yet.
 * Returns the id on success so the caller can commit it to context.
 */
export async function saveSchoolRow(
  supabase: Client,
  schoolId: string | null,
  payload: SchoolPayload,
  onDrop?: (column: string) => void,
): Promise<SaveOutcome> {
  const drop = onDrop ? (c: string) => onDrop(c) : undefined;

  if (schoolId) {
    const res = await saveWithSchemaFallback<unknown>(
      "schools",
      payload,
      (p) => supabase.from("schools").update(p as never).eq("id", schoolId) as never,
      { onDrop: drop },
    );
    return {
      ok: !res.error,
      schoolId,
      droppedColumns: res.droppedColumns,
      error: res.error ? { message: res.error.message } : null,
    };
  }

  // ── No row yet: this insert must succeed or the whole wizard is dead. ──
  const insert = await saveWithSchemaFallback<{ id: string }>(
    "schools",
    { ...payload, setup_step: 1 },
    (p) => supabase.from("schools").insert(p as never).select("id").single() as never,
    { onDrop: drop },
  );
  if (!insert.error && insert.data?.id) {
    return { ok: true, schoolId: insert.data.id, droppedColumns: insert.droppedColumns, error: null };
  }

  // Last resort: create the barest possible row so `schoolId` exists, then
  // layer the real values on with an update. A constraint we can't guess is
  // still better than losing the session.
  const bare = await saveWithSchemaFallback<{ id: string }>(
    "schools",
    minimalSchoolPayload(payload),
    (p) => supabase.from("schools").insert(p as never).select("id").single() as never,
    { onDrop: drop },
  );
  if (bare.error || !bare.data?.id) {
    return {
      ok: false,
      schoolId: null,
      droppedColumns: [...insert.droppedColumns, ...bare.droppedColumns],
      error: { message: (bare.error ?? insert.error)?.message ?? "Could not create the school." },
    };
  }

  const newId = bare.data.id;
  const fill = await saveWithSchemaFallback<unknown>(
    "schools",
    payload,
    (p) => supabase.from("schools").update(p as never).eq("id", newId) as never,
    { onDrop: drop },
  );
  return {
    // The row exists and is usable even if the follow-up update failed —
    // report the id so downstream steps work, but surface the error.
    ok: !fill.error,
    schoolId: newId,
    droppedColumns: [...insert.droppedColumns, ...bare.droppedColumns, ...fill.droppedColumns],
    error: fill.error ? { message: fill.error.message } : null,
  };
}
