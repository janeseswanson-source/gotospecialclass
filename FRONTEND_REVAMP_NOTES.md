# Master Schedule Frontend Revamp — Notes

Living document for the Master Schedule rewrite. Records the current data flow,
the new component structure, and which edge field each "power" reads. **Frontend
only** — the solver, SSOT validator, and scoring rubric are not changed (one
sanctioned minimal exception: threading the already-computed confidence signal
through to the generation row so the UI can read it).

---

## 1. Current data flow (the monolith)

`src/pages/schedule/MasterSchedulePage.tsx` (~1,428 lines) does everything:

- **Load** (`loadGenerations`): pulls `schedule_generations` (all versions, desc),
  `specialists`, `classroom_teachers`, `recess_lunch_config`, `clubs`, `schools`
  (hours + recess bands), approved `parsed_calendar_events`. Picks the newest
  generation, parses its `quote`.
- **Load blocks** (`loadBlocks`): `schedule_blocks` for the selected generation →
  `mapBlocks` into `BlockData` (carries `placement_reason`, `ai_explanation`,
  `notes`, `is_override`, `week_label`). Resets locks + history, seeds the week
  filter, runs `analyzeScheduleBlocks` for warnings, and fire-and-forgets
  `explain-schedule` to backfill missing `ai_explanation`s.
- **Edit**: optimistic drag/drop (`handleBlockDrop` → move or swap, validated by
  the SSOT-mirror `computeConflictIds`/`computeAutoFit`/`placementProblem`, then
  persisted), `handleSaveOverride` (specialist/room/subject), `handleNotesChange`,
  `toggleLock` (client-only set). Undo/redo via a `history` stack.
- **AI**: `ScheduleChatPanel` (propose→confirm→apply, keep), `handleResolveWithAI`
  (calls `resolve-conflicts-ai`), `handleReplan` (`replan-subgraph`),
  `explain-schedule`, `verify-schedule` results shown read-only.
- **Render**: BrandedHeader → toolbar (undo/redo, locked badge, version tab bar,
  Compare select, density toggle, Edit-with-AI, Explain, Export menu) → review
  bar (pending → Accept/Edit/Regenerate) → strategy badge + fallback alert → diff
  bar → quote → replan banner → warning panel (errors/warnings/info + "Fix with
  AI") → 3-tab grid (Master / By Specialist / By Teacher) with a `ScrabbleTray`
  for conflicts, plus an optional "Explain" sidebar → EditBlockDialog + export
  modals + ScheduleChatPanel.

### Existing scaffolding we reuse (don't rebuild)
- **Perturbation highlight**: `recentChangedIds` + `flagChangedBlocks` already
  glow moved blocks and scroll them into view (power 4 foundation).
- **Version compare**: `diffGenId`/`diffBlocks`/`showDiff` + `diffData` memo
  (power 4/6 foundation) — currently a key-set add/removed count.
- **Undo/redo**: `history`/`historyIndex` (supports power 4 "offer undo").
- **Replan**: `replanSuggestion` + `handleReplan` → `replan-subgraph` (power 4).

---

## 2. Edge response shapes the UI reads (verified)

| Function | Key fields the UI uses |
|---|---|
| `generate-schedule` | `score_breakdown`, `winning_score`, `sa_iterations`, `sa_improvement`; **NEW: `quality_confidence`** (threaded below) |
| `refine-schedule` (Phase 1) | `improved`, `generation_id`, `refined_from_generation_id`, `version`, `quality_percent`, `previous_quality_percent`, `moved_from_baseline`, `score_breakdown`, `confidence`, `sa_iterations`, `lns_rounds` |
| `resolve-conflicts-ai` (Phase 3, **shape changed**) | `resolved`, `applied`, `escalated`, `escalations[].{reason, conflicting_constraints}`, `summary`, `rationale[].{change, why}`, `errors` |
| `update-scoring-weights` (Phase 4, **shape changed**) | propose → `{ proposed, summary, deltas[].{key, from, to, direction, reason}, proposed_weights, confirm_hint }`; confirm → `{ applied, sample_count, weights }` |
| `replan-subgraph` | `replanned`, `new_generation_id`, `blocks_count`, `warnings_count`, `message` |
| `explain-schedule` | backfills `schedule_blocks.ai_explanation` |

DB columns on `schedule_generations`: `score_breakdown`, `winning_score`,
`sa_iterations`, `sa_improvement`, `verify_quality_score`/`verify_issues_found`/
`verify_summary`, `review_state`, `feedback_signal`, `refined_from_generation_id`,
**NEW `quality_confidence`**. Learnable-weights proposals live on
`scoring_weight_profiles.proposed_weights` (not on the generation — task brief was
slightly off here).

> **Two shape changes from the engine work must be handled:** the old
> `handleResolveWithAI` read `{updates, deletes, inserts}` (gone) and the old
> auto-`update-scoring-weights` call assumed silent auto-apply (now propose-only).
> Powers 5 and 7 update the UI to the new, human-gated shapes.

### Confidence threading (the one sanctioned engine touch)
`_confidence.ts::computeQualityConfidence` exists but is only used inside
`_refine.ts`; `generate-schedule` never returns or persists it. Minimal change:
migration adds `quality_confidence jsonb` to `schedule_generations`;
`generate-schedule`'s background `finalize()` computes and persists it (and
returns it); `refine-schedule` persists its richer confidence on the refined
version. Shape: `{ assessment: "near_optimal"|"more_headroom"|"structurally_limited",
recommendation, convergence, headroom, gapQualityPoints, ... }`.

