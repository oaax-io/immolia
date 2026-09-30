# ASIMOS Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.

## [2.0.0] – 30.09.2026 – Immolia SaaS, Commercial, Kalender & Stabilisierung

### Hinzugefügt
- **Immolia als White-Label-SaaS:** Mehrere Unternehmen arbeiten in strikt getrennten Bereichen mit eigener Marke, Domain, Mitgliedschaften und Modulen; ASIMO bleibt als Bestandsunternehmen erhalten.
- **Plattform-Admin-Center:** Zentrale Verwaltung von Unternehmen, Benutzern, Domains, Modulen, Abrechnung, Feedback, Aktivitäten und Sicherheit bei strikter Trennung von Plattform- und Firmenrollen.
- **Unternehmens- und Domainverwaltung:** Unternehmen atomar anlegen, verwalten oder sperren; Domains registrieren, prüfen, aktivieren und als bevorzugte Adresse festlegen.
- **Modulverwaltung:** Produktzugang ist von Rollenrechten getrennt; fehlende Freigaben werden standardmässig abgewiesen.
- **Einladungsbasierte Benutzeraufnahme:** Einmalige, an die E-Mail-Adresse gebundene Links für Inhaber, Mitarbeitende und Plattformbenutzer; offene Registrierung und temporäre Passwörter sind deaktiviert.
- **Abonnemente und Credits:** Pläne, Add-ons, Testphasen, monatliche Kontingente, Credit-Pakete, Verbrauchsvorschau und Buchungshistorie auf der Seite «Abo & Credits».
- **Flexible Abrechnung:** Stripe, Rechnung, Banküberweisung, individuelle Verträge und kostenlose Abonnemente verwenden dieselbe Abrechnungslogik.
- **Provisionsverwaltung:** Gebuchte Provisionen, Potenzial, Aufteilungen, persönliche Ziele, Abschlussbuchungen und Provisionsabrechnungen.
- **Aufgabenansichten:** Kompakte Liste, Karten und Kanban, Anpinnen, Detailfenster, durchsuchbare Zuweisungen und Wiederholungen mit Enddatum.
- **Kalenderausbau:** Kombinierbare Ebenen für Feiertage, Geburtstage, Aufgaben, Termine und Online-Meetings; Tagessprung, Serien, getrennte Datums-/Zeitwahl, Adressvorschläge und Kollisionshinweise.
- **Microsoft-365-Kalender:** Persönliche Verbindung im bestehenden Kalender und in den Einstellungen mit Kalenderwahl, getrenntem Verbindungs-/Synchronisationsstatus, Fehlerzuständen und sicherem Trennen.

### Geändert
- **Microsoft-Synchronisationsbetrieb vorbereitet:** Verschlüsselte Zugangsdaten, automatische Erneuerung, Live-Änderungsmeldungen, regelmässiger Sicherheitsabgleich, Wiederholungen bei Störungen und Konfliktbehandlung. Der vollständige Praxistest mit einem autorisierten Microsoft-Geschäftskonto ist noch ausstehend.
- **Sicherer Firmenwechsel:** Aktive Firma wird serverseitig bestätigt; laufende Abfragen, Live-Verbindungen und Zwischenspeicher werden vor dem vollständigen Neuladen bereinigt.
- **Strikte Kommunikationsisolation:** Benachrichtigungen, interne Nachrichten, Feedback und Anhänge sind immer an die aktive Firma gebunden.
- **Credit-Verbrauch:** Credits werden nach Herkunft und Ablauf geführt, für kostenpflichtige Aktionen reserviert und bei technischen Fehlern automatisch freigegeben.
- **Bank-Pakete:** ZIP-Dateien werden speicherschonend gestreamt; Grenzen von 25 MB pro Datei, 45 MB insgesamt und 150 Dateien verhindern Speicherabbrüche.
- **Papierkorb:** Sicherung und endgültiges Löschen erfolgen atomar und unter den Berechtigungen der aktiven Firma.

