CREATE OR REPLACE FUNCTION public.tg_scope_feedback() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.agency_id := coalesce(public.current_agency_id(), public._sole_agency_of(NEW.created_by));
  ELSIF OLD.agency_id IS NOT NULL OR current_user IN ('authenticated','anon') THEN
    NEW.agency_id := OLD.agency_id; -- Firma nie über die App änderbar; nur einmalige Zuordnung von Altdaten
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tg_scope_feedback() FROM PUBLIC, anon, authenticated;