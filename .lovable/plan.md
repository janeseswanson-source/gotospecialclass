
## Problem

After Quick-Adding several specialists, the "Saved" indicator lights up, but pressing Continue leaves the database with only the very first specialist (e.g. Swanson/Art). Confirmed against production data — the school has exactly one specialist row despite multiple being added on screen.

## Root cause

`StepSpecialists` uses a fragile **"delete everything missing + upsert all"** autosave pattern, driven by two overlapping timers (a 1s useEffect debounce and a 0ms save inside `addSpecialist`) and coalesced through a single `pendingRerunRef` boolean.

Any autosave call that fires with a stale `items` array will nuke rows that were just added by a concurrent save, because `keepIds` is derived from that stale array and everything else in the DB gets deleted. The `savingRef` / `pendingRerunRef` gate only guarantees that ONE rerun happens after the in-flight save — it does not guarantee the winning save uses the freshest state on every race, especially when Continue triggers unmount mid-flight.

## Fix

Replace "delete missing + upsert all" with **per-card operations**. Deletions only happen when the user explicitly deletes a card. Saves only ever touch the row(s) that changed. This eliminates the entire class of "one save wipes out other rows" races.

### `src/pages/setup/steps/StepSpecialists.tsx`

1. **Remove the delete-missing block** from `autoSave`. It becomes a pure upsert.

2. **Add `deleteSpecialist(id)`** — the ONLY code path that deletes from the DB. Called by the trash icon and the pending-delete confirm dialog. The current `remove()` handler also calls this.

3. **Immediate insert on Quick Add.** `addSpecialist` awaits a single-row upsert to the DB before/while updating local state — so the new card exists in the DB the instant it appears on screen. No dependence on the debounced autosave to persist new cards.

4. **Per-card debounced upsert on edit.** Replace the whole-array debounce with a `Map<id, timer>` keyed by specialist id. Editing card X schedules a 800ms upsert of card X only. Editing card Y schedules a separate timer for card Y. Concurrent edits never conflict.

5. **Flush on unmount** iterates the per-card timer map and awaits all pending upserts (Promise.all), guaranteeing every dirty card is saved before Continue navigates.

6. **Bulk import path** (`Upload Filled Template` → line ~632 and ~677): after `setSpecialists(prev => [...prev, ...imported])`, immediately `upsert(imported)` in one call, so imports are persisted atomically without relying on the debounce.

7. **Remove the `savingRef` / `pendingRerunRef` gate** — no longer needed. Per-card serialization is achieved by the per-card debounce map: a new edit to card X clears the previous card-X timer before scheduling a new one.

8. **Keep the "(Unnamed specialist)" placeholder** for blank names so NOT NULL still passes.

9. **Save status indicator** remains: any per-card save flips status to 'saving' → 'saved' → 'idle' after 2s.

### Files touched
- `src/pages/setup/steps/StepSpecialists.tsx` — autoSave/addSpecialist/remove/useEffect rewritten as described.

### Out of scope
- No schema changes, no RLS changes, no changes to the Teachers step, Setup wizard shell, or `useFlushOnUnmount`.
- No changes to the import parser, PLUS rotation matrix, or the card UI itself.

## Technical notes

The current 1s debounce + "delete everything not in items" pattern was chosen for simplicity but is incompatible with rapid successive edits: any save that runs with a stale `items` list will delete rows that a later save already inserted. Switching to per-card upsert + explicit delete removes the shared "keepIds" contention entirely — the same pattern the Teachers step (per-teacher upsert) already uses successfully.
