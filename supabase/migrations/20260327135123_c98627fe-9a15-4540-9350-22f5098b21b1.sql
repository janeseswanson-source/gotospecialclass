ALTER TABLE public.specialists ADD COLUMN two_schools boolean DEFAULT false;
ALTER TABLE public.specialists ADD COLUMN second_school_name text DEFAULT NULL;
ALTER TABLE public.specialists ADD COLUMN uses_cart boolean DEFAULT false;
ALTER TABLE public.specialists ADD COLUMN location text DEFAULT NULL;
ALTER TABLE public.specialists ADD COLUMN second_location text DEFAULT NULL;
ALTER TABLE public.specialists ADD COLUMN grade_rotation jsonb DEFAULT NULL;