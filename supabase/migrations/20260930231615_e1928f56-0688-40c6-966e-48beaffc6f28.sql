-- Live-Aktualisierung des Dashboards: relevante Tabellen in die Realtime-Publikation aufnehmen
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'financing_dossiers','clients','leads','properties','appointments',
    'reservations','client_self_disclosures','generated_documents','property_media'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;