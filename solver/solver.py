"""
CP-SAT timetabling solver for GoToSpecialClass (the "provably optimal" path).

Given a normalized problem spec (classes, specialists, per-grade candidate slots,
locks, week structure), this finds the schedule that MAXIMIZES the same soft
rubric the rest of the app uses, subject to the hard constraints — and proves how
close to optimal it is. It is the heavyweight alternative to the in-app
metaheuristic, run off-platform where it can compute as long as needed.

Division of labor (important): the TypeScript app already owns the messy,
battle-tested derivation of *what to schedule* — the per-grade slot grid (hours +
recess + early-release aware), specialist working days, grade rotation, and the
PLC/lunch locks. It sends those as the spec. This solver only does the hard
combinatorial part: assign each (class, specialist) session to a (day, slot) that
is legal and minimizes the rubric penalties. Every result is ALSO re-validated by
the app against the SSOT before persisting, so this can never produce an illegal
schedule even if the model drifts.

Hard constraints modeled here:
  - a specialist teaches at most one class at any overlapping time
  - a class (teacher) is in at most one session at any overlapping time
  - each (class, specialist) pair is scheduled at most once  -> class_repeats = 0
  - a session uses only a slot valid for that grade (the app pre-filters slots for
    school hours, recess/lunch, PLC locks, specialist working days & grade rotation)
  - Big-Group sessions (pre-assigned class+specialist+slot) are fixed in place

Soft objective (mirrors src/lib/scoringConstants.ts magnitudes):
  + coverage     : place as many (class, specialist) pairs as possible (subject_gap)
  - clustering   : a (grade, subject) appearing more than once on the same weekday
  - k_late       : Kindergarten sessions starting at/after 13:00
  + full_week    : a grade having a session on every schedulable weekday
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from ortools.sat.python import cp_model

DAY_INDEX = {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4}


@dataclass
class Slot:
    day: str
    start: int  # minutes from midnight
    end: int

    @property
    def gstart(self) -> int:
        return DAY_INDEX[self.day] * 1440 + self.start

    @property
    def gend(self) -> int:
        return DAY_INDEX[self.day] * 1440 + self.end


@dataclass
class Weights:
    coverage: int = 40
    cluster: int = 15
    k_late: int = 20
    full_week: int = 100
    k_late_threshold: int = 780  # 13:00


@dataclass
class FixedSession:
    """A pre-placed session that must stay exactly as given (e.g. Big-Group)."""
    teacher_id: str
    specialist_id: str
    grade: str
    day: str
    start: int
    end: int
    week_label: Optional[str] = None


@dataclass
class Spec:
    classes: list[dict]          # {teacher_id, grade}
    specialists: list[dict]      # {id, subject, working_days, grades|None, duration}
    slots_by_grade: dict[str, list[Slot]]
    week_labels: list[Optional[str]] = field(default_factory=lambda: [None])
    fixed: list[FixedSession] = field(default_factory=list)
    weights: Weights = field(default_factory=Weights)
    time_limit_s: float = 30.0
    num_workers: int = 8


@dataclass
class PlacedBlock:
    teacher_id: str
    specialist_id: str
    subject: str
    grade: str
    day: str
    start: int
    end: int
    week_label: Optional[str]


@dataclass
class Solution:
    blocks: list[PlacedBlock]
    status: str                 # OPTIMAL | FEASIBLE | INFEASIBLE
    objective: float
    best_bound: float
    coverage_placed: int
    coverage_required: int
    wall_time_s: float


def _spec_from_dict(d: dict) -> Spec:
    w = d.get("weights", {})
    weights = Weights(
        coverage=w.get("coverage", 40),
        cluster=w.get("cluster", 15),
        k_late=w.get("k_late", 20),
        full_week=w.get("full_week", 100),
        k_late_threshold=w.get("k_late_threshold", 780),
    )
    slots = {g: [Slot(s["day"], s["start"], s["end"]) for s in lst] for g, lst in d["slots_by_grade"].items()}
    fixed = [FixedSession(**f) for f in d.get("fixed", [])]
    return Spec(
        classes=d["classes"],
        specialists=d["specialists"],
        slots_by_grade=slots,
        week_labels=d.get("week_labels") or [None],
        fixed=fixed,
        weights=weights,
        time_limit_s=d.get("time_limit_s", 30.0),
        num_workers=d.get("num_workers", 8),
    )


def solve(spec_dict: dict) -> dict:
    """Solve a problem spec (dict) -> solution (dict). Pure JSON in/out."""
    spec = _spec_from_dict(spec_dict)
    sol = _solve(spec)
    return {
        "status": sol.status,
        "objective": sol.objective,
        "best_bound": sol.best_bound,
        "coverage_placed": sol.coverage_placed,
        "coverage_required": sol.coverage_required,
        "wall_time_s": sol.wall_time_s,
        "blocks": [
            {
                "teacher_id": b.teacher_id, "specialist_id": b.specialist_id, "subject": b.subject,
                "grade": b.grade, "day": b.day, "start": b.start, "end": b.end, "week_label": b.week_label,
            }
            for b in sol.blocks
        ],
    }


def _can_teach(spec_spc: dict, grade: str) -> bool:
    grades = spec_spc.get("grades")
    return grades is None or grade in grades


def _solve(spec: Spec) -> Solution:
    model = cp_model.CpModel()
    spec_by_id = {s["id"]: s for s in spec.specialists}
    grade_by_teacher = {c["teacher_id"]: c["grade"] for c in spec.classes}

    # Candidate placements: a boolean + optional interval per (class, specialist,
    # week, slot) that is legal for that class's grade and that specialist.
    # present[(t, s, w, si)] = 1 iff teacher t sees specialist s in week w at slot si.
    present: dict[tuple, cp_model.IntVar] = {}
    spec_intervals: dict[str, list] = {s["id"]: [] for s in spec.specialists}
    teacher_intervals: dict[str, list] = {c["teacher_id"]: [] for c in spec.classes}
    # Quick lookup of placements by (teacher, specialist, week) for the "at most
    # once per pair" and coverage terms.
    pair_vars: dict[tuple, list] = {}

    for c in spec.classes:
        t = c["teacher_id"]
        grade = c["grade"]
        slots = spec.slots_by_grade.get(grade, [])
        for s in spec.specialists:
            sid = s["id"]
            if not _can_teach(s, grade):
                continue
            dur = s.get("duration") or 45
            work = set(s.get("working_days") or list(DAY_INDEX.keys()))
            for w in spec.week_labels:
                for si, slot in enumerate(slots):
                    if slot.day not in work:
                        continue
                    if slot.end - slot.start != dur:
                        # Only place a session in a slot matching the specialist's
                        # class length (the app builds slots per duration).
                        continue
                    key = (t, sid, w, si)
                    b = model.NewBoolVar(f"x_{t}_{sid}_{w}_{si}")
                    present[key] = b
                    iv = model.NewOptionalIntervalVar(slot.gstart, slot.gend - slot.gstart, slot.gend, b, f"iv_{t}_{sid}_{w}_{si}")
                    spec_intervals[sid].append(iv)
                    teacher_intervals[t].append(iv)
                    pair_vars.setdefault((t, sid, w), []).append(b)

    # Hard: no specialist / no class double-booked (interval no-overlap).
    for ivs in spec_intervals.values():
        if ivs:
            model.AddNoOverlap(ivs)
    for ivs in teacher_intervals.values():
        if ivs:
            model.AddNoOverlap(ivs)

    # Hard: each (class, specialist, week) pair scheduled at most once.
    # placed[(t,s,w)] = 1 iff that pair is scheduled (for coverage objective).
    placed: dict[tuple, cp_model.IntVar] = {}
    for key, vars_ in pair_vars.items():
        p = model.NewBoolVar(f"placed_{key[0]}_{key[1]}_{key[2]}")
        model.Add(sum(vars_) == p)  # at most one, and p reflects whether placed
        placed[key] = p

    # Fixed (Big-Group) sessions: force the matching placement on.
    for f in spec.fixed:
        grade = grade_by_teacher.get(f.teacher_id, f.grade)
        slots = spec.slots_by_grade.get(grade, [])
        for si, slot in enumerate(slots):
            if slot.day == f.day and slot.start == f.start:
                key = (f.teacher_id, f.specialist_id, f.week_label, si)
                if key in present:
                    model.Add(present[key] == 1)
                break

    # Objective MIRRORS the public rubric (src/lib/scoringConstants.ts) exactly,
    # scaled ×20 so every term is integer (CP-SAT requires integer objectives).
    # Maximizing this maximizes the displayed quality % (which is 100 − Σ|penalty|/4).
    S = 20
    obj_terms = []
    coverage_required = sum(1 for key in placed)

    # − subject_gap (40): each (grade, specialist) with ZERO sessions costs −40.
    by_grade_spec: dict[tuple, list] = {}
    for (t, sid, w, si), b in present.items():
        by_grade_spec.setdefault((grade_by_teacher[t], sid), []).append(b)
    # Every (grade, specialist) pair that COULD be covered; if it has no candidate
    # placements at all it's an unavoidable gap and contributes a constant (skipped).
    grades_set = {c["grade"] for c in spec.classes}
    for grade in grades_set:
        for s in spec.specialists:
            if not _can_teach(s, grade):
                continue
            vars_ = by_grade_spec.get((grade, s["id"]), [])
            if not vars_:
                continue
            covered = model.NewBoolVar(f"gscov_{grade}_{s['id']}")
            model.Add(sum(vars_) >= 1).OnlyEnforceIf(covered)
            model.Add(sum(vars_) == 0).OnlyEnforceIf(covered.Not())
            obj_terms.append(S * 40 * covered)  # reward coverage == penalize the gap

    # − teacher_planning (0.05/min): each class needs `planning_minutes` of its
    # students being out at specials; penalize the shortfall in minutes (×0.05×20 = ×1).
    for c in spec.classes:
        t = c["teacher_id"]
        required = int(c.get("planning_minutes") or 0)
        if required <= 0:
            continue
        terms = []
        for s in spec.specialists:
            if not _can_teach(s, grade_by_teacher[t]):
                continue
            dur = s.get("duration") or 45
            for w in spec.week_labels:
                key = (t, s["id"], w)
                if key in placed:
                    terms.append(dur * placed[key])
        got = sum(terms) if terms else 0
        short = model.NewIntVar(0, required, f"plan_short_{t}")
        model.Add(short >= required - got)
        obj_terms.append(-short)  # 0.05 (weight) × 20 (scale) = 1 per minute short

    # − clustering (15): a (grade, subject, day) appearing more than once (any week).
    cluster_groups: dict[tuple, list] = {}
    for (t, sid, w, si), b in present.items():
        grade = grade_by_teacher[t]
        subject = spec_by_id[sid]["subject"]
        slot = spec.slots_by_grade[grade][si]
        cluster_groups.setdefault((grade, subject, slot.day), []).append(b)
    for gkey, vars_ in cluster_groups.items():
        excess = model.NewIntVar(0, len(vars_), f"clx_{gkey[0]}_{gkey[1]}_{gkey[2]}")
        model.Add(excess >= sum(vars_) - 1)
        obj_terms.append(-S * spec.weights.cluster * excess)

    # − k_late (20): Kindergarten sessions starting at/after the threshold.
    k_grades = {"K", "TK"}
    for (t, sid, w, si), b in present.items():
        grade = grade_by_teacher[t]
        if grade in k_grades:
            slot = spec.slots_by_grade[grade][si]
            if slot.start >= spec.weights.k_late_threshold:
                obj_terms.append(-S * spec.weights.k_late * b)

    # + full_week (100): a grade with a session on EVERY schedulable weekday.
    schedulable_days = set()
    for s in spec.specialists:
        for d in (s.get("working_days") or list(DAY_INDEX.keys())):
            if d in DAY_INDEX:
                schedulable_days.add(d)
    grades = sorted({c["grade"] for c in spec.classes})
    for grade in grades:
        day_has: dict[str, list] = {d: [] for d in schedulable_days}
        for (t, sid, w, si), b in present.items():
            if grade_by_teacher[t] != grade:
                continue
            slot = spec.slots_by_grade[grade][si]
            if slot.day in day_has:
                day_has[slot.day].append(b)
        covered_flags = []
        for d, vars_ in day_has.items():
            cov = model.NewBoolVar(f"cov_{grade}_{d}")
            if vars_:
                model.Add(sum(vars_) >= 1).OnlyEnforceIf(cov)
                model.Add(sum(vars_) == 0).OnlyEnforceIf(cov.Not())
            else:
                model.Add(cov == 0)
            covered_flags.append(cov)
        full = model.NewBoolVar(f"full_{grade}")
        model.AddMinEquality(full, covered_flags) if covered_flags else model.Add(full == 0)
        obj_terms.append(S * spec.weights.full_week * full)

    model.Maximize(sum(obj_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = spec.time_limit_s
    solver.parameters.num_search_workers = spec.num_workers
    status = solver.Solve(model)

    status_name = {
        cp_model.OPTIMAL: "OPTIMAL", cp_model.FEASIBLE: "FEASIBLE",
        cp_model.INFEASIBLE: "INFEASIBLE", cp_model.MODEL_INVALID: "MODEL_INVALID",
        cp_model.UNKNOWN: "UNKNOWN",
    }.get(status, str(status))

    blocks: list[PlacedBlock] = []
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        for (t, sid, w, si), b in present.items():
            if solver.Value(b) == 1:
                grade = grade_by_teacher[t]
                slot = spec.slots_by_grade[grade][si]
                blocks.append(PlacedBlock(
                    teacher_id=t, specialist_id=sid, subject=spec_by_id[sid]["subject"],
                    grade=grade, day=slot.day, start=slot.start, end=slot.end, week_label=w,
                ))

    return Solution(
        blocks=blocks,
        status=status_name,
        objective=solver.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0.0,
        best_bound=solver.BestObjectiveBound() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0.0,
        coverage_placed=sum(1 for b in blocks),
        coverage_required=coverage_required,
        wall_time_s=solver.WallTime(),
    )


if __name__ == "__main__":
    import json
    import sys
    spec = json.load(sys.stdin)
    print(json.dumps(solve(spec)))
