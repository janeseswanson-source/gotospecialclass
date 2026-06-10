-- Tighten calendar-uploads storage: scope SELECT/INSERT/UPDATE/DELETE to the
-- workspace that owns the school whose UUID is the first path segment.
-- File path convention (see useCalendarUpload.ts): `${schoolId}/${ts}_${name}`.

DROP POLICY IF EXISTS "Members can view own calendars" ON storage.objects;
DROP POLICY IF EXISTS "Members can upload calendars" ON storage.objects;
DROP POLICY IF EXISTS "Members can update own calendars" ON storage.objects;
DROP POLICY IF EXISTS "Members can delete own calendars" ON storage.objects;

CREATE POLICY "Workspace members can view calendar uploads"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'calendar-uploads'
  AND EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = ((storage.foldername(name))[1])::uuid
      AND public.is_workspace_member(s.workspace_id)
  )
);

CREATE POLICY "Workspace members can upload calendar uploads"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'calendar-uploads'
  AND EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = ((storage.foldername(name))[1])::uuid
      AND public.is_workspace_member(s.workspace_id)
  )
);

CREATE POLICY "Workspace members can update calendar uploads"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'calendar-uploads'
  AND EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = ((storage.foldername(name))[1])::uuid
      AND public.is_workspace_member(s.workspace_id)
  )
)
WITH CHECK (
  bucket_id = 'calendar-uploads'
  AND EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = ((storage.foldername(name))[1])::uuid
      AND public.is_workspace_member(s.workspace_id)
  )
);

CREATE POLICY "Workspace members can delete calendar uploads"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'calendar-uploads'
  AND EXISTS (
    SELECT 1 FROM public.schools s
    WHERE s.id = ((storage.foldername(name))[1])::uuid
      AND public.is_workspace_member(s.workspace_id)
  )
);

-- Remove the permissive "Anyone can view invite by token" policy. The
-- invite-accept flow already resolves tokens server-side with the service
-- role, and the "Members can view workspace invites" policy still lets
-- workspace members see their own workspace's invites.
DROP POLICY IF EXISTS "Anyone can view invite by token" ON public.workspace_invites;