// Conflict-cascade display helpers (power 5).
//
// The deterministic engine (resolve-conflicts-ai) returns the ranked legal fixes
// it applied, each with a MEASURED blast radius, plus structured escalations when
// nothing was legal. These pure helpers format that for humans. The UI never
// invents a fix — it only narrates what the engine did.

export interface AppliedChange {
  tactic: string;
  blast_radius: number;
  description: string;
}

export interface ConflictEscalation {
  reason: string;
  conflicting_constraints: string[];
}

const TACTIC_LABEL: Record<string, string> = {
  relocate: "Moved the class",
  swap: "Swapped two sessions",
  add_session: "Added a session",
};

/** Friendly verb for an applied tactic. */
export function tacticLabel(tactic: string): string {
  return TACTIC_LABEL[tactic] ?? "Adjusted the schedule";
}

/** "affects 1 block" / "affects 3 blocks" — the measured blast radius. */
export function blastLabel(radius: number): string {
  const n = Math.max(0, Math.round(radius));
  return `affects ${n} block${n === 1 ? "" : "s"}`;
}

/** One-line headline for the resolution outcome. */
export function resolutionHeadline(resolved: number, escalated: number): string {
  if (resolved === 0 && escalated === 0) return "No conflicts to resolve.";
  if (escalated === 0) return `Resolved ${resolved} conflict${resolved === 1 ? "" : "s"} with the smallest possible change.`;
  if (resolved === 0) return `${escalated} conflict${escalated === 1 ? "" : "s"} need your decision.`;
  return `Resolved ${resolved}; ${escalated} need${escalated === 1 ? "s" : ""} your decision.`;
}
