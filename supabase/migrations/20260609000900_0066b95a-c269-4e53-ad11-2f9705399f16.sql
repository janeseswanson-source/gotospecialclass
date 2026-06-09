ALTER TABLE public.schedule_generations
  ADD COLUMN IF NOT EXISTS sa_iterations integer,
  ADD COLUMN IF NOT EXISTS sa_improvement double precision,
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS verify_quality_score integer,
  ADD COLUMN IF NOT EXISTS verify_issues_found integer,
  ADD COLUMN IF NOT EXISTS verify_summary text,
  ADD COLUMN IF NOT EXISTS feedback_signal text,
  ADD COLUMN IF NOT EXISTS manual_edit_count integer DEFAULT 0;

ALTER TABLE public.schedule_blocks
  ADD COLUMN IF NOT EXISTS placement_reason text;

CREATE TABLE IF NOT EXISTS public.scoring_weight_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  weights JSONB NOT NULL DEFAULT '{}',
  sample_count INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scoring_weight_profiles TO authenticated;
GRANT ALL ON public.scoring_weight_profiles TO service_role;

ALTER TABLE public.scoring_weight_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'scoring_weight_profiles'
      AND policyname = 'Members can manage weight profiles'
  ) THEN
    CREATE POLICY "Members can manage weight profiles"
      ON public.scoring_weight_profiles FOR ALL
      USING (EXISTS (
        SELECT 1 FROM public.schools s
        WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id)
      ));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS scoring_weight_profiles_school_id_idx
  ON public.scoring_weight_profiles(school_id);