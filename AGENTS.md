# ASIMO / Immolia – Architekturregeln (Kurzfassung)

Ausführliche, nach Phasen gegliederte Regeln: `src/AGENTS.md`. Dort nachlesen und neue Regeln ergänzen, bevor Datenbank- oder Modulcode geändert wird.

Immer gültige Invarianten:
- Plattform- und Tenantrolle sind strikt getrennt. Plattform-Admins lesen/schreiben Tenantdaten nur über `platform_*` SECURITY-DEFINER-RPCs mit genau einem Audit-Eintrag; nie direkte Tabellenschreibzugriffe aus dem Browser.
- Genau eine aktive Firma pro Sitzung: `current_agency_id()`. Alle RLS-Helfer (`is_agency_member`, `has_agency_role`, `is_agency_owner_or_admin`) verlangen sie, `agency_is_active()` erzwingt den Firmenstatus zentral.
- Tenant-UI rendert nur hinter dem fail-closed DomainAccessGate; Query-Keys werden zentral mit der bestätigten Firma präfixiert (`src/lib/tenant-session.ts`).
- Commercial: Entitlement ≠ Limit ≠ Credit-Kosten. Auswertung und Buchung nur serverseitig; Credits sind ein unveränderliches Journal, Gutschriften nur `service_role`/Plattform.
- Module: `agency_modules` steuert Produktzugang (RESTRICTIVE Policies), `module_permissions` nur Rollenrechte darin. Fehlende Zeile = verweigert.
- Additiv arbeiten: neue Spalten NULLABLE, keine bestehenden Spalten/Tabellen/Enums/Policies umbenennen oder löschen; jede neue Tabelle mit GRANTs und RLS.
- UI-Sprache Deutsch (Schweiz).
- Immobilien-Marktanalysen laufen über eine geschützte, gezählte TanStack-Serverfunktion und werden in der bestehenden firmengebundenen Analysehistorie gespeichert; so verwenden Karte und Detailansicht denselben sicheren Weg.
