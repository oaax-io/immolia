# Immolia Roadmap (intern)

Einzige interne Roadmap. Die Liste unter Dokumentation → Roadmap in der App ist die Kunden-Roadmap und enthält keine Architekturthemen.

## Commercial – Reihenfolge
- [x] 5.1–5.5 Commercial Foundation, Credits, Usage, Trial, Katalog
- [x] 5.6 Stripe Billing + E2E (OAASE, Testmodus)
- [ ] 5.6.1 Invite-only Onboarding (Einladung ohne bestehendes Konto annehmbar)
- [ ] 5.6.2 Manual & Invoice Billing
  - Abo und Zahlungsquelle getrennt: stripe, invoice, bank_transfer, complimentary, manual
  - System Owner verwaltet: Plan, individueller Preis, monatlich/jährlich, Beginn, gültig bis, bezahlt/unbezahlt, Auto-Verlängerung, interne Notiz, individuelle Allowances (Credits, User, Storage, Financing Requests)
  - Gleiche Subscription-/Entitlement-/Allowance-Engine wie Stripe; Stripe steuert keine Business-Logik
  - Jede Änderung ein Audit-Eintrag; Tenant aktiviert nie selbst
  - Use Case: ASIMO Jahresmitgliedschaft per Rechnung bezahlt
- [ ] 5.7 Billing & Credits UI
- [ ] 5.8 Credit Enforcement in echten Funktionen
- [ ] 5.9 Commercial/Billing Security Audit

## Spätere Workstreams (noch nicht umsetzen)
- [ ] Tenant Feature Flags: generische Feature Keys (z. B. advanced_commission_management), Kategorien standard/beta/custom/enterprise, zusätzlich zum Modulsystem, nie `if agency === ASIMO`; Platform Admin → Unternehmen → Features; umgehen nie RLS/Tenant-Isolation
- [ ] Vermittler / Untervermittler / Partner im Tenant: Partnerbeziehung getrennt von Tenant-Rolle; Person oder Organisation, mehrere Benutzer je Organisation; sieht nur eigene Leads, Fälle, Finanzierungsanfragen, Vermittlungsstatus, freigegebene Dokumente, eigene Provisionen; in RLS abgebildet
- [ ] Immolia Platform Partner Network: platform_partners, partner_types, partner_referrals; Case-/Referral-Modell mit Origin Agency und Provider, nur ausdrücklich freigegebene Daten, kein Cross-Tenant-Zugriff; erster Use Case ASIMO als Finanzierungspartner
- [ ] Financing Provider Architecture: financing_providers, financing_cases, financing_provider_id; ASIMO nur erster Provider; später Banken, Versicherungen, Bewertung, Notare, Treuhand; Bank-APIs ohne Neuaufbau integrierbar
