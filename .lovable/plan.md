# Immobilienkarte nach Kanton und Potenzial

## Ziel
Die Kartenansicht wird zu einer interaktiven Arbeitsansicht: Objekte erscheinen beim Darüberfahren, Kantone sind farblich unterscheidbar und filterbar, und eine vorhandene oder bewusst ausgelöste KI-Analyse zeigt Verkaufs- und Vermietungspotenzial.

## Umsetzung
1. **Objektvorschau beim Darüberfahren**
   - Beim Mauszeiger über einen Marker erscheint eine kompakte Objektkarte mit Bild, Titel, Adresse, Preis/Miete, Zimmern, Fläche und Status.
   - Ein Klick hält die Karte offen und führt über «Objekt öffnen» zur Detailansicht; auf Touch-Geräten bleibt der Klick die Bedienung.
   - Die Vorschau wird so positioniert, dass sie am Kartenrand nicht abgeschnitten wird.

2. **Kanton automatisch erkennen und farblich darstellen**
   - Die bestehende Adressauflösung liefert zusätzlich den Kanton zurück; vorhandene Objekt- oder Lageangaben werden bevorzugt.
   - Jeder vorkommende Kanton erhält eine klar unterscheidbare, feste Farbe. Die gleiche Farbe gilt für Marker, Kantonsname und Legende.
   - Unbekannte Regionen erhalten einen neutralen Marker, statt falsch zugeordnet zu werden.

3. **Filter direkt in der Karte**
   - Kompakte Filter für Kanton, Kauf/Miete und Status werden über der Karte angeboten.
   - Eine anklickbare Kantonslegende kann einzelne Kantone ein- und ausblenden und zeigt die jeweilige Objektanzahl.
   - «Zurücksetzen» stellt alle Objekte wieder her; die Karte zoomt automatisch auf die sichtbaren Marker.

4. **KI-Potenzial bei Bedarf**
   - Die Hover-Karte zeigt die neuste bereits gespeicherte Marktanalyse: Verkaufspotenzial mit Marktvergleich/Preisspanne sowie Vermietungspotenzial mit Mietspanne und Bruttorendite.
   - Fehlt eine Analyse, erscheint «KI-Potenzial analysieren». Erst dieser Klick startet die Analyse und verursacht Nutzungskosten.
   - Während der Analyse gibt es einen klaren Ladezustand; danach aktualisiert sich die Karte sofort. Fehler oder fehlendes Guthaben werden verständlich angezeigt.
   - Ergebnisse bleiben als Analysehistorie beim Objekt gespeichert und werden nicht bei jedem Öffnen neu berechnet.

5. **Stabilität und Prüfung**
   - Die bestehende Tenant-Trennung und die Berechtigungen der Marktanalyse bleiben unverändert.
   - Kartenansicht auf Desktop und Mobilgerät prüfen: Hover/Klick, Filter, Farben, Randpositionen, Lade- und Fehlerzustände.
   - Keine Produktionsdaten verändern und nichts veröffentlichen.

## Technische Details
- Erweiterung der bestehenden Kartenkomponente und Adressauflösung; keine neue Regionstabelle nötig.
- Neueste Einträge aus der bestehenden Marktanalyse-Historie werden gesammelt für die sichtbaren Objekte geladen.
- Die KI-Auslösung wird über eine geschützte Server-Funktion angebunden; das Ergebnis wird in der bestehenden Analyse-Historie gespeichert.
- Kantonsfarben werden als zentrale semantische Kartenpalette definiert, nicht pro Marker improvisiert.
