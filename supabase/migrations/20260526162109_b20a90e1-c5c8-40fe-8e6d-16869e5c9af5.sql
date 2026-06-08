
-- class_rotations: normalized rotation matrix
CREATE TABLE public.class_rotations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id uuid NOT NULL,
  specialist_id uuid,
  teacher_id uuid,
  grade text NOT NULL,
  week_label text,
  day_of_week text NOT NULL,
  slot_index integer NOT NULL DEFAULT 0,
  rotation_type text NOT NULL DEFAULT 'standard',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_class_rotations_school ON public.class_rotations(school_id);
CREATE INDEX idx_class_rotations_specialist ON public.class_rotations(specialist_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_rotations TO authenticated;
GRANT ALL ON public.class_rotations TO service_role;

ALTER TABLE public.class_rotations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can manage class rotations"
ON public.class_rotations
FOR ALL
USING (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = class_rotations.school_id AND public.is_workspace_member(s.workspace_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = class_rotations.school_id AND public.is_workspace_member(s.workspace_id)));

CREATE TRIGGER trg_class_rotations_updated_at
BEFORE UPDATE ON public.class_rotations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- lesson_plans
CREATE TABLE public.lesson_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id uuid NOT NULL,
  specialist_id uuid,
  block_id uuid,
  plan_date date,
  title text NOT NULL,
  objective text,
  materials text,
  activities jsonb NOT NULL DEFAULT '[]'::jsonb,
  standards text[] NOT NULL DEFAULT '{}'::text[],
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lesson_plans_school ON public.lesson_plans(school_id);
CREATE INDEX idx_lesson_plans_specialist ON public.lesson_plans(specialist_id);
CREATE INDEX idx_lesson_plans_block ON public.lesson_plans(block_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_plans TO authenticated;
GRANT ALL ON public.lesson_plans TO service_role;

ALTER TABLE public.lesson_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can manage lesson plans"
ON public.lesson_plans
FOR ALL
USING (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = lesson_plans.school_id AND public.is_workspace_member(s.workspace_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = lesson_plans.school_id AND public.is_workspace_member(s.workspace_id)));

CREATE TRIGGER trg_lesson_plans_updated_at
BEFORE UPDATE ON public.lesson_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- lesson_plan_templates
CREATE TABLE public.lesson_plan_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  school_id uuid NOT NULL,
  specialist_id uuid,
  subject text,
  name text NOT NULL,
  body jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_lesson_plan_templates_school ON public.lesson_plan_templates(school_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_plan_templates TO authenticated;
GRANT ALL ON public.lesson_plan_templates TO service_role;

ALTER TABLE public.lesson_plan_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can manage lesson plan templates"
ON public.lesson_plan_templates
FOR ALL
USING (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = lesson_plan_templates.school_id AND public.is_workspace_member(s.workspace_id)))
WITH CHECK (EXISTS (SELECT 1 FROM public.schools s WHERE s.id = lesson_plan_templates.school_id AND public.is_workspace_member(s.workspace_id)));

CREATE TRIGGER trg_lesson_plan_templates_updated_at
BEFORE UPDATE ON public.lesson_plan_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
