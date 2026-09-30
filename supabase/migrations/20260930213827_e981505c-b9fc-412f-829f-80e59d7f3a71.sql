-- ============ Zentrale Partnerverwaltung (Plattform) ============
CREATE TABLE public.platform_partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  name text NOT NULL,
  legal_name text NULL,
  website text NULL,
  logo_url text NULL,
  description text NULL,
  country text NULL DEFAULT 'CH',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_partners_category_chk CHECK (category IN ('bank','insurance','craftsman','portal','notary','appraiser','marketing','service','other'))
);
CREATE UNIQUE INDEX platform_partners_unique_name ON public.platform_partners (category, lower(name));
CREATE INDEX platform_partners_active_idx ON public.platform_partners (category, is_active, sort_order);

GRANT SELECT ON public.platform_partners TO authenticated;
GRANT ALL ON public.platform_partners TO service_role;
ALTER TABLE public.platform_partners ENABLE ROW LEVEL SECURITY;

-- Alle angemeldeten Benutzer dürfen den aktiven zentralen Katalog lesen.
CREATE POLICY partners_select_active ON public.platform_partners
  FOR SELECT TO authenticated USING (is_active OR public.is_platform_admin());

-- ============ Firmenspezifische Ansprechpartner ============
CREATE TABLE public.agency_partner_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  platform_partner_id uuid NULL REFERENCES public.platform_partners(id) ON DELETE SET NULL,
  custom_partner_name text NULL,
  category text NOT NULL,
  branch_name text NULL,
  contact_name text NULL,
  role_title text NULL,
  email text NULL,
  phone text NULL,
  website text NULL,
  notes text NULL,
  is_favorite boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_partner_contacts_category_chk CHECK (category IN ('bank','insurance','craftsman','portal','notary','appraiser','marketing','service','other')),
  CONSTRAINT agency_partner_contacts_source_chk CHECK (platform_partner_id IS NOT NULL OR nullif(btrim(coalesce(custom_partner_name,'')),'') IS NOT NULL)
);
CREATE INDEX agency_partner_contacts_agency_idx ON public.agency_partner_contacts (agency_id, category, is_active);
CREATE INDEX agency_partner_contacts_partner_idx ON public.agency_partner_contacts (platform_partner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_partner_contacts TO authenticated;
GRANT ALL ON public.agency_partner_contacts TO service_role;
ALTER TABLE public.agency_partner_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY apc_select ON public.agency_partner_contacts
  FOR SELECT TO authenticated USING (public.is_agency_member(agency_id));
CREATE POLICY apc_insert ON public.agency_partner_contacts
  FOR INSERT TO authenticated WITH CHECK (agency_id = public.current_agency_id() AND public.is_agency_member(agency_id));
CREATE POLICY apc_update ON public.agency_partner_contacts
  FOR UPDATE TO authenticated USING (public.is_agency_member(agency_id)) WITH CHECK (agency_id = public.current_agency_id());
CREATE POLICY apc_delete ON public.agency_partner_contacts
  FOR DELETE TO authenticated USING (public.is_agency_member(agency_id));

-- Firma und Ersteller immer serverseitig setzen, nie aus dem Browser.
CREATE OR REPLACE FUNCTION public.agency_partner_contacts_defaults()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.agency_id := coalesce(public.current_agency_id(), NEW.agency_id);
    NEW.created_by := coalesce(NEW.created_by, auth.uid());
  ELSE
    NEW.agency_id := OLD.agency_id;
    NEW.created_by := OLD.created_by;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER agency_partner_contacts_defaults_trg
  BEFORE INSERT OR UPDATE ON public.agency_partner_contacts
  FOR EACH ROW EXECUTE FUNCTION public.agency_partner_contacts_defaults();

CREATE OR REPLACE FUNCTION public.platform_partners_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER platform_partners_touch_trg
  BEFORE UPDATE ON public.platform_partners
  FOR EACH ROW EXECUTE FUNCTION public.platform_partners_touch();

-- ============ Plattform-RPCs (nur Plattform-Admins, mit Audit) ============
CREATE OR REPLACE FUNCTION public.platform_list_partners(_category text DEFAULT NULL)
RETURNS TABLE (
  id uuid, category text, name text, legal_name text, website text, logo_url text,
  description text, country text, is_active boolean, sort_order integer,
  created_at timestamptz, updated_at timestamptz, tenant_contacts bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.id, p.category, p.name, p.legal_name, p.website, p.logo_url, p.description, p.country,
         p.is_active, p.sort_order, p.created_at, p.updated_at,
         (SELECT count(*) FROM agency_partner_contacts c WHERE c.platform_partner_id = p.id)
  FROM platform_partners p
  WHERE public.is_platform_admin()
    AND (_category IS NULL OR p.category = _category)
  ORDER BY p.category, p.sort_order, p.name;
$$;

CREATE OR REPLACE FUNCTION public.platform_save_partner(
  _id uuid, _category text, _name text, _legal_name text DEFAULT NULL, _website text DEFAULT NULL,
  _logo_url text DEFAULT NULL, _description text DEFAULT NULL, _country text DEFAULT 'CH',
  _sort_order integer DEFAULT 0, _is_active boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_action text;
BEGIN
  PERFORM public.platform_assert_admin();
  IF nullif(btrim(coalesce(_name,'')),'') IS NULL THEN RAISE EXCEPTION 'invalid' USING ERRCODE = '22023'; END IF;
  IF _id IS NULL THEN
    INSERT INTO platform_partners (category, name, legal_name, website, logo_url, description, country, sort_order, is_active)
    VALUES (_category, btrim(_name), _legal_name, _website, _logo_url, _description, _country, coalesce(_sort_order,0), coalesce(_is_active,true))
    RETURNING id INTO v_id;
    v_action := 'partner_created';
  ELSE
    UPDATE platform_partners SET category = _category, name = btrim(_name), legal_name = _legal_name,
      website = _website, logo_url = _logo_url, description = _description, country = _country,
      sort_order = coalesce(_sort_order,0), is_active = coalesce(_is_active,true)
    WHERE id = _id RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
    v_action := 'partner_updated';
  END IF;
  INSERT INTO platform_audit_logs (actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(), v_action, 'partner', v_id, btrim(_name), jsonb_build_object('category', _category, 'is_active', coalesce(_is_active,true)));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.platform_set_partner_active(_id uuid, _active boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm text;
BEGIN
  PERFORM public.platform_assert_admin();
  UPDATE platform_partners SET is_active = _active WHERE id = _id RETURNING name INTO nm;
  IF nm IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO platform_audit_logs (actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(), CASE WHEN _active THEN 'partner_activated' ELSE 'partner_deactivated' END, 'partner', _id, nm, '{}'::jsonb);
  RETURN _active;
END $$;

CREATE OR REPLACE FUNCTION public.platform_remove_partner(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm text; used bigint;
BEGIN
  PERFORM public.platform_assert_admin();
  SELECT name INTO nm FROM platform_partners WHERE id = _id;
  IF nm IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002'; END IF;
  SELECT count(*) INTO used FROM agency_partner_contacts WHERE platform_partner_id = _id;
  IF used > 0 THEN RAISE EXCEPTION 'partner_in_use' USING ERRCODE = '23503'; END IF;
  DELETE FROM platform_partners WHERE id = _id;
  INSERT INTO platform_audit_logs (actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(), 'partner_removed', 'partner', _id, nm, '{}'::jsonb);
END $$;

GRANT EXECUTE ON FUNCTION public.platform_list_partners(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_save_partner(uuid, text, text, text, text, text, text, text, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_set_partner_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_remove_partner(uuid) TO authenticated;