"""Self-contained validation of the CP-SAT solver — no external data needed.

Run:  python -m pytest solver/test_solver.py   (or)  python solver/test_solver.py

Asserts the hard guarantees the app relies on: proven-optimal status, zero
specialist/teacher double-bookings, no class repeats a specialist, every placement
on a legal slot, and that an obvious clustering-free / fully-covered layout is
found when one exists — plus the full conflict-strategy matrix (AA/BB labels,
quick-30 mixed durations, Big-Group group_id, extra_rotation, the min-sessions
coverage floor + soft retry, grade rotation, cart, and AM/PM & day preferences).
Every test keeps time_limit_s well under 30s.
"""
from solver import solve


def _grid(days, starts, dur=45):
    return [{"day": d, "start": s, "end": s + dur} for d in days for s in starts]


def _overlaps(a, b):
    return a["day"] == b["day"] and a["start"] < b["end"] and b["start"] < a["end"]


def _weeks_coincide(a, b):
    # A null week label means "every week"; two labelled weeks only clash if equal.
    return a["week_label"] is None or b["week_label"] is None or a["week_label"] == b["week_label"]


def _is_taught_together(a, b):
    """Big-Group exemption (mirrors the SSOT): same specialist, IDENTICAL interval,
    same grade, different teachers = one combined class, NOT a double-book."""
    return (a["specialist_id"] == b["specialist_id"] and a["start"] == b["start"]
            and a["end"] == b["end"] and a["grade"] == b["grade"]
            and a["teacher_id"] != b["teacher_id"])


def _assert_legal(sol, allow_repeats=False):
    blocks = sol["blocks"]
    # No specialist / teacher double-booked (Big-Group taught-together exempted).
    for i in range(len(blocks)):
        for j in range(i + 1, len(blocks)):
            a, b = blocks[i], blocks[j]
            if not _weeks_coincide(a, b):
                continue
            if a["specialist_id"] == b["specialist_id"] and _overlaps(a, b) and not _is_taught_together(a, b):
                raise AssertionError(f"specialist double-book: {a} vs {b}")
            if a["teacher_id"] == b["teacher_id"] and _overlaps(a, b):
                raise AssertionError(f"teacher double-book: {a} vs {b}")
    # No class repeats a specialist (unless extra_rotation deliberately allows it).
    if not allow_repeats:
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
    _assert_legal(sol)
    # 6 classes × 3 specialists = 18 sessions, all placeable.
    assert sol["coverage_placed"] == 18, sol["coverage_placed"]


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
    _assert_legal(sol)
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
    _assert_legal(sol)
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
    _assert_legal(sol)
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
    _assert_legal(ab)


# ─── Strategy matrix (permanent regression tests) ──────────────────────────

def test_aa_bb_labels_are_opaque_two_timelines():
    # AA/BB is solved EXACTLY like A/B — two disjoint timelines with the opaque
    # labels the app supplies. The 2-consecutive-week cadence is calendar-mapping,
    # not a solver concern. 8 distinct grades fit only across both rotation weeks.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    gs = [str(n) for n in range(8)]
    classes = [{"teacher_id": f"t{n}", "grade": gs[n], "planning_minutes": 45} for n in range(8)]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45}]
    slots = {g: [{"day": d, "start": 480, "end": 525} for d in days] for g in gs}
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": ["AA", "BB"], "time_limit_s": 10})
    assert sol["status"] in ("OPTIMAL", "FEASIBLE"), sol["status"]
    assert sol["coverage_placed"] == 8, sol["coverage_placed"]
    labels = {b["week_label"] for b in sol["blocks"]}
    assert labels == {"AA", "BB"}, labels  # both rotation weeks actually used
    _assert_legal(sol)  # no per-week double-book, no cross-week class repeat