### Behoben
- Veraltete Daten einer anderen Firma nach Firmenwechsel, Browser-Zurücknavigation oder parallelen Tabs werden durch eine serverseitig bestätigte Sperre und firmenbezogene Zwischenspeicher verhindert.
- Mandate werden inklusive Aufteilung, Dokument und Verknüpfung vollständig oder gar nicht erstellt; ungültige Anteile hinterlassen keine halbfertigen Datensätze.
- Löschvorgänge prüfen die tatsächlich gelöschten Datensätze; unzulässige Löschungen werden nicht mehr als erfolgreich gemeldet.
- Abrechnungskatalog, Planwechsel und Credit-Käufe stabilisiert; fehlende Modulzeilen entziehen bestehenden Unternehmen keine Funktionen.
- Termin-, Aufgaben-, Provisions- und Bank-Paket-Abläufe gegen doppelte Verarbeitung, unvollständige Datensätze und Speicherengpässe gehärtet.

---

## [1.15.0] – 18.07.2026 – Exposé, Makrolage & Finanzierungs-Detailseite

### Hinzugefügt
- **Makrolage KI-Analyse** pro Immobilie: strukturierte Auswertung (Lage, Verkehr, Infrastruktur, Bildung, Freizeit) mit Icons und Standortbeschreibung, dauerhaft am Objekt gespeichert (`properties.macro_location` jsonb, Edge Function `property-macro-location`) und in der Objekt-Übersicht sichtbar (`MacroLocationCard`).
- **Exposé-Zentrale**: Modal über den `Exposé`-Button im Immobilien-Header — Template-Auswahl (Classic / Modern / Luxury), PDF-Generierung und öffentlicher Freigabe-Link (`properties.public_token`, `public_enabled`).
- **Öffentliche Objekt-Landingpage** `/p/:token` mit Details, Fotos, Einheiten sowie Makrolage/Marktanalyse (falls vorhanden), teilbar ohne Login.
- **Selbstauskunft-Wizard**: mehrstufig mit optionalem Ehepartner und weiteren Mitantragstellern — alle Personen werden automatisch als verknüpfte Kunden angelegt.
- **Refinanzierungs-Wizard**: zwei Hypothekentranchen mit eigenen Zinssätzen, neuer Zweck `Renovation`, Ausgaben aller Antragsteller aus der Selbstauskunft.
- **Aufgaben**: Betreff-Presets (Notartermin, Kundenordner, Objektbesichtigung …), Pflicht-Kommentar-Modal beim Status `Pending`, Kalender-Integration (Monatsansicht als Standard).
- **Live-Benachrichtigungen**: Toasts unten rechts + farbcodiertes Notification-Center in der Glocke (Blau = Termine, Amber = Aufgaben, Grün = Leads), inkl. DB-Trigger für Zuweisungen.
- **Bank-Einreichungs-Paket**: enthält jetzt alle Antragsteller (Ehepartner + Mitantragsteller), Objektdaten und Objekt-Medien im Ordner `03_Immobilie`; vollständige Liste Schweizer Banken im Dropdown.
- **Aktivitätslog Finanzierung**: Trigger `tg_log_financing_dossier_change` protokolliert alle Dossier-Änderungen, Anzeige im Tab `Aktivität`.

### Geändert
- **Finanzierungs-Detailseite aufgeräumt**: Quick-Check-Tab entfernt, Vorprüfung/Detailrechnung/Szenarien direkt in der Übersicht, alle Aktionen (Bericht ansehen, PDF, Neu berechnen, An Kunde senden) im Header. Selbstauskunft-Tab entfernt, `DossierQualityCard` unter der Vorprüfung.
- **Neuer Tab-Look "Architectural Precision"** (glasige Pillen, farbige Akzentlinie, Aktivitäts-Puls) für Finanzierung und Kunden-Modal; Sub-Tabs im Underline-Stil mit Icons und Zählern.
- **Bericht-Vorschau als echte A4-Seite** mit skaliertem Inhalt und `@media screen`-Print-Styles (`FinancingReportPreviewDialog`).
- **Kunden-Modal**: Header und Haupttabs sind fixiert, nur der Inhalt scrollt (`92dvh`, sticky Header); Applikanten-Liste kompakt mit Inline-`ClientDetailDialog` (kein Seitenwechsel); `Matching`-Tab im Dialog-Modus ausgeblendet.
- **Kunden-Modal-KPIs**: Finanzierungsstatus als Label (Realistisch / Kritisch …) statt 0 %/100 %, Budget-Fallback aus letztem Dossier (`purchase_price` / `property_value`), Match-Vorschläge basierend auf Budgetbereich (≈ 60–105 %).
- **Refinanzierungs-Resultat**: Eigenmittelquote und harte Eigenmittel als `Nicht benötigt` statt 0 %, Tragbarkeit farbig (grün/amber/rot), beide Hypothekentranchen durchgehend sichtbar; `displayQuickCheckStatus` überall (inkl. Finanzierungs-Übersicht).
- **Exposé-PDFs**: Titelbild automatisch aus `is_cover`-Medium, `FOTO FOLGT`-Platzhalter für fehlende Bilder, Storage-URLs werden zu Base64 aufgelöst.
- **Aufgaben-UI**: besserer Kontrast, Prio `Hoch` rot, Fälligkeitsdatum prominenter, Kunden-Badge in Amber/Beige, Uhrzeit optional (Date-only).

