"""Scale stress test for the CP-SAT solver — NOT a unit test (too slow for CI); a
regression benchmark you run by hand:  python solver/bench/scale_test.py

Purpose: prove the sparse-schedule bug (min_sessions_per_pair floor) is closed at a
realistic size, and that a partial placement can NEVER be reported as a clean
OPTIMAL/FEASIBLE. The old bug's exact signature was "185/336 placed" — an aggregate
that hid 151 (teacher, specialist) pairs silently getting zero sessions. So this
prints the per-(teacher, specialist) session-count histogram, not just the total.

Built against the ACTUAL solver schema (solver/solver.py):
  - week_labels = ["AA","BB"]  (opaque two-timeline convention)
  - slots_by_grade_duration = {grade: {duration_int: [ {day,start,end}, ... ]}}
  - specialists: {id, subject, working_days, grades|None, duration, grade_rotation?,
                  uses_cart?, planning_free_budget?, required_planning_minutes?}
  - classes: {teacher_id, grade, planning_minutes?, am_pm_preference?, day_preference?}
  - min_sessions_per_pair (GLOBAL hard floor) + sessions_per_pair (GLOBAL cap)
NOTE: the solver does NOT emit a reason string for coverage_relaxed (Solution.message
is only set for MODEL_INVALID), so the "legible reason" below is DERIVED here from the
unplaced-pair histogram.
"""
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from solver import solve  # noqa: E402

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]
GRADES = ["K", "1", "2", "3", "4", "5"]           # 6 grades
TEACHERS_PER_GRADE = 7                              # 6 × 7 = 42 teachers
SUBJECTS = ["PE", "Art", "Music", "Library", "Science", "Garden", "Tech", "Dance"]  # 8 specialists
SLOT_STARTS = [480, 525, 570, 615, 660, 705, 750, 795]  # 8 slots/day, 45-min, back-to-back


def build_spec(time_limit_s: float) -> dict:
    classes = []
    for g in GRADES:
        for n in range(TEACHERS_PER_GRADE):
            classes.append({
                "teacher_id": f"t_{g}_{n}",
                "grade": g,
                "planning_minutes": 225,          # realistic: ~5 × 45-min specials/wk
            })

    specialists = []
    for subj in SUBJECTS:
        s = {
            "id": f"s_{subj}",
            "subject": subj,
            "working_days": DAYS,
            "grades": None,                        # every specialist can teach every grade
            "duration": 45,
            # planning-target inputs (planning_target_met term)
            "planning_free_budget": 5 * (795 + 45 - 480),  # weekly available mins
            "required_planning_minutes": 200,
        }
        if subj == "Garden":
            # grade_rotation: restricts WHICH grades per day, but every grade is still
            # allowed on >=1 day (Fri = all), so no pair is structurally unschedulable.
            s["grade_rotation"] = {
                "Mon": ["K", "1", "2"], "Tue": ["3", "4", "5"],
                "Wed": ["K", "1", "2"], "Thu": ["3", "4", "5"],
                "Fri": GRADES,
            }
        if subj == "Dance":
            s["uses_cart"] = True                  # exercises the cart_back_to_back term
        specialists.append(s)

    slots45 = [{"day": d, "start": st, "end": st + 45} for d in DAYS for st in SLOT_STARTS]
    slots_by_grade_duration = {g: {45: [dict(x) for x in slots45]} for g in GRADES}

    return {
        "classes": classes,
        "specialists": specialists,
        "slots_by_grade_duration": slots_by_grade_duration,
        "week_labels": ["AA", "BB"],               # real AA/BB convention
        "sessions_per_pair": 1,
        "min_sessions_per_pair": 1,                # demand full coverage (the fix under test)
        "time_limit_s": time_limit_s,
        "num_workers": 8,
    }


def run(time_limit_s: float) -> dict:
    spec = build_spec(time_limit_s)
    n_teachers = len(spec["classes"])
    n_specialists = len(spec["specialists"])
    sol = solve(spec)

    placed = sol["coverage_placed"]
    required = sol["coverage_required"]
    gap = (sol["objective"] - sol["best_bound"])
    gap_pct = (abs(gap) / abs(sol["objective"]) * 100) if sol["objective"] else float("nan")

    # Per-(teacher, specialist) session-count histogram — the anti-"185/336" guard.
    pair_count = Counter()
    for b in sol["blocks"]:
        pair_count[(b["teacher_id"], b["specialist_id"])] += 1
    # Every schedulable pair = every (teacher, specialist) that COULD be placed.
    all_pairs = [(c["teacher_id"], s["id"]) for c in spec["classes"] for s in spec["specialists"]]
    dist = Counter(pair_count.get(p, 0) for p in all_pairs)

    print(f"\n===== time_limit_s = {time_limit_s} =====")
    print(f"grid: {n_teachers} teachers × {n_specialists} specialists = {n_teachers * n_specialists} nominal pairs")
    print(f"status              : {sol['status']}")
    print(f"coverage            : {placed}/{required} placed  (coverage_required = schedulable pairs)")
    print(f"coverage_relaxed    : {sol['coverage_relaxed']}")
    print(f"objective           : {sol['objective']:.1f}")
    print(f"best_bound          : {sol['best_bound']:.1f}")
    print(f"optimality gap      : {gap_pct:.2f}%")
    print(f"wall_time_s         : {sol['wall_time_s']:.2f}")
    print("per-pair session histogram (sessions -> #pairs):")
    for k in sorted(dist):
        print(f"    {k} session(s): {dist[k]} pairs")

    zero_pairs = [p for p in all_pairs if pair_count.get(p, 0) == 0]
    if zero_pairs:
        by_spec = defaultdict(int)
        for _, sid in zero_pairs:
            by_spec[sid] += 1
        reason = "; ".join(f"{sid}: {n} classes uncovered" for sid, n in sorted(by_spec.items()))
        print(f"DERIVED relaxation reason ({len(zero_pairs)} unplaced pairs): {reason}")
    else:
        print("DERIVED relaxation reason: none — every schedulable pair got >=1 session")

    return {"sol": sol, "placed": placed, "required": required, "zero_pairs": zero_pairs}


def assert_honest(label: str, r: dict) -> None:
    sol = r["sol"]
    full = r["placed"] == r["required"]
    honest_relax = bool(sol["coverage_relaxed"]) and sol["status"] in ("OPTIMAL", "FEASIBLE")
    # The bug this guards: a partial placement (placed < required) reported as a clean
    # OPTIMAL/FEASIBLE with coverage_relaxed=False (or an UNKNOWN with 0 placed).
    assert full or honest_relax, (
        f"[{label}] DISHONEST RESULT: status={sol['status']} placed={r['placed']}/{r['required']} "
        f"coverage_relaxed={sol['coverage_relaxed']} — neither full coverage nor an honest relaxation."
    )
    if full:
        print(f"[{label}] ASSERT OK: full coverage {r['placed']}/{r['required']} (coverage_relaxed={sol['coverage_relaxed']})")
    else:
        print(f"[{label}] ASSERT OK: honest relaxation — coverage_relaxed=True, {r['placed']}/{r['required']}, status {sol['status']}")


if __name__ == "__main__":
    r60 = run(60.0)
    r120 = run(120.0)
    print("\n===== ASSERTIONS =====")
    # 60s is reported for context; the contract is asserted at 120s.
    assert_honest("60s", r60)
    assert_honest("120s", r120)
    print("\nBoth runs honest (full coverage OR flagged relaxation — never a silent partial).")
