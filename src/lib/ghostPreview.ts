// Ghost-preview mapping (edit-with-ai v2) — PURE, unit-tested.
//
// Turns the chat's proposed-but-unapplied ops into a grid overlay model:
//   moved blocks  → a dashed "ghost" at the destination + a faded origin
//   inserts       → a dashed ghost at the new slot
//   deletes       → the existing block rendered struck-through
// The page appends `ghostBlocks` to the display list and passes the id sets down
// so cells style themselves. Nothing here validates or persists — the SSOT does
// that at Apply time.

import type { BlockData } from "@/components/schedule/ScheduleGrid";

/** Proposed op shapes (mirror of the server's EditOp). */
export type PreviewOp =
  | { kind: "move"; label?: string; block_id: string; day_of_week: string; start_time: string; end_time: string }
  | { kind: "swap"; label?: string; a_id: string; a_day: string; a_start: string; a_end: string; b_id: string; b_day: string; b_start: string; b_end: string }
  | { kind: "delete"; label?: string; block_id: string }
  | { kind: "insert"; label?: string; day_of_week: string; start_time: string; end_time: string; subject: string; specialist_id: string | null; teacher_id: string | null; grade: string | null; room: string | null; week_label: string | null };

export interface GhostOverlay {
  /** Synthetic dashed blocks to append to the display list. */
  ghostBlocks: BlockData[];
  /** Ids of the synthetic ghosts (style: dashed, non-interactive). */
  ghostIds: Set<string>;
  /** Existing blocks that are being moved away — render faded at the origin. */
  originIds: Set<string>;
  /** Existing blocks proposed for deletion — render struck-through. */
  deletedIds: Set<string>;
}

export interface NameResolvers {
  specialistName?: (id: string | null) => string | null;
  teacherName?: (id: string | null) => string | null;
}

export const EMPTY_OVERLAY: GhostOverlay = {
  ghostBlocks: [], ghostIds: new Set(), originIds: new Set(), deletedIds: new Set(),
};

/** Build the overlay model for a set of proposed ops. Pure. */
export function buildGhostOverlay(blocks: BlockData[], ops: PreviewOp[], resolve?: NameResolvers): GhostOverlay {
  if (!ops.length) return EMPTY_OVERLAY;
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const ghostBlocks: BlockData[] = [];
  const ghostIds = new Set<string>();
  const originIds = new Set<string>();
  const deletedIds = new Set<string>();
  let n = 0;

  const pushGhost = (base: Partial<BlockData>, day: string, start: string, end: string) => {
    const id = `ghost_${n++}`;
    ghostIds.add(id);
    ghostBlocks.push({
      id,
      day_of_week: day,
      start_time: start,
      end_time: end,
      subject: base.subject ?? null,
      specialist_name: base.specialist_name ?? null,
      teacher_name: base.teacher_name ?? null,
      room: base.room ?? null,
      grade: base.grade ?? null,
      week_label: base.week_label ?? null,
      specialist_id: base.specialist_id ?? null,
      teacher_id: base.teacher_id ?? null,
    });
  };

  for (const op of ops) {
    if (op.kind === "move") {
      const src = byId.get(op.block_id);
      if (!src) continue;
      originIds.add(src.id);
      pushGhost(src, op.day_of_week, op.start_time, op.end_time);
    } else if (op.kind === "swap") {
      const a = byId.get(op.a_id);
      const b = byId.get(op.b_id);
      if (a) { originIds.add(a.id); pushGhost(a, op.a_day, op.a_start, op.a_end); }
      if (b) { originIds.add(b.id); pushGhost(b, op.b_day, op.b_start, op.b_end); }
    } else if (op.kind === "delete") {
      if (byId.has(op.block_id)) deletedIds.add(op.block_id);
    } else if (op.kind === "insert") {
      pushGhost(
        {
          subject: op.subject,
          grade: op.grade,
          room: op.room,
          week_label: op.week_label,
          specialist_id: op.specialist_id,
          teacher_id: op.teacher_id,
          specialist_name: resolve?.specialistName?.(op.specialist_id) ?? null,
          teacher_name: resolve?.teacherName?.(op.teacher_id) ?? null,
        },
        op.day_of_week, op.start_time, op.end_time,
      );
    }
  }
  return { ghostBlocks, ghostIds, originIds, deletedIds };
}

// ─── Apply-bar selection (pure helpers, unit-tested) ─────────────────────────

export interface ProposalItem {
  /** Stable selection id (toolCallId:index for chat ops; fix:index for panel ops). */
  id: string;
  op: PreviewOp;
}

/** Toggle one proposal in/out of the rejected set (immutably). */
export function toggleRejected(rejected: Set<string>, id: string): Set<string> {
  const next = new Set(rejected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** The ops that will actually be sent to apply-schedule-edits. */
export function acceptedOps(items: ProposalItem[], rejected: Set<string>): PreviewOp[] {
  return items.filter((p) => !rejected.has(p.id)).map((p) => p.op);
}

/** Human before→after line for an applied op (compact, chat-friendly). */
export function opBeforeAfter(op: PreviewOp, blocks: BlockData[]): string {
  const hm = (t: string) => t.slice(0, 5);
  const find = (id: string) => blocks.find((b) => b.id === id);
  if (op.kind === "move") {
    const b = find(op.block_id);
    const who = b ? `${b.subject ?? "Block"}${b.grade ? ` Gr ${b.grade}` : ""}` : "Block";
    return `${who}: ${b ? `${b.day_of_week} ${hm(b.start_time)}` : "?"} → ${op.day_of_week} ${hm(op.start_time)}`;
  }
  if (op.kind === "swap") {
    const a = find(op.a_id), b = find(op.b_id);
    return `${a?.subject ?? "A"} (${a ? `${a.day_of_week} ${hm(a.start_time)}` : "?"}) ⇄ ${b?.subject ?? "B"} (${b ? `${b.day_of_week} ${hm(b.start_time)}` : "?"})`;
  }
  if (op.kind === "delete") {
    const b = find(op.block_id);
    return `Removed ${b?.subject ?? "block"}${b?.grade ? ` Gr ${b.grade}` : ""} (${b ? `${b.day_of_week} ${hm(b.start_time)}` : "?"})`;
  }
  return `Added ${op.subject}${op.grade ? ` Gr ${op.grade}` : ""}: ${op.day_of_week} ${hm(op.start_time)}–${hm(op.end_time)}`;
}
