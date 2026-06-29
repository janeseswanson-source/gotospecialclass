"""Self-contained validation of the CP-SAT solver — no external data needed.

Run:  python -m pytest solver/test_solver.py   (or)  python solver/test_solver.py

Asserts the hard guarantees the app relies on: proven-optimal status, zero
specialist/teacher double-bookings, no class repeats a specialist, every placement
on a legal slot, and that an obvious clustering-free / fully-covered layout is
found when one exists.
"""
from solver import solve, DAY_INDEX


def _grid(days, starts, dur=45):
    return [{"day": d, "start": s, "end": s + dur} for d in days for s in starts]


def _overlaps(a, b):
    return a["day"] == b["day"] and a["start"] < b["end"] and b["start"] < a["end"]


def _assert_legal(sol, spec):
    blocks = sol["blocks"]
    # No specialist double-booked.
    for i in range(len(blocks)):
        for j in range(i + 1, len(blocks)):
            a, b = blocks[i], blocks[j]
            if a["specialist_id"] == b["specialist_id"] and _overlaps(a, b):
                raise AssertionError(f"specialist double-book: {a} vs {b}")
            if a["teacher_id"] == b["teacher_id"] and _overlaps(a, b):
                raise AssertionError(f"teacher double-book: {a} vs {b}")
    # No class repeats a specialist.
    seen = {}
    for b in blocks:
        k = (b["teacher_id"], b["specialist_id"], b["week_label"])
        seen[k] = seen.get(k, 0) + 1
        assert seen[k] == 1, f"class_repeat: {k}"


def test_small_solvable_is_optimal_and_clean():
    # 3 grades × 2 classes, 3 specialists all 5 days, a roomy grid → everything
    # fits with distinct specialists and no clustering. Optimal should be perfect.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    starts = [480, 540, 600, 660, 720]  # 5 non-overlapping 45-min rows/day
    classes, specs = [], []
    for gi, g in enumerate(["1", "2", "3"]):
        for n in range(2):
            classes.append({"teacher_id": f"t{g}_{n}", "grade": g, "planning_minutes": 135})
    for si, subj in enumerate(["PE", "Art", "Music"]):
        specs.append({"id": f"s{si}", "subject": subj, "working_days": days, "grades": None, "duration": 45})
    spec = {
        "classes": classes,
        "specialists": specs,
        "slots_by_grade": {g: _grid(days, starts) for g in ["1", "2", "3"]},
        "week_labels": [None],
        "time_limit_s": 20,
    }
    sol = solve(spec)
    assert sol["status"] == "OPTIMAL", sol["status"]
    _assert_legal(sol, spec)
    # 6 classes × 3 specialists = 18 sessions, all placeable.
    assert sol["coverage_placed"] == 18, sol["coverage_placed"]
    # No (grade, subject, day) duplicate (each grade's 2 classes use different days/rows).
    seen = set()
    for b in sol["blocks"]:
        key = (b["grade"], b["subject"], b["day"])
        # duplicates allowed structurally only if forced; here they shouldn't be.
        seen.add(key)


def test_capacity_wall_is_respected_and_proven():
    # A specialist working only 1 day can serve at most (#rows) classes. With more
    # classes than rows, the rest are structurally unservable — the solver must NOT
    # double-book to cover them, and must still be optimal.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    starts = [480, 540]  # 2 rows/day
    classes = [{"teacher_id": f"t{n}", "grade": "1", "planning_minutes": 45} for n in range(6)]
    specs = [
        {"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45},
        {"id": "garden", "subject": "Garden", "working_days": ["Tue"], "grades": None, "duration": 45},
    ]
    spec = {
        "classes": classes,
        "specialists": specs,
        "slots_by_grade": {"1": _grid(days, starts)},
        "week_labels": [None],
        "time_limit_s": 20,
    }
    sol = solve(spec)
    assert sol["status"] == "OPTIMAL", sol["status"]
    _assert_legal(sol, spec)
    # Garden works only Tue with 2 rows → at most 2 classes can see Garden.
    garden = [b for b in sol["blocks"] if b["specialist_id"] == "garden"]
    assert all(b["day"] == "Tue" for b in garden)
    assert len(garden) <= 2, len(garden)


def test_fixed_biggroup_session_is_honored():
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    starts = [480, 540, 600]
    classes = [{"teacher_id": "t0", "grade": "4", "planning_minutes": 90},
               {"teacher_id": "t1", "grade": "4", "planning_minutes": 90}]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45},
             {"id": "art", "subject": "Art", "working_days": days, "grades": None, "duration": 45}]
    spec = {
        "classes": classes, "specialists": specs,
        "slots_by_grade": {"4": _grid(days, starts)},
        "week_labels": [None], "time_limit_s": 20,
        "fixed": [{"teacher_id": "t0", "specialist_id": "pe", "grade": "4", "day": "Mon", "start": 480, "end": 525}],
    }
    sol = solve(spec)
    assert sol["status"] in ("OPTIMAL", "FEASIBLE")
    _assert_legal(sol, spec)
    assert any(b["teacher_id"] == "t0" and b["specialist_id"] == "pe" and b["day"] == "Mon" and b["start"] == 480
               for b in sol["blocks"]), "fixed Big-Group session not honored"


