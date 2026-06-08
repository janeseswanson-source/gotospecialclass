
-- Admin templates table
CREATE TABLE public.admin_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view templates"
  ON public.admin_templates FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage templates"
  ON public.admin_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Templates storage bucket (public)
INSERT INTO storage.buckets (id, name, public) VALUES ('templates', 'templates', true);

-- Storage RLS: anyone can read, admins can upload/delete
CREATE POLICY "Anyone can read templates"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'templates');

CREATE POLICY "Admins can upload templates"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'templates' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete templates"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'templates' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update templates"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'templates' AND public.has_role(auth.uid(), 'admin'));
