"""Unit tests for the memory-aware worker cap (pure, no OR-Tools needed).

Run:  cd solver && python -m pytest test_memory.py -q   (or: python test_memory.py)
"""
from _memory import estimate_model_cells, safe_worker_count

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"]


def _spec(n_classes, n_specialists, slots_per_grade=40, weeks=1):
    grades = ["K", "1", "2", "3", "4", "5"]
    classes = [{"teacher_id": f"t{i}", "grade": grades[i % len(grades)]} for i in range(n_classes)]
    specialists = [{"id": f"s{j}", "subject": f"S{j}", "duration": 45} for j in range(n_specialists)]
    slots = [{"day": d, "start": 480 + k * 50, "end": 525 + k * 50} for d in DAYS for k in range(slots_per_grade // len(DAYS))]
    sbgd = {g: {"45": slots} for g in grades}
    return {
        "classes": classes,
        "specialists": specialists,
        "slots_by_grade_duration": sbgd,
        "week_labels": ["A", "B"] if weeks == 2 else [None],
    }


def test_small_model_keeps_all_requested_workers():
    # ~24 classes x 6 specialists, single week — comfortably fits 4 workers at 512 MB.
    spec = _spec(24, 6, weeks=1)
    assert safe_worker_count(spec, requested=4, memory_mb=512) == 4


def test_large_ab_model_drops_to_one_worker_on_free_tier():
    # ~48 classes x 10 specialists x A/B ≈ 38k cells — OOM'd at 2 and 4 workers on
    # 512 MB (measured), survives on 1, so the cap must drop it to 1.
    spec = _spec(48, 10, weeks=2)
    assert safe_worker_count(spec, requested=4, memory_mb=512) == 1


def test_same_large_model_keeps_workers_with_more_ram():
    # 2 GB has ~4x the budget → the big model can use the full 4 workers.
    spec = _spec(48, 10, weeks=2)
    assert safe_worker_count(spec, requested=4, memory_mb=2048) == 4


def test_never_below_one_or_above_requested():
    spec = _spec(200, 40, weeks=2)  # absurdly large
    assert safe_worker_count(spec, requested=4, memory_mb=512) == 1
    assert safe_worker_count(_spec(1, 1), requested=2, memory_mb=2048) == 2  # cap never raises above requested


def test_empty_model_is_safe():
    assert safe_worker_count({"classes": [], "specialists": []}, requested=4, memory_mb=512) == 4
    assert estimate_model_cells({}) == 0


if __name__ == "__main__":
    import sys
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print(f"ok  {fn.__name__}")
    print(f"\n{len(fns)} passed")
    sys.exit(0)
