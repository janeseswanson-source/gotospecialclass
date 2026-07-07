"""CP-SAT timetabling solver for GoToSpecialClass (the "provably optimal" path).

Given a normalized problem spec (classes, specialists, per-grade candidate slots,
locks, week structure), this finds the schedule that MAXIMIZES the same soft
rubric the rest of the app uses, subject to the hard constraints — and proves how
close to optimal it is. It is the heavyweight alternative to the in-app
metaheuristic, run off-platform where it can compute as long as needed.

Division of labor (important): the TypeScript app already owns the messy,
battle-tested derivation of *what to schedule* — the per-grade slot grid (hours +
recess + early-release aware, PER DURATION for quick-30 mixed classes), specialist
working days, grade rotation, the PLC/lunch locks, and which classes are taught
together (Big-Group). It sends those as the spec. This solver only does the hard
combinatorial part: assign each (class, specialist) session to a (day, slot) that
is legal and maximizes the rubric. Every result is ALSO re-validated by the app
against the SSOT before persisting, so this can never produce an illegal schedule
even if the model drifts.

Hard constraints modeled here:
  - a specialist teaches at most one class at any overlapping time
  - a class (teacher) is in at most one session at any overlapping time
  - each (class, specialist) pair is scheduled at most `sessions_per_pair` times
    (default 1  -> class_repeats = 0; extra_rotation raises it, see below)
  - an optional HARD floor of `min_sessions_per_pair` per placeable pair (the app
    sends 1 to demand full coverage; if that is INFEASIBLE the caller re-solves
    without the floor and flags coverage_relaxed=True)
  - a session uses only a slot valid for that grade AND that specialist's class
    duration (the app pre-filters slots for school hours, recess/lunch, PLC locks,
    specialist working days & grade rotation, per duration)
  - Big-Group sessions (pre-assigned class+specialist+slot, tagged with a shared
    group_id) are fixed in place; every member sharing a group_id counts as ONE
    specialist interval (the specialist teaches the combined class once) plus one
    interval per member teacher

Soft objective — MIRRORS the full public rubric (src/lib/scoringConstants.ts /
supabase/functions/generate-schedule/_scoring.ts), every term spec-weighted so the
school's learned weights drive it, scaled ×20 so all coefficients are integer:
  + coverage / subject_gap : place each (grade, specialist) pair
  + placement              : place each (class, specialist) pair (finer coverage)
  + extra_session          : a smaller reward for a pair's 2nd+ session
  - teacher_planning        : minutes a class is short of its planning target
  - subject_day_clustering  : a (grade, subject) appearing >1× on one weekday
  - k_grade_after_780       : Kindergarten sessions starting at/after 13:00
  + full_week_coverage      : a grade with a session on every schedulable weekday
  - grade_cohesion          : days a grade spans beyond ceil(sessions / 2)
  - grade_day_spread        : distinct grades a specialist teaches per day beyond 1
  - contract_min            : minutes short of a contractual (grade, subject) min
  - cart_back_to_back       : a cart specialist teaching back-to-back sessions
  - spec_dayload_stdev      : per-specialist day-load imbalance (MAD linearization)
  + am_pm_satisfied         : a teacher whose sessions all honor an AM/PM preference
  + day_pref_satisfied      : a teacher whose sessions all fall on a preferred day
  + planning_target_met     : a specialist left enough free time for their planning

Multi-week (A/B and AA/BB): each week label gets its own disjoint slice of the
global timeline (WEEK_SPAN offset), so Mon 9:00 in week A does NOT clash with Mon
9:00 in week B, and one (class, specialist) session spread across the weeks halves
weekly load. AA/BB is solved EXACTLY like A/B here — a two-timeline solve with the
opaque labels the app supplies ("AA"/"BB"). The "two consecutive calendar weeks"
cadence of AA/BB is a CALENDAR-MAPPING concern (which real dates each rotation week
lands on), handled by the app's week-date module — NOT a solver constraint. So the
solver never needs a bespoke AA/BB code path.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from ortools.sat.python import cp_model

DAY_INDEX = {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4}
DAYS = list(DAY_INDEX.keys())
WEEK_SPAN = 7 * 1440  # a full week of minutes — keeps per-week timelines disjoint
K_GRADES = {"K", "TK"}
SCALE = 20  # integer objective scale; teacher_planning/contract 0.05 × 20 = 1/min


@dataclass
class Slot:
    day: str
    start: int  # minutes from midnight
    end: int

    def gstart(self, woff: int = 0) -> int:
        return DAY_INDEX[self.day] * 1440 + self.start + woff

    def gend(self, woff: int = 0) -> int:
        return DAY_INDEX[self.day] * 1440 + self.end + woff


@dataclass
class Weights:
    # Magnitudes only (always positive); the app may send signed rubric weights and
    # we abs() them on ingest. Defaults mirror _scoring.ts DEFAULT_WEIGHTS.
    subject_gap: float = 40      # per (grade, specialist) pair covered
    placement: float = 20        # per (class, specialist) pair placed (finer)
    extra_session: float = 6     # per 2nd+ session of a pair (extra_rotation);
    #                              MUST stay < placement so a pair's extra session
    #                              never outranks giving an uncovered class its first
    cluster: float = 15          # subject_day_clustering
    k_late: float = 20           # k_grade_after_780
    full_week: float = 100       # full_week_coverage
    cart: float = 5              # cart_back_to_back
    grade_cohesion: float = 4
    # Distinct grades a specialist teaches per day beyond 1. MUST exceed cluster
    # (15): a day with N sessions across d grades costs cluster·(N−d) +
    # spread·(d−1), so any spread < cluster makes MORE grades per day cheaper.
    grade_day_spread: float = 20
    contract_min: float = 0.05
    dayload: float = 1           # spec_dayload_stdev (MAD proxy)
    teacher_planning: float = 0.05
    am_pm: float = 10            # am_pm_satisfied
    day_pref: float = 20         # day_pref_satisfied
    planning_target: float = 30  # planning_target_met
    k_late_threshold: int = 780  # 13:00

    def coef(self, name: str) -> int:
        """Integer objective coefficient for a term (weight × SCALE, rounded)."""
        return int(round(getattr(self, name) * SCALE))


@dataclass
class FixedSession:
    """A pre-placed session that must stay exactly as given (e.g. Big-Group).

    `group_id` ties the members of a taught-together Big-Group: every member with
    the same group_id is the SAME specialist teaching the combined class once, so
    they contribute one specialist interval (not one per member) and one interval
    per member teacher. Two same-slot same-specialist fixed sessions WITHOUT a
    shared group_id are a genuine double-book and stay INFEASIBLE.
    """
    teacher_id: str
    specialist_id: str
    grade: str
    day: str
    start: int
    end: int
    week_label: Optional[str] = None
    group_id: Optional[str] = None


@dataclass
class Spec:
    classes: list[dict]          # {teacher_id, grade, planning_minutes?, am_pm_preference?, day_preference?}
    specialists: list[dict]      # {id, subject, working_days, grades|None, duration, grade_rotation?, uses_cart?, planning_free_budget?, required_planning_minutes?}
    slots_by_grade: dict[str, list[Slot]]
    # Duration-aware grid: {grade: {duration_minutes: [Slot, ...]}}. Preferred over
    # slots_by_grade when present; lets a 30-min K specialist and a 45-min PE
    # specialist share a grade without a silent hole. A specialist whose class
    # duration has no list here for a grade it can teach is a SPEC ERROR.
    slots_by_grade_duration: dict[str, dict[int, list[Slot]]] = field(default_factory=dict)
    week_labels: list[Optional[str]] = field(default_factory=lambda: [None])
    fixed: list[FixedSession] = field(default_factory=list)
    busy: list[dict] = field(default_factory=list)  # {specialist_id?, teacher_id?, day, start, end}
    contract_subjects: list[dict] = field(default_factory=list)  # {grade, subject, weekly_minutes}
    sessions_per_pair: int = 1   # max sessions of one (class, specialist) pair
    min_sessions_per_pair: int = 0  # HARD floor per placeable pair (0 = off)
    keep_grades_together: bool = True
    # quick_30: {grade: minutes} — sessions for these grades run at this length
    # regardless of the specialist's own duration (see pair_duration).
    grade_duration_overrides: dict[str, int] = field(default_factory=dict)
    cart_buffer: int = 15        # a cart move within this many minutes = back-to-back
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
    status: str                 # OPTIMAL | FEASIBLE | INFEASIBLE | MODEL_INVALID | UNKNOWN
    objective: float
    best_bound: float
    coverage_placed: int
    coverage_required: int
    wall_time_s: float
    coverage_relaxed: bool = False
    message: str = ""


def _parse_slots(lst: list) -> list[Slot]:
    return [Slot(s["day"], int(s["start"]), int(s["end"])) for s in lst]


def pair_duration(spec: "Spec", s: dict, grade: str) -> int:
    """Session length for a (class-in-grade, specialist) pair: the grade's
    quick_30 override wins, else the specialist's own duration, else 45."""
    return int(spec.grade_duration_overrides.get(grade) or s.get("duration") or 45)


