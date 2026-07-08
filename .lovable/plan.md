## The limit
Anthropic caps whole-PDF `document` inputs at ~100 pages / ~32 MB per request. Union contracts routinely blow past that, and today we just tell the user to upload fewer pages.

## Fix: extract text server-side, then parse in chunks
Change `parse-contractual-minutes` so the PDF never leaves the edge function as a `document` block. Instead:

1. **Extract text from every page** using `unpdf` (Deno-friendly, no native deps: `import { extractText, getDocumentProxy } from "npm:unpdf@0.12"`). Produces one string per page — no page cap.
2. **Pre-filter to the relevant pages.** Most of a 300-page CBA is unrelated boilerplate. Keep only pages whose text matches a scheduling-signal regex (`/planning|prep(?:aration)?|duty[- ]free|instructional minutes|specials?|PE|physical education|music|art|library|minutes per week/i`). Fall back to all pages if nothing matches.
3. **Chunk to a safe token budget** (~40k chars per chunk, ~10k tokens — comfortably inside Haiku's window). Preserve page numbers in each chunk header (`--- Page 47 ---`) so Claude can cite context.
4. **Run the same `extract_contractual_minutes` tool call once per chunk** (in parallel with `Promise.all`, capped to ~4 concurrent). Each call is cheap on Haiku.
5. **Merge results deterministically**:
   - `subjects[]`: dedupe by `(grade, subject)`, keep the max `weekly_minutes` (contracts state minimums; if two sections mention the same subject/grade, the larger figure is the operative floor).
   - `teachers[]`: dedupe by `role`, keep max `planning_minutes` and max `duty_free_minutes`, concatenate `notes`.
   - `source_summary`: join non-empty summaries with "; ".
6. **Save the merged result** to `schools.contractual_minutes_extracted` exactly like today. No schema change.

Also drop the ~100-page framing in the "document_too_large" fallback — with this path we handle arbitrarily long PDFs. Keep the fallback only for truly unreadable/corrupt PDFs (unpdf throws or yields zero text).

## What changes
- `supabase/functions/parse-contractual-minutes/index.ts` — swap the whole-PDF `document` block for the extract-filter-chunk-merge flow above.
- Redeploy that one function.

## What doesn't change
- No database migration, no new secret, no frontend change (the toast already surfaces server errors after the last fix).
- URL-based text ingestion path stays exactly as it is.
- Same model (`MODELS.fast` / Haiku) — cheap, and 4 chunk calls still cost a fraction of one Opus call.

## Tradeoffs / notes
- We lose Claude's native PDF vision on scanned image-only PDFs. Realistically union contracts are digital text; if a user uploads a scan we'll return a clear "no extractable text — paste the relevant section as text" error instead of the current opaque 400.
- Slight latency increase for very long PDFs (multiple sequential-ish calls), but still well under the edge-function time budget.

Say the word and I'll ship it. If you'd rather keep it simpler (just text-extract + one call, no chunking), tell me the largest CBA size you typically see and I'll size accordingly.
