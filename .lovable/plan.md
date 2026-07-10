## Problem

On Setup → Specialists, adding a second (or later) specialist card looks fine in the UI, but after refresh only the first one is there. No error toast appears, so the autosave path is silently dropping rows.

## Diagnosis

`src/pages/setup/steps/StepSpecialists.tsx` autosaves through a debounced upsert. Two likely culprits fit "silent loss of 2nd+ rows":

1. **Blank-name filter drops in-progress rows.** `autoSave` filters `items.filter(s => s.name.trim())` before upserting. If the user clicks a Quick Add tile (which creates a card with an empty name) and then navigates away, switches tabs inside the wizard, or refreshes before typing a name, the row is never persisted — even though it's visible on screen and looks "added." The current UX gives no signal that untyped rows aren't real yet.
2. **Debounce race across quickly-added cards.** Each keystroke re-arms the same 1s timer. If the user adds card #2 and starts editing card #2 while the previous autosave for card #1 is still in flight, both saves run concurrently. `existing` is fetched twice, `toDelete` computed twice, and the two upserts can interleave. In practice this rarely deletes anything (because `keepIds` includes all cards), but combined with (1) any card that briefly held a blank name during a race gets skipped.

The RLS policy, schema, and constraints on `public.specialists` are fine — no unique constraint conflicts, no NOT NULL trap. So the fix is entirely in the client autosave logic + a small UX safeguard.

## Fix (frontend only, `StepSpecialists.tsx`)

1. **Persist blank rows too, so nothing disappears silently.** Remove the `name.trim()` filter from the upsert payload. The `specialists` DB row already tolerates an empty name in practice (we always send a string), and the setup wizard's Review step already treats un-named rows as incomplete. This makes the UI the source of truth: what you see on the card is what's saved.
   - Small guard: if `name` really must be non-empty at the DB layer, coerce to a placeholder like `"(Unnamed specialist)"` on save and treat that as "incomplete" downstream, so the row still round-trips.
2. **Serialize autosaves.** Replace the "debounced-then-fire-and-forget" pattern with a `savingRef` gate:
   - If a save is already in flight when the debounce fires, mark `pendingRef = true` and return.
   - When the in-flight save resolves, if `pendingRef` is set, immediately re-run `autoSave(latestRef.current)`.
   This removes the concurrent-upsert race without changing the debounce feel.
3. **Save on card add.** In `addSpecialist` (and the Quick Add tiles), call `autoSave(next)` immediately with the new array (bypassing debounce). This guarantees a blank-but-visible card exists in the DB the moment it's on screen, so it survives navigation even if the user never types.
4. **Verify visibly.** After the change, drive the wizard with Playwright to add three specialists (Art, Music, PE), type a name in each, wait for "Saved", refresh, and confirm all three come back. Capture screenshots at each step.

## Out of scope

- No schema changes, no RLS changes, no changes to any other setup step.
- No changes to import / AI-fill paths (`handleTemplateUpload`, `runAiFallback`) — they already `setSpecialists(prev => [...prev, ...imported])` which the new autosave path will pick up correctly.

## Files touched

- `src/pages/setup/steps/StepSpecialists.tsx` — autosave gate, remove blank-name filter, save-on-add.
