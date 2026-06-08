
-- Create workspace_invites table
CREATE TABLE public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL DEFAULT 'viewer',
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

-- Workspace members can view invites for their workspace
CREATE POLICY "Members can view workspace invites"
ON public.workspace_invites FOR SELECT TO authenticated
USING (is_workspace_member(workspace_id));

-- Workspace members can create invites
CREATE POLICY "Members can create invites"
ON public.workspace_invites FOR INSERT TO authenticated
WITH CHECK (is_workspace_member(workspace_id));

-- Workspace members can delete invites
CREATE POLICY "Members can delete invites"
ON public.workspace_invites FOR DELETE TO authenticated
USING (is_workspace_member(workspace_id));

-- Workspace members can update invites (accept)
CREATE POLICY "Members can update invites"
ON public.workspace_invites FOR UPDATE TO authenticated
USING (is_workspace_member(workspace_id));

-- Anyone can select by token (for accept invite flow - before joining workspace)
CREATE POLICY "Anyone can view invite by token"
ON public.workspace_invites FOR SELECT TO authenticated
USING (true);

-- Create notifications table
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  message text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own notifications"
ON public.notifications FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
ON public.notifications FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

-- Create support_tickets table
CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  subject text NOT NULL,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  admin_reply text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can create support tickets"
ON public.support_tickets FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own tickets"
ON public.support_tickets FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all tickets"
ON public.support_tickets FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow workspace_members updates and deletes for owners/admins
CREATE POLICY "Owners can update workspace members"
ON public.workspace_members FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = workspace_members.workspace_id
  AND wm.user_id = auth.uid()
  AND wm.role IN ('owner', 'admin')
));

CREATE POLICY "Owners can delete workspace members"
ON public.workspace_members FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.workspace_members wm
  WHERE wm.workspace_id = workspace_members.workspace_id
  AND wm.user_id = auth.uid()
  AND wm.role IN ('owner', 'admin')
));

-- Notification insert policy (system can insert via service role, but also allow self-insert)
CREATE POLICY "Users can insert own notifications"
ON public.notifications FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);
