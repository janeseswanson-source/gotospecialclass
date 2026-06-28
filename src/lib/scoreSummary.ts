// Human-readable schedule quality (powers 1 & 2).
//
// Turns the optimizer's pre-weighted `score_breakdown` into a plain-language
// "what's working / what it cost" summary, and the engine's `quality_confidence`
// signal into a calm headline an administrator understands at a glance. This is
// DISPLAY ONLY — it never changes the rubric. The headline % still comes from the
// shared rubric via `breakdownToPercent`; we only add meaning around it.
//
// Counts are derived from breakdown ÷ the term's default weight. These weights
// mirror `supabase/functions/generate-schedule/_scoring.ts::DEFAULT_WEIGHTS` for
// display; if a school has learned weights the counts are approximate, which is
// fine for a human summary (the headline % stays exact via the rubric).

import { breakdownToPercent } from "./optimizerScore";

type Breakdown = Record<string, number> | null | undefined;

/** Reward terms — their presence is a good thing to celebrate. */
const REWARDS: Array<{ key: string; weight: number; label: (n: number) => string }> = [
  { key: "full_week_coverage", weight: 100, label: (n) => `${n} grade${n === 1 ? " has" : "s have"} specials every day` },
  { key: "planning_target_met", weight: 30, label: (n) => `${n} specialist${n === 1 ? " hits" : "s hit"} their planning target` },
  { key: "day_pref_satisfied", weight: 20, label: (n) => `${n} teacher${n === 1 ? " got" : "s got"} their preferred day` },
  { key: "am_pm_satisfied", weight: 10, label: (n) => `${n} teacher${n === 1 ? " got" : "s got"} their AM/PM preference` },
];

/** Penalty terms — when zero they're a "working" win; when active they're a cost. */
const PENALTIES: Array<{
  key: string;
  weight: number;
  /** Shown under "what's working" when this term is zero (null = don't show). */
  good: string | null;
  /** Shown under "what it cost" when active; n = derived count/magnitude. */
  cost: (n: number) => string;
  /** Treat as active when |value| exceeds this (defaults to 0). */
  threshold?: number;
  /** A soft "balance" term reported qualitatively, not by count. */
  qualitative?: boolean;
}> = [
  { key: "subject_gap", weight: -40, good: "Every grade sees every specialist", cost: (n) => `${n} grade–specialist pairing${n === 1 ? "" : "s"} never happen${n === 1 ? "s" : ""} this week` },
  { key: "subject_day_clustering", weight: -15, good: "Subjects are well spread across the week", cost: (n) => `${n} subject${n === 1 ? "" : "s"} double up on the same day` },
  { key: "class_repeats", weight: -25, good: "No class repeats a specialist", cost: (n) => `${n} class${n === 1 ? "" : "es"} see${n === 1 ? "s" : ""} the same specialist twice` },
  { key: "k_grade_after_780", weight: -20, good: "No Kindergarten classes run late in the day", cost: (n) => `${n} Kindergarten class${n === 1 ? "" : "es"} scheduled after 1:00pm` },
  { key: "cart_back_to_back", weight: -5, good: "No rushed back-to-back cart moves", cost: (n) => `${n} cart move${n === 1 ? "" : "s"} ${n === 1 ? "is" : "are"} back-to-back across rooms` },
  { key: "grade_cohesion", weight: -4, good: "Each grade's specials stay tight in the week", cost: (n) => `${n} grade-day${n === 1 ? "" : "s"} could be grouped better` },
  { key: "teacher_planning", weight: -0.05, good: "Every teacher's planning time is covered", cost: (n) => `about ${n} teacher planning minute${n === 1 ? "" : "s"} short` },
  { key: "contract_min", weight: -0.05, good: "Contractual minutes are met", cost: (n) => `about ${n} contractual minute${n === 1 ? "" : "s"} short` },
  { key: "spec_dayload_stdev", weight: -1, good: "Specialist days are evenly balanced", cost: () => "Specialist day-loads are a little uneven", threshold: 0.5, qualitative: true },
  { key: "warnings", weight: -50, good: null, cost: (n) => `${n} scheduling warning${n === 1 ? "" : "s"}` },
];

