
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
- Kostenpflichtige Aktionen über credit_reserve → Leistung → credit_reservation_finalize bzw. credit_reservation_release (Helper withCreditReservation in src/lib/credits.server.ts); Reservierung bucht sofort in Topf-Reihenfolge ab (Wallet-Sperre, Idempotenz pro Firma+Aktion+Key), Finalize/Release/Ablauf nur service_role; why: nie doppelt verfügbar, nie Belastung bei technischem Fehler, Tenant kann sich nichts zurückerstatten.
- subscriptions lesen nur Mitglieder der aktiven Firma (RESTRICTIVE sec52_subscriptions_select); why: M5, keine Plattform-Hintertür.
## Flexible Usage (5.3)
- Allowances = erweiterte plan_limits (policy unlimited/included/metered/hard_limit, period, overage_credit_cost, unit) + usage_meters-Katalog; properties/leads/clients sind core_unlimited (Trigger verhindert Limits); why: keine parallele Limit-Architektur, Kerndaten nie gesperrt.
- Nutzung nur serverseitig: commercial_usage_decision (ALLOWED_UNLIMITED/INCLUDED/CREDIT_OVERAGE, INSUFFICIENT_CREDITS, HARD_BLOCKED, NOT_AVAILABLE) und commercial_usage_record (unveränderliches usage_events, Idempotenz, Teil-Inklusive + Teil-Overage über credit_operations 'usage.<key>'); fehlende Allowance = unbegrenzt; why: Frontend entscheidet nie, keine Zwangssperre.
- Wiederkehrende Kosten (Zusatzbenutzer/-speicher) = recurring_credit_resources + recurring_credit_charges (UNIQUE Ressource+Periode, 'recurring:<id>:<period>'); fehlende Credits → Status insufficient_credits, nie Daten löschen/sperren; Abbuchung nur service_role/Plattform; why: periodische, idempotente Abbuchung ohne Scheduler-Zwang.
## Abo & Trial (5.4)
- Neue Firma → Trigger agencies_auto_trial: genau ein Trial pro Firma (agency_trials PK), internes Abo in subscriptions (source='internal', status trialing), Test-Credits einmalig (Topf promotional, Ablauf = Trial-Ende, Idempotenz 'trial:<agency>'); Dauer/Credits/Test-Plan zentral in platform_commercial_settings; why: keine zweite Abo-Tabelle, keine Verlängerung durch Nutzeraktionen.
- Periodenwechsel/Plan-Credits/Planwechsel/Kündigung nur über commercial_advance_period, platform_assign_plan, commercial_set_cancel_at_period_end, platform_extend_trial (Begründung + Audit); Plan-Credits pro Periode idempotent 'plan:<sub>:<start>' mit Ablauf Periodenende; Planwechsel ändert nie Daten, Benutzer oder agency_modules; why: Commercial steuert Kontingente, nie CRM-Modulsperren.
- Abo-Perioden-Key = Abo-ID + Periodenbeginn (ms); Zustand über commercial_subscription_state (trialing/active/past_due/canceled_until_period_end/unpaid/post_trial/no_active_subscription); why: neue Periode = neue Messperiode, Wiederholung bucht nie doppelt.
## Katalog (5.5)
- Pläne solo/team/business (aktiv, CHF 29/69/149 in plans.price_monthly), enterprise Entwurf (is_custom); Benutzer/Speicher metered, Kerndaten ausdrücklich unbegrenzt; Overage-Kosten, Finanzierungskontingente, Paketpreise, Test-Credits bis zur Freigabe leer (Entscheidung liefert overage_cost_not_set); why: keine erfundenen Werte.
## Stripe Billing (5.6)
- Stripe ist nur Zahlungsquelle: ein Stripe-Kunde pro Firma (stripe_customers, nur service_role), Firma immer serverseitig über current_agency_id + Inhaber/Admin; Abo/Credits nur per verifiziertem Webhook über stripe_sync_subscription / stripe_grant_credit_purchase (idempotent 'stripe:checkout:<session>', stripe_webhook_events); why: nie Browser-Vertrauen, nie Doppelbuchung.
- past_due mit Frist platform_commercial_settings.past_due_grace_days (14), danach Zustand unpaid = Pay-as-you-use, nie Sperre/Löschung; why: Grace ohne Datenverlust.
## Invite-only Onboarding (5.6.1)
- Neue Konten nur über signupWithInvitation (src/lib/invite-signup.functions.ts): Server prüft Token via invitation_signup_target (nur service_role), E-Mail aus Einladung, admin.createUser; Mitgliedschaft danach nur in invitation_accept; öffentliche Registrierung bleibt gesperrt; why: Einladung ohne bestehendes Konto annehmbar ohne offenen Signup.
## Tenant-Isolation Kommunikation (5.6.1a)
- notifications/direct_messages/feedback tragen agency_id (Trigger setzt aus current_agency_id, nie aus dem Browser); RESTRICTIVE sec561a_* verlangen agency_id = current_agency_id(), auch für Plattformrollen; globale Feedback-Sicht nur über platform_list_feedback/platform_update_feedback (Audit); why: benutzerbezogene Tabellen ohne Firma zeigten Mehrfach-Mitgliedern Daten der anderen Firma.
- Feedback-Anhänge privat im Bucket feedback unter agency_id/user_id/uuid, Anzeige nur per signiertem Link; Lesen nur wenn zugehöriges Feedback per RLS sichtbar, Plattform nur über getPlatformFeedbackAttachments (platform_feedback_attachments); Realtime-Kanäle pro agencyId:userId; why: keine öffentlichen/firmenübergreifenden Anhänge oder veralteten Live-Meldungen.
## Manuelle Abrechnung (5.6.2)
- Manuelle/Rechnungs-/Complimentary-Abos laufen im selben subscriptions-Datensatz (source='internal', billing_source, Stripe-IDs NULL), Mutationen nur über platform_*-Billing-RPCs mit Audit; interne Notizen in subscription_admin_notes (nur Plattform); why: eine Commercial Engine, keine Parallel-Abrechnung.
- Credits haben eine eigene monatliche Periode (credit_period), unabhängig von der Abrechnungsperiode; Grant-Key pro Abo + Credit-Monat, täglicher Lauf commercial_advance_due_periods (nur Plattform/Datenbank); why: Jahresrechnung vergibt trotzdem monatlich, nie doppelt.
## Billing UI (5.7)
- Tenant-Billing-Seite liest nur bestehende RPCs (commercial_subscription_state, agency_commercial_state, credit_balance_breakdown, credit_ledger per RLS) plus read-only tenant_billing_catalog (aktive Pläne/Pakete/Credit-Kosten); Query Keys ["billing"|"usage"|"credits", agencyId]; why: Katalogtabellen sind nur für Plattform lesbar, Frontend rechnet nie selbst, kein Cache über Firmen hinweg.
## Workspace-Wechsel (Hotfix)
- Jeder Firmenwechsel läuft über switchWorkspace() in src/lib/workspaces.ts: Sperre gegen Doppelklick, Overlay, set_current_agency, Serverbestätigung via current_agency_id(), Queries abbrechen, Realtime-Kanäle entfernen, Cache leeren, dann vollständiges Neuladen; why: nur so werden React-/Router-State, verspätete Antworten und alte Kanäle deterministisch verworfen.

