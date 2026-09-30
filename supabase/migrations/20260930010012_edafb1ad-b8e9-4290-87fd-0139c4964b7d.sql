ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence text NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_until date NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recurrence_spawned boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.tasks_spawn_recurrence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE base timestamptz; nxt timestamptz;
BEGIN
  IF NEW.recurrence IS NULL OR NEW.recurrence NOT IN ('daily','weekly','biweekly','monthly','quarterly','yearly') THEN RETURN NEW; END IF;
  IF NEW.status <> 'done' OR OLD.status = 'done' OR NEW.recurrence_spawned THEN RETURN NEW; END IF;
  base := COALESCE(NEW.due_date, now());
  nxt := base + CASE NEW.recurrence
    WHEN 'daily' THEN interval '1 day' WHEN 'weekly' THEN interval '7 days'
    WHEN 'biweekly' THEN interval '14 days' WHEN 'monthly' THEN interval '1 month'
    WHEN 'quarterly' THEN interval '3 months' ELSE interval '1 year' END;
  IF NEW.recurrence_until IS NOT NULL AND nxt::date > NEW.recurrence_until THEN RETURN NEW; END IF;
  INSERT INTO public.tasks (title, description, status, priority, due_date, assigned_to, related_type, related_id, created_by, agency_id, recurrence, recurrence_until)
  VALUES (NEW.title, NEW.description, 'open', NEW.priority, nxt, NEW.assigned_to, NEW.related_type, NEW.related_id, NEW.created_by, NEW.agency_id, NEW.recurrence, NEW.recurrence_until);
  UPDATE public.tasks SET recurrence_spawned = true WHERE id = NEW.id;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.tasks_spawn_recurrence() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tasks_spawn_recurrence() TO service_role;

DROP TRIGGER IF EXISTS tasks_spawn_recurrence ON public.tasks;
CREATE TRIGGER tasks_spawn_recurrence AFTER UPDATE OF status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.tasks_spawn_recurrence();