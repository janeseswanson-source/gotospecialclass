
DROP POLICY IF EXISTS "Users can join workspace" ON public.workspace_members;

CREATE POLICY "Users can join workspace via valid invite"
ON public.workspace_members
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.workspace_invites wi
    WHERE wi.workspace_id = workspace_members.workspace_id
      AND lower(wi.email) = lower((auth.jwt() ->> 'email'))
      AND wi.accepted_at IS NULL
      AND wi.expires_at > now()
  )
);
