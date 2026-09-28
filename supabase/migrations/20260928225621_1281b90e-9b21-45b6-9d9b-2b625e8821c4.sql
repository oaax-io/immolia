CREATE OR REPLACE FUNCTION public.invitation_preview(_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE inv invitations; st text; my_email text; nm text; ex boolean;
BEGIN
  IF _token IS NULL OR length(_token) <> 64 THEN RETURN jsonb_build_object('status','invalid'); END IF;
  SELECT * INTO inv FROM invitations WHERE token_hash = public.invitation_hash(_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid'); END IF;
  st := public.invitation_effective_status(inv.status, inv.expires_at);
  IF st <> 'pending' THEN RETURN jsonb_build_object('status', st); END IF;
  IF inv.agency_id IS NOT NULL THEN
    SELECT name INTO nm FROM agencies WHERE id = inv.agency_id;
    IF NOT public.agency_is_active(inv.agency_id) THEN RETURN jsonb_build_object('status','unavailable'); END IF;
  END IF;
  SELECT EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(btrim(inv.email))) INTO ex;
  IF auth.uid() IS NOT NULL THEN SELECT lower(email) INTO my_email FROM auth.users WHERE id = auth.uid(); END IF;
  RETURN jsonb_build_object('status', st, 'type', inv.invitation_type,
    'company_name', CASE WHEN inv.invitation_type = 'platform_user' THEN 'Immolia Platform' ELSE nm END,
    'role', coalesce(inv.platform_role, inv.tenant_role::text),
    'email', lower(btrim(inv.email)), 'account_exists', ex,
    'email_match', CASE WHEN my_email IS NULL THEN NULL ELSE my_email = lower(btrim(inv.email)) END);
END $function$;

-- Nur Server (service_role): Ziel für invite-only Kontoerstellung
CREATE OR REPLACE FUNCTION public.invitation_signup_target(_token text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE inv invitations; st text;
BEGIN
  IF _token IS NULL OR _token !~ '^[a-f0-9]{64}$' THEN RETURN jsonb_build_object('status','invalid'); END IF;
  SELECT * INTO inv FROM invitations WHERE token_hash = public.invitation_hash(_token);
  IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid'); END IF;
  st := public.invitation_effective_status(inv.status, inv.expires_at);
  IF st = 'pending' AND inv.agency_id IS NOT NULL AND NOT public.agency_is_active(inv.agency_id) THEN st := 'unavailable'; END IF;
  RETURN jsonb_build_object('status', st, 'invitation_id', inv.id, 'email', lower(btrim(inv.email)),
    'account_exists', EXISTS (SELECT 1 FROM auth.users WHERE lower(email) = lower(btrim(inv.email))));
END $function$;
REVOKE ALL ON FUNCTION public.invitation_signup_target(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invitation_signup_target(text) TO service_role;