
-- =============================================
-- Specialist Ops! Scheduler — Full Schema
-- =============================================

-- 1. ENUMS
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'specialist_teacher', 'classroom_teacher', 'office_staff', 'viewer');
CREATE TYPE public.access_source AS ENUM ('stripe', 'license', 'admin_override', 'enterprise');
CREATE TYPE public.calendar_event_type AS ENUM ('holiday', 'teacher_workday', 'no_school', 'early_release', 'closure', 'event', 'first_day', 'last_day');
CREATE TYPE public.conflict_strategy AS ENUM ('standard', 'ab_week', 'quick_30', 'big_group', 'makeup');
CREATE TYPE public.schedule_type AS ENUM ('whole_school', 'staggered');
CREATE TYPE public.crm_stage AS ENUM ('lead', 'prospect', 'trial', 'customer', 'churned');
CREATE TYPE public.license_status AS ENUM ('active', 'redeemed', 'expired', 'revoked');
CREATE TYPE public.export_format AS ENUM ('pdf', 'csv', 'excel');

-- 2. UTILITY: updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- 3. PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. USER ROLES (separate table per security requirements)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

-- 5. WORKSPACES
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  access_source access_source DEFAULT 'stripe',
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. WORKSPACE MEMBERS
CREATE TABLE public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

-- Helper: check workspace membership
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members WHERE workspace_id = _workspace_id AND user_id = auth.uid()
  )
$$;

CREATE POLICY "Members can view workspace" ON public.workspaces FOR SELECT USING (public.is_workspace_member(id));
CREATE POLICY "Authenticated users can create workspace" ON public.workspaces FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Members can update workspace" ON public.workspaces FOR UPDATE USING (public.is_workspace_member(id));

CREATE POLICY "Members can view members" ON public.workspace_members FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Users can join workspace" ON public.workspace_members FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 7. SCHOOLS
CREATE TABLE public.schools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  website TEXT,
  start_time TIME,
  end_time TIME,
  planning_minutes INTEGER DEFAULT 0,
  lunch_minutes INTEGER DEFAULT 30,
  passing_time INTEGER DEFAULT 5,
  setup_time INTEGER DEFAULT 5,
  school_year TEXT DEFAULT '2025-2026',
  notes TEXT,
  grades_served TEXT[] DEFAULT '{}',
  schedule_type schedule_type DEFAULT 'whole_school',
  conflict_strategy conflict_strategy DEFAULT 'standard',
  setup_step INTEGER DEFAULT 0,
  setup_complete BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view schools" ON public.schools FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Members can insert schools" ON public.schools FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id));
CREATE POLICY "Members can update schools" ON public.schools FOR UPDATE USING (public.is_workspace_member(workspace_id));
CREATE POLICY "Members can delete schools" ON public.schools FOR DELETE USING (public.is_workspace_member(workspace_id));

CREATE TRIGGER update_schools_updated_at BEFORE UPDATE ON public.schools
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8. RECESS/LUNCH CONFIGURATION
CREATE TABLE public.recess_lunch_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  grade_band TEXT NOT NULL DEFAULT 'all',
  am_recess_start TIME,
  am_recess_end TIME,
  lunch_start TIME,
  lunch_end TIME,
  pm_recess_start TIME,
  pm_recess_end TIME,
  early_release_lunch_start TIME,
  early_release_lunch_end TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.recess_lunch_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage recess config" ON public.recess_lunch_config FOR ALL USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);

-- 9. SPECIALISTS
CREATE TABLE public.specialists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  working_days TEXT[] DEFAULT '{Mon,Tue,Wed,Thu,Fri}',
  planning_minutes INTEGER DEFAULT 0,
  planning_preferences TEXT,
  lunch_minutes INTEGER DEFAULT 30,
  extra_minutes INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.specialists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage specialists" ON public.specialists FOR ALL USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);
CREATE TRIGGER update_specialists_updated_at BEFORE UPDATE ON public.specialists
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 10. CLASSROOM TEACHERS
CREATE TABLE public.classroom_teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  grade TEXT NOT NULL,
  room TEXT,
  team TEXT,
  am_pm_preference TEXT,
  day_preference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.classroom_teachers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage teachers" ON public.classroom_teachers FOR ALL USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);
CREATE TRIGGER update_teachers_updated_at BEFORE UPDATE ON public.classroom_teachers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 11. CLUBS
CREATE TABLE public.clubs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  day_of_week TEXT,
  start_time TIME,
  end_time TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage clubs" ON public.clubs FOR ALL USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);

-- 12. SPECIAL EVENTS
CREATE TABLE public.special_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  event_type TEXT,
  event_date DATE,
  start_time TIME,
  end_time TIME,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.special_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage events" ON public.special_events FOR ALL USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);

-- 13. CALENDAR UPLOADS
CREATE TABLE public.calendar_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  parsed BOOLEAN DEFAULT false,
  parsed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.calendar_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage uploads" ON public.calendar_uploads FOR ALL USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);

