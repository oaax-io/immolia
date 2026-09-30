import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BookOpen, Rocket, Sparkles, LifeBuoy, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_app/docs")({
  head: () => ({
    meta: [
      { title: "Dokumentation & Changelog – Immolia" },
      { name: "description", content: "Neuigkeiten, Anleitungen, Roadmap und Hilfe für Immolia." },
      { property: "og:title", content: "Dokumentation & Changelog – Immolia" },
      { property: "og:description", content: "Neuigkeiten, Anleitungen, Roadmap und Hilfe für Immolia." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DocsPage,
});

type ChangeType = "feature" | "improvement" | "fix";

interface ChangelogEntry {
  version: string;
  date: string;
  changes: { type: ChangeType; text: string }[];
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: "2.0.0",
    date: "30.09.2026",
    changes: [
      { type: "feature", text: "Immolia ist neu als White-Label-SaaS für mehrere Unternehmen aufgebaut: Jede Firma arbeitet in einem vollständig getrennten Bereich mit eigener Marke, Domain, Mitgliedschaften und Modulen; ASIMO bleibt als bestehendes Unternehmen erhalten." },
      { type: "feature", text: "Neues Plattform-Admin-Center für Unternehmen, Benutzer, Domains, Module, Abrechnung, Feedback, Aktivitäten und Sicherheit – Plattformrollen und Firmenrollen sind strikt getrennt." },
      { type: "feature", text: "Unternehmen lassen sich zentral und vollständig anlegen, sperren und verwalten; eigene Domains können registriert, geprüft, aktiviert und als bevorzugte Adresse festgelegt werden." },
      { type: "feature", text: "Zentrale Modulverwaltung: Produktzugang und Rollenrechte sind getrennt. Firmen können nur freigeschaltete Module nutzen; fehlende Freigaben werden sicher abgewiesen." },
      { type: "feature", text: "Neues Einladungssystem für Inhaber, Mitarbeitende und Plattformbenutzer: Konten werden ausschliesslich über einen einmaligen, an die E-Mail-Adresse gebundenen Einladungslink aufgenommen; die offene Registrierung und temporäre Passwörter entfallen." },
      { type: "feature", text: "Abonnemente und Credits: Pläne, Add-ons, Testphasen, monatliche Kontingente, Credit-Pakete und Verbrauchshistorie sind in der neuen Seite «Abo & Credits» sichtbar." },
      { type: "feature", text: "Stripe-Zahlungen sowie Rechnungs-, Banküberweisungs-, individuelle und kostenlose Abonnemente verwenden dieselbe Abrechnungslogik; bezahlte Pläne und Credit-Pakete werden erst nach bestätigter Zahlung gutgeschrieben." },
      { type: "feature", text: "Credits werden nach Herkunft und Ablaufdatum geführt. Kostenpflichtige Aktionen zeigen ihre voraussichtlichen Kosten, reservieren Credits sicher und geben sie bei technischen Fehlern automatisch wieder frei." },
      { type: "feature", text: "Neue Provisionsverwaltung mit gebuchten Provisionen, Potenzial, Aufteilungen nach beteiligten Personen, Zielwerten, Abschlussbuchung und Provisionsabrechnung." },
      { type: "feature", text: "Aufgaben neu in kompakter Liste, Kartenansicht oder Kanban; Aufgaben lassen sich anpinnen und per Klick in einem übersichtlichen Detailfenster öffnen. Zuweisungen sind durchsuchbar, Wiederholungen können mit Enddatum erstellt werden." },
      { type: "feature", text: "Kalender erweitert: frei kombinierbare Ebenen für Feiertage, Geburtstage, Aufgaben, alle/eigene Termine und Online-Meetings; direkter Tagessprung, Serien täglich bis monatlich, getrennte Datums- und Zeitwahl, Adressvorschläge und Kollisionshinweise." },
      { type: "feature", text: "Persönliche Microsoft-365-Kalenderverbindung direkt im bestehenden Kalender und unter Einstellungen: Kalenderwahl, getrennte Anzeige von Verbindung und Synchronisationsstatus, letzter erfolgreicher Abgleich, verständliche Fehlerzustände und sicheres Trennen." },
      { type: "improvement", text: "Microsoft-365-Synchronisation technisch für den dauerhaften beidseitigen Betrieb vorbereitet: verschlüsselte Zugangsdaten, automatische Erneuerung, Live-Änderungsmeldungen, stündlicher Sicherheitsabgleich, Wiederholungen bei Störungen und Konfliktbehandlung." },
      { type: "improvement", text: "Wichtig: Die Microsoft-Verbindung und der Terminabgleich sind bereitgestellt, benötigen aber noch den vollständigen Praxistest mit einem autorisierten Microsoft-Geschäftskonto, bevor die Synchronisation als abschliessend bestätigt gilt." },
      { type: "improvement", text: "Firmenwechsel vollständig abgesichert: Die aktive Firma wird serverseitig bestätigt, laufende Abfragen und Live-Verbindungen werden beendet und alte Zwischenspeicher geleert; Daten einer anderen Firma werden nie unter dem falschen Branding angezeigt." },
      { type: "improvement", text: "Kommunikation und Dateien weiter isoliert: Benachrichtigungen, interne Nachrichten, Feedback und Anhänge gehören immer zur aktiven Firma; Plattformadministratoren erhalten keinen direkten Zugriff auf CRM-Inhalte." },
      { type: "improvement", text: "Bank-Pakete werden speicherschonend als Datenstrom erstellt. Klare Grenzen von 25 MB pro Datei, 45 MB insgesamt und 150 Dateien verhindern Abbrüche bei grossen Dossiers." },
      { type: "improvement", text: "Papierkorb und endgültiges Löschen arbeiten atomar: Sicherung und Löschung gelingen gemeinsam oder gar nicht; Wiederherstellung und Berechtigungen bleiben firmenbezogen." },
      { type: "fix", text: "Kritischer Schutz gegen veraltete Firmendaten nach Firmenwechsel, Browser-Zurücknavigation oder parallelen Tabs ergänzt; bei einer fehlgeschlagenen Firmenprüfung erscheint eine neutrale Sperransicht statt fremder Inhalte." },
      { type: "fix", text: "Mandate werden inklusive Aufteilung, Dokument und Verknüpfung in einem einzigen sicheren Vorgang erstellt; ungültige Anteile können keine halbfertigen Mandate mehr hinterlassen." },
      { type: "fix", text: "Löschvorgänge prüfen neu, ob tatsächlich ein Datensatz entfernt wurde; unzulässige Löschungen über Firmen- oder Rollengrenzen werden nicht mehr irrtümlich als erfolgreich angezeigt." },
      { type: "fix", text: "Abrechnungskatalog, Planwechsel und Credit-Käufe stabilisiert; Firmen verlieren bei fehlenden Modulzeilen keine bestehenden Funktionen, während neue Freigaben weiterhin standardmässig gesperrt bleiben." },
      { type: "fix", text: "Termin-, Aufgaben-, Provisions- und Bank-Paket-Abläufe wurden gegen doppelte Verarbeitung, unvollständige Datensätze und Speicherengpässe gehärtet." },
    ],
  },
  {
    version: "1.16.0",
    date: "21.08.2026",
    changes: [
      { type: "feature", text: "Exposé-Wizard pro Objekt: Schritt fuer Schritt (Vorlage → Inhalte → Galerie → Ansprechperson → Vorschau → Generieren) mit Auswahl der Inhalte, Bildergalerie, Live-Vorschau, PDF-Download und Ablage in den generierten Dokumenten" },
      { type: "feature", text: "Ansprechperson im Exposé: Mitarbeitende (inkl. Profilbild) auswaehlen oder eigene Kontaktdaten erfassen" },
      { type: "feature", text: "Papierkorb in den Einstellungen: geloeschte Immobilien, Kunden, Leads, Aufgaben, Termine, Dokumente, Checklisten und Finanzierungen landen dort und lassen sich wiederherstellen oder endgueltig entfernen" },
      { type: "feature", text: "Interner Chat: neues Postfach-Icon neben der Glocke — Mitarbeitende koennen in Echtzeit miteinander chatten" },
      { type: "feature", text: "Echtzeit-Praesenz: Online-/Offline-Status der Nutzer via Heartbeat statt pauschal 'gruen'" },
      { type: "feature", text: "ASIMO Portal Anbindung: signierte Webhooks (HMAC-SHA256) mit Idempotenz-Log fuer neue Leads/Termine/Selbstauskuenfte sowie Schalter 'Auf Portal veroeffentlichen' bei Immobilien (Upsert/Unpublish)" },
      { type: "feature", text: "Schnellzugriffe im Objekt-Header: '+ Neu'-Dropdown fuer Aufgabe, Termin, Checkliste, Marktanalyse, Mandat und Reservation — jeweils direkt als Modal" },
      { type: "feature", text: "KI-Objektbeschreibung: Beschreibungstext wird auf Wunsch aus den Objektdaten generiert (Streaming), manuelles Schreiben bleibt optional" },
      { type: "feature", text: "Pin-Funktion bei Immobilien mit frei waehlbarer Farbe — in der Listenansicht wird die ganze Zeile eingefaerbt (unabhaengig von den Statusfarben)" },
      { type: "feature", text: "Mehrfach-Zustaendigkeiten: mehrere Personen pro Immobilie zuweisen, mit Profilbildern in Liste, Kachel und Detailseite; Eigentuemer-Verwaltung direkt als Kachel in der Detailseite (Tab entfernt)" },
      { type: "feature", text: "Automatische Objektnummern im Format IMO-100.001 fuer alle bestehenden und neuen Immobilien" },
      { type: "feature", text: "Hover-Karte bei Immobilientiteln mit Bild und den wichtigsten Objektdaten" },
      { type: "feature", text: "Hyporechner Schweiz: Vergleich direkte vs. indirekte Amortisation (Versicherungsloesung) inkl. Steuerbetrachtung, Vor-/Nachteilen und PDF-Export" },
      { type: "feature", text: "Firmenlogo-Upload im Firmenprofil — wird automatisch in Exposés und Dokumentvorlagen verwendet" },
      { type: "feature", text: "Profilbilder fuer Mitarbeitende inkl. Upload im Team-Bereich" },
      { type: "feature", text: "Einstellungen als Startseite mit grossen Kacheln und eigener Unterseite je Bereich (statt Tabs)" },
      { type: "improvement", text: "Filter-Standard fuer Kunden, Leads, Immobilien und Finanzierungen: durchsuchbare Mehrfachauswahl (Status, Typ/Quelle, Mitarbeitende mit Profilbild, Banken) und automatische Speicherung bis 'Zuruecksetzen'" },
      { type: "improvement", text: "Bank-Filter mit vollstaendiger Schweizer Bankenliste und Mehrfachauswahl; Filter 'Datenbasis' entfernt, Status farbcodiert" },
      { type: "improvement", text: "'Quick-Check' heisst neu durchgehend 'Finanzierung' (Buttons, Menues, Statuslabels)" },
      { type: "improvement", text: "Neue Seitenkoepfe: grosses violettes Bereichs-Icon neben dem Titel, ueberfluessige Beschreibungstexte entfernt (Immobilien, Kunden, Leads, Termine, Matching, Aufgaben, Analytics, Dokumente, Mediathek, Finanzierungen)" },
      { type: "improvement", text: "Objekt-Detailseite: Uebersicht dynamischer mit Inline-Bearbeitung (u. a. Beschreibung) und Kacheln fuer Aufgaben, Mandate und Termine; Tabs 'Vermarktung', 'Organisation' und 'Marktanalyse' entfernt und Tab-Design im CI" },
      { type: "improvement", text: "Objekt-Cover zeigt alle hochgeladenen Medien, Button 'Alle Bilder' oeffnet Galerie-Modal inkl. Upload" },
      { type: "improvement", text: "Neue Hauptfarbe #6F6B94 inkl. Sidebar; Immobilienstatus 'Aktiv' entfernt (bestehende auf 'Verfuegbar' umgestellt)" },
      { type: "improvement", text: "Checklisten, Mandate, Reservationen, NDAs und Exposés sind neu im Dokumentencenter gebuendelt" },
      { type: "improvement", text: "Hyporechner-Schweiz-Modal ueberarbeitet: mehr Kontrast, klare Bereiche und scrollbarer Inhalt" },
      { type: "improvement", text: "Sprache wird neu unter 'Mein Profil' in den Einstellungen gewaehlt (aus der Topbar entfernt); 'Abonnement' aus den Einstellungen entfernt; Mitarbeitende, Feedback und Dokumentation zusaetzlich im Profil-Dropdown" },
      { type: "improvement", text: "Objekt-Header-Button 'Exposé' heisst neu 'Veroeffentlichen' (Share-Icon)" },
      { type: "improvement", text: "Kundenliste kompakter mit Pfeil-Aufklappen und Inline-Kundendialog ohne Seitenwechsel" },
      { type: "fix", text: "Profilbild wird in der Topbar zuverlaessig angezeigt (direkt aus dem Profil, mit Live-Update); Initialen nur noch als Fallback" },
      { type: "fix", text: "Pin-Farbauswahl bei Immobilien liess sich nicht oeffnen — behoben" },
      { type: "fix", text: "Aufgaben werden bei Kundenzuweisung automatisch mit uebertragen" },
      { type: "fix", text: "Veroeffentlichung unter crm.asimo.ch geprueft und URL-Handling stabilisiert" },
    ],
  },
  {

    version: "1.15.0",
    date: "18.07.2026",
    changes: [
      { type: "feature", text: "Makrolage KI-Analyse: pro Immobilie generierbar (Lage, Verkehr, Infrastruktur, Bildung, Freizeit) inkl. Icons und Standortbeschreibung, dauerhaft am Objekt gespeichert und in der Objekt-Uebersicht sichtbar" },
      { type: "feature", text: "Exposé-Zentrale pro Immobilie: neues Modal ueber den 'Exposé'-Button im Immobilien-Header — Template waehlen (Classic / Modern / Luxury), PDF generieren, oeffentlichen Freigabe-Link (/p/:token) erstellen und verwalten" },
      { type: "feature", text: "Oeffentliche Objekt-Landingpage: /p/:token zeigt Details, Fotos, Einheiten und (falls vorhanden) Makrolage/Marktanalyse — ohne Login teilbar" },
      { type: "feature", text: "Selbstauskunft-Wizard fuer Kunden: mehrstufig mit optionalem Ehepartner und weiteren Mitantragstellern — alle Personen werden automatisch als verknuepfte Kunden angelegt" },
      { type: "feature", text: "Refinanzierungs-Wizard: zwei Hypothekentranchen mit eigenen Zinssaetzen, neuer Zweck 'Renovation', Ausgaben aller Antragsteller werden aus der Selbstauskunft uebernommen" },
      { type: "feature", text: "Aufgaben mit Betreff-Presets (Notartermin, Kundenordner, Objektbesichtigung …), Pending-Status verlangt Kommentar via Modal, Aufgaben mit Faelligkeitsdatum erscheinen im Kalender (Monatsansicht als Standard)" },
      { type: "feature", text: "Live-Benachrichtigungen: Toasts unten rechts + farbcodiertes Notification-Center in der Glocke (Blau = Termine, Amber = Aufgaben, Gruen = Leads)" },
      { type: "feature", text: "Bank-Einreichungs-Paket vollstaendig: enthaelt jetzt alle Antragsteller (Ehepartner + Mitantragsteller), Objektdaten und Objekt-Medien im Ordner 03_Immobilie" },
      { type: "feature", text: "Bank-Dropdown mit vollstaendiger Liste Schweizer Banken" },
      { type: "feature", text: "Aktivitaetslog fuer Finanzierungen: alle Aenderungen am Dossier werden automatisch protokolliert und im Tab 'Aktivitaet' angezeigt" },
      { type: "improvement", text: "Finanzierungs-Detailseite aufgeraeumt: Quick-Check-Tab entfernt, Vorpruefung/Detailrechnung/Szenarien direkt in der Uebersicht, alle Aktionen (Bericht ansehen, PDF, Neu berechnen, An Kunde senden) im Header" },
      { type: "improvement", text: "Neuer Tab-Look 'Architectural Precision' (glasige Pillen, farbige Akzentlinie, Aktivitaets-Puls) fuer Finanzierung und Kunden-Modal — Sub-Tabs im Underline-Stil mit Icons und Zaehlern" },
      { type: "improvement", text: "Bericht-Vorschau als echte A4-Seite mit skaliertem Inhalt und Print-Styles" },
      { type: "improvement", text: "Kunden-Modal: Header und Haupttabs sind fixiert, nur der Inhalt scrollt — Applikanten-Liste kompakt mit Inline-Detail-Dialog (kein Seitenwechsel)" },
      { type: "improvement", text: "Kunden-Modal KPIs zeigen echte Werte: Finanzierungsstatus (Realistisch / Kritisch …) statt 0 %/100 %, Budget-Fallback aus letztem Dossier, Match-Vorschlaege basierend auf Budgetbereich" },
      { type: "improvement", text: "Refinanzierungs-Resultat: Eigenmittelquote und harte Eigenmittel werden als 'Nicht benoetigt' angezeigt statt 0 %, Tragbarkeit farbig (gruen/amber/rot), beide Hypothekentranchen durchgehend sichtbar" },
      { type: "improvement", text: "Exposé-PDFs: Titelbild verwendet automatisch das als Cover markierte Foto, fehlende Bilder werden durch 'FOTO FOLGT'-Platzhalter ersetzt, Storage-Bilder korrekt in PDFs eingebettet" },
      { type: "improvement", text: "Aufgaben-Karten mit besserem Kontrast, Prio 'Hoch' rot, Faelligkeitsdatum prominenter, Kunden-Badge in Amber/Beige, Uhrzeit optional" },
      { type: "fix", text: "Manager-Rolle konnte keine Objektfotos hochladen — user_roles wird jetzt automatisch mit profiles.role synchronisiert" },
      { type: "fix", text: "Refinanzierungs-Wizard Schritt 4: 'Weiter' war trotz vollstaendig ausgefuellter Felder blockiert (Eigennutzungsanteil-Validierung)" },
      { type: "fix", text: "Kundenname wird bei Speicherung der Selbstauskunft korrekt uebernommen (z. B. 'Neshyt Cuculi' statt 'N Cuculi')" },
      { type: "fix", text: "Dokumente in der Finanzierung oeffnen jetzt eine Inline-Vorschau (Signed URL) statt einer neuen Browser-Tab-Route" },
      { type: "fix", text: "Finanzierungs-Uebersicht zeigt 'Realistisch' fuer Refinanzierungen statt faelschlich 'Nicht finanzierbar'" },
    ],
  },
  {
    version: "1.14.0",
    date: "17.06.2026",
    changes: [
      { type: "feature", text: "Mehrsprachigkeit Franzoesisch: Aufgaben, Dokumente und Mediathek vollstaendig auf Franzoesisch verfuegbar (DE/FR umschaltbar)" },
      { type: "feature", text: "Neukunden-Wizard komplett uebersetzt: alle Schritte (Stammdaten, Kontaktperson, Suchprofil, Investment, Finanzierung, Eigentum, Tags, Review) inkl. Toast-Meldungen, Statuslabels und Footer-Navigation auf Franzoesisch" },
      { type: "feature", text: "Immobilien-Wizard komplett uebersetzt: alle 10 Schritte (Typ, Struktur, Stammdaten, Adresse, Flaechen, Preis, Technik, Medien, Einheiten, Zusammenfassung) inkl. Heizungs-, Energie- und Vermarktungslabels auf Franzoesisch" },
      { type: "improvement", text: "Lokalisierte Zahlenformatierung (CHF, m², %) je nach gewaehlter Sprache" },
    ],
  },
  {
    version: "1.13.0",
    date: "04.06.2026",
    changes: [
      { type: "feature", text: "Smart-Matching: berechnet automatisch Tragbarkeit & Belehnung aus der Selbstauskunft (inkl. Ehepartner / Mitantragsteller) und matcht passende Immobilien — auch wenn Budget oder Stadt im Profil leer sind" },
      { type: "improvement", text: "Matching beruecksichtigt jetzt auch Immobilien mit Status 'aktiv' und 'in Vorbereitung' (vorher nur 'verfuegbar' / 'Entwurf')" },
      { type: "improvement", text: "Finanzierungs-Uebersicht im gleichen Look wie der Kunden-Finanzierungstab: farbcodierte Quick-Check-Kachel (Tragbarkeit, Belehnung, Hypothek, Eigenmittel) plus Begruendungsliste" },
    ],
  },
  {
    version: "1.12.0",
    date: "03.06.2026",
    changes: [
      { type: "feature", text: "Einheitliches In-App-Bestaetigungs-Modal fuer alle Loeschvorgaenge (Kunden, Leads, Termine, Aufgaben, Properties, Medien, Beziehungen, Dokumente, Bankkonten, Agenturen, Bank-Paket-Versionen) — keine Browser-Popups mehr" },
      { type: "feature", text: "Bank-Paket-Historie: einzelne Versionen koennen geloescht werden (inkl. Storage-Bereinigung)" },
      { type: "improvement", text: "Bank-Paket-Historie zeigt Datum & Uhrzeit konsistent in Europe/Zurich" },
    ],
  },
  {
    version: "1.11.0",
    date: "01.06.2026",
    changes: [
      { type: "feature", text: "Bank-Paket Master-Dossier: Quick-Check-Grafiken werden farbgetreu (gruen/gelb/rot) aus der Vorpruefung uebernommen, inkl. vollstaendiger Detailrechnung" },
      { type: "feature", text: "Selbstauskunft im Master-Dossier wird komplett uebernommen — Hauptantragsteller und Mitantragsteller / Ehepartner stehen nebeneinander, alle Felder untereinander" },
      { type: "improvement", text: "Selbstauskunft, Tragbarkeit und Detailrechnung passen jetzt auf 1-2 zusammenhaengende Seiten" },
      { type: "fix", text: "Belehnung & Tragbarkeit werden im PDF korrekt gruen dargestellt (statt faelschlich orange)" },
      { type: "fix", text: "Englische Restbegriffe im Master-Dossier vollstaendig auf Deutsch uebersetzt" },
    ],
  },
  {
    version: "1.10.0",
    date: "28.05.2026",
    changes: [
      { type: "feature", text: "Kunden-Liste gruppiert verknuepfte Partner (z. B. Ehepaare) visuell zusammen: Hauptkunde oben, Partner direkt darunter eingerueckt mit Pfeil-Symbol" },
      { type: "improvement", text: "Kunden-Liste sortiert standardmaessig nach Erstellungsdatum absteigend — neueste Kunden zuoberst" },
      { type: "improvement", text: "Medien-Ordner und Kacheln-Ansicht im Design an Kunden-Kacheln angeglichen (einheitlicher Look)" },
      { type: "fix", text: "Doppelte Ehepartner-Badges entfernt (doppelter Kunden-Datensatz Gjyle Krasniqi bereinigt)" },
      { type: "fix", text: "DB-Constraint hinzugefuegt: Kundenbeziehungen koennen nicht mehr doppelt angelegt werden (richtungsunabhaengig eindeutig)" },
    ],
  },

  {
    version: "1.9.0",
    date: "26.05.2026",
    changes: [
      { type: "feature", text: "Kunden-Status-Workflow mit 7 farbcodierten Stufen: Entwurf (Grau), Pendent (Gelb), Vollstaendig (Blau), Finanzierung (Indigo), Abgeschlossen (Gruen), Abgelehnt (Rot), Storniert (Orange)" },
      { type: "feature", text: "Status-Filter in der Kundenuebersicht" },
      { type: "feature", text: "Status direkt im Kunden-Modal aenderbar (oben rechts neben den Pfeilen, mit farbigem Punkt)" },
      { type: "improvement", text: "Kunden-Typ-Farben (Kaeufer, Verkaeufer, Eigentuemer, Mieter, Vermieter, Investor, Sonstige) klar von Status-Farben getrennt (Cyan, Teal, Indigo, Orange, Pink, Rose, Stone)" },
      { type: "improvement", text: "Kundenuebersicht aufgeraeumt: Spalte 'Finanzierung' und Filter 'Alle Finanzierungen' entfernt" },
      { type: "fix", text: "Doppelter Farb-Punkt im Status-Button des Kunden-Modals behoben" },
    ],
  },
  {
    version: "1.8.0",
    date: "26.05.2026",
    changes: [
      { type: "feature", text: "Dokumentenverwaltung im Kundenprofil: Modal-Vorschau, Herunterladen, Umbenennen, Dokumententyp-Erkennung beim Upload, Anzahl im Tab-Badge" },
      { type: "feature", text: "Immobilien-Zuweisung mit Rollen: Kunden koennen Immobilien als Eigentuemer, Kaufinteressent, Mieter, Investor etc. zugewiesen werden — mit Doppelbelegungs-Warnung" },
      { type: "feature", text: "Bidirektionale Kundenbeziehungen: Verknuepfungen (z. B. Ehepartner) sind jetzt von beiden Seiten sichtbar und lassen sich zentral verwalten" },
      { type: "improvement", text: "Smart-Uebersicht im Kunden-Modal erweitert: zeigt jetzt auch zugewiesene Immobilien (nicht nur Eigentum) und Beziehungen" },
      { type: "improvement", text: "Immobilien-Tab im Kundenprofil zeigt eigene und zugewiesene Objekte getrennt mit Rollen-Label" },
      { type: "fix", text: "Mediathek: Hover-Buttons ueber Bildern wieder korrekt sichtbar" },
      { type: "fix", text: "Dokumente nach Umbenennung konnten nicht mehr angezeigt werden — Storage-Pfad-Logik korrigiert" },
    ],
  },
  {
    version: "1.7.0",
    date: "25.05.2026",
    changes: [
      { type: "feature", text: "Immobilien-Karten-Ansicht (Mapbox): alle Immobilien auf der Schweizer Karte, Klick zoomt zum Detail" },
      { type: "feature", text: "Neuer Kunden-Wizard Schritt 2: manuelle Eingabe oder Selbstauskunft hochladen (KI fuellt restliche Schritte automatisch)" },
      { type: "improvement", text: "Kundenuebersicht aufgeraeumt: Eigentum unter Immobilien, Suchprofile unter Matching, Rollen unter Aktivitaeten — Profil-Details-Accordion entfernt" },
      { type: "improvement", text: "Sicherheits-Haertung: 18+ Tabellen mit striktem RLS (Besitzer/Admin), Storage-Bucket feedback privat, Funktionsrechte fuer anon/PUBLIC entzogen" },
      { type: "improvement", text: "Neue Sicherheits-Helper: can_access_property() und vereinheitlichte is_owner_or_admin() auf Basis von user_roles" },
      { type: "improvement", text: "README & CHANGELOG im Repository ergaenzt" },
      { type: "fix", text: "Muster-Kunde Button aus der Kundenliste entfernt" },
    ],
  },
  {
    version: "1.6.0",
    date: "25.05.2026",
    changes: [
      { type: "feature", text: "Globale Suche in der Topbar: vergroesserteres Overlay mit Hintergrund-Blur, durchsucht Kunden, Leads, Immobilien, Finanzierungen, Termine, Aufgaben, Dokumente & Mitarbeiter (⌘K)" },
      { type: "feature", text: "Immobilien-Tab im Kunden-Modal mit Leerstands-Hinweis und Immobilie hinzufuegen-Button" },
      { type: "improvement", text: "Konsolidierung: nur noch ein einziger Matching-Tab im Kunden-Modal (Button oben & Duplikat in Immobilien-Tab entfernt)" },
      { type: "improvement", text: "Drag-&-Drop-Upload als alleiniger Weg im Dokumente-Tab – manueller Dokument hinzufuegen-Dialog entfernt" },
      { type: "improvement", text: "Animiertes Drag-&-Drop-Feedback (Skalierung, Puls, Bounce-Icon) beim Datei-Upload" },
      { type: "improvement", text: "Kunden-Liste: separate Spalten fuer Telefon, E-Mail und PLZ/Ort statt vermischter Kontakt-Spalte" },
      { type: "improvement", text: "Farbige Badges fuer Kunden-Typen (Kaeufer, Verkaeufer, Sonstige …)" },
      { type: "improvement", text: "Kontakt-Tab zeigt jetzt die Angaben aus der Selbstauskunft" },
      { type: "feature", text: "Ansprechpartner im Kunden-Modal sichtbar; Ersteller wird automatisch als Betreuer zugewiesen und in der Aktivitaet protokolliert" },
    ],
  },
  {
    version: "1.5.0",
    date: "12.05.2026",
    changes: [
      { type: "feature", text: "Dokumentations-Bereich mit Changelog, Roadmap, Anleitung & Support" },
      { type: "improvement", text: "Vollstaendige historische Uebersicht aller Releases ergaenzt" },
    ],
  },
  {
    version: "1.4.0",
    date: "12.05.2026",
    changes: [
      { type: "feature", text: "Drag-and-Drop Upload fuer Kunden-Dokumente" },
      { type: "feature", text: "Datei-Upload zusatzlich zu Link-Hinterlegung im Kunden-Tab" },
      { type: "improvement", text: "Nach Anlage eines Kunden direkt zum Kundenprofil statt Matching-Seite" },
      { type: "fix", text: "PDF-Generierung: Browser-Druck-Fallback bei Service-Ausfall (404)" },
    ],
  },
  {
    version: "1.3.0",
    date: "11.05.2026",
    changes: [
      { type: "feature", text: "Admin kann Mitarbeiter direkt anlegen und Passwort vergeben (ohne E-Mail-Einladung)" },
      { type: "improvement", text: "E-Mail-Bestaetigung fuer admin-erstellte Benutzer entfaellt" },
      { type: "fix", text: "Berechtigungen fuer is_superadmin / has_role korrigiert (Kunden-Zuweisung)" },
    ],
  },
  {
    version: "1.2.0",
    date: "05.05.2026",
    changes: [
      { type: "feature", text: "UBS-Checkliste & Bank-Submission-Tab in der Finanzierung" },
      { type: "feature", text: "Dossier-Qualitaets-Score fuer Finanzierungsanfragen" },
      { type: "improvement", text: "Generierte Dokumente pro Kunde & Immobilie auflistbar" },
      { type: "improvement", text: "Verbessertes Matching mit Benchmark-Karten" },
    ],
  },
  {
    version: "1.1.0",
    date: "20.04.2026",
    changes: [
      { type: "feature", text: "Finanzierungs-Quick-Check mit PDF-Export" },
      { type: "feature", text: "Selbstauskunft per Token-Link an Kunden senden" },
      { type: "feature", text: "Parsen hochgeladener Selbstauskunfts-PDFs via KI" },
      { type: "feature", text: "Matching zwischen Suchprofilen und Immobilien" },
    ],
  },
  {
    version: "1.0.0",
    date: "01.04.2026",
    changes: [
      { type: "feature", text: "Kunden-, Lead-, Immobilien- & Mandatsverwaltung" },
      { type: "feature", text: "Mandate, Reservationen, NDAs, Exposees" },
      { type: "feature", text: "Termine, Aufgaben, Checklisten & Aktivitaeten-Tracking" },
      { type: "feature", text: "Dokumentvorlagen mit Rich-Text-Editor & Generator" },
      { type: "feature", text: "Mehrere Bankkonten & Brandkit pro Firma" },
      { type: "feature", text: "Marktanalyse fuer Immobilien (KI-gestuetzt)" },
      { type: "feature", text: "Mehrbenutzer-Support mit Rollen & Rechten" },
      { type: "feature", text: "Lead-Import aus externen Quellen" },
      { type: "feature", text: "Property-Import & Owners-Tab" },
      { type: "feature", text: "Analytics-Dashboard mit Kennzahlen" },
      { type: "feature", text: "Activity-Tracking: Vollstaendiger Aktivitaetslog fuer Audit-Trail" },
    ],
  },
];

const ROADMAP = [
  { title: "Digitale Signatur direkt im Dossier", status: "in Arbeit" },
  { title: "Microsoft-365-Kalender: vollständiger Praxistest", status: "in Prüfung" },
  { title: "Google-Kalender-Synchronisation", status: "geplant" },
  { title: "Bank-API-Anbindung fuer direkten Dossier-Versand", status: "in Arbeit" },
  { title: "Mehrsprachigkeit (FR / IT / EN)", status: "geplant" },
  { title: "KI-Assistent fuer E-Mail-Entwuerfe", status: "geplant" },
  { title: "Automatische WhatsApp-Benachrichtigungen an Kunden", status: "geplant" },
  { title: "Mobile-App (iOS / Android)", status: "Konzept" },
  { title: "Marktplatz-Integrationen (Homegate, ImmoScout24)", status: "Konzept" },
];


const FAQS = [
  {
    q: "Wie lade ich einen neuen Mitarbeiter ein?",
    a: "Öffne Mitarbeitende und erstelle eine Einladung mit E-Mail-Adresse und Rolle. Der einmalig angezeigte Link wird der eingeladenen Person sicher zugestellt; offene Registrierungen und temporäre Passwörter sind deaktiviert.",
  },
  {
    q: "Warum kann sich ein Makler nicht einloggen?",
    a: "Meist falsches Passwort (Tippfehler, unsichtbare Leerzeichen beim Kopieren). Passwort im Mitarbeiter-Dialog im Tab 'Passwort' neu setzen.",
  },
  {
    q: "Wie lade ich ein Dokument zu einem Kunden hoch?",
    a: "Kundenprofil → Tab 'Dokumente' → Datei in die Dropzone ziehen. Der Typ wird automatisch erkannt (z. B. Selbstauskunft, Vertrag, Pass).",
  },
  {
    q: "Wie verknuepfe ich zwei Kunden (z. B. Ehepaar)?",
    a: "Kundenprofil → Tab 'Beziehungen' → 'Beziehung hinzufuegen'. Die Verknuepfung ist automatisch bidirektional — beide Kontakte sehen einander.",
  },
  {
    q: "Wie weise ich einem Kunden eine Immobilie zu?",
    a: "Kundenprofil → Tab 'Immobilien' → 'Immobilie zuweisen'. Waehle die Immobilie und die Rolle (Eigentuemer, Kaufinteressent, Mieter etc.). Bereits als Eigentuemer zugewiesene Objekte werden blockiert.",
  },
  {
    q: "PDF-Generierung funktioniert nicht (404)",
    a: "Der externe PDF-Service ist nicht erreichbar. Administrator muss die URL in den Cloud-Secrets pruefen.",
  },
  {
    q: "Wie wechsle ich zwischen mehreren Unternehmen?",
    a: "Verwende den Firmenwechsel in der Navigation. Immolia bestätigt die neue Firma, leert alte Ansichten und lädt den Arbeitsbereich vollständig neu. Bei einer fehlgeschlagenen Prüfung bleiben Firmendaten verborgen.",
  },
  {
    q: "Wo sehe ich mein Abonnement und meine Credits?",
    a: "Unter Einstellungen → Abo & Credits findest du Plan, Zahlungsweg, Kontingente, Credit-Guthaben und Verbrauchshistorie. Firmeninhaber und Administratoren können dort verfügbare Pläne oder Credit-Pakete wählen.",
  },
  {
    q: "Wie verbinde ich meinen Microsoft-365-Kalender?",
    a: "Öffne den Kalender und wähle «Microsoft Sync» oder gehe zu Einstellungen → Microsoft-365-Kalender. Die Verbindung gilt nur für dich in der aktuell gewählten Firma. Der vollständige Praxistest der Synchronisation ist noch ausstehend.",
  },
];

const typeMeta: Record<ChangeType, { label: string; className: string }> = {
  feature:     { label: "Neu",         className: "bg-primary/10 text-primary border-primary/20" },
  improvement: { label: "Verbessert",  className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  fix:         { label: "Behoben",     className: "bg-amber-500/10 text-amber-700 border-amber-500/20" },
};

function DocsPage() {
  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">Dokumentation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Changelog, Roadmap, FAQ und Hilfe rund um Immolia.
        </p>
      </div>

      <Tabs defaultValue="changelog" className="space-y-4">
        <TabsList>
          <TabsTrigger value="changelog"><Sparkles className="mr-1.5 h-4 w-4" />Changelog</TabsTrigger>
          <TabsTrigger value="roadmap"><Rocket className="mr-1.5 h-4 w-4" />Roadmap</TabsTrigger>
          <TabsTrigger value="guide"><BookOpen className="mr-1.5 h-4 w-4" />Anleitung</TabsTrigger>
          <TabsTrigger value="support"><LifeBuoy className="mr-1.5 h-4 w-4" />Support</TabsTrigger>
        </TabsList>

        <TabsContent value="changelog" className="space-y-4">
          {CHANGELOG.map((entry) => (
            <Card key={entry.version}>
              <CardContent className="p-6">
                <div className="mb-4 flex items-baseline justify-between">
                  <div className="flex items-baseline gap-3">
                    <h2 className="font-display text-xl font-semibold">v{entry.version}</h2>
                    <Badge variant="secondary" className="text-xs">{entry.date}</Badge>
                  </div>
                </div>
                <ul className="space-y-2">
                  {entry.changes.map((c, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Badge variant="outline" className={`shrink-0 text-[10px] ${typeMeta[c.type].className}`}>
                        {typeMeta[c.type].label}
                      </Badge>
                      <span className="text-sm">{c.text}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="roadmap">
          <Card>
            <CardContent className="p-6">
              <h2 className="mb-4 font-display text-lg font-semibold">Geplante Funktionen</h2>
              <ul className="space-y-3">
                {ROADMAP.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                    <div className="flex items-center gap-3">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">{r.title}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">{r.status}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="guide">
          <Card>
            <CardContent className="space-y-6 p-6 text-sm">
              <section>
                <h3 className="mb-2 font-display text-base font-semibold">Erste Schritte</h3>
                <ol className="ml-5 list-decimal space-y-1 text-muted-foreground">
                  <li>Firmenprofil und White Label unter <strong>Einstellungen</strong> hinterlegen.</li>
                  <li>Mitarbeitende über <strong>Mitarbeitende → Einladen</strong> aufnehmen und Rollen vergeben.</li>
                  <li>Bankkonten und Dokumentvorlagen konfigurieren.</li>
                  <li>Erste Leads / Kunden erfassen und Suchprofile pflegen.</li>
                </ol>
              </section>
              <section>
                <h3 className="mb-2 font-display text-base font-semibold">Unternehmen wechseln</h3>
                <p className="text-muted-foreground">
                  Wenn du Mitglied mehrerer Unternehmen bist, wechselst du über die Firmenauswahl in der Navigation.
                  Immolia lädt danach den Arbeitsbereich der gewählten Firma vollständig neu. Daten, Branding und
                  Live-Meldungen bleiben strikt voneinander getrennt.
                </p>
              </section>
              <section>
                <h3 className="mb-2 font-display text-base font-semibold">Kunden & Matching</h3>
                <p className="text-muted-foreground">
                  Lege Kunden mit Rolle (Kaeufer, Verkaeufer, Mieter, Vermieter, Finanzierungskunde)
                  an. Kaeufer erhalten ein Suchprofil — Matching findet passende Immobilien automatisch.
                  Verknuepfe Kunden ueber den Tab <strong>Beziehungen</strong> (z. B. Ehepaar, Familie).
                </p>
              </section>
              <section>
                <h3 className="mb-2 font-display text-base font-semibold">Immobilien-Zuweisung</h3>
                <p className="text-muted-foreground">
                  Im Kundenprofil unter <strong>Immobilien → Immobilie zuweisen</strong> kannst du
                  Objekte mit einer Rolle verknuepfen: Eigentuemer, Kaufinteressent, Mieter, Investor
                  etc. Doppelbelegungen als Eigentuemer werden automatisch verhindert.
                </p>
              </section>
              <section>
                <h3 className="mb-2 font-display text-base font-semibold">Dokumente</h3>
                <p className="text-muted-foreground">
                  Im Kunden-Tab <strong>Dokumente</strong> per Drag-and-Drop hochladen. Immolia erkennt
                  den Dokumententyp automatisch. Dateien lassen sich umbenennen, in einer Vorschau
                  ansehen und herunterladen.
                </p>
              </section>
              <section>
                <h3 className="mb-2 font-display text-base font-semibold">Finanzierung</h3>
                <p className="text-muted-foreground">
                  Quick-Check direkt im Kundenprofil starten, Selbstauskunft per Link einholen,
                  PDF-Dossier fuer Banken generieren.
                </p>
              </section>
              <section>
                <h3 className="mb-2 font-display text-base font-semibold">Abo & Credits</h3>
                <p className="text-muted-foreground">
                  Unter <strong>Einstellungen → Abo & Credits</strong> siehst du deinen Plan, den Zahlungsweg,
                  enthaltene Kontingente, das verfügbare Credit-Guthaben und alle Buchungen. Vor einer gezählten
                  Zusatzleistung zeigt Immolia die voraussichtlichen Credit-Kosten an.
                </p>
              </section>
              <section>
                <h3 className="mb-2 font-display text-base font-semibold">Microsoft-365-Kalender</h3>
                <p className="text-muted-foreground">
                  Verbinde deinen persönlichen Microsoft-Kalender direkt im Kalender oder unter
                  <strong> Einstellungen → Microsoft-365-Kalender</strong>. Die Verbindung gilt ausschliesslich
                  für dein Benutzerkonto in der aktiven Firma. Der vollständige Praxistest des beidseitigen
                  Terminabgleichs ist noch ausstehend.
                </p>
              </section>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="support">
          <Card>
            <CardContent className="space-y-5 p-6">
              <div>
                <h3 className="mb-3 font-display text-base font-semibold">Haeufige Fragen</h3>
                <div className="space-y-3">
                  {FAQS.map((f, i) => (
                    <div key={i} className="rounded-xl border p-3">
                      <p className="text-sm font-medium">{f.q}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{f.a}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-xl border bg-muted/30 p-4 text-sm">
                <p className="font-medium">Weitere Hilfe noetig?</p>
                <p className="mt-1 text-muted-foreground">
                  Ueber <strong>Administration → Feedback</strong> kannst du Wuensche, Bugs und Fragen direkt einreichen.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