### Behoben
- Manager-Rolle konnte keine Objektfotos hochladen — `user_roles` wird nun automatisch mit `profiles.role` synchronisiert.
- Refinanzierungs-Wizard Schritt 4: `Weiter` war trotz vollständig ausgefüllter Felder blockiert (Eigennutzungsanteil-Validierung bei gemischter Nutzung).
- Ausgaben-Kalkulation im Wizard nutzt jetzt alle Ausgaben-Kategorien aller Antragsteller aus der Selbstauskunft (statt nur Leasing/Kredit).
- Kundenname wird bei Speicherung der Selbstauskunft in `clients` synchronisiert (z. B. `Neshyt Cuculi` statt `N Cuculi`).
- Dokumente in der Finanzierung öffnen eine Inline-Vorschau via Signed URL statt einer neuen Browser-Tab-Route.
- Finanzierungs-Übersicht zeigt `Realistisch` für Refinanzierungen statt fälschlich `Nicht finanzierbar`.

---

## [1.14.0] – 08.06.2026 – Finanzierungs-Quick-Check Redesign

### Hinzugefügt
- **Aufstockungsbetrag-Indikator bei Refinanzierung**: Live-Anzeige des maximal möglichen Aufstockungsbetrags — grün wenn möglich, rot wenn überschritten. Manuell anpassbar mit sofortiger Validierung.
- **Schweizer-Banken-Dropdown**: Schritt 4 (Refinanzierung) nutzt nun ein durchsuchbares Dropdown mit 25+ Schweizer Banken (inkl. UBS, ZKB, Credit Suisse, Raiffeisen etc.) — eigene Eingaben als "Sonstige" möglich.

### Geändert
- **Zwei-Spalten-Layout im Quick-Check-Wizard**: Das Modal ist jetzt aufgeteilt wie ein aufgeschlagenes Buch (max-w-6xl). Links Quelle/Auswahl, rechts Daten — deutlich kompakter und übersichtlicher.
  - Schritt 2 (Objekt): Links CRM-Objekt-Auswahl, rechts Adresse & Kaufpreis.
  - Schritt 3 (Kunde): Links Hauptkunde, rechts Co-Applicant / Ehepartner.
  - Schritt 4 (Refinanzierung): Links Objekt- & Hypothekendetails, rechts Bank & Einkommen.
- **Kompakte Eingabefelder**: Numerische Felder auf max. 14rem, Datumsfelder auf 12rem begrenzt — keine überlangen Felder mehr für kleine Werte.
- **Visuelles Kontrast-System**: Modal-Body (`bg-muted`), Step-Cards (`bg-card`), Formularfelder (`bg-background`) — drei klar abgestufte Ebenen statt gleichfarbiger Flächen.
- **Sichtbarer Schliess-Button**: Weisser Kreis mit Rand und voller Deckkraft, hoverbar — immer erkennbar.

---

## [1.13.0] – 04.06.2026 – Smart Matching

### Hinzugefügt
- **Smart-Matching mit Finanzkapazität**: Das Matching berechnet jetzt aus der Selbstauskunft (inkl. Ehepartner / Mitantragsteller) automatisch Tragbarkeit (≤ 38 %) und Belehnung (≤ 80 %) gegen jedes verfügbare Objekt — Käufer ohne Budget oder Stadtpräferenz erscheinen jetzt trotzdem im Matching, sofern die Finanzlage passt.
- **Finanzierungs-Übersicht im Kacheldesign**: Die Dossier-Karte zeigt jetzt die farbcodierte Quick-Check-Kachel (Tragbarkeit, Belehnung, Hypothek, Eigenmittel) plus Begründungsliste – konsistent zum Kunden-Finanzierungstab.