-- 14. PARSED CALENDAR EVENTS
CREATE TABLE public.parsed_calendar_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID REFERENCES public.calendar_uploads(id) ON DELETE CASCADE NOT NULL,
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  event_type calendar_event_type NOT NULL,
  title TEXT NOT NULL,
  event_date DATE,
  end_date DATE,
  approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.parsed_calendar_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage parsed events" ON public.parsed_calendar_events FOR ALL USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);

-- 15. SCHEDULE GENERATIONS
CREATE TABLE public.schedule_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  version INTEGER DEFAULT 1,
  quote TEXT,
  status TEXT DEFAULT 'draft',
  generated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.schedule_generations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage generations" ON public.schedule_generations FOR ALL USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);

-- 16. SCHEDULE BLOCKS
CREATE TABLE public.schedule_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  generation_id UUID REFERENCES public.schedule_generations(id) ON DELETE CASCADE NOT NULL,
  day_of_week TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  specialist_id UUID REFERENCES public.specialists(id) ON DELETE SET NULL,
  teacher_id UUID REFERENCES public.classroom_teachers(id) ON DELETE SET NULL,
  grade TEXT,
  room TEXT,
  subject TEXT,
  is_override BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.schedule_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage blocks" ON public.schedule_blocks FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.schedule_generations sg
    JOIN public.schools s ON s.id = sg.school_id
    WHERE sg.id = generation_id AND public.is_workspace_member(s.workspace_id)
  )
);

-- 17. EXPORT RECORDS
CREATE TABLE public.export_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID REFERENCES public.schools(id) ON DELETE CASCADE NOT NULL,
  generation_id UUID REFERENCES public.schedule_generations(id) ON DELETE SET NULL,
  export_type TEXT NOT NULL,
  format export_format NOT NULL,
  file_path TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.export_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can manage exports" ON public.export_records FOR ALL USING (
  EXISTS (SELECT 1 FROM public.schools s WHERE s.id = school_id AND public.is_workspace_member(s.workspace_id))
);

-- 18. LICENSE KEYS
CREATE TABLE public.license_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  plan TEXT DEFAULT 'pro',
  duration_days INTEGER DEFAULT 365,
  max_schools INTEGER DEFAULT 5,
  status license_status DEFAULT 'active',
  assigned_workspace UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  redeemed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  redeemed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.license_keys ENABLE ROW LEVEL SECURITY;
-- Admins manage via has_role; users can view their redeemed keys
CREATE POLICY "Users can view own redeemed keys" ON public.license_keys FOR SELECT USING (auth.uid() = redeemed_by);
CREATE POLICY "Admins can manage all keys" ON public.license_keys FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- 19. SUBSCRIPTIONS
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',
  status TEXT DEFAULT 'inactive',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view subscription" ON public.subscriptions FOR SELECT USING (public.is_workspace_member(workspace_id));
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 20. CRM ENTRIES (admin only)
CREATE TABLE public.crm_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  stage crm_stage DEFAULT 'lead',
  source TEXT,
  owner TEXT,
  tags TEXT[] DEFAULT '{}',
  notes TEXT,
  last_contact TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.crm_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage CRM" ON public.crm_entries FOR ALL USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_crm_updated_at BEFORE UPDATE ON public.crm_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 21. ACTIVITY LOG
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all activity" ON public.activity_log FOR SELECT USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Users can view own activity" ON public.activity_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Authenticated can insert activity" ON public.activity_log FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 22. AI USAGE LOG
CREATE TABLE public.ai_usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  feature TEXT NOT NULL,
  tokens_used INTEGER DEFAULT 0,
  cost_estimate NUMERIC(10,4) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view AI usage" ON public.ai_usage_log FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- 23. STORAGE BUCKET for calendar PDFs
INSERT INTO storage.buckets (id, name, public) VALUES ('calendar-uploads', 'calendar-uploads', false);

CREATE POLICY "Members can upload calendars" ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'calendar-uploads' AND auth.role() = 'authenticated');

CREATE POLICY "Members can view own calendars" ON storage.objects FOR SELECT
USING (bucket_id = 'calendar-uploads' AND auth.role() = 'authenticated');

-- 24. INDEXES
CREATE INDEX idx_workspace_members_user ON public.workspace_members(user_id);
CREATE INDEX idx_workspace_members_workspace ON public.workspace_members(workspace_id);
CREATE INDEX idx_schools_workspace ON public.schools(workspace_id);
CREATE INDEX idx_specialists_school ON public.specialists(school_id);
CREATE INDEX idx_teachers_school ON public.classroom_teachers(school_id);
CREATE INDEX idx_schedule_blocks_generation ON public.schedule_blocks(generation_id);
CREATE INDEX idx_activity_log_user ON public.activity_log(user_id);
CREATE INDEX idx_activity_log_workspace ON public.activity_log(workspace_id);
