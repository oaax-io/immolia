CREATE OR REPLACE FUNCTION public.my_workspaces()
 RETURNS TABLE(agency_id uuid, name text, role text, logo_url text, favicon_url text, custom_domain text, subdomain text, is_current boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT a.id,
         COALESCE(NULLIF(b.company_name,''), a.name)::text,
         m.role::text,
         b.logo_url, b.favicon_url,
         (SELECT d.domain FROM public.tenant_domains d WHERE d.agency_id = a.id AND d.domain_type = 'custom'
            AND d.verification_status = 'verified' AND d.activated_at IS NOT NULL
          ORDER BY d.is_primary DESC LIMIT 1),
         -- Nur die als Hauptadresse markierte, verifizierte Immolia-Adresse gilt als erreichbares Ziel.
         (SELECT d.domain FROM public.tenant_domains d WHERE d.agency_id = a.id AND d.domain_type = 'subdomain'
            AND d.verification_status = 'verified' AND d.is_primary LIMIT 1),
         COALESCE(a.id = public.current_agency_id(), false)
  FROM public.agency_memberships m
  JOIN public.agencies a ON a.id = m.agency_id
  LEFT JOIN public.brand_settings b ON b.agency_id = a.id
  WHERE auth.uid() IS NOT NULL AND m.user_id = auth.uid() AND m.is_active AND public.agency_is_active(a.id)
  ORDER BY 2;
$function$;