def test_quick30_mixed_durations_place_the_30min_specialist():
    # A 30-min specialist and a 45-min specialist share a grade. With a per-duration
    # slot grid the 30-min specialist MUST get real sessions (the old single-grid
    # path silently dropped them because no 30-min slot matched).
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    classes = [{"teacher_id": f"t{n}", "grade": "1", "planning_minutes": 0} for n in range(2)]
    specs = [
        {"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45},
        {"id": "mind", "subject": "Mindfulness", "working_days": days, "grades": None, "duration": 30},
    ]
    slots45 = [{"day": d, "start": s, "end": s + 45} for d in days for s in [480, 540]]
    slots30 = [{"day": d, "start": s, "end": s + 30} for d in days for s in [600, 635]]
    sol = solve({
        "classes": classes, "specialists": specs,
        "slots_by_grade_duration": {"1": {45: slots45, 30: slots30}},
        "week_labels": [None], "time_limit_s": 10,
    })
    assert sol["status"] == "OPTIMAL", sol["status"]
    _assert_legal(sol)
    mind = [b for b in sol["blocks"] if b["specialist_id"] == "mind"]
    assert len(mind) == 2, f"30-min specialist must cover both classes, got {mind}"
    assert all(b["end"] - b["start"] == 30 for b in mind), mind
    pe = [b for b in sol["blocks"] if b["specialist_id"] == "pe"]
    assert all(b["end"] - b["start"] == 45 for b in pe), pe


def test_quick30_missing_duration_grid_is_model_invalid():
    # A specialist whose class duration has NO slot list is a SPEC ERROR named in
    # the message — never a silent hole.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    classes = [{"teacher_id": "t0", "grade": "1", "planning_minutes": 0}]
    specs = [{"id": "mind", "subject": "Mindfulness", "working_days": days, "grades": None, "duration": 30}]
    slots45 = [{"day": d, "start": 480, "end": 525} for d in days]
    sol = solve({"classes": classes, "specialists": specs,
                 "slots_by_grade_duration": {"1": {45: slots45}},  # no 30-min grid
                 "week_labels": [None], "time_limit_s": 5})
    assert sol["status"] == "MODEL_INVALID", sol["status"]
    assert "mind" in sol["message"], sol["message"]


def test_biggroup_group_id_is_feasible_taught_together():
    # Two classes taught together by one specialist at one slot (shared group_id):
    # ONE specialist interval + one interval per member teacher → feasible.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    starts = [480, 540, 600]
    classes = [{"teacher_id": "t0", "grade": "4", "planning_minutes": 0},
               {"teacher_id": "t1", "grade": "4", "planning_minutes": 0}]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45},
             {"id": "art", "subject": "Art", "working_days": days, "grades": None, "duration": 45}]
    fixed = [
        {"teacher_id": "t0", "specialist_id": "pe", "grade": "4", "day": "Mon", "start": 480, "end": 525, "group_id": "g1"},
        {"teacher_id": "t1", "specialist_id": "pe", "grade": "4", "day": "Mon", "start": 480, "end": 525, "group_id": "g1"},
    ]
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": {"4": _grid(days, starts)},
                 "week_labels": [None], "time_limit_s": 10, "fixed": fixed})
    assert sol["status"] in ("OPTIMAL", "FEASIBLE"), sol["status"]
    _assert_legal(sol)  # exemption honored: identical-interval same-grade different-teacher is legal
    tg = [b for b in sol["blocks"] if b["specialist_id"] == "pe" and b["day"] == "Mon" and b["start"] == 480]
    assert {b["teacher_id"] for b in tg} == {"t0", "t1"}, tg


def test_biggroup_same_slot_without_group_id_is_infeasible():
    # The SAME two fixed sessions, same specialist + slot, but NO shared group_id,
    # is a genuine double-book → INFEASIBLE (not silently merged).
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    starts = [480, 540, 600]
    classes = [{"teacher_id": "t0", "grade": "4", "planning_minutes": 0},
               {"teacher_id": "t1", "grade": "4", "planning_minutes": 0}]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45}]
    fixed = [
        {"teacher_id": "t0", "specialist_id": "pe", "grade": "4", "day": "Mon", "start": 480, "end": 525},
        {"teacher_id": "t1", "specialist_id": "pe", "grade": "4", "day": "Mon", "start": 480, "end": 525},
    ]
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": {"4": _grid(days, starts)},
                 "week_labels": [None], "time_limit_s": 10, "fixed": fixed})
    assert sol["status"] == "INFEASIBLE", sol["status"]


def test_extra_rotation_two_per_pair_spaced_across_days():
    # sessions_per_pair=2 lets a pair repeat; spacing forbids both on one day.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    classes = [{"teacher_id": "t0", "grade": "1", "planning_minutes": 0}]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45}]
    slots = {"1": [{"day": d, "start": 480, "end": 525} for d in days]}
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": [None], "time_limit_s": 10, "sessions_per_pair": 2})
    assert sol["status"] == "OPTIMAL", sol["status"]
    pe = [b for b in sol["blocks"] if b["teacher_id"] == "t0" and b["specialist_id"] == "pe"]
    assert len(pe) == 2, f"extra_rotation should place 2 sessions of the pair, got {pe}"
    assert pe[0]["day"] != pe[1]["day"], f"two sessions of one pair must not share a day: {pe}"


