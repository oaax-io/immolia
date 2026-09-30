
CREATE OR REPLACE FUNCTION public.calendar_event_seq(_prefix text)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT count(*)::int + 1 FROM calendar_notification_events WHERE event_key LIKE _prefix || ':%';
$$;
REVOKE ALL ON FUNCTION public.calendar_event_seq(text) FROM PUBLIC, anon, authenticated;

-- Neutralisierung zugestellter Meldungen
CREATE OR REPLACE FUNCTION public.calendar_neutralize_notifications(_related_id uuid, _users uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE notifications SET title='Termin nicht mehr verfügbar',
    message='Dieser Termin ist für dich nicht mehr sichtbar.', link=NULL
   WHERE related_type='calendar_event' AND related_id=_related_id
     AND (_users IS NULL OR user_id = ANY(_users));
  UPDATE calendar_notification_events SET title='Termin nicht mehr verfügbar', message=NULL, link=NULL
   WHERE related_type='calendar_event' AND related_id=_related_id
     AND (_users IS NULL OR recipient_id = ANY(_users));
END $$;
REVOKE ALL ON FUNCTION public.calendar_neutralize_notifications(uuid, uuid[]) FROM PUBLIC, anon, authenticated;

-- Termine (Immolia)
CREATE OR REPLACE FUNCTION public.tg_calendar_appt_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _u uuid; _when text; _recips uuid[]; _p text; _skip uuid[] := '{}';
BEGIN
  _when := to_char(NEW.starts_at AT TIME ZONE 'Europe/Zurich','DD.MM.YYYY HH24:MI');
  -- Regel für Outlook-Änderungen (kein angemeldeter Auslöser): Personen, deren verbundener
  -- Outlook-Kalender diesen Termin führt, gelten als mutmassliche Bearbeiter und werden ausgelassen.
  IF auth.uid() IS NULL THEN
    _skip := ARRAY(SELECT c.user_id FROM calendar_event_links l JOIN calendar_connections c ON c.id=l.connection_id
                    WHERE l.appointment_id=NEW.id AND l.deleted_at IS NULL);
  END IF;
  FOR _u IN SELECT x FROM unnest(COALESCE(NEW.extra_assignee_ids,'{}')) x
            WHERE x IS DISTINCT FROM NEW.assigned_to  -- Hauptzuständiger erhält bereits "Neuer Termin"
              AND (TG_OP='INSERT' OR NOT (x = ANY(COALESCE(OLD.extra_assignee_ids,'{}')))) LOOP
    CONTINUE WHEN _u = ANY(_skip);
    _p := 'appt:'||NEW.id||':assigned:'||_u;
    PERFORM calendar_notify(NEW.agency_id, _u, _p||':'||calendar_event_seq(_p), 'assigned',
      'Termin zugewiesen', COALESCE(NEW.title,'Termin')||' am '||_when, '/appointments', 'appointment', NEW.id);
  END LOOP;
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  _recips := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[NEW.assigned_to] || COALESCE(NEW.extra_assignee_ids,'{}')) x
                   WHERE x IS NOT NULL AND (x = OLD.assigned_to OR x = ANY(COALESCE(OLD.extra_assignee_ids,'{}'))));
  IF NEW.status::text='cancelled' AND OLD.status::text <> 'cancelled' THEN
    FOREACH _u IN ARRAY _recips LOOP
      CONTINUE WHEN _u = ANY(_skip);
      _p := 'appt:'||NEW.id||':cancelled:'||_u;
      PERFORM calendar_notify(NEW.agency_id, _u, _p||':'||calendar_event_seq(_p), 'cancelled',
        'Termin abgesagt', COALESCE(NEW.title,'Termin')||' am '||_when, '/appointments', 'appointment', NEW.id);
    END LOOP;
  ELSIF NEW.status::text <> 'cancelled' AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
        OR NEW.location IS DISTINCT FROM OLD.location OR NEW.title IS DISTINCT FROM OLD.title) THEN
    FOREACH _u IN ARRAY _recips LOOP
      CONTINUE WHEN _u = ANY(_skip);
      _p := 'appt:'||NEW.id||':changed:'||_u;
      PERFORM calendar_notify(NEW.agency_id, _u, _p||':'||calendar_event_seq(_p), 'changed',
        'Termin geändert', COALESCE(NEW.title,'Termin')||' am '||_when, '/appointments', 'appointment', NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $function$;

-- Zuordnungen (Outlook)
CREATE OR REPLACE FUNCTION public.tg_calendar_assign_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _b record; _u uuid; _label text; _when text; _p text; _removed uuid[];
BEGIN
  IF TG_OP='DELETE' THEN
    PERFORM calendar_neutralize_notifications(OLD.id, NULL); RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.visibility <> 'shared' THEN _removed := OLD.shared_with_user_ids;
    ELSE _removed := ARRAY(SELECT x FROM unnest(OLD.shared_with_user_ids) x WHERE NOT (x = ANY(NEW.shared_with_user_ids))); END IF;
    IF cardinality(_removed) > 0 THEN PERFORM calendar_neutralize_notifications(NEW.id, _removed); END IF;
  END IF;
  IF NEW.visibility <> 'shared' THEN RETURN NEW; END IF;
  SELECT * INTO _b FROM calendar_busy_blocks WHERE connection_id=NEW.connection_id AND provider_event_id=NEW.provider_event_id;
  IF _b IS NULL OR COALESCE(_b.is_private,false) THEN RETURN NEW; END IF;
  _label := COALESCE(NULLIF(_b.subject,''),'Outlook-Termin');
  _when := to_char(_b.starts_at AT TIME ZONE 'Europe/Zurich','DD.MM.YYYY HH24:MI');
  FOR _u IN SELECT x FROM unnest(NEW.shared_with_user_ids) x
            WHERE TG_OP='INSERT' OR OLD.visibility <> 'shared' OR NOT (x = ANY(OLD.shared_with_user_ids)) LOOP
    IF _u = ANY(NEW.responsible_user_ids) THEN
      _p := 'ext:'||NEW.id||':assigned:'||_u;
      PERFORM calendar_notify(NEW.agency_id, _u, _p||':'||calendar_event_seq(_p), 'assigned',
        'Termin zugewiesen', _label||' am '||_when, '/appointments', 'calendar_event', NEW.id);
    ELSE
      _p := 'ext:'||NEW.id||':shared:'||_u;
      PERFORM calendar_notify(NEW.agency_id, _u, _p||':'||calendar_event_seq(_p), 'shared',
        'Termin mit dir geteilt', _label||' am '||_when, '/appointments', 'calendar_event', NEW.id);
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN COALESCE(NEW, OLD);
END $function$;
DROP TRIGGER IF EXISTS trg_calendar_assign_notify_del ON public.calendar_event_assignments;
CREATE TRIGGER trg_calendar_assign_notify_del AFTER DELETE ON public.calendar_event_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_calendar_assign_notify();

-- Outlook-Belegungen
CREATE OR REPLACE FUNCTION public.tg_calendar_block_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _a record; _u uuid; _kind text; _label text; _when text; _p text;
BEGIN
  SELECT * INTO _a FROM calendar_event_assignments WHERE connection_id=NEW.connection_id AND provider_event_id=NEW.provider_event_id;
  IF COALESCE(NEW.is_private,false) THEN
    IF NOT COALESCE(OLD.is_private,false) AND _a IS NOT NULL THEN
      PERFORM calendar_neutralize_notifications(_a.id, NULL);
      IF _a.visibility='shared' THEN
        UPDATE calendar_event_assignments SET visibility='personal', shared_with_user_ids='{}' WHERE id=_a.id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.is_cancelled,false) AND NOT COALESCE(OLD.is_cancelled,false) THEN _kind := 'cancelled';
  ELSIF NOT COALESCE(NEW.is_cancelled,false) AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
        OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.location IS DISTINCT FROM OLD.location) THEN _kind := 'changed';
  ELSE RETURN NEW; END IF;
  -- Nachladen fehlender Titel (Bestandsabgleich) ist keine inhaltliche Änderung
  IF _kind='changed' AND OLD.subject IS NULL AND NEW.starts_at IS NOT DISTINCT FROM OLD.starts_at
     AND NEW.ends_at IS NOT DISTINCT FROM OLD.ends_at THEN RETURN NEW; END IF;
  IF _a IS NULL OR _a.visibility <> 'shared' THEN RETURN NEW; END IF;
  _label := COALESCE(NULLIF(NEW.subject,''),'Outlook-Termin');
  _when := to_char(NEW.starts_at AT TIME ZONE 'Europe/Zurich','DD.MM.YYYY HH24:MI');
  FOREACH _u IN ARRAY _a.shared_with_user_ids LOOP
    CONTINUE WHEN _u = NEW.user_id;
    _p := 'ext:'||_a.id||':'||_kind||':'||_u;
    PERFORM calendar_notify(NEW.agency_id, _u, _p||':'||calendar_event_seq(_p), _kind,
      CASE _kind WHEN 'cancelled' THEN 'Termin abgesagt' ELSE 'Termin geändert' END, _label||' am '||_when, '/appointments', 'calendar_event', _a.id);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $function$;

