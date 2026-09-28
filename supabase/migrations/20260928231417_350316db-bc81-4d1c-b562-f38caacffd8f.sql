DROP POLICY IF EXISTS feedback_storage_read ON storage.objects;
DROP POLICY IF EXISTS feedback_storage_insert ON storage.objects;
DROP POLICY IF EXISTS feedback_storage_delete ON storage.objects;

-- Lesen: neue Dateien nur im Ordner der aktiven Firma; Altdateien nur, wenn ein für den Benutzer sichtbares Feedback/Kommentar (RLS, aktive Firma) exakt diesen Pfad referenziert.
CREATE POLICY fb561a_storage_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'feedback' AND (
    (storage.foldername(name))[1] = public.current_agency_id()::text
    OR EXISTS (SELECT 1 FROM public.feedback f WHERE f.attachments::text LIKE '%/feedback/' || storage.objects.name || '"%')
    OR EXISTS (SELECT 1 FROM public.feedback_comments c WHERE c.attachments::text LIKE '%/feedback/' || storage.objects.name || '"%')
  )
);
CREATE POLICY fb561a_storage_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'feedback'
  AND public.current_agency_id() IS NOT NULL
  AND (storage.foldername(name))[1] = public.current_agency_id()::text
  AND (storage.foldername(name))[2] = auth.uid()::text
);
CREATE POLICY fb561a_storage_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'feedback'
  AND (storage.foldername(name))[1] = public.current_agency_id()::text
  AND (storage.foldername(name))[2] = auth.uid()::text
);

-- Plattform: Anhangspfade eines Feedbacks (inkl. Kommentare), nur Plattform-Admins
CREATE OR REPLACE FUNCTION public.platform_feedback_attachments(_feedback_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN COALESCE((SELECT jsonb_agg(a) FROM (
    SELECT jsonb_array_elements(COALESCE(f.attachments,'[]'::jsonb)) a FROM feedback f WHERE f.id = _feedback_id
    UNION ALL
    SELECT jsonb_array_elements(COALESCE(c.attachments,'[]'::jsonb)) FROM feedback_comments c WHERE c.feedback_id = _feedback_id
  ) s), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.platform_feedback_attachments(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_feedback_attachments(uuid) TO authenticated;