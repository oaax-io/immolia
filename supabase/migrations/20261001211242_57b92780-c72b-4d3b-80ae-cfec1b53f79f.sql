ALTER TABLE public.document_templates ADD COLUMN IF NOT EXISTS system_key text NULL;
ALTER TABLE public.document_templates ADD COLUMN IF NOT EXISTS system_version integer NULL;
CREATE UNIQUE INDEX IF NOT EXISTS document_templates_agency_system_key_uniq ON public.document_templates (agency_id, system_key) WHERE system_key IS NOT NULL;

-- Core-Default = Spiegel von MODULE_REGISTRY[].default_enabled (aktuell alle Registry-Module)
CREATE OR REPLACE FUNCTION public.platform_default_module_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT public.platform_module_keys(); $$;

CREATE OR REPLACE FUNCTION public.immolia_system_defaults_version()
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$ SELECT 1; $$;

-- Idempotentes Einspielen generischer Immolia-Defaults (nur beim Einrichten einer Firma)
CREATE OR REPLACE FUNCTION public._immolia_provision_defaults(_agency_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE nf int; nm int; nt int := 0;
BEGIN
  IF _agency_id IS NULL OR NOT EXISTS (SELECT 1 FROM agencies WHERE id = _agency_id) THEN
    RAISE EXCEPTION 'agency_not_found' USING ERRCODE='22023';
  END IF;

  INSERT INTO property_feature_options (agency_id, key, label_de, sort_order, is_active)
  SELECT _agency_id, k, l, o, true FROM (VALUES
    ('balkon','Balkon',10),('lift','Lift',20),('garage','Garage',30),('doppelgarage','Doppelgarage',40),
    ('carport','Carport',50),('parkplatz','Parkplatz',60),('ladestation_elektroauto','Ladestation für Elektroauto',70),
    ('cheminee','Cheminée',80),('kachelofen','Kachelofen',90),('swimmingpool','Swimmingpool',100),
    ('waschmaschine','Waschmaschine',110),('tumbler','Tumbler',120),('gasanschluss','Gasanschluss',130),
    ('kabelfernsehen','Kabelfernsehen',140),('multimediale_verkabelung','Multimediale Verkabelung',150),
    ('rollstuhlgaengig','Rollstuhlgängig',160),('erdgeschoss','Erdgeschoss',170),('hochparterre','Hochparterre',180),
    ('eckhaus','Eckhaus',190),('seesicht','Seesicht',200),('bergsicht','Bergsicht',210),('sonnig','Sonnig',220),
    ('ruhig','Ruhig',230),('hanglage','Hanglage',240),('suedhang','Südhang',250),('kinderfreundlich','Kinderfreundlich',260),
    ('haustiere_erlaubt','Haustiere erlaubt',270),('nichtraucher','Nichtraucher',280),('erstwohnsitz','Erstwohnsitz',290),
    ('zweitwohnsitz','Zweitwohnsitz',300),('auslaenderkontingent','Ausländerkontingent',310),('im_baurecht','Im Baurecht',320),
    ('bauland_erschlossen','Bauland erschlossen',330),('projektiert','Projektiert',340),
    ('virtuelle_besichtigung','Virtuelle Besichtigung',350),('mietkautionsgarantie','Mietkautionsgarantie',360),
    ('in_wohngemeinschaft','In Wohngemeinschaft',370)
  ) v(k,l,o)
  ON CONFLICT (agency_id, key) DO NOTHING;
  GET DIAGNOSTICS nf = ROW_COUNT;

  INSERT INTO master_list_values (agency_id, list_key, value, label_de, sort_order, is_active)
  SELECT _agency_id, lk, v, v, o, true FROM (VALUES
    ('condition','Neu',10),('condition','Gepflegt',20),('condition','Renovationsbedürftig',30),('condition','Sanierungsbedürftig',40),
    ('marketing_type','Kaufen',10),('marketing_type','Mieten',20),
    ('vat_status','optiert',10),('vat_status','nicht optiert',20),
    ('sale_procedure','Festpreis',10),('sale_procedure','Bieterverfahren',20),('sale_procedure','Auktion',30),
    ('deal_type','Asset Deal',10),('deal_type','Share Deal',20)
  ) x(lk,v,o)
  ON CONFLICT (agency_id, list_key, value) DO NOTHING;
  GET DIAGNOSTICS nm = ROW_COUNT;

  -- IMMOLIA_SYSTEM_TEMPLATES: aktuell keine freigegebenen Vorlagen. Spätere Vorlagen
  -- werden hier mit system_key/system_version + ON CONFLICT DO NOTHING eingespielt.
  -- Checklisten: keine Core-Defaults (PRODUCT_DECISION_REQUIRED).

  RETURN jsonb_build_object('version', public.immolia_system_defaults_version(),
    'features_added', nf, 'master_values_added', nm, 'templates_added', nt, 'checklists_added', 0);
END $$;
REVOKE ALL ON FUNCTION public._immolia_provision_defaults(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._immolia_provision_defaults(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.platform_create_tenant(_name text, _slug text, _owner_first_name text, _owner_last_name text, _owner_email text, _modules text[])
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  nm text := btrim(coalesce(_name,''));
  s text := lower(btrim(coalesce(_slug,'')));
  fn text := btrim(coalesce(_owner_first_name,''));
  ln text := btrim(coalesce(_owner_last_name,''));
  em text := lower(btrim(coalesce(_owner_email,'')));
  all_modules text[] := public.platform_module_keys();
  mods text[];
  defaults jsonb;
  inv_id uuid; inv_token text; chk text; ag uuid; dom text; owner_id uuid; owner_status text; m text; r app_role;
BEGIN
  PERFORM public.platform_assert_admin();
  IF nm = '' OR length(nm) > 120 THEN RAISE EXCEPTION 'invalid_name' USING ERRCODE='22023'; END IF;
  IF fn = '' OR ln = '' OR length(fn) > 80 OR length(ln) > 80 THEN RAISE EXCEPTION 'invalid_owner' USING ERRCODE='22023'; END IF;
  IF em !~ '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' OR length(em) > 254 THEN RAISE EXCEPTION 'invalid_email' USING ERRCODE='22023'; END IF;
  chk := public.platform_check_subdomain(s);
  IF chk <> 'available' THEN RAISE EXCEPTION 'slug_%', chk USING ERRCODE='22023'; END IF;
  IF coalesce(array_length(_modules,1),0) = 0 THEN
    mods := public.platform_default_module_keys();
  ELSE
    SELECT coalesce(array_agg(DISTINCT x), '{}') INTO mods FROM unnest(_modules) x WHERE x = ANY(all_modules);
  END IF;
  mods := (SELECT array_agg(DISTINCT x) FROM unnest(mods || public.platform_core_module_keys()) x);

  INSERT INTO agencies (name, slug, status) VALUES (nm, s, 'active') RETURNING id INTO ag;
  dom := s || '.' || public.tenant_subdomain_root();
  INSERT INTO tenant_domains (agency_id, domain, domain_type, is_primary, verification_status, verified_at)
  VALUES (ag, dom, 'subdomain', true, 'verified', now());
  INSERT INTO company (agency_id, name, country) VALUES (ag, nm, 'CH');
  INSERT INTO brand_settings (agency_id, company_name) VALUES (ag, nm);

  FOREACH m IN ARRAY all_modules LOOP
    INSERT INTO agency_modules (agency_id, module, is_entitled, is_enabled)
    VALUES (ag, m, m = ANY(mods), m = ANY(mods))
    ON CONFLICT (agency_id, module) DO NOTHING;
    FOREACH r IN ARRAY ARRAY['admin','manager','agent','assistant','employee']::app_role[] LOOP
      INSERT INTO module_permissions (agency_id, module, role, can_view, can_create, can_edit_own, can_edit_all, can_delete)
      VALUES (ag, m, r, true,
        r IN ('admin','manager','agent','assistant'),
        r IN ('admin','manager','agent','assistant'),
        r IN ('admin','manager'),
        r = 'admin');
    END LOOP;
  END LOOP;

  defaults := public._immolia_provision_defaults(ag);

  SELECT u.id INTO owner_id FROM auth.users u WHERE lower(u.email) = em LIMIT 1;
  IF owner_id IS NOT NULL THEN
    INSERT INTO agency_memberships (agency_id, user_id, role, is_active) VALUES (ag, owner_id, 'owner', true);
    owner_status := 'active';
  ELSE
    SELECT i.invitation_id, i.token INTO inv_id, inv_token
      FROM public._invitation_issue('tenant_owner', em, ag, 'owner'::app_role, NULL, fn, ln) i;
    owner_status := 'pending_invitation';
  END IF;

  INSERT INTO platform_audit_logs (actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(), 'tenant_created', 'agency', ag, nm, jsonb_build_object(
    'subdomain', dom, 'modules_count', coalesce(array_length(mods,1),0),
    'owner_user_exists', owner_id IS NOT NULL, 'owner_status', owner_status, 'invitation_id', inv_id,
    'core_defaults', defaults));

  RETURN jsonb_build_object('agency_id', ag, 'name', nm, 'domain', dom, 'owner_status', owner_status,
    'owner_user_exists', owner_id IS NOT NULL, 'modules', to_jsonb(mods), 'invitation_token', inv_token,
    'core_defaults', defaults);
END $function$;