def test_extra_rotation_does_not_crowd_out_first_coverage():
    # 2 classes, 1 specialist, only 2 total slots, sessions_per_pair=2. Giving each
    # class its FIRST session must beat giving one class a second — the smaller
    # 2nd-session reward guarantees it.
    classes = [{"teacher_id": "t0", "grade": "1", "planning_minutes": 0},
               {"teacher_id": "t1", "grade": "1", "planning_minutes": 0}]
    specs = [{"id": "pe", "subject": "PE", "working_days": ["Mon", "Tue"], "grades": None, "duration": 45}]
    slots = {"1": [{"day": "Mon", "start": 480, "end": 525}, {"day": "Tue", "start": 480, "end": 525}]}
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": [None], "time_limit_s": 10, "sessions_per_pair": 2})
    assert sol["status"] == "OPTIMAL", sol["status"]
    covered = {b["teacher_id"] for b in sol["blocks"] if b["specialist_id"] == "pe"}
    assert covered == {"t0", "t1"}, f"both classes must get a first session, got {covered}"


def test_min_sessions_floor_soft_retries_on_capacity_wall():
    # 8 classes, one specialist with 5 slots/week, single week. Demanding every pair
    # (min_sessions_per_pair=1) is a genuine capacity wall → INFEASIBLE with the
    # floor; the solver soft-retries WITHOUT it and reports coverage_relaxed.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    classes = [{"teacher_id": f"t{n}", "grade": str(n), "planning_minutes": 0} for n in range(8)]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45}]
    slots = {str(n): [{"day": d, "start": 480, "end": 525} for d in days] for n in range(8)}
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": [None], "time_limit_s": 10, "min_sessions_per_pair": 1})
    assert sol["status"] in ("OPTIMAL", "FEASIBLE"), sol["status"]
    assert sol["coverage_relaxed"] is True, "capacity wall must relax the coverage floor"
    assert sol["coverage_placed"] == 5, sol["coverage_placed"]


def test_min_sessions_floor_met_when_feasible():
    # Same shape but two weeks → all 8 fit, so the floor holds and nothing relaxes.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    classes = [{"teacher_id": f"t{n}", "grade": str(n), "planning_minutes": 0} for n in range(8)]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45}]
    slots = {str(n): [{"day": d, "start": 480, "end": 525} for d in days] for n in range(8)}
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": ["A", "B"], "time_limit_s": 10, "min_sessions_per_pair": 1})
    assert sol["status"] in ("OPTIMAL", "FEASIBLE"), sol["status"]
    assert sol["coverage_relaxed"] is False
    assert sol["coverage_placed"] == 8, sol["coverage_placed"]


def test_grade_rotation_filters_candidate_days():
    # A specialist whose grade_rotation only allows grade 1 on Mon and grade 2 on
    # Tue must never place grade 1 on Tue (or grade 2 on Mon).
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    classes = [{"teacher_id": "t1", "grade": "1", "planning_minutes": 0},
               {"teacher_id": "t2", "grade": "2", "planning_minutes": 0}]
    # Every day is listed, so the rotation is a real restriction: grade 1 only on
    # Mon/Wed/Fri, grade 2 only on Tue/Thu (an unlisted day would be unrestricted).
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45,
              "grade_rotation": {"Mon": ["1"], "Tue": ["2"], "Wed": ["1"], "Thu": ["2"], "Fri": ["1"]}}]
    slots = {g: _grid(days, [480, 540]) for g in ["1", "2"]}
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": [None], "time_limit_s": 10})
    assert sol["status"] == "OPTIMAL", sol["status"]
    _assert_legal(sol)
    for b in sol["blocks"]:
        if b["grade"] == "1":
            assert b["day"] in ("Mon", "Wed", "Fri"), f"grade 1 placed on a rotation-forbidden day: {b}"
        if b["grade"] == "2":
            assert b["day"] in ("Tue", "Thu"), f"grade 2 placed on a rotation-forbidden day: {b}"


