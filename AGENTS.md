
- Platform Admin Center (/platform) reads tenant metadata only via platform_* SECURITY DEFINER RPCs gated by is_platform_admin(); why: platform roles must never bypass tenant RLS or expose CRM data.
- Tenant status (agencies.status) is enforced centrally in current_agency_id()/is_agency_member()/has_agency_role()/is_agency_owner_or_admin() via agency_is_active(); why: one enforcement point instead of frontend checks, while public domain branding stays independent.
- Platform admin mutations go only through platform_* RPCs that write exactly one platform_audit_logs row; why: auditable, no direct table writes from the browser.
- Tenant provisioning runs only through the atomic platform_create_tenant RPC (platform admins), pending owners without an account go to tenant_owner_invitations; why: no half-built tenants, no browser inserts, no temp passwords.
- Module access = agency_modules (product access, enforced server-side by RESTRICTIVE module_gate_* policies via agency_module_enabled_for(row agency_id)); module_permissions = role rights inside an available module; owner has full rights in enabled modules without rows; why: a role permission can never open a locked module.
## Domain Center (4.4)
- Platform domain mutations only via platform_* RPCs (platform_add_custom_domain/set_domain_active/set_primary_domain/remove_domain) writing one audit row; DNS result stored only by server via platform_domain_record_check (service_role); why: no browser writes, no fake verification.
- Wildcard reachability of *.immolia.ch is one flag IMMOLIA_WILDCARD_READY in platform-admin.ts; why: registered ≠ reachable, remove hint centrally later.
## Modules (4.5)
- Single module registry src/lib/modules.ts (MODULE_REGISTRY), mirrored in DB by platform_module_keys()/platform_core_module_keys(); why: one list, server validates keys.
- is_entitled only via platform_set_module_entitlement (platform admins, one audit row); tenants change is_enabled only (guard trigger blocks browser roles from is_entitled/core-disable); missing agency_modules row = denied; why: default-deny for SaaS tenants.
## Workspace-Kontext (4.6A)
- Genau ein aktives Unternehmen pro Sitzung: profiles.active_agency_id (nur via set_current_agency, Trigger blockiert Browser-Schreibzugriffe); current_agency_id() = gültige Auswahl, sonst einzige aktive Mitgliedschaft, sonst NULL (Auswahl nötig); why: mehrere Mitgliedschaften dürfen nie Daten mehrerer Firmen zugleich zeigen.
- is_agency_member/has_agency_role/is_agency_owner_or_admin verlangen _agency_id = current_agency_id(); why: ein zentraler Punkt härtet alle RLS-Policies ohne Policy-Umbau.
- Firmenwechsel auf fremder Firmen-Adresse leitet auf deren aktive eigene Domain bzw. GENERIC_APP_HOST (src/lib/workspaces.ts) um; why: nie Daten von Firma B unter Branding von Firma A.
## Plattformzugänge (4.6B)
- Plattformrollen nur in platform_admins; Mutationen ausschliesslich über platform_set_user_role/platform_remove_user_access (nur System Owner, letzter System Owner geschützt, ein Audit-Eintrag), Browser hat keine Schreibrechte auf die Tabelle; why: Plattform- und Tenantrollen bleiben getrennt und nachvollziehbar.
- platform_support öffnet /platform weiterhin nicht (is_platform_admin nur system_owner/platform_admin); why: Support-Funktionen kommen erst mit einer eigenen Phase.
## Einladungen (4.7)
- Eine zentrale Tabelle invitations (tenant_owner/tenant_member/platform_user), nur token_hash (sha256) gespeichert, Zugriff ausschliesslich über invitation_*/platform_invite_user/platform_list_invitations RPCs; tenant_owner_invitations ist stillgelegt; why: ein Einladungssystem, kein Klartext-Token, keine Browser-Tabellenzugriffe.
- Neue Mitarbeitende nur per Einladung (team-create-member liefert 410, keine Passwörter); Annahme atomar in invitation_accept mit E-Mail-Bindung, ändert nie active_agency_id/Module/Branding; why: kein Parallel-Onboarding, keine temporären Passwörter.
- E-Mail-Versand ist nicht eingerichtet (email_delivery_status='not_configured'); der Link wird nur bei Erstellung/Neu senden einmalig angezeigt; why: kein vorgetäuschter Versand.
## Sicherheits-Audit (4.8)
- Plattformrolle hat keinen direkten Schreibzugriff auf agencies/agency_memberships/profiles/user_roles (RESTRICTIVE sec48_* Policies); Plattform-Mutationen nur über platform_* RPCs; why: alte is_superadmin()-Policies waren ein Backdoor in fremde Firmen.
- /oaax ist stillgelegt (Redirect auf /platform); why: einziges Plattform-Admin-Center ist /platform.
- Rollenrechte Erstellen/Bearbeiten serverseitig über einen Helper role_can(agency, module, action, owner, other) in RESTRICTIVE sec481_* Policies; Inhaber/Admin voll; why: module_permissions darf nicht nur UI sein.
- Öffentliche Token-Links (financing_links, bank_package_shares, public_property_view) prüfen agency_is_active; why: gesperrte Firmen haben keine operativen öffentlichen Zugänge.
- Profile-Sichtbarkeit (can_see_profile) ohne Plattform-Ausnahme; Plattform liest Benutzerdaten nur über platform_* RPCs.
## Commercial Foundation (5.1)
- Kommerzielle Ebenen getrennt: plans/plan_entitlements (Freischaltung), plan_limits (Menge, Zahl oder unbegrenzt), addons/addon_entitlements/addon_limit_increments/agency_addons, credit_packages, credit_action_costs, credit_wallets/credit_ledger (unveränderliches Journal, Saldo nur daraus); subscriptions erweitert (plan_id, billing_period, trial_*) statt zweiter Tabelle; why: Entitlement ≠ Limit ≠ Credit Cost.
- Auswertung nur serverseitig: agency_has_entitlement / agency_effective_limit (Plan + Add-ons) / agency_commercial_state / credit_action_effective_cost (NULL, 0 oder inaktiv = kostenlos); why: Frontend rechnet nie selbst.
- Definitionen nur über platform_* RPCs (is_platform_admin, ein Audit-Eintrag); Tenants lesen nur eigene agency_addons/credits (Inhaber/Admin), schreiben nie; why: keine Browser-Mutationen, Plattformrolle verleiht keine Commercial-Rechte.
- commercial_enforced=false: agency_modules bleibt massgeblich, bis die Plan-Migration ausdrücklich aktiviert wird; Stripe darf später nie agency_modules.is_enabled setzen; why: ASIMO verliert keine Funktionen.
## Credit Engine (5.2)
- Credits = Posten-Modell im bestehenden credit_ledger: positive Zeile = Posten (Topf + optional expires_at), negative Zeile belastet genau einen Posten (lot_id); fachliche Vorgänge in credit_operations (unveränderlich, operation_id verbindet mehrere Zeilen); why: Ablauf pro Posten, Saldo jederzeit aus dem Journal rekonstruierbar.
- Verbrauch nur über credit_consume(action_key, idempotency_key): aktive Firma, Kosten aus credit_action_costs, Wallet-Sperre FOR UPDATE, Reihenfolge subscription → promotional → adjustment → purchased, früheste Ablaufzeit zuerst; Idempotenz per UNIQUE-Index; why: nie doppelt, nie negativ, Browser bestimmt nie Kosten.
- Gutschrift/Rückerstattung nur service_role (credit_grant/credit_refund, später Stripe/Abo) oder Plattform (platform_credit_adjust/refund mit Begründung + Audit); Tenants nie; why: keine Selbstgutschrift.
- Kein Reserve/Commit: kostenpflichtige externe Aktionen buchen erst nach Erfolg (credit_can_consume vorher, credit_consume nachher mit gleicher Idempotenz); why: nie Belastung bei technischem Fehler, geringere Komplexität.
- subscriptions lesen nur Mitglieder der aktiven Firma (RESTRICTIVE sec52_subscriptions_select); why: M5, keine Plattform-Hintertür.
