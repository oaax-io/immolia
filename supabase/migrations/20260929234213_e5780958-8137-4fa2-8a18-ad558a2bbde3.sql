CREATE OR REPLACE FUNCTION public.create_mandate_atomic(_mandate jsonb, _splits jsonb, _doc jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  _mid uuid; _did uuid; _prop uuid := NULLIF(_mandate->>'property_id','')::uuid; _s jsonb; _p numeric;
BEGIN
  IF auth.uid() IS NULL OR public.current_agency_id() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _prop IS NULL OR NULLIF(_mandate->>'client_id','') IS NULL THEN RAISE EXCEPTION 'Kunde und Immobilie sind erforderlich' USING ERRCODE='22023'; END IF;
  -- Validierung VOR jeder Schreiboperation
  FOR _s IN SELECT * FROM jsonb_array_elements(coalesce(_splits,'[]'::jsonb)) LOOP
    IF NULLIF(_s->>'user_id','') IS NULL THEN RAISE EXCEPTION 'Jede Aufteilungszeile braucht eine Person' USING ERRCODE='22023'; END IF;
    _p := NULLIF(_s->>'split_percent','')::numeric;
    IF _p IS NULL OR _p <= 0 OR _p > 100 THEN
      RAISE EXCEPTION 'Anteil muss grösser als 0 %% und höchstens 100 %% sein' USING ERRCODE='22023';
    END IF;
  END LOOP;

  INSERT INTO mandates(client_id, property_id, commission_model, commission_value, valid_from, valid_until, status, mandate_type, cancellation_fee, cancellation_fee_notes)
  VALUES ((_mandate->>'client_id')::uuid, _prop, _mandate->>'commission_model', NULLIF(_mandate->>'commission_value','')::numeric,
          NULLIF(_mandate->>'valid_from','')::date, NULLIF(_mandate->>'valid_until','')::date, 'draft',
          _mandate->>'mandate_type', NULLIF(_mandate->>'cancellation_fee','')::numeric, NULLIF(_mandate->>'cancellation_fee_notes',''))
  RETURNING id INTO _mid;

  DELETE FROM mandate_commission_splits WHERE property_id = _prop;
  INSERT INTO mandate_commission_splits(property_id, mandate_id, user_id, role, split_percent)
  SELECT _prop, _mid, (s->>'user_id')::uuid, s->>'role', (s->>'split_percent')::numeric
  FROM jsonb_array_elements(coalesce(_splits,'[]'::jsonb)) s;

  INSERT INTO generated_documents(related_type, related_id, html_content, variables, created_by, title, document_type, status)
  VALUES ('mandate', _mid, _doc->>'html_content', coalesce(_doc->'variables','{}'::jsonb), auth.uid(), _doc->>'title', _doc->>'document_type', 'ready')
  RETURNING id INTO _did;

  UPDATE mandates SET generated_document_id = _did WHERE id = _mid;
  RETURN jsonb_build_object('mandate_id', _mid, 'document_id', _did);
END $$;
REVOKE ALL ON FUNCTION public.create_mandate_atomic(jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_mandate_atomic(jsonb, jsonb, jsonb) TO authenticated;