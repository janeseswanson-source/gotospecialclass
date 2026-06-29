// Phase 1c — quality-confidence signal.
//
// Metaheuristic search (MC + SA + LNS) cannot PROVE optimality, but it can report
// how confident we should be that the result is near-best. Two cheap signals:
//
//   1. Convergence — did the best score PLATEAU within the budget, or was it
//      still improving when the budget ran out? (From refinement telemetry.)
//   2. Headroom — a relaxation lower bound on how much soft penalty is
//      STRUCTURALLY UNAVOIDABLE given capacity (specialist session-capacity vs.
//      the (grade × specialist) coverage demand). Subtracting that floor from the
//      current penalty bounds the remaining optimality gap from above.
//
// The result lets the UI say "near-optimal" vs. "more headroom — consider another
// refinement pass" vs. "structurally limited — add capacity", honestly and
// cheaply. It is NOT part of the public quality-% rubric and does not touch it.

import { timeToMinutes, getEndMinForDay } from "../../_shared/constraints.ts";
import { penaltyMagnitude } from "../../_shared/scoring-rubric.ts";
import { DEFAULT_WEIGHTS } from "./_scoring.ts";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** Within this many rubric quality-points of the relaxation lower bound, we
 *  call the schedule near-optimal (the remaining gap is provably ≤ this). */
const NEAR_OPTIMAL_POINTS = 2;

/** Fraction of the refinement budget that must pass with no improvement before
 *  we consider the search converged (plateaued). */
const PLATEAU_FRACTION = 0.3;

export interface ConvergenceInput {
  /** Total refinement rounds/iterations actually run. */
  rounds: number;
  /** 0-based index of the last improvement, or -1 if never improved. */
  lastImprovementRound: number;
}

export interface Convergence {
  converged: boolean;
  stillImproving: boolean;
  roundsSinceImprovement: number;
  totalRounds: number;
}

export function computeConvergence(t: ConvergenceInput): Convergence {
  const totalRounds = Math.max(0, t.rounds);
  if (totalRounds === 0) {
    return { converged: true, stillImproving: false, roundsSinceImprovement: 0, totalRounds };
  }
  // Never improved ⇒ the initial schedule was already best for this operator set
  // ⇒ treat as converged (no remaining momentum).
  const roundsSinceImprovement = t.lastImprovementRound < 0
    ? totalRounds
    : totalRounds - 1 - t.lastImprovementRound;
  const stillImproving = roundsSinceImprovement < Math.ceil(totalRounds * PLATEAU_FRACTION);
  return { converged: !stillImproving, stillImproving, roundsSinceImprovement, totalRounds };
}

export interface HeadroomInput {
  specialists: Array<{ working_days?: string[] | null; class_duration?: number | null }>;
  gradeCount: number;
  specialistCount: number;
  school: { start_time?: string; end_time?: string; early_release_day?: string; early_release_end_time?: string; class_duration?: number | null; passing_time?: number | null };
}

export interface Headroom {
  /** Sessions a week the specialists can collectively teach. */
  sessionCapacity: number;
  /** (grade × specialist) pairs that must each get ≥1 session for full coverage. */
  requiredPairs: number;
  /** capacity / requiredPairs (>= 1 ⇒ full coverage is structurally possible). */
  capacityRatio: number;
  /** (grade × specialist) pairs that CANNOT be covered for lack of capacity. */
  forcedSubjectGaps: number;
  /** Lower bound on unavoidable soft-penalty magnitude (score units). */
  unavoidablePenaltyLB: number;
}

/** Session capacity — mirrors the feasibility precheck in generateScheduleBlocks
 *  (per-specialist class_duration aware), so the headroom estimate agrees with
 *  the generator's own capacity_shortfall logic. */
