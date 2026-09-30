CREATE TABLE public.calendar_notification_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL,
  event_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('assigned','shared','changed','cancelled','sync_error')),
  title text NOT NULL,
  message text NULL,
  link text NULL,
  related_type text NULL,
  related_id uuid NULL,
  in_app_status text NOT NULL DEFAULT 'pending' CHECK (in_app_status IN ('pending','delivered','skipped','failed')),
  email_status text NOT NULL DEFAULT 'disabled' CHECK (email_status IN ('disabled','pending','sent','failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.calendar_notification_events TO service_role;
ALTER TABLE public.calendar_notification_events ENABLE ROW LEVEL SECURITY;
-- bewusst ohne Browser-Policies: Anzeige läuft über die bestehende Inbox (notifications)

CREATE OR REPLACE FUNCTION public.calendar_notify(_agency uuid, _recipient uuid, _event_key text, _kind text,
  _title text, _message text, _link text, _related_type text, _related_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _id uuid; _prefs record;
BEGIN
  IF _recipient IS NULL OR _agency IS NULL THEN RETURN; END IF;
  IF _recipient = auth.uid() THEN RETURN; END IF; -- eigene Aktionen nicht an sich selbst
  IF NOT EXISTS (SELECT 1 FROM agency_memberships WHERE agency_id=_agency AND user_id=_recipient AND is_active) THEN RETURN; END IF;
  BEGIN
    INSERT INTO calendar_notification_events(agency_id, recipient_id, event_key, kind, title, message, link, related_type, related_id)
    VALUES (_agency, _recipient, _event_key, _kind, _title, _message, _link, _related_type, _related_id)
    ON CONFLICT (event_key) DO NOTHING RETURNING id INTO _id;
    IF _id IS NULL THEN RETURN; END IF; -- dedupliziert (Retry, doppelter Trigger)
    SELECT * INTO _prefs FROM notification_preferences WHERE user_id=_recipient;
    IF FOUND AND (NOT COALESCE(_prefs.in_app_enabled,true) OR (_kind <> 'sync_error' AND NOT COALESCE(_prefs.appointments_enabled,true))) THEN
      UPDATE calendar_notification_events SET in_app_status='skipped' WHERE id=_id; RETURN;
    END IF;
    INSERT INTO notifications(user_id, agency_id, type, title, message, link, related_type, related_id)
    VALUES (_recipient, _agency, 'appointment', _title, _message, _link, _related_type, _related_id);
    UPDATE calendar_notification_events SET in_app_status='delivered' WHERE id=_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'calendar_notify failed: %', SQLSTATE; -- Termin wird nie zurückgerollt
  END;
END $$;
REVOKE ALL ON FUNCTION public.calendar_notify(uuid,uuid,text,text,text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;

-- Immolia-Termine: Zusatz-Zuständige, relevante Änderungen, Absage (AFTER = erst nach dem Speichern)
CREATE OR REPLACE FUNCTION public.tg_calendar_appt_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _u uuid; _when text; _st text; _recips uuid[];
BEGIN
  _when := to_char(NEW.starts_at AT TIME ZONE 'Europe/Zurich','DD.MM.YYYY HH24:MI');
  _st := md5(COALESCE(NEW.title,'')||NEW.starts_at::text||COALESCE(NEW.ends_at::text,'')||COALESCE(NEW.location,''));
  -- neu hinzugefügte Zusatz-Zuständige (Hauptzuständiger wird vom bestehenden Trigger gemeldet)
  FOR _u IN SELECT x FROM unnest(COALESCE(NEW.extra_assignee_ids,'{}')) x
            WHERE TG_OP='INSERT' OR NOT (x = ANY(COALESCE(OLD.extra_assignee_ids,'{}'))) LOOP
    PERFORM calendar_notify(NEW.agency_id, _u, 'appt:'||NEW.id||':assigned:'||_u, 'assigned',
      'Termin zugewiesen', COALESCE(NEW.title,'Termin')||' am '||_when, '/appointments', 'appointment', NEW.id);
  END LOOP;
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  _recips := ARRAY(SELECT DISTINCT x FROM unnest(ARRAY[NEW.assigned_to] || COALESCE(NEW.extra_assignee_ids,'{}')) x
                   WHERE x IS NOT NULL AND (x = OLD.assigned_to OR x = ANY(COALESCE(OLD.extra_assignee_ids,'{}'))));
  IF NEW.status::text='cancelled' AND OLD.status::text <> 'cancelled' THEN
    FOREACH _u IN ARRAY _recips LOOP
      PERFORM calendar_notify(NEW.agency_id, _u, 'appt:'||NEW.id||':cancelled:'||_u, 'cancelled',
        'Termin abgesagt', COALESCE(NEW.title,'Termin')||' am '||_when, '/appointments', 'appointment', NEW.id);
    END LOOP;
  ELSIF NEW.status::text <> 'cancelled' AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
        OR NEW.location IS DISTINCT FROM OLD.location OR NEW.title IS DISTINCT FROM OLD.title) THEN
    FOREACH _u IN ARRAY _recips LOOP
      PERFORM calendar_notify(NEW.agency_id, _u, 'appt:'||NEW.id||':changed:'||_u||':'||_st, 'changed',
        'Termin geändert', COALESCE(NEW.title,'Termin')||' am '||_when, '/appointments', 'appointment', NEW.id);
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER calendar_appt_notify AFTER INSERT OR UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.tg_calendar_appt_notify();

-- Outlook-Termine: Zuweisung / Freigabe (nur freigegebene Inhalte, nie private Titel)
CREATE OR REPLACE FUNCTION public.tg_calendar_assign_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _b record; _u uuid; _label text; _when text;
BEGIN
  IF NEW.visibility <> 'shared' THEN RETURN NEW; END IF;
  SELECT * INTO _b FROM calendar_busy_blocks WHERE connection_id=NEW.connection_id AND provider_event_id=NEW.provider_event_id;
  IF _b IS NULL OR COALESCE(_b.is_private,false) THEN RETURN NEW; END IF;
  _label := COALESCE(NULLIF(_b.subject,''),'Outlook-Termin');
  _when := to_char(_b.starts_at AT TIME ZONE 'Europe/Zurich','DD.MM.YYYY HH24:MI');
  FOR _u IN SELECT x FROM unnest(NEW.shared_with_user_ids) x
            WHERE TG_OP='INSERT' OR OLD.visibility <> 'shared' OR NOT (x = ANY(OLD.shared_with_user_ids)) LOOP
    IF _u = ANY(NEW.responsible_user_ids) THEN
      PERFORM calendar_notify(NEW.agency_id, _u, 'ext:'||NEW.id||':assigned:'||_u||':'||NEW.updated_at, 'assigned',
        'Termin zugewiesen', _label||' am '||_when, '/appointments', 'calendar_event', NEW.id);
    ELSE
      PERFORM calendar_notify(NEW.agency_id, _u, 'ext:'||NEW.id||':shared:'||_u||':'||NEW.updated_at, 'shared',
        'Termin mit dir geteilt', _label||' am '||_when, '/appointments', 'calendar_event', NEW.id);
    END IF;
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER calendar_assign_notify AFTER INSERT OR UPDATE ON public.calendar_event_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_calendar_assign_notify();

-- Outlook-Änderung/Absage an geteilten Terminen
CREATE OR REPLACE FUNCTION public.tg_calendar_block_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a record; _u uuid; _kind text; _label text; _when text; _st text;
BEGIN
  IF COALESCE(NEW.is_private,false) THEN RETURN NEW; END IF;
  IF COALESCE(NEW.is_cancelled,false) AND NOT COALESCE(OLD.is_cancelled,false) THEN _kind := 'cancelled';
  ELSIF NOT COALESCE(NEW.is_cancelled,false) AND (NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
        OR NEW.subject IS DISTINCT FROM OLD.subject OR NEW.location IS DISTINCT FROM OLD.location) THEN _kind := 'changed';
  ELSE RETURN NEW; END IF;
  SELECT * INTO _a FROM calendar_event_assignments WHERE connection_id=NEW.connection_id AND provider_event_id=NEW.provider_event_id AND visibility='shared';
  IF _a IS NULL THEN RETURN NEW; END IF;
  _label := COALESCE(NULLIF(NEW.subject,''),'Outlook-Termin');
  _when := to_char(NEW.starts_at AT TIME ZONE 'Europe/Zurich','DD.MM.YYYY HH24:MI');
  _st := md5(COALESCE(NEW.subject,'')||NEW.starts_at::text||NEW.ends_at::text||COALESCE(NEW.location,'')||COALESCE(NEW.is_cancelled,false)::text);
  FOREACH _u IN ARRAY _a.shared_with_user_ids LOOP
    CONTINUE WHEN _u = NEW.user_id;
    PERFORM calendar_notify(NEW.agency_id, _u, 'ext:'||_a.id||':'||_kind||':'||_u||':'||_st, _kind,
      CASE _kind WHEN 'cancelled' THEN 'Termin abgesagt' ELSE 'Termin geändert' END, _label||' am '||_when, '/appointments', 'calendar_event', _a.id);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER calendar_block_notify AFTER UPDATE ON public.calendar_busy_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_calendar_block_notify();

-- Handlungsrelevante Sync-Fehler nur beim Übergang (Retries erzeugen nichts Neues)
CREATE OR REPLACE FUNCTION public.tg_calendar_conn_notify()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('reconnect_required','admin_approval_required') AND OLD.status IS DISTINCT FROM NEW.status THEN
    PERFORM calendar_notify(NEW.agency_id, NEW.user_id,
      'conn:'||NEW.id||':'||NEW.status||':'||COALESCE(extract(epoch from NEW.last_error_at)::bigint::text,'0'), 'sync_error',
      'Microsoft-Kalender: Aktion nötig',
      CASE NEW.status WHEN 'admin_approval_required' THEN 'Deine Microsoft-Organisation muss die Kalender-Verbindung freigeben.'
        ELSE 'Bitte verbinde deinen Microsoft-Kalender erneut, damit die Synchronisierung weiterläuft.' END,
      '/settings/calendar', 'calendar_connection', NEW.id);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
CREATE TRIGGER calendar_conn_notify AFTER UPDATE ON public.calendar_connections
  FOR EACH ROW EXECUTE FUNCTION public.tg_calendar_conn_notify();