export interface ScoreCost {
  label: string;
  /** Penalty magnitude (for sorting / emphasis), already absolute. */
  magnitude: number;
}

export interface ScoreSummary {
  /** Headline quality %, or null when unknown (UI shows "—"). */
  percent: number | null;
  /** Positive, plain-language wins ("Every grade has specials daily ✓"). */
  working: string[];
  /** Active costs, worst first ("2 teachers didn't get their preferred prep"). */
  costs: ScoreCost[];
  /** Count of hard errors (blocking) if any are encoded in the breakdown. */
  errorCount: number;
}

const magnitude = (v: number) => Math.abs(v);

/** Build the human summary from a pre-weighted breakdown. Pure. */
export function scoreSummary(breakdown: Breakdown): ScoreSummary {
  const b = breakdown && typeof breakdown === "object" ? breakdown : {};
  const percent = breakdownToPercent(breakdown);
  const working: string[] = [];
  const costs: ScoreCost[] = [];

  for (const r of REWARDS) {
    const v = b[r.key];
    if (typeof v === "number" && v > 0) {
      const n = Math.round(v / r.weight);
      if (n > 0) working.push(r.label(n));
    }
  }

  for (const p of PENALTIES) {
    const v = b[p.key];
    const mag = typeof v === "number" && Number.isFinite(v) ? magnitude(v) : 0;
    const active = mag > (p.threshold ?? 0);
    if (active) {
      const n = p.qualitative ? 0 : Math.max(1, Math.round(mag / magnitude(p.weight)));
      costs.push({ label: p.cost(n), magnitude: mag });
    } else if (p.good) {
      working.push(p.good);
    }
  }

  costs.sort((a, c) => c.magnitude - a.magnitude);

  const errVal = b["errors"];
  const errorCount = typeof errVal === "number" ? Math.round(magnitude(errVal) / 1000) : 0;

  return { percent, working, costs, errorCount };
}

// ─── Confidence signal (power 1) ─────────────────────────────────────────────

export type ConfidenceTone = "good" | "info" | "warn";

export interface ConfidenceCopy {
  tone: ConfidenceTone;
  headline: string;
  detail: string;
  assessment: "near_optimal" | "more_headroom" | "structurally_limited" | "unknown";
}

export interface QualityConfidence {
  assessment?: string;
  recommendation?: string;
  gapQualityPoints?: number;
  headroom?: { forcedSubjectGaps?: number; sessionCapacity?: number; requiredPairs?: number };
  convergence?: { stillImproving?: boolean };
}

const HEADLINES: Record<string, { tone: ConfidenceTone; headline: string; fallback: string }> = {
  near_optimal: { tone: "good", headline: "Near-optimal", fallback: "There's very little room to improve this schedule." },
  more_headroom: { tone: "info", headline: "Room to improve", fallback: "Another refinement pass could nudge this higher." },
  structurally_limited: { tone: "warn", headline: "Capacity-limited", fallback: "Your specialist capacity caps how good this can get — add a specialist or a working day." },
};

/** Turn the engine's confidence signal into a calm, plain-language headline. */
export function confidenceCopy(confidence: QualityConfidence | null | undefined): ConfidenceCopy {
  const assessment = confidence?.assessment ?? "";
  const meta = HEADLINES[assessment];
  if (!meta) {
    return { tone: "info", headline: "Quality summary", detail: "", assessment: "unknown" };
  }
  const detail = (confidence?.recommendation && confidence.recommendation.trim()) || meta.fallback;
  return { tone: meta.tone, headline: meta.headline, detail, assessment: assessment as ConfidenceCopy["assessment"] };
}
