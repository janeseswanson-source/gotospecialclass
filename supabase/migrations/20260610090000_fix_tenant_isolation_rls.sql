-- Fix two critical tenant-isolation RLS holes.
--
-- Background: legitimate workspace joins NEVER happen through a client-side
-- INSERT. They happen via:
--   1. signup           -> handle_new_user() trigger (SECURITY DEFINER, bypasses RLS)
--   2. accept invite    -> invite-member edge function (service role, bypasses RLS)
-- and invite lookups for the accept flow are done server-side with the service
-- role. So the two permissive client policies below are unnecessary for any real
-- flow and only serve as a cross-tenant escalation path.

-- ---------------------------------------------------------------------------
-- J-1: any authenticated user could insert themselves into ANY workspace
-- (the only check was user_id = auth.uid(), not that they were invited).
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can join workspace" ON public.workspace_members;

-- Defense-in-depth: if a client self-join is ever needed, it is allowed ONLY
-- when there is a valid, unexpired, unaccepted invite for the caller's own
-- email in that exact workspace. Legitimate flows (trigger / service role)
-- bypass RLS and are unaffected by this policy's presence.
CREATE POLICY "Join only via valid invite" ON public.workspace_members
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.workspace_invites wi
    JOIN auth.users u ON u.id = auth.uid()
    WHERE wi.workspace_id = workspace_members.workspace_id
      AND lower(wi.email) = lower(u.email)
      AND wi.accepted_at IS NULL
      AND wi.expires_at > now()
  )
);

-- ---------------------------------------------------------------------------
-- J-2: any authenticated user could read EVERY invite row (all emails + tokens)
-- via `USING (true)`, enabling enumeration + (with J-1) trivial takeover.
-- The accept flow resolves tokens server-side with the service role, so no
-- client SELECT-by-token policy is required. Workspace members can still view
-- their own workspace's invites via "Members can view workspace invites".
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view invite by token" ON public.workspace_invites;