def _spec_from_dict(d: dict) -> Spec:
    w = d.get("weights", {}) or {}

    def wv(*keys, default):
        for k in keys:
            if k in w and w[k] is not None:
                return abs(float(w[k]))  # magnitude — app may send signed weights
        return default

    weights = Weights(
        subject_gap=wv("subject_gap", "coverage", default=40),
        placement=wv("placement", default=20),
        extra_session=wv("extra_session", default=6),  # < placement (see Weights)
        cluster=wv("subject_day_clustering", "cluster", default=15),
        k_late=wv("k_grade_after_780", "k_late", default=20),
        full_week=wv("full_week_coverage", "full_week", default=100),
        cart=wv("cart_back_to_back", "cart", default=5),
        grade_cohesion=wv("grade_cohesion", default=4),
        grade_day_spread=wv("grade_day_spread", default=20),
        contract_min=wv("contract_min", default=0.05),
        dayload=wv("spec_dayload_stdev", "dayload", default=1),
        teacher_planning=wv("teacher_planning", default=0.05),
        am_pm=wv("am_pm_satisfied", "am_pm", default=10),
        day_pref=wv("day_pref_satisfied", "day_pref", default=20),
        planning_target=wv("planning_target_met", "planning_target", default=30),
        # threshold is not a magnitude — read raw
        k_late_threshold=int(w.get("k_late_threshold") or 780),
    )

    slots = {g: _parse_slots(lst) for g, lst in d.get("slots_by_grade", {}).items()}
    sbgd_raw = d.get("slots_by_grade_duration", {}) or {}
    slots_by_grade_duration: dict[str, dict[int, list[Slot]]] = {}
    for g, by_dur in sbgd_raw.items():
        slots_by_grade_duration[g] = {int(dur): _parse_slots(lst) for dur, lst in by_dur.items()}

    fixed = [FixedSession(**f) for f in d.get("fixed", [])]
    return Spec(
        classes=d["classes"],
        specialists=d["specialists"],
        slots_by_grade=slots,
        slots_by_grade_duration=slots_by_grade_duration,
        week_labels=d.get("week_labels") or [None],
        fixed=fixed,
        busy=d.get("busy", []),
        contract_subjects=d.get("contract_subjects", []) or [],
        sessions_per_pair=int(d.get("sessions_per_pair", 1) or 1),
        min_sessions_per_pair=int(d.get("min_sessions_per_pair", 0) or 0),
        keep_grades_together=bool(d.get("keep_grades_together", True)),
        grade_duration_overrides={str(g): int(v) for g, v in (d.get("grade_duration_overrides") or {}).items() if int(v or 0) > 0},
        cart_buffer=int(d.get("cart_buffer", 15) or 15),
        weights=weights,
        time_limit_s=float(d.get("time_limit_s", 30.0)),
        num_workers=int(d.get("num_workers", 8)),
    )


