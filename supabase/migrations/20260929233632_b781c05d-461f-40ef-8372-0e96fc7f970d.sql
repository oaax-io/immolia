CREATE POLICY sec4_subobject_delete ON public.property_media FOR DELETE TO authenticated
  USING (is_agency_member(agency_id) AND role_can(agency_id, 'media', 'edit', uploaded_by));
CREATE POLICY sec4_subobject_delete ON public.tasks FOR DELETE TO authenticated
  USING (is_agency_member(agency_id) AND role_can(agency_id, 'tasks', 'edit', created_by, assigned_to));
CREATE POLICY sec4_subobject_delete ON public.documents FOR DELETE TO authenticated
  USING (is_agency_member(agency_id) AND role_can(agency_id, 'documents', 'edit', uploaded_by));
CREATE POLICY sec4_subobject_delete ON public.appointments FOR DELETE TO authenticated
  USING (is_agency_member(agency_id) AND role_can(agency_id, 'appointments', 'edit', owner_id, assigned_to));