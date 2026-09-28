CREATE OR REPLACE FUNCTION public.platform_invite_tenant_owner(_agency_id uuid, _email text, _first_name text DEFAULT NULL, _last_name text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE em text := lower(btrim(coalesce(_email,''))); res record; aname text; has_account boolean;
BEGIN
  PERFORM public.platform_assert_admin();
  SELECT name INTO aname FROM agencies WHERE id = _agency_id;
  IF aname IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM agency_memberships m JOIN auth.users u ON u.id=m.user_id
             WHERE m.agency_id=_agency_id AND m.is_active AND lower(u.email)=em) THEN
    RAISE EXCEPTION 'already_member' USING ERRCODE='23505';
  END IF;
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE lower(email)=em) INTO has_account;
  SELECT * INTO res FROM public._invitation_issue('tenant_owner', em, _agency_id, 'owner'::app_role, NULL, _first_name, _last_name);
  INSERT INTO platform_audit_logs (actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(), 'tenant_owner_invitation_created', 'agency', _agency_id, aname,
    jsonb_build_object('invitation_id', res.invitation_id, 'type','tenant_owner','target_email',em,'account_exists',has_account));
  RETURN jsonb_build_object('invitation_id', res.invitation_id, 'token', res.token, 'email_delivery_status','not_configured','account_exists',has_account);
END $function$;
REVOKE ALL ON FUNCTION public.platform_invite_tenant_owner(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_invite_tenant_owner(uuid,text,text,text) TO authenticated;