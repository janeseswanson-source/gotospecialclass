CREATE TABLE public.coordinator_prep (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL,
  school_id uuid,
  school_site_url text,
  district_calendar_url text,
  early_release_day text,
  early_release_end_time time,
  grade_preference text,
  day_preference text[] DEFAULT '{}'::text[],
  am_pm_preference text,
  specialist_count integer,
  cart_users text,
  two_school_users text,
  part_time_users text,
  custom_grade_prefs text,
  mostly_monday_holidays boolean,
  holiday_notes text,
  has_special_rotation boolean,
  special_rotation_notes text,
  dismissed_dashboard_suggestion boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX coordinator_prep_workspace_school_uidx
  ON public.coordinator_prep (workspace_id, COALESCE(school_id, '00000000-0000-0000-0000-000000000000'::uuid));

ALTER TABLE public.coordinator_prep ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view coordinator prep"
  ON public.coordinator_prep FOR SELECT
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Members can insert coordinator prep"
  ON public.coordinator_prep FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id));

CREATE POLICY "Members can update coordinator prep"
  ON public.coordinator_prep FOR UPDATE
  USING (public.is_workspace_member(workspace_id));

CREATE POLICY "Members can delete coordinator prep"
  ON public.coordinator_prep FOR DELETE
  USING (public.is_workspace_member(workspace_id));

CREATE TRIGGER update_coordinator_prep_updated_at
  BEFORE UPDATE ON public.coordinator_prep
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();