def test_cart_specialist_avoids_back_to_back_when_possible():
    # A cart specialist (rooms change between classes) should not teach two sessions
    # within the cart buffer when a spread-out placement is available and optimal.
    # Distinct grades → no clustering pressure; one working day isolates the cart term.
    classes = [{"teacher_id": "t0", "grade": "1", "planning_minutes": 0},
               {"teacher_id": "t1", "grade": "2", "planning_minutes": 0}]
    specs = [{"id": "pe", "subject": "PE", "working_days": ["Mon"], "grades": None, "duration": 45, "uses_cart": True}]
    # Mon rows: 480-525 and 530-575 are back-to-back (gap 5 < 15 buffer); 700 is far.
    slots = {g: [{"day": "Mon", "start": s, "end": s + 45} for s in [480, 530, 700]] for g in ["1", "2"]}
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": [None], "time_limit_s": 10, "cart_buffer": 15})
    assert sol["status"] == "OPTIMAL", sol["status"]
    pe = sorted((b for b in sol["blocks"] if b["specialist_id"] == "pe"), key=lambda b: b["start"])
    assert len(pe) == 2, pe
    gap = pe[1]["start"] - pe[0]["end"]
    assert gap >= 15, f"cart specialist should avoid a back-to-back move, gap was {gap}: {pe}"


def test_am_pm_and_day_preferences_are_honored_when_free():
    # Ample capacity so honoring costs nothing: an AM-preferring class lands in the
    # morning; a Wed-preferring class lands on Wednesday.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    classes = [{"teacher_id": "t_am", "grade": "1", "planning_minutes": 0, "am_pm_preference": "AM"},
               {"teacher_id": "t_wed", "grade": "2", "planning_minutes": 0, "day_preference": "Wed"}]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45}]
    # Both AM (600) and PM (800) rows every day.
    slots = {g: [{"day": d, "start": s, "end": s + 45} for d in days for s in [600, 800]] for g in ["1", "2"]}
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": [None], "time_limit_s": 10})
    assert sol["status"] == "OPTIMAL", sol["status"]
    _assert_legal(sol)
    am = [b for b in sol["blocks"] if b["teacher_id"] == "t_am"]
    assert am and all(b["start"] < 720 for b in am), f"AM preference not honored: {am}"
    wed = [b for b in sol["blocks"] if b["teacher_id"] == "t_wed"]
    assert wed and all(b["day"] == "Wed" for b in wed), f"day preference not honored: {wed}"


# ─── Prior-audit regression matrix (exact failure signatures) ──────────────
# Each of these pins the SPECIFIC behavior a prior review flagged as broken —
# not a looser proxy that was green even while the bug was live.

def test_aa_bb_week_labels():
    # OLD BUG: aa_bb_week schools were solved as a single week (labels dropped), so
    # the two-week rotation never materialized. NEW: opaque ["AA","BB"] two-timeline
    # solve; EVERY returned block carries an AA/BB label and both weeks are used.
    # Edge wiring confirmed separately: _spec_builder.ts:188 sends ["AA","BB"] for
    # aa_bb_week specifically (["A","B"] for ab_week), asserted in
    # generate-cpsat/_spec_builder_test.ts ("aa_bb_week → opaque labels [AA,BB]").
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    gs = [str(n) for n in range(8)]
    classes = [{"teacher_id": f"t{n}", "grade": gs[n], "planning_minutes": 45} for n in range(8)]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45}]
    slots = {g: [{"day": d, "start": 480, "end": 525} for d in days] for g in gs}
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": ["AA", "BB"], "time_limit_s": 10})
    assert sol["status"] in ("OPTIMAL", "FEASIBLE"), sol["status"]
    assert sol["blocks"], "expected placed blocks"
    labels = {b["week_label"] for b in sol["blocks"]}
    assert labels <= {"AA", "BB"}, f"non-AA/BB label leaked: {labels}"
    assert labels == {"AA", "BB"}, f"both rotation weeks must be used, got {labels}"
    assert all(b["week_label"] in ("AA", "BB") for b in sol["blocks"])


