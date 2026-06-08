
-- Admin SELECT policy on profiles
CREATE POLICY "Admins can view all profiles"
ON public.profiles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin SELECT policy on workspaces
CREATE POLICY "Admins can view all workspaces"
ON public.workspaces FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin SELECT policy on workspace_members
CREATE POLICY "Admins can view all workspace members"
ON public.workspace_members FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin SELECT policy on schools
CREATE POLICY "Admins can view all schools"
ON public.schools FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin SELECT policy on subscriptions
CREATE POLICY "Admins can view all subscriptions"
ON public.subscriptions FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
