-- Per-user rate limiting for the LLM-backed edge functions.
--
-- We reuse ai_usage_log as the counter AND the admin-visible usage feed: every AI
-- attempt writes one row (user_id, feature), and enforceRateLimit() counts the
-- caller's rows for a feature within a rolling window. Over-limit attempts are
-- still logged (so the Admin AI-costs page sees demand), but the function returns
-- 429 before spending a model call.

ALTER TABLE public.ai_usage_log
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

-- The rate-limit count is: WHERE user_id = ? AND feature = ? AND created_at > now()-window.
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_feature_recent
  ON public.ai_usage_log (user_id, feature, created_at DESC);

COMMENT ON COLUMN public.ai_usage_log.user_id IS 'Caller (for per-user rate limiting). Nullable for legacy/service rows.';
