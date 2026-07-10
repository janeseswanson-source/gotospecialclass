
## Problem

Recess/lunch bands in the schedule grid render labels like:

`AM Recess · AM Recess · AM Recess · … · Primary (1, 2, 3) · 9:30 AM–9:45 AM`

Two bugs feed this:

1. `buildRecessBands` in `src/lib/scheduleGrid.ts` joins every `grade_band` group name into the label, and dedup is case/whitespace-sensitive — so noisy config rows (labels like "AM Recess", stray whitespace, mixed case) get concatenated instead of merged.
2. When multiple grade bands share the exact same window, they render as separate rows in some views but in the main grid they collapse into one row where the label repeats the kind for every group.

## Fix (UI only)

**File: `src/lib/scheduleGrid.ts` — `buildRecessBands`**

- Normalize group names before dedup: trim, collapse whitespace, compare case-insensitively.
- Drop any group whose normalized value equals the band kind ("AM Recess", "PM Recess", "Lunch") — those are garbage labels, not grade bands.
- If, after cleanup, multiple distinct grade bands share the same window, merge them into one banner and join with " & " (e.g. `AM Recess · Primary (1,2,3) & Intermediate (4,5) · 9:30–9:45 AM`).
- Cap at 3 joined groups; overflow becomes `+N more`.

**File: `src/components/schedule/ScheduleGrid.tsx` — band row (lines ~265–273)**

Redesign the band row into a single, cleaner full-width banner:

```
[icon]  AM Recess · Primary (1,2,3) & Intermediate (4,5)          9:30 – 9:45 AM
```

- One `<tr>` spanning all day columns (already the case).
- Left: small icon per kind (Sun for AM Recess, Utensils for Lunch, Cloud for PM Recess), then kind name in bold, then a subtle dot separator, then the merged band names in muted color.
- Right-aligned: time range in mono, muted.
- Softer amber styling: thinner border, lighter background, no repeated per-column tint.
- Never render the kind text more than once per row.

**File: `src/pages/schedule/MasterAdminViewPage.tsx` — `chromeForDay` (lines ~248–274) and chrome render (lines ~534–560)**

Same treatment for the Master Admin View:
- Merge same-window entries across bands into one row per kind+window.
- Render as one full-width banner per window (colspan across all 5 day columns) instead of five per-day cells that each repeat the label.
- Same icon + label + right-aligned time layout.

## Out of scope

No changes to data model, PDFs, XLSX exports, or the recess/lunch setup wizard. Behavior of drag/drop, conflict detection, and time-slot math is untouched — this is purely how the band row is composed and rendered.

## Technical notes

- `RecessBand` shape is unchanged; only the `label` content and the JSX for the row change.
- Icons imported from `lucide-react` (already used elsewhere).
- Colors stay on the existing `amber-*` tokens used today.
