# Frontend – Architektur

Next.js 15 (App Router, Client-Rendering für die Live-Ansicht), TypeScript, Tailwind v4, MapLibre GL JS v6, Supabase JS (nur lesend, Publishable Key).

## Module

| Pfad | Aufgabe |
|---|---|
| `src/lib/supabase.ts` | Lazy-Singleton des Supabase-Clients (Env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) |
| `src/lib/api.ts` | Typen + typisierte Aufrufe: `get_live_trips`, `get_route_shapes`, `get_source_status`, `search_vehicle`, Tabelle `lines` |
| `src/lib/geo.ts` | `Polyline`: kumulierte Distanzen, `pointAt` (Binärsuche), `slice` (lineSliceAlong-Äquivalent), `project`, `bearingAt(d±30 m)` |
| `src/lib/position.ts` | Rein funktionale Positionsschätzung: effektive Zeiten (`est ?? planned`), Status, Projektion der Halte (monoton), Fallback Gerade, `TrackCache`, `smoothDistance` |
| `src/lib/trips.ts` | Ableitungen für die UI: Zusammenfassung je Fahrt, Halt-Zustände, Gleis(änderung), Suche |
| `src/lib/time.ts` | Formatierung in Europe/Berlin, Verspätung (`delayMinutes`, `delayTone`) |
| `src/hooks/useLiveData.ts` | Polling: Trips + Status alle 30 s; Shapes + Linien alle 10 min (alle 3 min, solange Trips ohne geladene Shape existieren) |
| `src/components/map/*` | `LiveMap` (Karte, ein rAF-Loop ≈30 fps), `layers.ts` (Sources/Layer), `maplibre.ts` (Worker-URL, Basisstyle mit Fallback, SDF-Icons) |
| `src/components/panels/*` | Seitenleiste/Bottom-Sheet, Detailpanel mit Halte-Timeline, Statusbadge/Banner, Fahrzeugsuche |
| `src/components/LiveApp.tsx` | Zustand der Hauptseite (Filter, Auswahl, Folgen, Panels) |
| `src/app/page.tsx`, `src/app/fahrzeuge/page.tsx` | Routen |

## Positionsschätzung (keine GPS-Daten)

1. Halte ohne Zeiten oder mit `cancelled` werden für die Bewegung übersprungen; Zeiten werden monoton gemacht.
2. Status: > 5 min vor erster Abfahrt ausgeblendet → `vor_abfahrt` (am Starthalt) → `fahrend` / `am_halt` → `angekommen` (bis 5 min nach Ankunft).
3. Geometrie: Shape (`shape_id`) wird ggf. umgedreht, Halte projiziert, Kilometrierung monoton korrigiert. Liegt der Median-Abstand Halt↔Shape über 800 m oder fehlt die Shape → Gerade zwischen den Halten, in der UI als „Streckenverlauf ungenau“ gekennzeichnet.
4. Fahrend: `lerp(d_i, d_i+1, ease(f))` mit leichtem Ease-in-out. Das Ergebnis pro Trip wird gecacht (Schlüssel: Trip, Shape, Halt-Koordinaten).
5. Animation: Die Position wird in jedem Frame aus der Uhrzeit berechnet. Springt sie um mehr als 300 m (neue Echtzeitdaten), wird über 2 s angeglichen. Bei einem Geometriewechsel (Gerade → Shape) wird räumlich überblendet.
6. Zuglänge: 140 m, bzw. Anzahl Einheiten × 68 m, wenn `formation.vehicles` vorhanden ist.

## Karte

- Basisstyle `tiles.openfreemap.org/styles/dark`. Fallbacks: Positron mit dunklem Overlay, danach ein minimaler eigener Style ohne Kacheln (Hinweis in der UI).
- MapLibre v6 lädt seinen Worker über `import.meta.url`; das scheitert mit dem Bundler. Deshalb kopiert `scripts/copy-maplibre-worker.mjs` (prebuild/predev) die Datei nach `public/maplibre/` (gitignored), und `setWorkerUrl` setzt den Pfad.
- Layer: Strecken (Glow + Linie), Stationen (aus den Halten aggregiert, Namen ab Zoom 12), Züge: ab Zoom 13 ein Linienstück mit Rand und Spitze, darunter ein gedrehter SDF-Pfeil mit Linienkürzel. Fahrplan-Schätzungen werden transparenter und mit gestricheltem Rand gezeichnet.
- Labels nutzen die OpenFreeMap-Glyphen (`Noto Sans Regular/Bold`).

## Qualität

`npm test` (vitest: position.ts, Verspätung, Formatierung), `npm run lint`, `npm run build`.

## Nachträge (QA)

- Verspätungsweitergabe: `deriveTimes` übernimmt die letzte Ist-Verspätung auf Halte ohne `*_est` (`arrKind/depKind = "derived"`). In der UI erscheint das als „Prognose (abgeleitet)“ mit „≈“. Die Timeline zeigt nur echte `*_est` als Ist.
- Projektion: `Polyline.projectForward` sucht sequentiell ab dem Vorgängerhalt (erster Treffer < 150 m, dort das lokale Minimum). Die Richtung der Shape wird über die Abstände der End-Halte zu Shape-Anfang/-Ende geprüft.
- Performance: Track, Timeline und Qualität werden pro Trip-Objekt in WeakMaps gecacht. Eine Quelle `sb-trains` (ein `setData` pro Tick, ~12 Hz). Zugkörper werden erst ab Zoom 12,5 berechnet.
- Shapes: einmal `get_route_shapes`, danach nur fehlende IDs über `get_route_shapes_by_ids` (Wiederholung frühestens nach 3 min). Anfragen sind durchnummeriert, damit ältere Antworten neuere nicht überschreiben.
- Security-Header und CSP in `next.config.ts`. Error-Boundary (`src/components/ErrorBoundary.tsx`, `src/app/error.tsx`).
