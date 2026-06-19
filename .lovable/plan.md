# Remove sidebar "Prep" item + auto-skip PLUS Rotation when AI auto-fit is on

Two small, surgical changes.

---

## 1. Remove "Prep" from the sidebar

The page at `/app/prep` (`PrepPage`) is the pre-flight conflict-strategy + Generate Schedule launcher — useful, but its sidebar label "Prep" is confusing next to "Coordinator Prep". Drop the sidebar entry; keep the route reachable from its existing entry points (Coordinator Prep → Done, Master Schedule → "Re-generate", Onboarding Checklist → Generate Schedule).

**Edits**
- `src/components/layouts/AppSidebar.tsx` — remove the `{ label: 'Prep', icon: BookOpen, path: '/app/prep' }` item.
- `src/App.tsx` — keep the `/app/prep` route as-is (still reachable programmatically).
- No changes to `PrepPage.tsx`, `OnboardingChecklist.tsx`, or `MasterSchedulePage.tsx` — their `navigate('/app/prep')` calls continue to work.

**Out of scope**
- Folding PrepPage's content into Coordinator Prep — annotation said "Maybe remove?" and the user chose Remove. Re-evaluate later if users can't find the Generate button.

---

## 2. Auto-skip PLUS Rotation Matrix when the prep sheet says "AI auto-fit"

The `PlusRotationMatrix` renders per-specialist inside `StepSpecialists`. When the school's `plus_auto_fit === true` (set by Coordinator Prep when `plus_mode === 'ai_auto_fit'`), the matrix is irrelevant — the generator absorbs PLUS into the regular grid.

**Behavior**
- In `StepSpecialists.tsx`, read `schools.plus_auto_fit` once on mount (alongside the existing school fetch) and stash on a ref/state.
- When true: replace the per-specialist `<PlusRotationMatrix .../>` block with a compact info card:
  > **PLUS handled automatically.** Per your Coordinator Prep setting, the scheduler will fit PLUS into the regular weekly rotation. No matrix needed here. *Change this on the Coordinator Prep sheet → Special Rotations.*
- Persistence: don't clear `plus_rotation` data (preserve in case the coordinator flips back to "I'll specify").
- When false / null: render the matrix exactly as today.

**Edits**
- `src/pages/setup/steps/StepSpecialists.tsx` — fetch `plus_auto_fit`, conditionally render matrix vs. info banner.

**Out of scope**
- Generator changes (already covered — `plus_auto_fit` flag persists; runtime branching is a separate task documented in the prior session).
- Restyling `PlusRotationMatrix` itself.
- "Defer until draft schedule exists" mode — single-mode change for now; if the user later wants a defer-friendly path for the `'admin'` mode too, that's a follow-up.

---

## Files touched
- `src/components/layouts/AppSidebar.tsx`
- `src/pages/setup/steps/StepSpecialists.tsx`
