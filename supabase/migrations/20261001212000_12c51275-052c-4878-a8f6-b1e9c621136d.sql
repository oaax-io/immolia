CREATE TABLE public.property_portal_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  provider_key text NOT NULL CHECK (provider_key ~ '^[a-z0-9_]{2,40}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  enabled boolean NOT NULL DEFAULT false,
  protocol text NOT NULL CHECK (protocol ~ '^[a-z0-9_]{2,40}$'),
  secret_ref text NOT NULL CHECK (secret_ref ~ '^[A-Z][A-Z0-9_]{1,40}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, provider_key)
);
CREATE INDEX property_portal_connections_protocol_idx ON public.property_portal_connections (protocol, secret_ref) WHERE enabled;
GRANT SELECT ON public.property_portal_connections TO authenticated;
GRANT ALL ON public.property_portal_connections TO service_role;
ALTER TABLE public.property_portal_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY ppc_select_own_agency ON public.property_portal_connections
  FOR SELECT TO authenticated USING (public.is_agency_member(agency_id));
CREATE TRIGGER ppc_touch BEFORE UPDATE ON public.property_portal_connections
  FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

ALTER TABLE public.portal_event_log ADD COLUMN IF NOT EXISTS provider_key text NULL;
ALTER TABLE public.portal_event_log ADD COLUMN IF NOT EXISTS agency_id uuid NULL;
ALTER TABLE public.portal_event_log ADD COLUMN IF NOT EXISTS connection_id uuid NULL;
CREATE UNIQUE INDEX IF NOT EXISTS portal_event_log_provider_event_uniq ON public.portal_event_log (provider_key, portal_event_id) WHERE provider_key IS NOT NULL;