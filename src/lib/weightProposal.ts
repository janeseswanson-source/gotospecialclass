// Learnable-weights proposal copy (power 7).
//
// The engine stages a clamped weight nudge in scoring_weight_profiles.proposed_weights
// (a new weights map). This derives the plain-language deltas vs. the active
// weights for display — mirroring the backend's labels/direction in
// _weightlearning.ts. DISPLAY ONLY; applying still goes through the engine's
// confirm path (update-scoring-weights). Nothing here changes weights.

/** Mirrors _scoring.ts DEFAULT_WEIGHTS (magnitudes only matter for display). */
const DEFAULTS: Record<string, number> = {
  errors: -1000, warnings: -50, full_week_coverage: 100, am_pm_satisfied: 10,
  day_pref_satisfied: 20, planning_target_met: 30, cart_back_to_back: -5,
  k_grade_after_780: -20, spec_dayload_stdev: -1, class_repeats: -25,
  grade_cohesion: -4, contract_min: -0.05, subject_gap: -40,
  subject_day_clustering: -15, teacher_planning: -0.05,
};

/** Plain-language term names, matching _weightlearning.ts. */
const LABEL: Record<string, string> = {
  subject_gap: "even subject coverage",
  subject_day_clustering: "spreading subjects across the week",
  class_repeats: "variety of specialists per class",
  k_grade_after_780: "keeping Kindergarten earlier in the day",
  cart_back_to_back: "avoiding rushed cart moves",
  grade_cohesion: "keeping each grade's specials grouped",
  contract_min: "meeting contractual minutes",
  teacher_planning: "covering teacher planning time",
  spec_dayload_stdev: "balancing specialist day-loads",
  full_week_coverage: "specials every day for every grade",
  am_pm_satisfied: "AM/PM teacher preferences",
  day_pref_satisfied: "teacher day preferences",
  planning_target_met: "specialist planning targets",
};

const NON_LEARNABLE = new Set(["errors", "warnings"]);
const EPS = 1e-6;

export interface WeightDeltaCopy {
  key: string;
  label: string;
  direction: "more" | "less";
  reason: string;
}

/** Derive human deltas between the active weights and a staged proposal. */
export function describeWeightProposal(
  active: Record<string, number> | null | undefined,
  proposed: Record<string, number> | null | undefined,
): WeightDeltaCopy[] {
  if (!proposed || typeof proposed !== "object") return [];
  const a = active && typeof active === "object" ? active : {};
  const out: WeightDeltaCopy[] = [];
  for (const key of Object.keys(proposed)) {
    if (NON_LEARNABLE.has(key)) continue;
    const cur = typeof a[key] === "number" ? a[key] : (DEFAULTS[key] ?? 0);
    const next = proposed[key];
    if (typeof next !== "number" || Math.abs(next - cur) < EPS) continue;
    const more = Math.abs(next) > Math.abs(cur);
    const label = LABEL[key] ?? key;
    out.push({
      key,
      label,
      direction: more ? "more" : "less",
      reason: more
        ? `Lean toward ${label} in future schedules.`
        : `Relax ${label} in future schedules.`,
    });
  }
  // Stable, most-meaningful-first ordering by relative change magnitude.
  out.sort((x, y) => labelRank(x.key) - labelRank(y.key));
  return out;
}

function labelRank(key: string): number {
  const order = ["subject_gap", "subject_day_clustering", "class_repeats", "full_week_coverage", "k_grade_after_780", "day_pref_satisfied", "am_pm_satisfied", "teacher_planning", "contract_min", "planning_target_met", "grade_cohesion", "cart_back_to_back", "spec_dayload_stdev"];
  const i = order.indexOf(key);
  return i < 0 ? 999 : i;
}

/** One-line headline for the proposal card. */
export function weightProposalHeadline(deltas: WeightDeltaCopy[]): string {
  if (deltas.length === 0) return "";
  const lead = deltas[0];
  if (deltas.length === 1) {
    return lead.direction === "more"
      ? `Want future schedules to favor ${lead.label}?`
      : `Want future schedules to relax ${lead.label}?`;
  }
  return `Your edits suggest ${deltas.length} tweaks to future schedules — review them?`;
}