---

## 3. New component structure (decomposition)

`MasterSchedulePage.tsx` → thin orchestrator (data loading + state) composing:

| Component | Power(s) | Reads |
|---|---|---|
| `QualityPanel` | 1 confidence, 2 human score | `quality_confidence`, `score_breakdown` (→ `breakdownToPercent` + `scoreSummary`) |
| `WeekGrid` | hero grid | `BlockData[]`, time slots, recess bands, conflict/lock/highlight sets |
| `BlockInspector` | 3 explainability (+ edit/lock/notes consolidation) | `placement_reason`/`ai_explanation` (+ `explain-schedule` on demand) |
| `ConflictResolver` | 5 cascade | `resolve-conflicts-ai` ranked options + escalation |
| `VersionCompare` | 4 & 6 diff | two generations' blocks → `scheduleDiff` |
| `RefinementBanner` | 6 background refinement | `refined_from_generation_id`, `refine-schedule` |
| `WeightProposal` | 7 learnable weights | `scoring_weight_profiles.proposed_weights` + `update-scoring-weights` confirm |
| `ScheduleToolbar` | — | version selector, filters, exports, primary actions |
| `ScheduleChatPanel` | — (keep) | propose→confirm→apply (restyled) |

Pure, tested helpers (no UI):
- `lib/scoreSummary.ts` — `score_breakdown` + `quality_confidence` → human "what's
  working / what it cost" + confidence copy (powers 1–2).
- `lib/scheduleDiff.ts` — diff two block sets → moved/added/removed by stable
  identity (powers 4 & 6); "Only N classes moved".
- `lib/conflictOptions.ts` — format engine cascade options for display (power 5).

---

## 4. Invariants (frontend)
- The UI never decides legality or invents a placement. Existing drag/drop uses
  the SSOT-mirror (`computeConflictIds`) only for immediate "can't drop here"
  feedback and persists the validated result; conflict *fixes* go through
  `resolve-conflicts-ai` (engine resolves, LLM narrates). New code asks the engine.
- `scoringConstants.ts` is read-only here; never change the displayed quality %.
- No `localStorage`/`sessionStorage` for schedule state.
- Refinements and weight changes stay **human-gated** (review/confirm).
- `prefers-reduced-motion` respected for all change-communicating motion.

---

## 5. Build log
(updated per component)