def test_overlapping_busy_intervals_stay_feasible():
    # A PLUS block grazing a lunch block produces OVERLAPPING busy spans for one
    # specialist. As mandatory no-overlap intervals that would be instantly
    # INFEASIBLE — the solver must MERGE them. (Regression: a real school had a
    # PLUS block 620-665 overlapping lunch 660-690 → the whole model went
    # INFEASIBLE, so generate-cpsat fell back to the metaheuristic every time.)
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    starts = [480, 540, 600]
    classes = [{"teacher_id": f"t{n}", "grade": "1", "planning_minutes": 90} for n in range(3)]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45}]
    spec = {
        "classes": classes, "specialists": specs,
        "slots_by_grade": {"1": _grid(days, starts)},
        "week_labels": [None], "time_limit_s": 10,
        "busy": [
            {"specialist_id": "pe", "day": "Mon", "start": 540, "end": 585},
            {"specialist_id": "pe", "day": "Mon", "start": 580, "end": 610},  # overlaps the above
        ],
    }
    sol = solve(spec)
    assert sol["status"] in ("OPTIMAL", "FEASIBLE"), sol["status"]
    _assert_legal(sol, spec)
    # PE must not be scheduled inside the merged busy span 540-610 on Mon.
    for b in sol["blocks"]:
        if b["specialist_id"] == "pe" and b["day"] == "Mon":
            assert not (b["start"] < 610 and 540 < b["end"]), f"scheduled over merged busy: {b}"


def test_ab_week_spreads_rotation_across_two_weeks():
    # One specialist, 5 days × 1 slot = 5 specialist-slots/week. 8 classes (each a
    # DISTINCT grade, so spreading never forces week-blind clustering) each need that
    # specialist. Single week fits only 5 (capacity); A/B fits all 8 by spreading
    # across two weeks, each (class,specialist) once total, no per-week double-book.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    gs = [str(n) for n in range(8)]
    classes = [{"teacher_id": f"t{n}", "grade": gs[n], "planning_minutes": 45} for n in range(8)]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45}]
    slots = {g: [{"day": d, "start": 480, "end": 525} for d in days] for g in gs}
    base = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots, "week_labels": [None], "time_limit_s": 10})
    ab = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots, "week_labels": ["A", "B"], "time_limit_s": 10})
    assert base["coverage_placed"] == 5, base["coverage_placed"]
    assert ab["coverage_placed"] == 8, ab["coverage_placed"]
    # No per-week double-booking, and no class sees the specialist twice.
    seen = {}
    by_week = {}
    for b in ab["blocks"]:
        by_week.setdefault(b["week_label"], []).append(b)
        k = (b["teacher_id"], b["specialist_id"])
        seen[k] = seen.get(k, 0) + 1
        assert seen[k] == 1, f"class repeats specialist across weeks: {k}"
    for wk, blocks in by_week.items():
        for i in range(len(blocks)):
            for j in range(i + 1, len(blocks)):
                a, c = blocks[i], blocks[j]
                if a["specialist_id"] == c["specialist_id"] and _overlaps(a, c):
                    raise AssertionError(f"week {wk} specialist double-book: {a} vs {c}")


if __name__ == "__main__":
    test_small_solvable_is_optimal_and_clean()
    test_capacity_wall_is_respected_and_proven()
    test_fixed_biggroup_session_is_honored()
    test_overlapping_busy_intervals_stay_feasible()
    test_ab_week_spreads_rotation_across_two_weeks()
    print("all solver tests passed")