def test_quick_30_no_silent_hole():
    # OLD BUG: a 30-min specialist alongside 45-min specialists got ZERO sessions
    # (no 30-min slot matched the single grid) while status stayed OPTIMAL — a silent
    # hole. NEW: per-duration slots_by_grade_duration; the 30-min specialist's session
    # count is > 0 and equals its full coverage_required contribution (one per class).
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    classes = [{"teacher_id": f"t{g}_{n}", "grade": g, "planning_minutes": 0}
               for g in ["1", "2"] for n in range(2)]  # 4 classes
    specs = [
        {"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45},
        {"id": "art", "subject": "Art", "working_days": days, "grades": None, "duration": 45},
        {"id": "mind", "subject": "Mindfulness", "working_days": days, "grades": None, "duration": 30},
    ]
    slots45 = [{"day": d, "start": s, "end": s + 45} for d in days for s in [480, 540, 600]]
    slots30 = [{"day": d, "start": s, "end": s + 30} for d in days for s in [660, 700, 740]]
    sol = solve({
        "classes": classes, "specialists": specs,
        "slots_by_grade_duration": {"1": {45: slots45, 30: slots30}, "2": {45: slots45, 30: slots30}},
        "week_labels": [None], "time_limit_s": 10, "min_sessions_per_pair": 1,
    })
    assert sol["status"] in ("OPTIMAL", "FEASIBLE"), sol["status"]
    mind = [b for b in sol["blocks"] if b["specialist_id"] == "mind"]
    assert len(mind) > 0, "30-min specialist got ZERO sessions (the silent-hole bug)"
    # its coverage_required contribution = one session per class it can teach (all 4)
    assert len(mind) == len(classes), f"30-min specialist under-covered: {len(mind)} of {len(classes)}"
    assert all(b["end"] - b["start"] == 30 for b in mind), mind


def test_big_group_group_id():
    # OLD BUG: taught-together Big-Group members (same specialist+slot) were flagged as
    # a double-book. NEW: a shared group_id makes them ONE specialist interval + one
    # teacher interval each → FEASIBLE, both member blocks present. Companion: the SAME
    # two fixed sessions WITHOUT a group_id stay INFEASIBLE (a genuine double-book is
    # still a LOUD failure, never silently dropped).
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    starts = [480, 540, 600]
    classes = [{"teacher_id": "t0", "grade": "4", "planning_minutes": 0},
               {"teacher_id": "t1", "grade": "4", "planning_minutes": 0}]
    specs = [{"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45}]
    base = {"classes": classes, "specialists": specs, "slots_by_grade": {"4": _grid(days, starts)},
            "week_labels": [None], "time_limit_s": 10}

    grouped = solve({**base, "fixed": [
        {"teacher_id": "t0", "specialist_id": "pe", "grade": "4", "day": "Mon", "start": 480, "end": 525, "group_id": "g1"},
        {"teacher_id": "t1", "specialist_id": "pe", "grade": "4", "day": "Mon", "start": 480, "end": 525, "group_id": "g1"},
    ]})
    assert grouped["status"] in ("OPTIMAL", "FEASIBLE"), grouped["status"]
    tg = [b for b in grouped["blocks"] if b["specialist_id"] == "pe" and b["day"] == "Mon" and b["start"] == 480]
    assert {b["teacher_id"] for b in tg} == {"t0", "t1"}, f"both members must appear: {tg}"

    ungrouped = solve({**base, "fixed": [
        {"teacher_id": "t0", "specialist_id": "pe", "grade": "4", "day": "Mon", "start": 480, "end": 525},
        {"teacher_id": "t1", "specialist_id": "pe", "grade": "4", "day": "Mon", "start": 480, "end": 525},
    ]})
    assert ungrouped["status"] == "INFEASIBLE", f"genuine double-book must stay INFEASIBLE, got {ungrouped['status']}"


def test_extra_rotation_two_per_pair():
    # OLD BUG: extra_rotation never produced a real 2nd session. NEW: sessions_per_pair
    # (a GLOBAL cap — the schema has no per-specialist override) lets a pair reach 2
    # sessions, spaced onto DIFFERENT days. A pair that only has one working day stays
    # at 1 because the day-spacing constraint forbids a 2nd same-day session.
    days = ["Mon", "Tue", "Wed", "Thu", "Fri"]
    classes = [{"teacher_id": "t0", "grade": "1", "planning_minutes": 0}]
    specs = [
        {"id": "pe", "subject": "PE", "working_days": days, "grades": None, "duration": 45},   # 5 days
        {"id": "solo", "subject": "Solo", "working_days": ["Mon"], "grades": None, "duration": 45},  # 1 day
    ]
    slots = {"1": [{"day": d, "start": s, "end": s + 45} for d in days for s in [480, 540, 600]]}
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": [None], "time_limit_s": 10, "sessions_per_pair": 2})
    assert sol["status"] == "OPTIMAL", sol["status"]
    pe = [b for b in sol["blocks"] if b["specialist_id"] == "pe"]
    solo = [b for b in sol["blocks"] if b["specialist_id"] == "solo"]
    assert len(pe) == 2, f"multi-day pair should reach the 2-session cap, got {len(pe)}"
    assert pe[0]["day"] != pe[1]["day"], f"the 2 sessions must be spaced across days: {pe}"
    assert len(solo) == 1, f"single-day pair can't be spaced, must stay at 1, got {len(solo)}"


def test_grade_duration_override_places_30min_for_that_grade_only():
    # quick_30: grade K overridden to 30 minutes; grade 3 keeps the specialist's 45.
    days = ["Mon", "Tue"]
    classes = [
        {"teacher_id": "tk", "grade": "K", "planning_minutes": 0},
        {"teacher_id": "t3", "grade": "3", "planning_minutes": 0},
    ]
    specs = [{"id": "art", "subject": "Art", "working_days": days, "grades": None, "duration": 45}]
    sbgd = {
        "K": {"30": _grid(days, [480, 540, 600], dur=30), "45": _grid(days, [480, 540, 600], dur=45)},
        "3": {"30": _grid(days, [480, 540, 600], dur=30), "45": _grid(days, [480, 540, 600], dur=45)},
    }
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade_duration": sbgd,
                 "week_labels": [None], "time_limit_s": 10,
                 "grade_duration_overrides": {"K": 30}})
    assert sol["status"] == "OPTIMAL", sol["status"]
    _assert_legal(sol)
    k = [b for b in sol["blocks"] if b["grade"] == "K"]
    g3 = [b for b in sol["blocks"] if b["grade"] == "3"]
    assert k and all(b["end"] - b["start"] == 30 for b in k), f"K must run 30-min sessions: {k}"
    assert g3 and all(b["end"] - b["start"] == 45 for b in g3), f"grade 3 must keep 45: {g3}"


def test_grade_duration_override_without_grid_is_model_invalid():
    # An override grade with no matching-duration grid is a hard spec error,
    # matching the existing no-silent-hole philosophy.
    days = ["Mon"]
    classes = [{"teacher_id": "tk", "grade": "K", "planning_minutes": 0}]
    specs = [{"id": "art", "subject": "Art", "working_days": days, "grades": None, "duration": 45}]
    sbgd = {"K": {"45": _grid(days, [480, 540], dur=45)}}  # no 30-min grid
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade_duration": sbgd,
                 "week_labels": [None], "time_limit_s": 5,
                 "grade_duration_overrides": {"K": 30}})
    assert sol["status"] == "MODEL_INVALID", sol["status"]
    assert "30-min slot grid" in sol["message"], sol["message"]


