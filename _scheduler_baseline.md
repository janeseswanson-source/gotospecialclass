# Scheduler Baseline (Phase 1A)

**Date:** 2026-05-26
**Generator:** `supabase/functions/generate-schedule/index.ts` (1,443 lines, pre-fix)
**Test school:** `Demo Elementary 450` (`cf0603f1-5df5-4c0e-81d1-ccb9d1b333fe`)
**Generation:** `1ec8bc7a-a2fb-4d0e-a589-fcb8e3d350b7` (version 1, generated 2026-05-25)

> **Source note:** the preview session was unauthenticated, so a fresh `POST /generate-schedule`
> returns 401 from the in-function `auth.getUser()` check. Baseline metrics are pulled from the
> most recent generation already persisted by the current code against this school. All metrics
> below are properties of the same generator binary we are about to modify.

---

## School profile

| Field | Value |
|---|---|
| Grades served | K, 1, 2, 3, 4, 5 |
| School hours | 07:45 – 14:00 (375 min/day, 1875 min/week) |
| Default planning_minutes (school) | 225 |
| Default lunch_minutes (school) | 30 |
| Specialists | 6 (Art, Music, PE, Tech, Library, Science) |
| Classroom teachers | 18 |

---

## Totals

| Metric | Value |
|---|---|
| Total blocks generated | **63** |
| Blocks with `specialist_id IS NULL` | 3 (expected — admin/PLC pre-seeded blocks) |
| Blocks with `specialist_id = ''` (empty string) | **0** in this run |
| Distinct grades scheduled | 5 of 6 (Grades 4 and 5 not covered) |
| Distinct days scheduled | 5 |

> Note: `specialist_id` is already `NULL`-able on `schedule_blocks` (verified via
> `information_schema`). FIX-P1-4 therefore does **not** require a column migration —
> only a code change from `?? ""` to `?? null`.

---

## Warnings (current generator output)

```json
[
  { "type": "no_coverage", "severity": "error",
    "message": "Grade 4 has no specialist sessions.",
    "suggestion": "Add more specialists or enable A/B Week." },
  { "type": "no_coverage", "severity": "error",
    "message": "Grade 5 has no specialist sessions.",
    "suggestion": "Add more specialists or enable A/B Week." }
]
```

| Type | Count |
|---|---|
| `no_coverage` | 2 |
| `double_booked` | 0 |
| (everything else) | 0 |

Total: **2 warnings**.

---

## Weekly teaching load per specialist (silent-overload check)

Available pool per spec = `school_hours − weekly_planning − weekly_lunch`
= `1875 − 225 − 150` = **1500 min/week** (using school defaults; every spec has
`weekly_planning_minutes = 0` and `lunch_minutes = 30/day`).

| Specialist | Subject | Teaching min/wk | Free min/wk | Overloaded? |
|---|---|---:|---:|---|
| Alex Romano | Science | 450 | 1050 | no |
| Dana Okafor | Music | 450 | 1050 | no |
| Lin Harper | Library | 450 | 1050 | no |
| Mike Patel | PE | 450 | 1050 | no |
| Sarah Mendoza | Art | 450 | 1050 | no |
| Tess Brennan | Tech | 450 | 1050 | no |

**Silent overloads: 0.** Note `weekly_planning_minutes = 0` everywhere means the
upcoming FIX-P1-5 validator will fall back to `school.planning_minutes = 225`,
which is satisfied here — no `planning_shortfall` warnings expected.

---

## Calendar events present but unused

`parsed_calendar_events` for this school (approved=true):

| event_type | count |
|---|---:|
| first_day | 1 |
| last_day | 1 |
| holiday | 2 |
| early_release | 1 |
| event | 3 |

**None of these influenced the generated schedule.** No `skipped_holiday`,
`calendar_one_off`, or any other calendar-derived warning appears in the
generation's `warnings` JSON. Confirms the known FIX-P1-1 bug:
`getBlockedDayTimeRanges` receives `calendarEvents` but never reads it.

---

## Generation wall time

Not directly measured (historical run, no timing column). The
`schedule_generations` row records only `generated_at`. Wall-time deltas will
be captured live during phase 1B + 1C verification.

---

## Items that will move in Phase 1B

| Fix | Expected baseline delta |
|---|---|
| FIX-P1-1 calendar | New `skipped_holiday` / `calendar_one_off` info warnings if recurring no-school days exist; one-offs ≥ 4 holidays here so unlikely to trip the “≥2 same weekday” threshold — most likely a few `calendar_one_off` infos. |
| FIX-P1-2 extra_rotation | `double_booked` already 0 on this run because no conflict-grade strategies fired. Will resurface as `extra_rotation_failed` warnings only when that strategy is actually selected. |
| FIX-P1-3 A/B occupancy | No A/B strategy in use on this school, so no observable delta here; verified separately. |
| FIX-P1-4 empty UUIDs | Already 0 empty IDs in this run; code change is preventative. |
| FIX-P1-5 planning enforcement | Expected 0 `planning_shortfall` warnings (load below threshold). |
| FIX-P1-6 PLC grade lock | 3 null-spec admin blocks present; need to verify no specialist block lands on the same `(grade, day, slot)` after the fix. |

---

## Ready for Phase 1B

Baseline locked. Awaiting `phase 1b` to apply the six correctness fixes.
