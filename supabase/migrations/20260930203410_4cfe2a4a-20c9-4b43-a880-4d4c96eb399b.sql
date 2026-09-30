REVOKE EXECUTE ON FUNCTION public.chat_is_group_member(uuid), public.chat_can_manage_group(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_is_group_member(uuid), public.chat_can_manage_group(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.chat_group_touch() FROM PUBLIC, anon, authenticated;