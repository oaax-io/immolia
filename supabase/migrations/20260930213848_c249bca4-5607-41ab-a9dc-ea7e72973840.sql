REVOKE EXECUTE ON FUNCTION public.platform_list_partners(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_save_partner(uuid, text, text, text, text, text, text, text, integer, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_set_partner_active(uuid, boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.platform_remove_partner(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.agency_partner_contacts_defaults() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.platform_partners_touch() FROM PUBLIC, anon, authenticated;