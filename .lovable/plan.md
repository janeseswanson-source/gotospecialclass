## Plan

1. **Confirm the database state**
   - Re-check whether the scheduler fields and `contractual-docs` storage bucket exist.
   - Confirm whether the prior “Modified database” action actually applied anything or failed silently.

2. **Use the correct approval path**
   - If the schema changes are still missing, submit one clean migration for the scheduler fields and storage policies.
   - Because the previous tool action did not render an approval prompt, I will treat the next migration attempt as the approval-triggering step and report the exact outcome.

3. **Avoid duplicate changes**
   - If the migration has already applied by the time implementation starts, I will skip the schema migration and move directly to app wiring.

4. **After approval/running**
   - Verify the new database columns, storage bucket, and storage policies exist.
   - Then wire the scheduler wizard and generator flow to the new models in a separate implementation step.