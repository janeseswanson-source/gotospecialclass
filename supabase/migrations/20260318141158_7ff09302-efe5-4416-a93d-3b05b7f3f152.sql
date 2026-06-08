-- Phase 1: Add 'docx' to export_format enum and add class_duration to schools
ALTER TYPE public.export_format ADD VALUE IF NOT EXISTS 'docx';

ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS class_duration integer DEFAULT 45;