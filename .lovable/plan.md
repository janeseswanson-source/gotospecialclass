## Plan

### 1. Fix the Master Schedule grid alignment
- Change the generator so schedule start times use a shared school-day slot grid instead of each grade/specialist drifting on its own 5-minute/offset cursor.
- Keep valid exceptions for recess/lunch/early-release boundaries, but normalize generated teaching blocks to predictable starts.
- Add a safety normalization step before saving generated blocks so future schedules do not create staggered rows like 7:50, 7:55, 8:00, 8:05 unless the school config explicitly requires it.

### 2. Make drag/drop work with existing messy schedules
- Update the grid drop logic so it checks interval overlap, not just “same start time”.
- When dragging a block, snap the target to the nearest legal grid slot and allow moving the block out of its current interval without falsely detecting itself as occupied.
- Improve the rejection message so it names the real blocker instead of only saying the place is occupied.

### 3. Stabilize “Edit with AI” apply behavior
- Make AI-proposed moves/inserts snap to the same grid rules before validation.
- Validate proposed edits against the same overlap/hours/recess rules used by the generator before showing them as applyable.
- If the AI proposes an invalid edit, return a clear rejected proposal instead of applying something that scrambles the Master Grid.

### 4. Replace the infinite-loading “Fix with AI” path
- The current Fix button uses a separate legacy resolver that can receive `{}` from the AI gateway and fail silently.
- Rework it to either:
  - use the safer existing AI editor proposal/apply flow, or
  - add a hard timeout + explicit error path + no-op handling so the spinner always stops.
- Prefer not to auto-apply destructive AI changes without a review step.

### 5. Repair the blank published site, but only after deploy blockers are addressed
- The live site appears to be serving a stale/broken published bundle while the Lovable preview works.
- Before publishing, fix the critical backend security findings that currently block safe publish:
  - restrict `calendar-uploads` storage SELECT to the matching school/workspace,
  - restrict `calendar-uploads` INSERT to the matching school/workspace,
  - remove or replace the permissive `workspace_invites` SELECT policy.
- Run a fresh security scan, then publish once critical findings are clear.

## Technical notes
- Likely files/functions to modify:
  - `supabase/functions/generate-schedule/index.ts` — slot generation and saved block normalization.
  - `src/lib/scheduleGrid.ts` — snapping/overlap helpers.
  - `src/pages/schedule/MasterSchedulePage.tsx` — drag/drop, Fix button behavior, grid density behavior.
  - `supabase/functions/schedule-chat/index.ts` and `supabase/functions/apply-schedule-edits/index.ts` — AI edit proposal normalization/validation.
  - `supabase/functions/resolve-conflicts-ai/index.ts` — timeout/error handling or deprecation in favor of the safer flow.
  - A new backend migration for the storage/invite policy fixes.

## Validation
- Generate a fresh schedule and confirm Master Grid rows are aligned and readable.
- Drag a block to an open slot and confirm it moves/swaps only when legal.
- Use Edit with AI for a small move and confirm changes are proposed, reviewable, and applied without scrambling the grid.
- Click Fix with AI and confirm it either proposes changes or fails cleanly without infinite loading.
- Re-run security scan, then publish so the browser URL renders again.