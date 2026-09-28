REVOKE ALL ON FUNCTION public.tg_scope_notification() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_scope_direct_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_scope_feedback() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sole_agency_of(uuid) FROM PUBLIC, anon, authenticated;