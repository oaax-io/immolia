DROP POLICY IF EXISTS fb561a_storage_read ON storage.objects;
-- Lesen nur, wenn der Anhang zu einem Feedback/Kommentar gehört, das der Benutzer in der aktiven Firma sehen darf (RLS),
-- oder eigene neue Datei im Ordner der aktiven Firma (direkt nach dem Hochladen).
CREATE POLICY fb561a_storage_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'feedback' AND (
    ((storage.foldername(name))[1] = public.current_agency_id()::text AND (storage.foldername(name))[2] = auth.uid()::text)
    OR EXISTS (SELECT 1 FROM public.feedback f WHERE f.attachments::text LIKE '%' || storage.objects.name || '"%')
    OR EXISTS (SELECT 1 FROM public.feedback_comments c WHERE c.attachments::text LIKE '%' || storage.objects.name || '"%')
  )
);