### Geändert
- **Matching-Property-Filter erweitert**: Status `active` und `preparation` werden zusätzlich zu `available` / `draft` als matchbar gezählt.

---

## [1.12.0] – 03.06.2026 – Einheitliche Bestätigungs-Dialoge

### Hinzugefügt
- **In-App-Confirm-Provider**: Globaler `useConfirm`-Hook (`AlertDialog`) ersetzt alle nativen `window.confirm()`-Aufrufe. Eingebunden in Bank-Paket-Historie, Bankkonten, Agenturen, Aufgaben, Leads, Termine, Properties, Marktanalysen, Medien, Kunden-Profile, Beziehungen und Kunden-Dokumenten.
- **Bank-Paket-Versionen löschbar**: Einzelne Versionen in der Bank-Paket-Historie können gelöscht werden – inkl. Bereinigung der Storage-Datei.

### Geändert
- **Zeitstempel in Europe/Zurich**: Bank-Paket-Historie zeigt Datum & Uhrzeit konsistent in der Schweizer Zeitzone (`formatZurich`).

---

## [1.11.0] – 01.06.2026 – Bank-Paket Master-Dossier

### Hinzugefügt
- **Quick-Check-Grafiken im Master-Dossier**: Tragbarkeit, Belehnung, Eigenmittel & Co. werden farbgetreu (Grün / Gelb / Rot) aus der Vorprüfung übernommen, inkl. vollständiger Detailrechnung.
- **Selbstauskunft vollständig im Master-Dossier**: Hauptantragsteller und Mitantragsteller / Ehepartner werden nebeneinander dargestellt, alle Felder konsistent untereinander.

### Geändert
- **Kompaktes Seitenlayout**: Selbstauskunft, Tragbarkeit und Detailrechnung passen jetzt auf 1–2 zusammenhängende Seiten.

### Behoben
- **Falsche Farbgebung** für Belehnung & Tragbarkeit im PDF (war orange statt grün) behoben.
- **Englische Restbegriffe** im Master-Dossier vollständig auf Deutsch übersetzt.

---

## [1.10.0] – 28.05.2026 – Kunden-Gruppierung & Status-Workflow

### Hinzugefügt
- **Kunden-Status-Workflow**: 7 farblich kodierte Stufen (Entwurf, Pendent, Vollständig, Finanzierung, Abgeschlossen, Abgelehnt, Storniert) mit Filter und Inline-Bearbeitung im Kunden-Modal.
- **Bidirektionale Kundenbeziehungen** mit eindeutigem DB-Constraint.
- **Dokumentenverwaltung im Kundenprofil**: Modal-Vorschau, Download, Umbenennen, automatische Dokumententyp-Erkennung.
- **Immobilien-Zuweisung mit Rollen**: Eigentümer, Kaufinteressent, Mieter, Investor — mit Doppelbelegungs-Warnung.
- **Mapbox-Kartenansicht** für Immobilien mit Preis-Labels und Klick-zu-Detail.
- **KI-Auto-Fill der Selbstauskunft** im Kunden-Wizard (Antragsteller 1 + 2 inkl. Beziehung).
- **Finanzierungs-Quick-Check-Wizard** direkt aus dem Kundenprofil.

### Geändert
- **Kunden-Typ-Farben** von Status-Farben entkoppelt (Cyan, Teal, Indigo, Orange, Pink, Rose, Stone).
- **Kunden-Gruppierung**: Verknüpfte Partner werden eingerückt unter dem Hauptkunden dargestellt (CornerDownRight-Indikator).
- **Sortierung** standardmäßig nach `created_at` absteigend.
- **Medien-Ansicht** an Kunden-Kacheldesign angeglichen.

### Behoben
- Mediathek: Hover-Buttons über Bildern wieder sichtbar.
- Storage-Pfad-Logik bei umbenannten Dokumenten korrigiert.
- Doppelte Ehepartner-Badges dedupliziert.

### Entfernt
- "Finanzierung"-Spalte und "Muster-Kunde"-Button aus der Kundenübersicht.


---

## [1.0.0] – Security-Hardening & Foundation

