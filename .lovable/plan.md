## Plan

### Goal
Stop the “failed generation” / CPU Time exceeded loop while still aiming for the best schedule possible.

### What I found
- The latest backend log still shows `CPU Time exceeded` in `generate-schedule`.
- Even with only 4 outer attempts, one attempt already runs Monte Carlo up to 400 iterations per strategy plus scoring/annealing, so CPU can be exhausted before the save finishes.
- The screenshot’s “No Coverage” messages are schedule-quality warnings from the last saved schedule, not the root crash. The root crash is the generation function being killed before it can reliably persist results.

### Implementation steps
1. **Make the first request reliable**
   - Change `generate-schedule` so the user click only runs a fast, bounded generation pass that always keeps enough CPU headroom to save blocks and metadata.
   - Cap Monte Carlo iterations much lower for the interactive path.
   - Remove the outer best-of-4 loop from the synchronous request path.
   - Save the best available candidate before running expensive warning/quality work when needed.

2. **Add true best-of-20 as background refinement**
   - After the fast schedule is saved, launch a non-blocking background refinement with `EdgeRuntime.waitUntil`.
   - Run up to 20 candidate attempts there, always tracking the highest score.
   - If a better schedule is found, save it as a newer generation version or update the generation metadata safely.
   - If background refinement gets killed, the user still has the first saved schedule instead of a failed generation.

3. **Surface generation state clearly in the UI**
   - Show the first generated version immediately.
   - If refinement is still running, show a clear “Optimizing best schedule…” status rather than a failure toast.
   - Refresh/select the improved generation once the background best-of-20 version is saved.

4. **Fix the “No Coverage” outcome after generation succeeds**
   - Treat “no coverage for every grade” as a generation-quality failure only if there truly are no instructional specialist blocks.
   - Prefer A/B or standard fallback automatically when the selected strategy produces coverage gaps for all grades.
   - Keep warnings visible when capacity is genuinely short, but don’t let a crash create a misleading empty/partial schedule.

5. **Verify backend and chat**
   - Redeploy `generate-schedule` after the changes.
   - Check edge logs for absence of `CPU Time exceeded`.
   - Test AI Edit chat logs separately if it still returns silence, but avoid mixing that into generation persistence unless the logs show the same cause.

### Technical notes
- The reason a 20-generation loop cannot safely run inside one Edge Function request is CPU time, not wait time. Wall-clock waiting is okay; CPU-heavy local optimization is what gets killed.
- The safe pattern is: save a valid first result quickly, then do heavier optimization asynchronously and never let it block the user’s saved schedule.
- The existing UI/export stacked-cell work can stay; this plan focuses on generation reliability and schedule quality.