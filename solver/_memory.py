"""Memory-aware search-worker cap (pure, no OR-Tools dependency so it is unit-testable).

CP-SAT runs `num_search_workers` parallel copies of the model, so peak RAM scales
with (model size x workers). On a small instance a big model with several workers
gets OOM-killed by the kernel mid-solve — which returns an empty-body 502 AND
restart-loops the container, so it also breaks OTHER schools' generations.

Rather than crash, we cap the worker count for large models so the solve degrades
(fewer workers = a weaker result, and the caller's JS fallback can still take over)
while the service stays UP for everyone else. On a properly-sized instance the cap
never binds and full parallelism is used.

Calibration (measured on a 512 MB Render free instance, 45-min classes, ~40
slots/grade): a ~5.8k-cell model runs fine on 4 workers; a ~38k-cell model OOM-kills
at 2 and 4 workers but survives on 1. So the safe budget (workers x cells) at 512 MB
is ~40k. Scale that by the actual instance RAM via SOLVER_MEMORY_MB.
"""
from __future__ import annotations

# Safe budget of (workers x model-cells) per 512 MB of instance RAM.
CELLS_PER_WORKER_PER_512MB = 40_000


def estimate_model_cells(spec: dict) -> float:
    """Rough proxy for CP-SAT model size: one assignment variable per
    (class, specialist, candidate slot, week). Uses average slots/grade so a
    missing grade grid doesn't zero it out."""
    classes = spec.get("classes") or []
    specialists = spec.get("specialists") or []
    weeks = max(1, len(spec.get("week_labels") or [None]))

    slot_counts: list[int] = []
    for by_dur in (spec.get("slots_by_grade_duration") or {}).values():
        if isinstance(by_dur, dict):
            slot_counts.append(sum(len(v or []) for v in by_dur.values()))
    for lst in (spec.get("slots_by_grade") or {}).values():
        slot_counts.append(len(lst or []))
    avg_slots = (sum(slot_counts) / len(slot_counts)) if slot_counts else 40.0

    return len(classes) * len(specialists) * avg_slots * weeks


def safe_worker_count(spec: dict, requested: int, memory_mb: int) -> int:
    """Largest worker count that should fit the model in `memory_mb`, never above
    `requested` and never below 1."""
    requested = max(1, int(requested))
    cells = estimate_model_cells(spec)
    if cells <= 0:
        return requested
    budget = CELLS_PER_WORKER_PER_512MB * (max(128, memory_mb) / 512.0)
    fits = int(budget // cells)
    return max(1, min(requested, fits))