-- Verbindung
CREATE OR REPLACE FUNCTION public.tg_calendar_conn_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _p text;
BEGIN
  IF NEW.status IN ('reconnect_required','admin_approval_required') AND OLD.status IS DISTINCT FROM NEW.status THEN
    _p := 'conn:'||NEW.id||':'||NEW.status;
    PERFORM calendar_notify(NEW.agency_id, NEW.user_id, _p||':'||calendar_event_seq(_p), 'sync_error',
      'Microsoft-Kalender: Aktion nötig',
      CASE NEW.status WHEN 'admin_approval_required' THEN 'Deine Microsoft-Organisation muss die Kalender-Verbindung freigeben.'
        ELSE 'Bitte verbinde deinen Microsoft-Kalender erneut, damit die Synchronisierung weiterläuft.' END,
      '/settings/calendar', 'calendar_connection', NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $function$;

-- Mitgliedschaftsende: Freigaben entfernen und Meldungen neutralisieren
CREATE OR REPLACE FUNCTION public.tg_calendar_membership_notify_cleanup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _agency uuid; _user uuid;
BEGIN
  IF TG_OP='DELETE' THEN _agency := OLD.agency_id; _user := OLD.user_id;
  ELSIF NEW.is_active = false AND OLD.is_active = true THEN _agency := NEW.agency_id; _user := NEW.user_id;
  ELSE RETURN NEW; END IF;
  UPDATE calendar_event_assignments SET shared_with_user_ids = array_remove(shared_with_user_ids, _user),
         responsible_user_ids = array_remove(responsible_user_ids, _user)
   WHERE agency_id=_agency AND (_user = ANY(shared_with_user_ids) OR _user = ANY(responsible_user_ids));
  UPDATE notifications SET title='Termin nicht mehr verfügbar', message='Dieser Termin ist für dich nicht mehr sichtbar.', link=NULL
   WHERE agency_id=_agency AND user_id=_user AND related_type='calendar_event';
  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN RETURN COALESCE(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION public.tg_calendar_membership_notify_cleanup() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_calendar_membership_notify_cleanup ON public.agency_memberships;
CREATE TRIGGER trg_calendar_membership_notify_cleanup AFTER UPDATE OF is_active OR DELETE ON public.agency_memberships
  FOR EACH ROW EXECUTE FUNCTION public.tg_calendar_membership_notify_cleanup();

-- Detailabfrage für das Outlook-Terminfenster (nur Verbindungseigentümer, aktive Firma)
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
                 'name', trim(COALESCE(cl.first_name,'')||' '||COALESCE(cl.last_name,''))))
               FROM calendar_event_clients e JOIN clients cl ON cl.id=e.client_id
              WHERE e.connection_id=_b.connection_id AND e.provider_event_id=_provider_event_id AND e.removed_at IS NULL
                AND e.source <> 'suggestion'), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.calendar_event_detail(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_event_detail(text) TO authenticated;

-- Bestandsabgleich: einmaliger Vollabgleich, um Titel/Teilnehmer nachzuladen (Upsert über Microsoft-ID)
UPDATE public.calendar_connections SET delta_link = NULL WHERE status='connected';
INSERT INTO public.calendar_sync_jobs(agency_id, connection_id, job_type)
SELECT agency_id, id, 'delta' FROM public.calendar_connections WHERE status='connected';
