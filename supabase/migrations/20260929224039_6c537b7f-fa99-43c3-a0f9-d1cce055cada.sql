CREATE OR REPLACE FUNCTION public.trash_delete(_table text, _ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _allowed text[] := ARRAY['properties','clients','leads','tasks','appointments','documents','mandates','reservations','checklists','nda_agreements','financing_dossiers','property_media','generated_documents','client_financial_items','matches'];
  _agency uuid := public.current_agency_id();
  _uid uuid := auth.uid();
  _rows jsonb[];
  _r jsonb;
  _snap int := 0;
  _del int := 0;
BEGIN
  IF _uid IS NULL OR _agency IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF NOT (_table = ANY(_allowed)) THEN RAISE EXCEPTION 'table not allowed' USING ERRCODE = '22023'; END IF;
  IF _ids IS NULL OR cardinality(_ids) = 0 THEN RETURN 0; END IF;

  -- 1. Originale lesen (RLS des Benutzers gilt) und sperren
  EXECUTE format('SELECT array_agg(to_jsonb(t)) FROM (SELECT * FROM public.%I WHERE id = ANY($1) FOR UPDATE) t', _table)
    INTO _rows USING _ids;
  IF _rows IS NULL THEN RETURN 0; END IF;

  -- 2. Vollständigen Snapshot schreiben
  FOREACH _r IN ARRAY _rows LOOP
    INSERT INTO public.trash_items(agency_id, table_name, record_id, label, subtitle, payload, deleted_by)
    VALUES (
      COALESCE(NULLIF(_r->>'agency_id','')::uuid, _agency),
      _table,
      (_r->>'id')::uuid,
      COALESCE(NULLIF(_r->>'title',''), NULLIF(_r->>'name',''), NULLIF(_r->>'file_name',''), NULLIF(_r->>'subject',''),
               NULLIF(trim(COALESCE(_r->>'first_name','') || ' ' || COALESCE(_r->>'last_name','')), ''),
               NULLIF(_r->>'address',''), NULLIF(_r->>'reference',''), NULLIF(_r->>'email',''), 'Eintrag'),
      COALESCE(_r->>'reference', _r->>'city', _r->>'status', _r->>'email'),
      _r, _uid);
    _snap := _snap + 1;
  END LOOP;

  -- 3. Snapshot bestätigt → erst jetzt Original löschen
  EXECUTE format('WITH d AS (DELETE FROM public.%I WHERE id = ANY($1) RETURNING 1) SELECT count(*) FROM d', _table)
    INTO _del USING (SELECT array_agg((x->>'id')::uuid) FROM unnest(_rows) x);

  IF _del <> _snap THEN
    RAISE EXCEPTION 'trash delete incomplete (% of %)', _del, _snap USING ERRCODE = '40001';
  END IF;
  RETURN _del;
END $$;

REVOKE ALL ON FUNCTION public.trash_delete(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trash_delete(text, uuid[]) TO authenticated, service_role;

-- Modul-Nachtragung: nur fehlende Einträge bestehender Firmen, bestehende Zustände unverändert.
INSERT INTO public.agency_modules(agency_id, module, is_entitled, is_enabled)
SELECT a.id, k, true, true
FROM public.agencies a CROSS JOIN unnest(public.platform_module_keys()) k
WHERE a.created_at < now()
ON CONFLICT (agency_id, module) DO NOTHING;