ALTER TABLE public.recess_lunch_config ADD COLUMN early_release_am_recess_start time DEFAULT NULL;
ALTER TABLE public.recess_lunch_config ADD COLUMN early_release_am_recess_end time DEFAULT NULL;
ALTER TABLE public.recess_lunch_config ADD COLUMN early_release_pm_recess_start time DEFAULT NULL;
ALTER TABLE public.recess_lunch_config ADD COLUMN early_release_pm_recess_end time DEFAULT NULL;