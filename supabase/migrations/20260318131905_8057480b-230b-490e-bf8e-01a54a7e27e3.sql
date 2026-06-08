ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS conflict_grades text[] DEFAULT '{}';
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS conflict_timing text DEFAULT 'before';