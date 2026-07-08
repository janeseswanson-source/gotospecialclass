## Root cause of the useless error text
`supabase.functions.invoke()` returns a `FunctionsHttpError` on any non-2xx, and its `.message` is always the generic "Edge Function returned a non-2xx status code". The edge function *does* return a helpful message in the JSON body (e.g. "This contract is too large to parse whole…", "No contract uploaded", "Could not download contract", Anthropic's real error, etc.), but the frontend throws the FunctionsHttpError as-is and shows only its generic message. That's why the toast is unhelpful.

Edge logs confirm the function returned **400** on your last two attempts — so there *is* a specific reason (most likely: the PDF is too large for whole-document parsing, or the download/URL failed). We just aren't showing it.

## Fix (frontend only, one file)
In `src/pages/setup/steps/StepContractualMinutes.tsx` `parseWithAi()`, unwrap the real error:

- When `error` is a `FunctionsHttpError`, read `error.context.body` (a `ReadableStream`) → text → JSON, and surface `body.error` in the toast (fallback to the generic message if parsing fails).
- Also fall back to `(data as any)?.error` when `data` itself carries an error payload.

That single change makes the real reason visible (e.g. "This contract is too large to parse whole — upload just the pages covering planning time / duty-free minutes…"), which lets you act on it instead of retrying blindly.

## Not doing
- No edge-function changes — the server already returns a clear message; the client just wasn't reading it.
- No new deploys, migrations, or config.
