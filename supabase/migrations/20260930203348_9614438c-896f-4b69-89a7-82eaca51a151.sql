CREATE TABLE public.chat_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'group' CHECK (kind IN ('group','property')),
  name text NOT NULL,
  property_id uuid NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NULL
);
CREATE UNIQUE INDEX chat_groups_property_uniq ON public.chat_groups(agency_id, property_id) WHERE kind = 'property';

CREATE TABLE public.chat_group_members (
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  added_by uuid NULL,
  last_read_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX chat_group_members_user ON public.chat_group_members(user_id);

CREATE TABLE public.chat_group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL DEFAULT auth.uid(),
  body text NOT NULL DEFAULT '',
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_group_messages_group ON public.chat_group_messages(group_id, created_at);

GRANT SELECT ON public.chat_groups TO authenticated;
GRANT SELECT ON public.chat_group_members TO authenticated;
GRANT SELECT, INSERT ON public.chat_group_messages TO authenticated;
GRANT ALL ON public.chat_groups, public.chat_group_members, public.chat_group_messages TO service_role;

ALTER TABLE public.chat_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.chat_is_group_member(_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_groups g JOIN chat_group_members m ON m.group_id = g.id
    WHERE g.id = _group_id AND m.user_id = auth.uid()
      AND g.agency_id = current_agency_id() AND is_agency_member(g.agency_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.chat_can_manage_group(_group_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM chat_groups g WHERE g.id = _group_id
      AND g.agency_id = current_agency_id() AND is_agency_member(g.agency_id)
      AND (g.created_by = auth.uid() OR is_agency_owner_or_admin(g.agency_id))
  );
$$;

CREATE POLICY chat_groups_select ON public.chat_groups FOR SELECT TO authenticated
  USING (public.chat_is_group_member(id));
CREATE POLICY chat_group_members_select ON public.chat_group_members FOR SELECT TO authenticated
  USING (public.chat_is_group_member(group_id));
CREATE POLICY chat_group_messages_select ON public.chat_group_messages FOR SELECT TO authenticated
  USING (public.chat_is_group_member(group_id));
CREATE POLICY chat_group_messages_insert ON public.chat_group_messages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() AND public.chat_is_group_member(group_id));

CREATE OR REPLACE FUNCTION public.chat_group_touch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE chat_groups SET last_message_at = NEW.created_at, updated_at = now() WHERE id = NEW.group_id;
  UPDATE chat_group_members SET last_read_at = NEW.created_at WHERE group_id = NEW.group_id AND user_id = NEW.sender_id;
  RETURN NEW;
END $$;
CREATE TRIGGER chat_group_messages_touch AFTER INSERT ON public.chat_group_messages
  FOR EACH ROW EXECUTE FUNCTION public.chat_group_touch();

-- nur aktive Mitglieder der Firma
CREATE OR REPLACE FUNCTION public._chat_valid_members(_agency uuid, _ids uuid[])
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(array_agg(DISTINCT am.user_id), '{}')
  FROM agency_memberships am
  WHERE am.agency_id = _agency AND am.is_active AND am.user_id = ANY(coalesce(_ids,'{}'));
$$;

CREATE OR REPLACE FUNCTION public.chat_group_create(_name text, _member_ids uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid := current_agency_id(); g uuid; u uuid;
BEGIN
  IF auth.uid() IS NULL OR a IS NULL OR NOT is_agency_member(a) THEN RAISE EXCEPTION 'not allowed'; END IF;
  IF coalesce(trim(_name),'') = '' THEN RAISE EXCEPTION 'name required'; END IF;
  INSERT INTO chat_groups(agency_id, kind, name, created_by) VALUES (a, 'group', left(trim(_name),120), auth.uid()) RETURNING id INTO g;
  INSERT INTO chat_group_members(group_id, user_id, added_by) VALUES (g, auth.uid(), auth.uid());
  FOREACH u IN ARRAY _chat_valid_members(a, _member_ids) LOOP
    INSERT INTO chat_group_members(group_id, user_id, added_by) VALUES (g, u, auth.uid()) ON CONFLICT DO NOTHING;
  END LOOP;
  RETURN g;
END $$;

CREATE OR REPLACE FUNCTION public.chat_property_open(_property_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid := current_agency_id(); p record; g uuid; ids uuid[];
BEGIN
  IF auth.uid() IS NULL OR a IS NULL OR NOT is_agency_member(a) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT id, agency_id, title, owner_id, assigned_to INTO p FROM properties WHERE id = _property_id;
  IF p.id IS NULL OR p.agency_id <> a THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT id INTO g FROM chat_groups WHERE agency_id = a AND kind = 'property' AND property_id = _property_id;
  IF g IS NULL THEN
    INSERT INTO chat_groups(agency_id, kind, name, property_id, created_by)
      VALUES (a, 'property', left(coalesce(nullif(trim(p.title),''),'Immobilie'),120), _property_id, auth.uid())
      ON CONFLICT DO NOTHING RETURNING id INTO g;
    IF g IS NULL THEN SELECT id INTO g FROM chat_groups WHERE agency_id = a AND kind = 'property' AND property_id = _property_id; END IF;
  END IF;
  ids := ARRAY(SELECT user_id FROM property_assignees WHERE property_id = _property_id)
         || ARRAY[p.assigned_to, p.owner_id, auth.uid()];
  INSERT INTO chat_group_members(group_id, user_id, added_by)
    SELECT g, x, auth.uid() FROM unnest(_chat_valid_members(a, ids)) x
    ON CONFLICT DO NOTHING;
  RETURN g;
END $$;

CREATE OR REPLACE FUNCTION public.chat_group_rename(_group_id uuid, _name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT chat_can_manage_group(_group_id) OR coalesce(trim(_name),'') = '' THEN RAISE EXCEPTION 'not allowed'; END IF;
  UPDATE chat_groups SET name = left(trim(_name),120), updated_at = now() WHERE id = _group_id;
END $$;

CREATE OR REPLACE FUNCTION public.chat_group_add_members(_group_id uuid, _member_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid;
BEGIN
  IF NOT chat_can_manage_group(_group_id) THEN RAISE EXCEPTION 'not allowed'; END IF;
  SELECT agency_id INTO a FROM chat_groups WHERE id = _group_id;
  INSERT INTO chat_group_members(group_id, user_id, added_by)
    SELECT _group_id, x, auth.uid() FROM unnest(_chat_valid_members(a, _member_ids)) x ON CONFLICT DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION public.chat_group_remove_member(_group_id uuid, _user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF _user_id = auth.uid() THEN
    IF NOT chat_is_group_member(_group_id) THEN RAISE EXCEPTION 'not allowed'; END IF;
  ELSIF NOT chat_can_manage_group(_group_id) THEN RAISE EXCEPTION 'not allowed'; END IF;
  DELETE FROM chat_group_members WHERE group_id = _group_id AND user_id = _user_id;
END $$;

CREATE OR REPLACE FUNCTION public.chat_group_mark_read(_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT chat_is_group_member(_group_id) THEN RETURN; END IF;
  UPDATE chat_group_members SET last_read_at = now() WHERE group_id = _group_id AND user_id = auth.uid();
END $$;

REVOKE EXECUTE ON FUNCTION public._chat_valid_members(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.chat_group_create(text, uuid[]), public.chat_property_open(uuid), public.chat_group_rename(uuid, text),
  public.chat_group_add_members(uuid, uuid[]), public.chat_group_remove_member(uuid, uuid), public.chat_group_mark_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_group_create(text, uuid[]), public.chat_property_open(uuid), public.chat_group_rename(uuid, text),
  public.chat_group_add_members(uuid, uuid[]), public.chat_group_remove_member(uuid, uuid), public.chat_group_mark_read(uuid) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_group_messages;