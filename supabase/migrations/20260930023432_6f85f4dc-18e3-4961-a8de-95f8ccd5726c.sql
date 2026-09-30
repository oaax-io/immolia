GRANT SELECT ON public.calendar_connections TO authenticated;
GRANT SELECT ON public.calendar_busy_blocks TO authenticated;
GRANT SELECT ON public.calendar_event_links TO authenticated;
GRANT SELECT ON public.calendar_sync_jobs TO authenticated;
REVOKE ALL ON public.calendar_connection_tokens, public.calendar_oauth_attempts, public.calendar_worker_config FROM anon, authenticated;
DROP POLICY IF EXISTS cal_busy_select_agency ON public.calendar_busy_blocks;
CREATE POLICY cal_busy_select_own ON public.calendar_busy_blocks FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND agency_id = public.current_agency_id() AND public.is_agency_member(agency_id)
         AND public.agency_module_enabled_for(agency_id, 'appointments'));