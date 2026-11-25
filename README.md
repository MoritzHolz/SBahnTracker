# S-Bahn Stuttgart Live

Live-Karte der S-Bahn Stuttgart: Fahrten mit Echtzeit-Zeiten, Gleisen und Haltfolge, Züge als animierte 2D-Modellzüge entlang der echten Strecke. Dazu kommt ein Datenmodell für Fahrzeughistorie, Wagenreihungsvergleich, Zugtrennungs- und Abstellort-Erkennung.

> **Datenlage in einem Satz:** Fahrten, Zeiten, Verspätungen, Gleise und Zugnummern sind echt (NVBW EFA). **Positionen sind immer geschätzt.** **Fahrzeugnummern** liefert der zuschaltbare [Live-Webscanner](docs/scanner.md), soweit die Webseite sie anzeigt.

## Inhalt
- [Architektur](#architektur)
- [Datenquellen](#datenquellen)
- [Setup](#setup) · [Umgebungsvariablen](#umgebungsvariablen) · [Deployment](#deployment)
- [Datenbankmodell](#datenbankmodell) · [API](#api-rpc) · [Cron-Jobs](#cron-jobs)
- [Tracking-Logik](#tracking-logik) · [Zugtrennungserkennung](#zugtrennungserkennung) · [Abstellort-Erkennung](#abstellort-erkennung)
- [Kosten](#kosten) · [Limitierungen](#limitierungen) · [Agent-Aufgaben](#agent-aufgaben-und-verantwortlichkeiten)

## Architektur

```
NVBW EFA (efa-bw.de/nvbw)                       Browser (Next.js, MapLibre)
   │  XML_DM_REQUEST (Abfahrten + Haltfolge)        ▲  RPC get_live_trips / get_route_shapes /
   │  XML_STOPSEQCOORD_REQUEST (Gleisgeometrie)     │      get_source_status / search_vehicle (nur angemeldet)
   ▼                                                │
Supabase Edge Function `collect` ──RPC (service_role)──► Postgres (RLS: nur private.members)
   ▲                                                     ├─ trips, trip_stops, route_shapes, stations, lines
   └── pg_cron alle 3 min → pg_net → POST (Shared Secret)├─ vehicles, formations, vehicle_sightings
                                                         ├─ split_events, parking_estimates (Trigger/Cron)
                                                         └─ collector_runs (Monitoring)
```

| Schicht | Ort | Verantwortung |
|---|---|---|
| Datenbeschaffung | `supabase/functions/collect` | EFA abfragen, normalisieren, Shapes nachladen |
| Datenhaltung | `supabase/migrations` | Schema, RLS, Ingest-RPCs, Analytik |
| Fahrzeugtracking/Analytik | `private.on_formation_insert`, `private.update_parking_estimates` | Sichtungen, Trennungen, Abstellorte |
| Positionsberechnung | `src/lib/position.ts`, `src/lib/geo.ts` | Zeit → Position auf der Strecke (rein clientseitig) |
| Karte/Animation | `src/components/map` | MapLibre-Layer, rAF-Loop, Modellzüge |
| UI | `src/components/panels`, `src/app` | Seitenleiste, Detailpanel, Timeline, Fahrzeugsuche |

Details zum Frontend: [`docs/frontend.md`](docs/frontend.md).

## Datenquellen

| Quelle | Status | Genutzt für |
|---|---|---|
| **NVBW EFA** `https://www.efa-bw.de/nvbw/` (MobiData BW) | offiziell, offen, getestet | Abfahrten am Hbf (tief) und in Feuerbach (S62), Soll-/Ist-Zeiten je Halt, Gleise (aktuell und geplant), Zugnummer, Ausfälle, Gleisgeometrie (`STOPSEQCOORD`) |
| Linienfarben | [Traewelling line-colors](https://github.com/Traewelling/line-colors) (`vvs-db-sbs`) | Tabelle `lines` |
| OpenFreeMap `styles/dark` | kostenlos, ohne Key, getestet | Basiskarte |
| DB Timetables / RIS (API Marketplace) | offiziell, **Konto nötig** | nicht angebunden |
| DB RIS::Formations (Wagenreihung) | offiziell, **Konto nötig**, ob S-Bahn-Fahrzeugnummern geliefert werden ist unbelegt | **vorbereitet, nicht angebunden** |
| bahn.de-Web-API (von bahn.expert genutzt) | inoffiziell, durch Akamai-Bot-Schutz abgesichert | **bewusst nicht genutzt**: Ein Zugriff erfordert das Umgehen des Bot-Schutzes |
| GTFS (VVS/NVBW), gtfs.de-RT | offen | geprüft, aktuell nicht nötig (EFA liefert alles Benötigte) |
| GPS-Positionen | nicht öffentlich verfügbar | – |

Erfasst wird alle 3 min: Ein Abfahrtsmonitor am Hbf (tief) mit Zeitfenster −80 min … ca. +2,5 h, max. 200 Ereignisse. Alle Linien S1–S6/S60 passieren den Hbf (tief), so dass jede laufende Fahrt mit ihrer **kompletten** Haltfolge im Fenster liegt. Die S62 kommt über einen zweiten Monitor in Feuerbach. Pro Lauf werden höchstens 6 neue Streckengeometrien nachgeladen. Insgesamt sind das etwa 2–8 Anfragen alle 3 min.

Zusätzlich gibt es den **Live-Webscanner** (Playwright, Ein/Aus-Schalter unter `/scanner`): [docs/scanner.md](docs/scanner.md).

## Setup

```bash
npm install
cp .env.example .env.local   # Werte siehe unten
npm run dev                  # http://localhost:3000
npm test                     # vitest
npm run lint && npm run build
```
`predev`/`prebuild` kopieren den MapLibre-Worker nach `public/maplibre/`.

Backend neu aufsetzen (nur bei einem neuen Supabase-Projekt):
1. Migrationen in `supabase/migrations` der Reihe nach ausführen. In `trigger_collector()` die Projekt-URL anpassen.
2. Edge Function `collect` deployen, mit `verify_jwt = false`, weil sie das Shared Secret aus `private.app_config` selbst prüft.
3. Optional `20261123150300_retention_PENDING.sql` ausführen (Datenbereinigung).

## Umgebungsvariablen

| Variable | Wo | Wert |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel / `.env.local` | `https://ytggyjckyslohbdkievd.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel / `.env.local` | Publishable Key (`sb_publishable_…`, öffentlich, nur Lesezugriff durch RLS) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Edge Function | von Supabase automatisch gesetzt |

Das Collector-Secret liegt in `private.app_config` (nicht über die API lesbar) und wird nicht als Env-Variable benötigt.

## Deployment

**Vercel:** Das GitHub-Repo importieren, Framework „Next.js“, Build-Befehl `npm run build` (Standard) und die beiden `NEXT_PUBLIC_*`-Variablen setzen. Jeder Push auf `main` deployt automatisch.
**Supabase:** Das Projekt `sbahn-stuttgart-tracking` (eu-central-1) ist eingerichtet. Edge Function und Cron laufen bereits.

## Datenbankmodell

| Tabelle | Inhalt |
|---|---|
| `lines` | S1…S62, Farbe |
| `stations` | Haltestellen (DHID, Koordinaten) |
| `route_shapes` | Gleisgeometrie je Linienverlauf (`signature = transport_id|erster|letzter Halt`) |
| `trips` | Fahrt (`id = Datum|transport_id|tripCode`), Zugnummer, Start/Ziel, Zeitspanne, `stop_count` |
| `trip_stops` | Haltfolge mit Soll-/Ist-Ankunft/-Abfahrt, Gleis (aktuell und geplant), Ausfall |
| `vehicle_types` | 423, 430 |
| `vehicles` | Fahrzeugprofil, letzter Ort, Status |
| `formations` | erfasste Wagenreihung (Fahrzeugliste) je Fahrt/Station/Zeit |
| `vehicle_sightings` | Fahrtenbuch (aus `formations` per Trigger) |
| `split_events` | mögliche Trennung/Vereinigung/Umstellung mit Konfidenz |
| `stabling_sites` | Lage der Abstellgleise je Endstation (OpenStreetMap) |
| `stabling_rules` | Mindeststandzeit und Frist bis zum Verschieben je Bahnhof (`*` = alle) |
| `stabling_events` | Abstellprotokoll je Fahrzeug, eindeutig über (Fahrzeug, Betriebstag, Linie, Zugnummer) |
| `parking_estimates` | vermuteter Abstellort/Status mit Konfidenz und Begründung |
| `collector_runs` | Protokoll jedes Sammellaufs |

**Login:** Lesen dürfen nur angemeldete Konten aus `private.members` (RLS und Prüfung in den RPCs, Migrationen `members` und `members_only`). `anon` sieht nichts. Konten legt man im Supabase-Dashboard an (Authentication → Users) und schaltet sie mit einem Eintrag in `private.members` frei. Registrierung dort abschalten; auch ohne das sieht ein fremdes Konto nichts.

Geschrieben wird über `security definer`-Funktionen mit `service_role`, über Trigger, vom Webscanner (eigenes Secret) und über `report_formation` (PIN, nach 10 Fehlversuchen pro Stunde gesperrt).

## API (RPC)

| Funktion | Rückgabe |
|---|---|
| `get_live_trips(p_now?)` | aktive Fahrten (±10 min) inkl. Halte und letzter Wagenreihung |
| `get_route_shapes()` | alle Geometrien `[[lon,lat],…]` |
| `get_source_status()` | letzter Sammellauf, letzter Erfolg, Status Wagenreihungsquelle |
| `get_stabling_log(p_from, p_to, p_weekdays_only)` | Abstellprotokoll, je Zug zusammengefasst, mit Abfahrt und Zustand |
| `search_vehicle(p_query)` | Fahrzeugprofil, Sichtungen, Trennungen, Abstellort |
| `get_parked_vehicles()` | geschätzt abgestellte Fahrzeuge mit Ort, Ankunftszug und Sicherheit |
| `scanner_schedule(p_enabled, p_windows, p_keep_awake)` | Zeitplan des Webscanners speichern, nur angemeldet |
| `report_formation(p_pin, p_trip_id, p_vehicles, p_station_id?)` | eigene Fahrzeugmeldung (Detailpanel „Fahrzeug melden“), Fehler als `{error}`; der PIN-Hash liegt in `private.app_config` (`report_pin_hash`) |

## Cron-Jobs

| Job | Takt | Aufgabe |
|---|---|---|
| `collect-efa` | `*/3 * * * *` | Edge Function `collect` auslösen |
| `parking-estimates` | `*/5 * * * *` | Abstellort-/Statusschätzung neu berechnen |
| `cleanup` (ausstehend) | täglich 03:17 | Fahrten > 30 Tage, Logs > 7 Tage löschen |

## Tracking-Logik

1. Je Halt gilt als effektive Zeit die Ist-Zeit, sonst die Soll-Zeit. Fehlt die Ankunft, wird die Abfahrt genommen und umgekehrt.
2. Status ergibt sich aus der aktuellen Uhrzeit: vor Abfahrt, am Halt, zwischen zwei Halten, angekommen.
3. Die Halte werden auf die Geometrie projiziert (Kilometrierung, monoton erzwungen). Zwischen zwei Halten wird mit Ease-in-out interpoliert.
4. Ohne Geometrie fährt der Zug eine Gerade zwischen den Halten. Die UI kennzeichnet das als „Streckenverlauf ungenau“.
5. Jede Position trägt das Label **geschätzt**: „(Echtzeit-Zeiten)“, wenn Ist-Zeiten vorliegen, sonst „(Fahrplan)“.

## Zugtrennungserkennung

Läuft als Trigger `private.on_formation_insert`, sobald eine Wagenreihung in `formations` eingetragen wird:
- Er vergleicht mit der letzten nicht-leeren Erfassung **derselben Fahrt**. Leere Meldungen gelten als Datenlücke und lösen keine Schlüsse aus.
- `possible_split` bedeutet, dass Fahrzeuge fehlen. `possible_join` bedeutet, dass neue hinzukommen. Gibt es beides, ist es `composition_change`; nur geänderte Reihenfolge ist `order_change`.
- Konfidenz von 0,1 bis 0,9:
  - Basis 0,5.
  - Erfassung an einer anderen Station +0,15, an derselben −0,15.
  - Ganze 4-Wagen-Einheiten +0,15.
  - Gemischter Austausch −0,2.
- Die UI zeigt alle Ereignisse ausdrücklich als **Vermutung**.

Mit synthetischen Daten getestet: 8 → 4 Fahrzeuge an einer anderen Station ergibt `possible_split` mit Konfidenz 0,8; eine leere Meldung erzeugt kein Ereignis.

## Abstellort-Erkennung

`private.update_parking_estimates()` läuft alle 5 min und prüft je Fahrzeug die letzte gelesene Fahrt. Kommt es nach der Ankunft in keiner gelesenen Abfahrt mehr vor, gilt es als abgestellt. In den gesammelten Daten starten Rückfahrten meist 3 bis 27 min nach der Ankunft am selben Bahnhof, deshalb die Wartezeit von 45 min (längster beobachteter Wert: 40 min).

| Lage | Status | Anzeige |
|---|---|---|
| Fahrt läuft noch | `in_service` | im Einsatz |
| Ankunft vor weniger als 45 min | `turning` | wendet |
| Keine Rückfahrt, Sicherheit ≥ 0,75 | `parked_assumed` | „wahrscheinlich hier“ |
| Keine Rückfahrt, Sicherheit 0,5 bis 0,75 | `parked_assumed` | „vermutlich hier“ |
| Sicherheit < 0,5, aber mindestens 85 % der letzten Fahrten gelesen | `absent` | „nicht im Einsatz, Ort unsicher“ |
| Länger als 48 h an einer Endstation (Schwabstraße 60 min), Fehlen belegt | `moved_depot` | Plochingen, „verschoben (Annahme)“ |
| Zu wenig gelesen, oder seit 4 Tagen nicht gesehen | `unknown` | nicht angezeigt |

Sicherheit = 0,9 · s1 · (0,35 + 0,65 · s2):
- s1: Anteil der gelesenen Abfahrten am Ankunftsbahnhof in den ersten 45 min (0,85, wenn dort keine fuhr).
- s2: Anteil der gelesenen Abfahrten danach (1, wenn es keine gab).
- Halbiert, wenn der Fahrplanabruf länger als 15 min ausfällt.

Grenzen: Die Schätzung ist nur so gut wie die Scans. Leerfahrten und nicht gelesene Züge sind unsichtbar. Die Lage der Abstellgleise stammt aus OpenStreetMap (`stabling_sites`); ob genau diese Gleise genutzt werden, ist nicht bestätigt. Wo keine bekannt sind (z. B. Filderstadt, Flughafen), steht das Zeichen am Bahnhof.

Karte: violettes „A“ mit Anzahl („3?“ = nur unsichere Fahrzeuge), Antippen öffnet die Fahrzeugliste. Seitenleiste: „Abgestellt (geschätzt)“.

### Regeln (`stabling_rules`)

| Bahnhof | Standzeit ab | Verschieben nach |
|---|---|---|
| alle übrigen | 45 min | 48 h |
| Schwabstraße (Wendeschleife) | 15 min | 60 min |
| Plochingen | 45 min | nie |

Schwabstraße: Züge kommen auf Gleis 1 an und fahren nach der Schleife von Gleis 2 ab. Gezählt werden deshalb nur Abfahrten vom Gegengleis, und alle in den ersten 15 min müssen gelesen sein. Spätabends dauert die planmäßige Wende 24 min und zählt nach der 15-min-Regel als Standzeit.

Verschieben ändert nur den geschätzten Ort (`moved_at`, `moved_from_name`), es entsteht keine Fahrt. Wird das Fahrzeug wieder gelesen, gilt die neue Fahrt.

### Abstellprotokoll (`stabling_events`, Seite `/abstellungen`)

- Beginn: Standzeit erreicht und Sicherheit ≥ 0,5. Wurde das Fahrzeug danach an einem anderen Bahnhof gelesen, ≥ 0,75.
- Ende: nächste gelesene Fahrt ab demselben Bahnhof (`departed_at`). Sonst bleibt die Abfahrt leer, nur `seen_again_at` ist gesetzt.
- Ein Eintrag bleibt bei Datenlücken bestehen. Er wird nur verworfen (`discarded_at`), wenn später gelesene Daten ihn widerlegen.
- Wiederholte Läufe aktualisieren denselben Eintrag (eindeutiger Schlüssel).
- Per Regel verschobene Fahrzeuge (`moved_at`) fehlen in der Ausgabe, nur ihre Anzahl wird gezeigt.
- Waggons: gelesene Wagennummern je Einheit, sonst 4.
- Neuer Eintrag nur, wenn in den ersten 2 h der Standzeit mindestens die Hälfte aller Fahrten gelesen wurde. `departed_at` nur bei Sicherheit ≥ 0,5 am Ende, sonst nur `seen_again_at`.
- Schwabstraße: laut Plan kürzere Wenden als 15 min (also nur verspätete) zählen nie als Abstellung.
- Aufzeichnung ab `private.app_config.stabling_log_from`. Die Zeit vor dem 25.11.2026, 14:35 Uhr wurde einmalig aus den vorhandenen Scans nachgerechnet (`20261125180000_stabling_log_accuracy.sql`).
- Die Seite zeigt eine Woche (Mo–So) und blättert bis `FIRST_WEEK` zurück.

## Kosten

0 €/Monat: Supabase Free (Edge Functions, pg_cron und pg_net enthalten), Vercel Hobby, OpenFreeMap und NVBW EFA sind kostenlos.
- **Datenbank:** etwa 1.000 Fahrten und 20.000 Haltzeilen pro Tag, grob 3–4 MB/Tag. Ohne Cleanup wird das 500-MB-Limit nach einigen Monaten erreicht. Deshalb den ausstehenden Cleanup-Job freigeben.
- **Edge Functions:** etwa 480 Aufrufe pro Tag, weit unter dem Free-Limit.
- **Pausierung:** Supabase pausiert Free-Projekte nach 7 Tagen ohne API-Aktivität; regelmäßige Seitenaufrufe verhindern das.

## Limitierungen

- **Keine echten Positionen.** Es gibt keinen öffentlichen GPS-Feed; alle Positionen sind aus Zeiten geschätzt.
- **Fahrzeugnummern/Wagenreihung nur mit eingeschaltetem Webscanner** (siehe [docs/scanner.md](docs/scanner.md)), je Fahrt einmal am Hbf (tief) bzw. durch eigene Meldung.
  - Die offizielle digitale Wagenreihung der DB deckt laut DB den Nahverkehr nicht oder nicht nachweislich ab.
  - Die inoffizielle bahn.de-API ist bot-geschützt und wird deshalb nicht genutzt.
  - Ohne Scanner bleiben Fahrzeugsuche, Fahrtenbuch, Zugtrennung und Abstellorte leer. Da jede Fahrt nur einmal gelesen wird, erkennt die Zugtrennung Änderungen innerhalb einer Fahrt nur mit zusätzlichen eigenen Meldungen.
  - Anbindung, sobald eine zulässige Quelle da ist (z. B. DB RIS::Formations mit eigenem API-Key): Den Collector so erweitern, dass er an Endhalten bzw. Trennungsbahnhöfen (Renningen, Marbach) einmal pro Fahrt eine Wagenreihung abfragt und in `formations` schreibt. Alles Weitere läuft automatisch.
- **Abdeckung:** Es werden nur Fahrten erfasst, die den Hbf (tief) bzw. Feuerbach (S62) passieren. Bei Sperrungen der Stammstrecke (z. B. Linienäste ohne Hbf) fehlen Fahrten. Dann `MONITOR_STOPS` in `collect/index.ts` um weitere Stationen ergänzen.
- **EFA-Nutzung:** EFA ist ein offener, aber nicht SLA-gestützter Dienst. Der Collector fragt sparsam ab (User-Agent gesetzt, 1 Wiederholung).
- **Geometrie:** Shapes kommen schrittweise (max. 6 pro Lauf). Bis dahin fährt der Zug eine Gerade, mit Hinweis in der UI.

## Agent-Aufgaben und Verantwortlichkeiten

| Agent | Aufgabe |
|---|---|
| Hauptagent (Orchestrator) | Architektur, Datenquellen-Tests, Supabase-Schema, Collector, Analytik, Integration, Doku |
| Data Research | Recherche DB-APIs, bahn.expert, GTFS, EFA, Positionen |
| Map & Geodaten | Linien, Geometriequellen, Tiles, Animationsansatz |
| Frontend & UI/Map | Next.js-App, Karte, Animation, Panels, Tests |
| QA & Security | unabhängige Prüfung von Code, SQL, Sicherheit, UI |

Wendeschleife Schwabstraße: Gleisverlauf aus OpenStreetMap (ODbL, `src/lib/schwabLoop.ts`). Fahrten, die dort enden oder beginnen, fahren auf der Karte durch die Schleife; die Bewegung ist aus den Fahrplanzeiten geschätzt. Kann der Browser die Karte nicht zeichnen (WebGL fehlt oder ist ausgefallen), erscheint eine vereinfachte SVG-Karte (`FallbackMap.tsx`).

Attribution: Fahrplan/Echtzeit © NVBW / MobiData BW · Karte © OpenFreeMap, © OpenMapTiles, © OpenStreetMap-Mitwirkende.
