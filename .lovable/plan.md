## Goal
Make the Master Schedule easier to read and faster to reach by reducing top-page clutter, removing unnecessary horizontal scrolling, compressing empty minute rows, and toning down the heavy color coding.

## Proposed changes

1. **Compress the page header and controls**
   - Combine the title, school name, version selector, compare, explain, export, and print actions into one compact toolbar.
   - Move secondary context like strategy/quote into a slim status strip instead of large vertical blocks.
   - Remove duplicate print controls so the schedule starts higher on the page.

2. **Add a cleaner schedule density model**
   - Default the Master Grid to a compact time scale instead of every 5-minute row.
   - Use larger visual intervals by default, while still preserving actual block start times so real scheduled items don’t disappear.
   - Keep a precise/expanded option available for drag-and-drop fine tuning when needed.

3. **Fix horizontal overflow from crowded time cells**
   - Stop rendering many same-time blocks side-by-side inside one day cell.
   - For the Master Grid, group crowded cells into compact neutral summaries like “7 classes” with a popover/list for the individual blocks.
   - Keep drag/drop target behavior on the cell itself.

4. **Tone down color coding**
   - Replace large pastel-filled blocks with a calmer card style: neutral background, subtle subject accent stripe or small badge.
   - Reserve strong color only for conflicts, warnings, locked blocks, and A/B week labels.
   - Keep subject identity visible without making the grid feel like a rainbow.

5. **Improve sticky navigation while scrolling**
   - Make the view tabs and compact controls stick near the top of the content area.
   - Keep the schedule header/time rail easier to orient against while scrolling.

## Files likely touched
- `src/pages/schedule/MasterSchedulePage.tsx`
- `src/components/schedule/ScheduleGrid.tsx`
- `src/components/schedule/ScheduleBlockCell.tsx`
- Possibly `src/lib/scheduleGrid.ts` for compact time-slot generation
- Possibly `src/lib/subjectColors.ts` for toned-down subject styling

## Validation
- Check the Master Grid at the current desktop size to confirm the schedule appears higher on the page.
- Confirm horizontal scrolling is no longer required for normal master-grid use.
- Confirm compact rows reduce vertical empty space while preserving block times.
- Confirm specialist/teacher views still work and block editing, notes, locking, drag/drop, and conflict indicators remain usable.