### Sicherheit
- **RLS-Policies überarbeitet**: 18+ Tabellen erhalten strikte, rollen- bzw. eigentümerbasierte RLS-Policies. Entfernung aller `USING (true)`-Regeln.
- **Neue Sicherheitshelfer**: `can_access_property()` für objektbezogenen Zugriff, `is_owner_or_admin()` nutzt nun zentral `public.user_roles`.
- **Funktions-Rechte**: `EXECUTE` wurde für interne `SECURITY DEFINER`-Funktionen (`is_admin`, `can_access_client`, `has_role` etc.) von `anon` und `PUBLIC` entzogen.
- **Storage-Härtung**: `feedback`-Bucket auf privat umgestellt, Upload-Policies auf Uploader/Admin beschränkt.
- **Auth-Middleware**: `attachSupabaseAuth` als globales `functionMiddleware` in `src/start.ts` registriert, damit alle geschützten Server Functions das Bearer-Token erhalten.

### Hinzugefügt
- **Rollen-System**: `app_role`-Enum (`admin`, `moderator`, `user`) und `user_roles`-Tabelle mit `has_role()`-Funktion (`SECURITY DEFINER`).
- **Lead-Import-Wizard**: Massenimport von Leads aus verschiedenen Quellen mit Mapping-Dialog.
- **Mandats-Wizard**: Digitaler Mandatserfassungs-Workflow.
- **Finanzierungs-Modul**: Vollständiges Finanzierungsdossier mit Bank-Submission, UBS-Checkliste und Dossier-Qualitätsprüfung.
- **Dokumenten-System**: Template-basierte Dokumentgenerierung mit TipTap, Platzhalter-Engine, PDF-Rendering über externen Puppeteer-Service.
- **Selbstauskunft-Wizard**: 5-Schritt-Formular (Personendaten → Beruf → Einnahmen → Ausgaben → Abschluss) mit Live-Benchmark-Karte.
- **Mapbox-Integration**: `getMapboxToken` und `geocodeAddresses` Server Functions für Adress-Geocoding.
- **Exposé-Generator**: Automatisches PDF-Exposé aus Objektdaten.
- **Matching-Engine**: Kunden-Suchprofile mit verfügbaren Objekten abgleichen.
- **Medien-Management**: Upload, Konvertierung (HEIC→JPEG) und Verwaltung von Bildern und Videos.
- **NDA-Verwaltung**: Nicht-Offenlegungs-Vereinbarungen für Objektbesichtigungen.
- **Reservierungen**: Objekt-Reservierungs-Workflow.
- **Team-Verwaltung**: Benutzer, Rollen und Berechtigungen.
- **Einstellungen**: Unternehmensprofil, Bankkonten, Brandkit, Dokumenten-Templates.
- **Global Search**: Schnellsuche über Kunden, Objekte, Leads und Dokumente.
- **Analytics-Dashboard**: Kennzahlen und Visualisierungen für das Makler-Business.
- **Activity-Tracking**: Vollständiger Aktivitätslog für Audit-Trail.

---

## [0.9.0] – Core Modules

### Hinzugefügt
- **Kundenverwaltung**: CRUD für Personen und Firmen, Beziehungen, Rollen, Suchprofile.
- **Immobilienverwaltung**: Objekt-CRUD, Eigentümer-Verknüpfung, Status-Workflow, Merkmale.
- **Termin- & Aufgabenverwaltung**: Kalender, Aufgaben mit Status-Tracking.
- **Dokumentenverwaltung**: Upload, Kategorisierung, Vorschau, Versand.
- **Authentifizierung**: Supabase Auth mit Email/Passwort und Google OAuth.
- **Grund-Layout**: App-Layout mit Sidebar, Navigation, Breadcrumbs.
- **Design-System**: Tailwind CSS v4 mit shadcn/ui Komponenten, semantische Farb-Tokens.

---

## Konventionen

- Versionsnummern folgen [SemVer](https://semver.org/lang/de/).
- `Added` – Neue Features.
- `Changed` – Änderungen an bestehenden Features.
- `Deprecated` – Features, die in zukünftigen Versionen entfernt werden.
- `Removed` – Entfernte Features.
- `Fixed` – Bugfixes.
- `Security` – Sicherheitsrelevante Änderungen.