def solve(spec_dict: dict) -> dict:
    """Solve a problem spec (dict) -> solution (dict). Pure JSON in/out.

    Enforces the min_sessions_per_pair coverage floor first; if that is INFEASIBLE
    (a genuine capacity wall) it re-solves without the floor and reports
    coverage_relaxed=True so the app can surface an honest ceiling.
    """
    spec = _spec_from_dict(spec_dict)
    sol = _solve(spec, enforce_floor=True)
    coverage_relaxed = False
    if sol.status == "INFEASIBLE" and spec.min_sessions_per_pair >= 1:
        sol = _solve(spec, enforce_floor=False)
        coverage_relaxed = True
    return {
        "status": sol.status,
        "message": sol.message,
        "objective": sol.objective,
        "best_bound": sol.best_bound,
        "coverage_placed": sol.coverage_placed,
        "coverage_required": sol.coverage_required,
        "coverage_relaxed": coverage_relaxed,
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


def _rotation_ok(rotation: Optional[dict], day: str, grade: str) -> bool:
    """Mirror canSpecialistTeachGradeOnDay: a per-day grade_rotation restricts which
    grades a specialist may teach that day; an empty/absent list = no restriction."""
    if not rotation:
        return True
    allowed = rotation.get(day)
    if not allowed:
        return True
    return grade in allowed


def _merge(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    out: list[list[int]] = []
    for s, e in sorted(spans):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(s, e) for s, e in out]


def _half(start: int) -> str:
    return "AM" if start < 720 else "PM"


def _solve(spec: Spec, enforce_floor: bool = True) -> Solution:
    model = cp_model.CpModel()
    spec_by_id = {s["id"]: s for s in spec.specialists}
    grade_by_teacher = {c["teacher_id"]: c["grade"] for c in spec.classes}
    W = spec.weights
    strict_slots = bool(spec.slots_by_grade_duration)
    week_idx = {w: i for i, w in enumerate(spec.week_labels)}
    n_weeks = len(spec.week_labels)

    schedulable_days = [d for d in DAYS if any(
        d in set(s.get("working_days") or DAYS) for s in spec.specialists)]
    if not schedulable_days:
        schedulable_days = list(DAYS)
    ndays = len(schedulable_days)

    grades_set = {c["grade"] for c in spec.classes}
    spec_errors: list[str] = []

    def slots_for(grade: str, duration: int) -> Optional[list[Slot]]:
        """Slot list for a (grade, duration). None = no list exists (spec hole in
        strict mode; a silent no-op in legacy mode)."""
        if strict_slots:
            by_dur = spec.slots_by_grade_duration.get(grade)
            if by_dur is None:
                return None
            return by_dur.get(duration)
        base = spec.slots_by_grade.get(grade)
        if base is None:
            return None
        # Legacy: filter the single grid to slots matching this duration.
        return [sl for sl in base if (sl.end - sl.start) == duration]

    # ── Big-Group / fixed grouping ──────────────────────────────────────
    # Members sharing a group_id => one specialist interval (lead only) + a teacher
    # interval each. Ungrouped fixed sessions each become their own singleton group.
    forced: set[tuple] = set()      # (t, sid, week, day, start) that must be present
    nonlead: set[tuple] = set()     # group members that DON'T add a specialist interval
    groups: dict[str, list[FixedSession]] = {}
    singleton = 0
    for f in spec.fixed:
        gid = f.group_id
        if gid is None:
            gid = f"__single_{singleton}"
            singleton += 1
        groups.setdefault(gid, []).append(f)
    for gid, members in groups.items():
        for i, f in enumerate(members):
            forced.add((f.teacher_id, f.specialist_id, f.week_label, f.day, f.start))
            if i > 0:
                nonlead.add((f.teacher_id, f.specialist_id, f.week_label, f.day, f.start))

    # ── Candidate placements ────────────────────────────────────────────
    present: dict[tuple, cp_model.IntVar] = {}
    key_slot: dict[tuple, Slot] = {}
    key_grade: dict[tuple, str] = {}
    present_index: dict[tuple, tuple] = {}  # (t, sid, week, day, start) -> key
    spec_intervals: dict[str, list] = {s["id"]: [] for s in spec.specialists}
    teacher_intervals: dict[str, list] = {c["teacher_id"]: [] for c in spec.classes}
    pair_vars: dict[tuple, list] = {}
    pair_day_vars: dict[tuple, list] = {}

    for c in spec.classes:
        t = c["teacher_id"]
        grade = c["grade"]
        for s in spec.specialists:
            sid = s["id"]
            if not _can_teach(s, grade):
                continue
            dur = pair_duration(spec, s, grade)
            work = set(s.get("working_days") or DAYS)
            rotation = s.get("grade_rotation")
            slist = slots_for(grade, dur)
            if slist is None:
                if strict_slots:
                    spec_errors.append(
                        f"specialist '{sid}' ({s.get('subject', '?')}) teaches grade {grade} in "
                        f"{dur}-min classes but no {dur}-min slot grid was provided for grade {grade}")
                continue
            for w in spec.week_labels:
                woff = week_idx[w] * WEEK_SPAN
                for si, slot in enumerate(slist):
                    if slot.day not in work:
                        continue
                    if not _rotation_ok(rotation, slot.day, grade):
                        continue
                    key = (t, sid, w, si)
                    b = model.NewBoolVar(f"x_{t}_{sid}_{w}_{si}")
                    present[key] = b
                    key_slot[key] = slot
                    key_grade[key] = grade
                    present_index[(t, sid, w, slot.day, slot.start)] = key
                    size = slot.end - slot.start
                    teacher_intervals[t].append(
                        model.NewOptionalIntervalVar(slot.gstart(woff), size, slot.gend(woff), b, f"ivt_{t}_{sid}_{w}_{si}"))
                    if (t, sid, w, slot.day, slot.start) not in nonlead:
                        spec_intervals[sid].append(
                            model.NewOptionalIntervalVar(slot.gstart(woff), size, slot.gend(woff), b, f"ivs_{t}_{sid}_{w}_{si}"))
                    pair_vars.setdefault((t, sid), []).append(b)
                    pair_day_vars.setdefault((t, sid, slot.day), []).append(b)

    # Force the fixed (Big-Group) placements; a fixed session with no legal
    # candidate is a hard spec error (never a silent drop).
    for (t, sid, w, day, start) in forced:
        key = present_index.get((t, sid, w, day, start))
        if key is None:
            spec_errors.append(
                f"fixed/Big-Group session (teacher '{t}', specialist '{sid}', {day} {start}) "
                f"has no legal candidate placement in the slot grid")
        else:
            model.Add(present[key] == 1)

    if spec_errors:
        return Solution(blocks=[], status="MODEL_INVALID", objective=0.0, best_bound=0.0,
                        coverage_placed=0, coverage_required=len(pair_vars), wall_time_s=0.0,
                        message="; ".join(sorted(set(spec_errors))))

    # ── Pre-occupied intervals (PLUS rotations, specialist lunch) ────────
    spec_busy: dict[str, list[tuple[int, int]]] = {}
    teacher_busy: dict[str, list[tuple[int, int]]] = {}
    for bz in spec.busy:
        day = bz.get("day")
        if day not in DAY_INDEX:
            continue
        gs = DAY_INDEX[day] * 1440 + int(bz["start"])
        ge = DAY_INDEX[day] * 1440 + int(bz["end"])
        if ge <= gs:
            continue
        sid = bz.get("specialist_id")
        if sid and sid in spec_intervals:
            spec_busy.setdefault(sid, []).append((gs, ge))
        tid = bz.get("teacher_id")
        if tid and tid in teacher_intervals:
            teacher_busy.setdefault(tid, []).append((gs, ge))
    for sid, spans in spec_busy.items():
        for gs, ge in _merge(spans):
            for wi in range(n_weeks):
                off = wi * WEEK_SPAN
                spec_intervals[sid].append(model.NewIntervalVar(gs + off, ge - gs, ge + off, f"busyS_{sid}_{gs}_{wi}"))
    for tid, spans in teacher_busy.items():
        for gs, ge in _merge(spans):
            for wi in range(n_weeks):
                off = wi * WEEK_SPAN
                teacher_intervals[tid].append(model.NewIntervalVar(gs + off, ge - gs, ge + off, f"busyT_{tid}_{gs}_{wi}"))

    # Hard: no specialist / no class double-booked.
    for ivs in spec_intervals.values():
        if ivs:
            model.AddNoOverlap(ivs)
    for ivs in teacher_intervals.values():
        if ivs:
            model.AddNoOverlap(ivs)

    # ── Per-pair session count, placement, floor, spacing ───────────────
    placed: dict[tuple, cp_model.IntVar] = {}
    n_sessions: dict[tuple, cp_model.IntVar] = {}
    cap = max(1, spec.sessions_per_pair)
    for key_pair, vars_ in pair_vars.items():
        ns = model.NewIntVar(0, cap, f"ns_{key_pair[0]}_{key_pair[1]}")
        model.Add(ns == sum(vars_))
        p = model.NewBoolVar(f"placed_{key_pair[0]}_{key_pair[1]}")
        model.Add(ns >= 1).OnlyEnforceIf(p)
        model.Add(ns == 0).OnlyEnforceIf(p.Not())
        placed[key_pair] = p
        n_sessions[key_pair] = ns
        if enforce_floor and spec.min_sessions_per_pair >= 1:
            model.Add(ns >= min(spec.min_sessions_per_pair, cap))
    # extra_rotation spacing: two sessions of one pair never share a day.
    if cap > 1:
        for pdk, vars_ in pair_day_vars.items():
            if len(vars_) > 1:
                model.Add(sum(vars_) <= 1)

    # ── Objective (full rubric, spec-weighted, ×SCALE integers) ─────────
    obj = []
    coverage_required = len(pair_vars)

    # + placement per (class, specialist)
    if W.placement > 0:
        c = W.coef("placement")
        for p in placed.values():
            obj.append(c * p)
    # + extra_session for a pair's 2nd+ session (kept < first-coverage reward)
    if cap > 1 and W.extra_session > 0:
        c = W.coef("extra_session")
        for kp, ns in n_sessions.items():
            extra = model.NewIntVar(0, cap - 1, f"extra_{kp[0]}_{kp[1]}")
            model.Add(extra == ns - placed[kp])
            obj.append(c * extra)

    # + subject_gap coverage per (grade, specialist)
    by_grade_spec: dict[tuple, list] = {}
    for key, b in present.items():
        by_grade_spec.setdefault((key_grade[key], key[1]), []).append(b)
    if W.subject_gap > 0:
        c = W.coef("subject_gap")
        for grade in grades_set:
            for s in spec.specialists:
                if not _can_teach(s, grade):
                    continue
                vars_ = by_grade_spec.get((grade, s["id"]), [])
                if not vars_:
                    continue
                cov = model.NewBoolVar(f"gscov_{grade}_{s['id']}")
                model.Add(sum(vars_) >= 1).OnlyEnforceIf(cov)
                model.Add(sum(vars_) == 0).OnlyEnforceIf(cov.Not())
                obj.append(c * cov)

    # − teacher_planning shortfall (minutes; 0.05 × 20 = 1/min)
    if W.teacher_planning > 0:
        c = W.coef("teacher_planning")
        for cl in spec.classes:
            t = cl["teacher_id"]
            required = int(cl.get("planning_minutes") or 0)
            if required <= 0:
                continue
            terms = []
            for s in spec.specialists:
                if not _can_teach(s, grade_by_teacher[t]):
                    continue
                dur = pair_duration(spec, s, grade_by_teacher[t])
                ns = n_sessions.get((t, s["id"]))
                if ns is not None:
                    terms.append(dur * ns)
            got = sum(terms) if terms else 0
            short = model.NewIntVar(0, required, f"plan_short_{t}")
            model.Add(short >= required - got)
            obj.append(-c * short)

    # − subject_day_clustering (Big-Group counts once: skip nonlead members)
    if W.cluster > 0:
        c = W.coef("cluster")
        cluster_groups: dict[tuple, list] = {}
        for key, b in present.items():
            slot = key_slot[key]
            if (key[0], key[1], key[2], slot.day, slot.start) in nonlead:
                continue
            subject = spec_by_id[key[1]]["subject"]
            cluster_groups.setdefault((key_grade[key], subject, slot.day), []).append(b)
        for gkey, vars_ in cluster_groups.items():
            if len(vars_) < 2:
                continue
            excess = model.NewIntVar(0, len(vars_), f"clx_{gkey[0]}_{gkey[1]}_{gkey[2]}")
            model.Add(excess >= sum(vars_) - 1)
            obj.append(-c * excess)

    # − k_grade_after_780
    if W.k_late > 0:
        c = W.coef("k_late")
        for key, b in present.items():
            if key_grade[key] in K_GRADES and key_slot[key].start >= W.k_late_threshold:
                obj.append(-c * b)

    # + full_week_coverage
    if W.full_week > 0:
        c = W.coef("full_week")
        for grade in sorted(grades_set):
            day_has: dict[str, list] = {d: [] for d in schedulable_days}
            for key, b in present.items():
                if key_grade[key] != grade:
                    continue
                d = key_slot[key].day
                if d in day_has:
                    day_has[d].append(b)
            flags = []
            for d, vars_ in day_has.items():
                cov = model.NewBoolVar(f"cov_{grade}_{d}")
                if vars_:
                    model.Add(sum(vars_) >= 1).OnlyEnforceIf(cov)
                    model.Add(sum(vars_) == 0).OnlyEnforceIf(cov.Not())
                else:
                    model.Add(cov == 0)
                flags.append(cov)
            full = model.NewBoolVar(f"full_{grade}")
            if flags:
                model.AddMinEquality(full, flags)
            else:
                model.Add(full == 0)
            obj.append(c * full)

    # − grade_cohesion: days a grade spans beyond ceil(sessions / 2)
    if spec.keep_grades_together and W.grade_cohesion > 0:
        c = W.coef("grade_cohesion")
        for grade in sorted(grades_set):
            gvars = [b for key, b in present.items() if key_grade[key] == grade]
            if not gvars:
                continue
            day_used = []
            for d in schedulable_days:
                dv = [b for key, b in present.items() if key_grade[key] == grade and key_slot[key].day == d]
                u = model.NewBoolVar(f"gcud_{grade}_{d}")
                if dv:
                    model.Add(sum(dv) >= 1).OnlyEnforceIf(u)
                    model.Add(sum(dv) == 0).OnlyEnforceIf(u.Not())
                else:
                    model.Add(u == 0)
                day_used.append(u)
            days_used = model.NewIntVar(0, ndays, f"gcdu_{grade}")
            model.Add(days_used == sum(day_used))
            sessions = model.NewIntVar(0, len(gvars), f"gcs_{grade}")
            model.Add(sessions == sum(gvars))
            ideal = model.NewIntVar(0, len(gvars), f"gci_{grade}")
            model.Add(2 * ideal >= sessions)
            model.Add(2 * ideal <= sessions + 1)
            extra = model.NewIntVar(0, ndays, f"gce_{grade}")
            model.Add(extra >= days_used - ideal)
            obj.append(-c * extra)

    # − grade_day_spread: distinct grades a specialist teaches per day beyond 1
    #   ("Grade 5 then 4 then K then 2 on Monday" — coordinators want same-grade
    #   days). Big-Group nonlead members share the lead's grade, so the OR over
    #   assignment lits can't double-count. Same gate as grade_cohesion.
    if spec.keep_grades_together and W.grade_day_spread > 0:
        c = W.coef("grade_day_spread")
        by_spec_day: dict[tuple, dict[str, list]] = {}
        for key, b in present.items():
            slot = key_slot[key]
            by_spec_day.setdefault((key[1], slot.day), {}).setdefault(key_grade[key], []).append(b)
        for (sid, day), by_grade in by_spec_day.items():
            if len(by_grade) < 2:
                continue  # a single reachable grade can never spread
            g_on = []
            for grade, vars_ in by_grade.items():
                u = model.NewBoolVar(f"gds_{sid}_{day}_{grade}")
                # Upward implication only: any assignment forces u=1; the penalty
                # pushes u down to 0 otherwise. (Two-sided channeling measurably
                # slowed optimality proofs without changing the optimum.)
                for b in vars_:
                    model.AddImplication(b, u)
                g_on.append(u)
            spread = model.NewIntVar(0, len(g_on), f"gdsn_{sid}_{day}")
            model.Add(spread >= sum(g_on) - 1)
            obj.append(-c * spread)

    # − contract_min: minutes short of a contractual (grade, subject) minimum
    if W.contract_min > 0 and spec.contract_subjects:
        c = W.coef("contract_min")

        def norm(x) -> str:
            return str(x or "").strip().lower()

        def norm_grade(x) -> str:
            return norm(x).replace("grade ", "").replace(" ", "")

        for req in spec.contract_subjects:
            required = int(req.get("weekly_minutes") or 0)
            if required <= 0:
                continue
            rg, rs = norm_grade(req.get("grade")), norm(req.get("subject"))
            terms = []
            for key, b in present.items():
                if norm_grade(key_grade[key]) == rg and norm(spec_by_id[key[1]]["subject"]) == rs:
                    slot = key_slot[key]
                    terms.append((slot.end - slot.start) * b)
            have = sum(terms) if terms else 0
            short = model.NewIntVar(0, required, f"contract_{rg}_{rs}")
            model.Add(short >= required - have)
            obj.append(-c * short)

    # − cart_back_to_back proxy: a cart specialist teaching two sessions within
    #   cart_buffer minutes on one day (rooms aren't modeled; the app re-scores the
    #   real rooms, so this is a nudge that keeps a cart from rushing between rooms).
    if W.cart > 0:
        c = W.coef("cart")
        for s in spec.specialists:
            if not s.get("uses_cart"):
                continue
            sid = s["id"]
            by_wd: dict[tuple, list] = {}
            for key, b in present.items():
                if key[1] != sid:
                    continue
                slot = key_slot[key]
                by_wd.setdefault((key[2], slot.day), []).append((slot, b))
            for lst in by_wd.values():
                lst.sort(key=lambda x: x[0].start)
                for i in range(len(lst)):
                    a_slot, a_b = lst[i]
                    for j in range(i + 1, len(lst)):
                        b_slot, b_b = lst[j]
                        gap = b_slot.start - a_slot.end
                        if gap < 0:
                            continue
                        if gap >= spec.cart_buffer:
                            break
                        pen = model.NewBoolVar(f"cart_{sid}_{a_slot.day}_{a_slot.start}_{b_slot.start}")
                        model.Add(pen <= a_b)
                        model.Add(pen <= b_b)
                        model.Add(pen >= a_b + b_b - 1)
                        obj.append(-c * pen)

    # − spec_dayload_stdev (MAD linearization): per specialist, penalize the sum of
    #   |dayload_d − mean| via AddAbsEquality. mean = total/ndays is folded into the
    #   coefficient (coef ≈ SCALE·weight/ndays) so the term stays integer.
    #   Sum of absolute deviations from a FREE per-specialist center (the solver
    #   settles it at the median day-load), which is minimized exactly when the
    #   week is balanced. Deviating from a scalar center — rather than the global
    #   day sum — avoids coupling every day through one total, which otherwise made
    #   the objective landscape flat and un-provable (OPTIMAL never certified).
    if W.dayload > 0 and W.coef("dayload") > 0:
        c = W.coef("dayload")
        for s in spec.specialists:
            sid = s["id"]
            max_load = 0
            dayloads = []
            for d in schedulable_days:
                dv = [b for key, b in present.items()
                      if key[1] == sid and key_slot[key].day == d
                      and (key[0], sid, key[2], d, key_slot[key].start) not in nonlead]
                cap_d = max(1, len(dv))
                max_load = max(max_load, cap_d)
                dl = model.NewIntVar(0, cap_d, f"dl_{sid}_{d}")
                model.Add(dl == (sum(dv) if dv else 0))
                dayloads.append(dl)
            if max_load <= 1:
                continue  # at most one session/day — perfectly balanced already
            center = model.NewIntVar(0, max_load, f"dlc_{sid}")
            for i, dl in enumerate(dayloads):
                dev = model.NewIntVar(-max_load, max_load, f"dld_{sid}_{i}")
                model.Add(dev == dl - center)
                ad = model.NewIntVar(0, max_load, f"dla_{sid}_{i}")
                model.AddAbsEquality(ad, dev)
                obj.append(-c * ad)

    # + am_pm_satisfied: a teacher whose sessions ALL honor an AM/PM preference
    if W.am_pm > 0:
        c = W.coef("am_pm")
        for cl in spec.classes:
            pref = cl.get("am_pm_preference")
            if pref not in ("AM", "PM"):
                continue
            t = cl["teacher_id"]
            wrong = [b for key, b in present.items() if key[0] == t and _half(key_slot[key].start) != pref]
            if not wrong:
                continue
            sat = model.NewBoolVar(f"ampm_{t}")
            for v in wrong:
                model.Add(v == 0).OnlyEnforceIf(sat)
            obj.append(c * sat)

    # + day_pref_satisfied: a teacher whose sessions ALL fall on a preferred day
    if W.day_pref > 0:
        c = W.coef("day_pref")
        for cl in spec.classes:
            pref = cl.get("day_preference")
            if not pref or pref not in DAY_INDEX:
                continue
            t = cl["teacher_id"]
            wrong = [b for key, b in present.items() if key[0] == t and key_slot[key].day != pref]
            if not wrong:
                continue
            sat = model.NewBoolVar(f"daypref_{t}")
            for v in wrong:
                model.Add(v == 0).OnlyEnforceIf(sat)
            obj.append(c * sat)

    # + planning_target_met: a specialist left with enough free time for planning.
    #   free = planning_free_budget (weekly available − lunch) − teaching; met iff
    #   teaching ≤ budget − required. Big-Group counts the specialist's time once.
    if W.planning_target > 0:
        c = W.coef("planning_target")
        for s in spec.specialists:
            budget = s.get("planning_free_budget")
            required = int(s.get("required_planning_minutes") or 0)
            if budget is None or required <= 0:
                continue
            sid = s["id"]
            # Slot-derived minutes (end - start per candidate) — exact even when
            # grade_duration_overrides give one specialist mixed session lengths.
            pairs = [(key_slot[key].end - key_slot[key].start, b)
                     for key, b in present.items()
                     if key[1] == sid
                     and (key[0], sid, key[2], key_slot[key].day, key_slot[key].start) not in nonlead]
            if not pairs:
                continue
            max_teaching = sum(size for size, _ in pairs)
            teaching = model.NewIntVar(0, max_teaching, f"teach_{sid}")
            model.Add(teaching == sum(size * b for size, b in pairs))
            met = model.NewBoolVar(f"plmet_{sid}")
            model.Add(teaching <= int(budget) - required).OnlyEnforceIf(met)
            obj.append(c * met)

    model.Maximize(sum(obj))

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
        for key, b in present.items():
            if solver.Value(b) == 1:
                slot = key_slot[key]
                blocks.append(PlacedBlock(
                    teacher_id=key[0], specialist_id=key[1], subject=spec_by_id[key[1]]["subject"],
                    grade=key_grade[key], day=slot.day, start=slot.start, end=slot.end, week_label=key[2],
                ))

    return Solution(
        blocks=blocks,
        status=status_name,
        objective=solver.ObjectiveValue() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0.0,
        best_bound=solver.BestObjectiveBound() if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else 0.0,
        coverage_placed=len(blocks),
        coverage_required=coverage_required,
        wall_time_s=solver.WallTime(),
    )


if __name__ == "__main__":
    import json
    import sys
    spec = json.load(sys.stdin)
    print(json.dumps(solve(spec)))