## Allowance & Overage (5.8A)
- Monatliche Kontingente (period 'monthly') zählen pro Credit-Monat des Abos (Key 'cm:<sub>:<start>'), nicht pro Abrechnungsperiode; why: Jahresrechnung erhält trotzdem monatliche Kontingente.
- _commercial_usage_decision liefert zusätzlich result (free/included/credit_required/insufficient_credits/hard_blocked/not_available) und usage_type; Gauges (storage_gb, users) ergeben RECURRING_OVERAGE statt Belastung pro Aktion, ohne Preis 'commercial_configuration_required' und erlaubt; why: Speicher nie pro Upload doppelt verrechnen, Arbeit nie blockieren.
## Metered Actions (5.8C)
- Gezählte App-Aktionen laufen nur über withMeteredUsage (src/lib/metered-usage.server.ts): commercial_usage_reserve (nur service_role, Firma = current_agency_id des Benutzers) → Leistung → commercial_usage_settle(ok|fail); Stornos in usage_event_voids statt Journal-Update; why: usage_events/credit_ledger bleiben unveränderlich, Fehler geben Credits und Kontingent zurück.
- Angebunden: KI-Beschreibung → ai_expose_generations, KI-Lagebeschreibung → ai_assistant_usage; ohne plan_limits-Eintrag kostenlos; why: nur explizit konfigurierte Aktionen verbrauchen Credits.
## Credit UX (5.8D)
- Credit-Zustände healthy/low/insufficient nur über creditUxState + LOW_BALANCE_THRESHOLD (src/lib/credit-ux.ts); Kostenvorschau vor gezählten Aktionen nur über getUsagePreview + UsageCostNotice; why: eine Stelle für Schwellen/Texte, Preise kommen immer vom Server.

## Reservation Cleanup (5.8E)
- Abgelaufene Credit-Reservierungen gibt nur credit_reservations_expire() zurück, zeitgesteuert per Datenbank-Job alle 15 Min (immolia-credit-reservations-expire); manuell nur Plattform-Admin mit Audit-Eintrag; Usage wird nur gevoidet, wenn die Rückgabe tatsächlich stattfand; why: kein Tenant-Eingriff, Finalize/Expire gewinnen nie beide.
## Commercial Audit (5.9)
- Abrechnungs-/Credit-Tabellen: anon/authenticated haben kein INSERT/UPDATE/DELETE, anon kein SELECT; Schreiben nur über SECURITY-DEFINER-RPCs oder service_role; why: Schutz zusätzlich zu RLS, Journal bleibt unveränderlich.
- Stripe-Checkout liest Plan/Paket-Preis serverseitig mit Admin-Client erst nach resolveBillingAgency; why: Katalog ist nur für Plattform lesbar, Preis nie vom Browser.
## Zero Stale Tenant Data (Hotfix)
- Tenant-App rendert nur hinter dem fail-closed DomainAccessGate: serverseitig bestätigte current_agency_id (+ Firma der Adresse), Baum gekeyed auf die Firma, Fehler → neutraler Bildschirm, andere Firma (anderer Tab, BFCache) → Neuladen; why: nie Daten einer Firma unter dem Branding einer anderen.
- Alle Query-Keys werden zentral per queryKeyHashFn (src/lib/tenant-session.ts) mit der bestätigten Firma präfixiert; Branding nur, wenn tenant-config zur bestätigten Firma passt; why: Cache-Isolation auch wo Seiten agencyId vergessen.
