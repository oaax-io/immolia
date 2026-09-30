DROP POLICY IF EXISTS apc_insert ON public.agency_partner_contacts;
DROP POLICY IF EXISTS apc_update ON public.agency_partner_contacts;
DROP POLICY IF EXISTS apc_delete ON public.agency_partner_contacts;

CREATE POLICY apc_insert ON public.agency_partner_contacts
  FOR INSERT TO authenticated
  WITH CHECK (agency_id = public.current_agency_id() AND public.is_agency_owner_or_admin(agency_id));
CREATE POLICY apc_update ON public.agency_partner_contacts
  FOR UPDATE TO authenticated
  USING (public.is_agency_owner_or_admin(agency_id))
  WITH CHECK (agency_id = public.current_agency_id() AND public.is_agency_owner_or_admin(agency_id));
CREATE POLICY apc_delete ON public.agency_partner_contacts
  FOR DELETE TO authenticated
  USING (public.is_agency_owner_or_admin(agency_id));