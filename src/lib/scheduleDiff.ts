// Minimal-perturbation diff (powers 4 & 6).
//
// Compares two block sets (e.g. a committed version vs. a replan/refine result)
// and reports how LITTLE changed — the signature promise "edit one thing and your
// week doesn't explode". A session's identity is its class+specialist+subject+
// grade+week (NOT its slot), so moving it to a new day/time reads as MOVED, not
// removed+added. Pure + framework-free so it's unit-testable.

export interface DiffBlock {
  id?: string | null;
  day_of_week: string;
  start_time: string;
  end_time: string;
  subject?: string | null;
  grade?: string | null;
  specialist_id?: string | null;
  specialist_name?: string | null;
  teacher_id?: string | null;
  teacher_name?: string | null;
  week_label?: string | null;
}

/** Stable identity of a session, independent of where it sits in the week. */
function identity(b: DiffBlock): string {
  const spec = b.specialist_id ?? b.specialist_name ?? "";
  const teach = b.teacher_id ?? b.teacher_name ?? "";
  return `${spec}|${teach}|${b.subject ?? ""}|${b.grade ?? ""}|${b.week_label ?? ""}`;
}

/** Where a session sits — used to tell "moved" from "unchanged". */
function slot(b: DiffBlock): string {
  return `${b.day_of_week}|${b.start_time}|${b.end_time}`;
}

export interface ScheduleDiff {
  /** Session ids in `next` whose slot changed vs `prev` (the highlight set). */
  movedIds: string[];
  /** Count of moved sessions. */
  moved: number;
  /** Sessions present in `next` but not `prev` (newly added). */
  added: number;
  /** Sessions present in `prev` but not `next` (removed). */
  removed: number;
  /** Sessions identical in identity AND slot. */
  unchanged: number;
  /** True when nothing changed at all. */
  identical: boolean;
}

/**
 * Diff `next` against `prev` by session identity. A session that exists in both
 * but sits in a different slot is "moved" (and its `next` id is returned for the
 * grid highlight). Duplicate identities (e.g. a class that sees a specialist
 * twice) are matched greedily by slot so an unchanged duplicate isn't miscounted.
 */
export function diffSchedules(prev: DiffBlock[], next: DiffBlock[]): ScheduleDiff {
  // Group prev by identity → multiset of slots.
  const prevByIdentity = new Map<string, DiffBlock[]>();
  for (const b of prev) {
    const k = identity(b);
    (prevByIdentity.get(k) ?? prevByIdentity.set(k, []).get(k)!).push(b);
  }

  const movedIds: string[] = [];
  let moved = 0;
  let added = 0;
  let unchanged = 0;

  for (const b of next) {
    const k = identity(b);
    const bucket = prevByIdentity.get(k);
    if (!bucket || bucket.length === 0) {
      added++;
      continue;
    }
    // Prefer an exact-slot match (unchanged); else consume one prev occurrence (moved).
    const sameSlotIdx = bucket.findIndex((p) => slot(p) === slot(b));
    if (sameSlotIdx >= 0) {
      bucket.splice(sameSlotIdx, 1);
      unchanged++;
    } else {
      bucket.shift();
      moved++;
      if (b.id) movedIds.push(b.id);
    }
  }

  // Anything left unconsumed in prev was removed.
  let removed = 0;
  for (const bucket of prevByIdentity.values()) removed += bucket.length;

  return {
    movedIds,
    moved,
    added,
    removed,
    unchanged,
    identical: moved === 0 && added === 0 && removed === 0,
  };
}

/** Plain-language summary for the perturbation banner. */
export function diffSummary(d: ScheduleDiff): string {
  if (d.identical) return "Nothing changed.";
  const parts: string[] = [];
  if (d.moved) parts.push(`${d.moved} class${d.moved === 1 ? "" : "es"} moved`);
  if (d.added) parts.push(`${d.added} added`);
  if (d.removed) parts.push(`${d.removed} removed`);
  const lead = parts.join(" · ");
  return d.moved && !d.added && !d.removed ? `Only ${lead} — the rest of your week is unchanged.` : lead;
}
