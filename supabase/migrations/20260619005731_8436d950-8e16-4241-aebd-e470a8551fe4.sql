ALTER TABLE public.coordinator_prep
  ADD COLUMN IF NOT EXISTS teacher_union_url text,
  ADD COLUMN IF NOT EXISTS teacher_contract_url text,
  ADD COLUMN IF NOT EXISTS calendar_file_path text,
  ADD COLUMN IF NOT EXISTS calendar_file_name text;