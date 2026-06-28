-- Phase 4: learnable-weights loop. A proposal is staged here and only becomes
-- the active `weights` when the admin explicitly confirms it (human-gated; never
-- auto-applied).
ALTER TABLE public.scoring_weight_profiles
  ADD COLUMN IF NOT EXISTS proposed_weights jsonb,
  ADD COLUMN IF NOT EXISTS proposed_at timestamptz;