def test_grade_day_spread_prefers_single_grade_days():
    # 2 grades x 2 classes, ONE specialist, 2 days, exactly 2 slots/day. With
    # grade_day_spread active the only zero-penalty layout groups each grade
    # onto its own day (beating subject_day_clustering's pull to mix).
    days = ["Mon", "Tue"]
    classes = [
        {"teacher_id": "t1a", "grade": "1", "planning_minutes": 0},
        {"teacher_id": "t1b", "grade": "1", "planning_minutes": 0},
        {"teacher_id": "t2a", "grade": "2", "planning_minutes": 0},
        {"teacher_id": "t2b", "grade": "2", "planning_minutes": 0},
    ]
    specs = [{"id": "art", "subject": "Art", "working_days": days, "grades": None, "duration": 45}]
    slots = {"1": _grid(days, [480, 540]), "2": _grid(days, [480, 540])}
    # full_week_coverage (+100/grade touching every day) is zeroed: with one
    # specialist it would trivially force mixing and mask the cluster-vs-spread
    # interaction this test pins down (real schools reach full-week via multiple
    # specialists while each still teaches one grade per day).
    sol = solve({"classes": classes, "specialists": specs, "slots_by_grade": slots,
                 "week_labels": [None], "time_limit_s": 10,
                 "weights": {"full_week_coverage": 0}})
    assert sol["status"] == "OPTIMAL", sol["status"]
    _assert_legal(sol)
    assert len(sol["blocks"]) == 4, sol["blocks"]
    grades_by_day = {}
    for b in sol["blocks"]:
        grades_by_day.setdefault(b["day"], set()).add(b["grade"])
    for day, gs in grades_by_day.items():
        assert len(gs) == 1, f"{day} mixes grades {gs} - grade_day_spread should group same-grade days"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"ok  {t.__name__}")
    print(f"all {len(tests)} solver tests passed")