export function estimateHeadroom(input: HeadroomInput): Headroom {
  const { specialists, gradeCount, specialistCount, school } = input;
  const feasStartMin = timeToMinutes(school.start_time ?? "08:00") ?? 8 * 60;
  const schoolPeriodLen = (school.class_duration && school.class_duration > 0) ? school.class_duration : 45;
  const feasPassing = school.passing_time ?? 5;
  let sessionCapacity = 0;
  for (const s of specialists) {
    const specPeriodLen = (((s.class_duration && s.class_duration > 0) ? s.class_duration : schoolPeriodLen) || 45) + feasPassing;
    for (const d of (s.working_days ?? DAYS)) {
      if (!DAYS.includes(d)) continue;
      const endMin = getEndMinForDay(d, school);
      sessionCapacity += Math.max(0, Math.floor((endMin - feasStartMin) / Math.max(1, specPeriodLen)));
    }
  }
  const requiredPairs = Math.max(0, gradeCount * specialistCount);
  const forcedSubjectGaps = Math.max(0, requiredPairs - sessionCapacity);
  const unavoidablePenaltyLB = forcedSubjectGaps * Math.abs(DEFAULT_WEIGHTS.subject_gap);
  const capacityRatio = requiredPairs > 0 ? sessionCapacity / requiredPairs : Infinity;
  return { sessionCapacity, requiredPairs, capacityRatio, forcedSubjectGaps, unavoidablePenaltyLB };
}

export type Assessment = "near_optimal" | "more_headroom" | "structurally_limited";

export interface QualityConfidence {
  assessment: Assessment;
  recommendation: string;
  convergence: Convergence;
  headroom: Headroom;
  /** Actual soft-penalty magnitude of the result (rubric units). */
  currentPenalty: number;
  /** Upper bound on penalty still removable = max(0, current − unavoidable LB). */
  optimalityGapUB: number;
  /** The above expressed in public quality-% points (rubric divides by 4). */
  gapQualityPoints: number;
}

export interface QualityConfidenceInput {
  /** Pre-weighted score_breakdown (same object the rubric reads). */
  breakdown: Record<string, number> | null | undefined;
  specialists: Array<{ working_days?: string[] | null; class_duration?: number | null }>;
  gradeCount: number;
  school: HeadroomInput["school"];
  refinement: ConvergenceInput;
}

export function computeQualityConfidence(input: QualityConfidenceInput): QualityConfidence {
  const convergence = computeConvergence(input.refinement);
  const headroom = estimateHeadroom({
    specialists: input.specialists,
    gradeCount: input.gradeCount,
    specialistCount: input.specialists.length,
    school: input.school,
  });
  const currentPenalty = penaltyMagnitude(input.breakdown);
  const optimalityGapUB = Math.max(0, currentPenalty - headroom.unavoidablePenaltyLB);
  const gapQualityPoints = optimalityGapUB / 4;

  let assessment: Assessment;
  let recommendation: string;
  if (headroom.forcedSubjectGaps > 0) {
    assessment = "structurally_limited";
    recommendation = `Capacity covers only ${headroom.sessionCapacity} of ${headroom.requiredPairs} grade×specialist pairs; ` +
      `at least ${headroom.forcedSubjectGaps} cannot be scheduled. Add a specialist, expand working days, or enable A/B Week.`;
  } else if (convergence.stillImproving) {
    assessment = "more_headroom";
    recommendation = "The score was still improving when the budget ran out — another refinement pass is likely to help.";
  } else if (gapQualityPoints <= NEAR_OPTIMAL_POINTS) {
    assessment = "near_optimal";
    recommendation = `Converged within ~${gapQualityPoints.toFixed(1)} quality points of the structural bound — this is near-optimal.`;
  } else {
    assessment = "more_headroom";
    recommendation = `Converged, but ~${gapQualityPoints.toFixed(1)} quality points of soft penalty may still be removable — another refinement pass could help.`;
  }

  return { assessment, recommendation, convergence, headroom, currentPenalty, optimalityGapUB, gapQualityPoints };
}
