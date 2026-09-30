
CREATE OR REPLACE FUNCTION public.calendar_event_detail(_provider_event_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _ag uuid := public.current_agency_id(); _b record; _a record;
BEGIN
  IF auth.uid() IS NULL OR _ag IS NULL OR NOT public.is_agency_member(_ag) OR NOT public.agency_module_enabled_for(_ag,'appointments') THEN
    RAISE EXCEPTION 'forbidden'; END IF;
  SELECT b.* INTO _b FROM calendar_busy_blocks b JOIN calendar_connections c ON c.id=b.connection_id
   WHERE b.provider_event_id=_provider_event_id AND b.agency_id=_ag AND b.user_id=auth.uid() AND c.status <> 'disconnected' LIMIT 1;
  IF _b IS NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  SELECT * INTO _a FROM calendar_event_assignments WHERE connection_id=_b.connection_id AND provider_event_id=_provider_event_id;
  RETURN jsonb_build_object(
    'provider_event_id', _b.provider_event_id, 'subject', _b.subject, 'location', _b.location,
    'starts_at', _b.starts_at, 'ends_at', _b.ends_at, 'is_all_day', _b.is_all_day,
    'is_private', COALESCE(_b.is_private,false), 'is_cancelled', COALESCE(_b.is_cancelled,false),
    'is_organizer', _b.is_organizer, 'has_attendees', cardinality(COALESCE(_b.attendee_emails,'{}')) > 0, 'web_link', _b.web_link,
    'visibility', COALESCE(_a.visibility,'personal'), 'responsible', COALESCE(_a.responsible_user_ids,'{}'),
    'shared_with', COALESCE(_a.shared_with_user_ids,'{}'),
    'clients', COALESCE((SELECT jsonb_agg(jsonb_build_object('link_id', e.id, 'client_id', e.client_id, 'source', e.source, 'reason', e.reason,
                 'name', COALESCE(NULLIF(cl.full_name,''), cl.company_name)))
               FROM calendar_event_clients e JOIN clients cl ON cl.id=e.client_id
              WHERE e.connection_id=_b.connection_id AND e.provider_event_id=_provider_event_id AND e.removed_at IS NULL
                AND e.source <> 'suggestion'), '[]'::jsonb));
END $$;
