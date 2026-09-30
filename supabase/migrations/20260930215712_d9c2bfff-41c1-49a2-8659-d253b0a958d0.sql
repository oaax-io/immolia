CREATE POLICY platform_partner_logo_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'brand-assets' AND split_part(name, '/', 1) = 'partner-logos' AND public.is_platform_admin());

CREATE POLICY platform_partner_logo_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'brand-assets' AND split_part(name, '/', 1) = 'partner-logos' AND public.is_platform_admin())
WITH CHECK (bucket_id = 'brand-assets' AND split_part(name, '/', 1) = 'partner-logos' AND public.is_platform_admin());

CREATE POLICY platform_partner_logo_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'brand-assets' AND split_part(name, '/', 1) = 'partner-logos' AND public.is_platform_admin());