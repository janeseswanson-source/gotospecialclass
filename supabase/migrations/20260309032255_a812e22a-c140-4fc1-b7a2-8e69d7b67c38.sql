
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_workspace_id uuid;
  display text;
BEGIN
  display := COALESCE(NEW.raw_user_meta_data ->> 'display_name', split_part(NEW.email, '@', 1));

  -- Create profile
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, display);

  -- Create workspace
  INSERT INTO public.workspaces (name, created_by, is_active)
  VALUES (display || '''s Workspace', NEW.id, true)
  RETURNING id INTO new_workspace_id;

  -- Add user as owner of workspace
  INSERT INTO public.workspace_members (user_id, workspace_id, role)
  VALUES (NEW.id, new_workspace_id, 'owner');

  RETURN NEW;
END;
$$;
