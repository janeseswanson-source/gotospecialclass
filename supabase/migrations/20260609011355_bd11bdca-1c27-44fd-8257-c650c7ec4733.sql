ALTER TABLE public.schools
  ADD COLUMN IF NOT EXISTS keep_grades_together boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS suggest_extra_plt boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extra_plt_target_minutes integer,
  ADD COLUMN IF NOT EXISTS contractual_minutes_url text,
  ADD COLUMN IF NOT EXISTS contractual_minutes_file_path text,
  ADD COLUMN IF NOT EXISTS contractual_minutes_extracted jsonb,
  ADD COLUMN IF NOT EXISTS contractual_minutes_status text;

DO $$ BEGIN
  ALTER TABLE public.schools
    ADD CONSTRAINT schools_extra_plt_target_minutes_nonnegative
    CHECK (extra_plt_target_minutes IS NULL OR extra_plt_target_minutes >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.schools
    ADD CONSTRAINT schools_contractual_minutes_status_valid
    CHECK (contractual_minutes_status IS NULL OR contractual_minutes_status IN ('pending','parsed','error'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP POLICY IF EXISTS "Workspace members can view contractual docs" ON storage.objects;
DROP POLICY IF EXISTS "Workspace members can upload contractual docs" ON storage.objects;
DROP POLICY IF EXISTS "Workspace members can update contractual docs" ON storage.objects;
DROP POLICY IF EXISTS "Workspace members can delete contractual docs" ON storage.objects;

CREATE POLICY "Workspace members can view contractual docs"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'contractual-docs' AND public.is_workspace_member(((storage.foldername(name))[1])::uuid));

CREATE POLICY "Workspace members can upload contractual docs"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'contractual-docs' AND public.is_workspace_member(((storage.foldername(name))[1])::uuid));

CREATE POLICY "Workspace members can update contractual docs"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'contractual-docs' AND public.is_workspace_member(((storage.foldername(name))[1])::uuid))
WITH CHECK (bucket_id = 'contractual-docs' AND public.is_workspace_member(((storage.foldername(name))[1])::uuid));

CREATE POLICY "Workspace members can delete contractual docs"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'contractual-docs' AND public.is_workspace_member(((storage.foldername(name))[1])::uuid));