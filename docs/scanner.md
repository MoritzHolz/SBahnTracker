# Live-Webscanner

Öffnet Webseiten in einem echten Chromium (Playwright), liest die sichtbaren S-Bahn-Fahrten ab und ergänzt die Karte. Bedienung unter `/scanner`.

## Quellenprüfung (Stand 23.11.2026)

| Seite | Sichtbar | Login/CAPTCHA | Automatisiert zulässig? | Genutzt |
|---|---|---|---|---|
| **dbf.finalrewind.org** | Linie, Zugnummer, Start, Ziel, Soll-/Ist-Zeit, Gleis, Ausfall, Meldung, Unterwegshalte. Keine Fahrzeuge, keine Positionen. Statisches HTML. | nein | Ja, in Grenzen: höchstens 10 Anfragen/min, 1 je Station und Minute; robots.txt: 20 s Abstand, `/z/` und `/map/` gesperrt | ja |
| **bahn.expert** | zusätzlich Wagenreihung mit Fahrzeugnummern. Dynamisch nachgeladen. | nein | robots.txt erlaubt alles, aber **keine ausdrückliche Regelung** des Betreibers. Daten stammen letztlich von bahn.de. Deshalb sparsam und einzeln abschaltbar. | ja |
| bahn.de | wie oben | Bot-Schutz | **Nein**, automatisches Auslesen untersagt; robots.txt sperrt `/web/` | nein |
| bahnhof.de / db.info | Abfahrtstafeln | nein | **Nein**, Nutzung nur zur Anzeige; andere Nutzung braucht schriftliche Zustimmung | nein |
| vvs.de | Verbindungen | nein | nicht geregelt, Vervielfältigung zustimmungspflichtig; kein Mehrwert gegenüber EFA | nein |
| zugfinder.net | Abruf lieferte leere Antwort | – | – | nein |

Keine dieser Seiten zeigt Fahrzeugpositionen. Positionen auf der Karte sind deshalb **immer geschätzt**.

Das ist eine technische Einschätzung, keine Rechtsberatung. Vor einer öffentlichen Nutzung der Daten sollte der Betreiber von bahn.expert gefragt werden.

## Laufzeit

| Ort | Ergebnis |
|---|---|
| Supabase Edge Functions | kein Chromium möglich |
| Vercel Hobby | Chromium nur je Aufruf; das CPU-Kontingent reicht nicht für einen Scan alle 5–10 min rund um die Uhr |
| GitHub Actions | verzögerte Starts, 6-h-Grenze, Dauerbetrieb in der Grauzone der Nutzungsbedingungen |
| **Eigener Worker (Mac, Docker)** | gewählt |

Der Mac-Worker arbeitet nur, solange der Mac wach ist. Während eines Scans hält der Worker ihn selbst wach (`caffeinate`), sonst nur der Schalter „Mac wach halten“ (siehe Einrichten). Zugeklappter Deckel und leerer Akku lassen sich nicht überstimmen. Schläft der Mac, startet ein von unterwegs angeforderter Scan erst nach dem Aufwachen und verfällt nach 5 min. Ein Raspberry Pi Pico reicht nicht als Server, weil darauf kein Chromium läuft; nötig ist ein Raspberry Pi 4/5 oder ein PC. Für Betrieb rund um die Uhr das Docker-Image auf einem Server laufen lassen.

## So wirkt der Schalter

- Der Worker wartet ohne Browser und fragt alle 5 s die Datenbank ab. Seite öffnen startet nie etwas.
- **EIN:** Der nächste Abruf startet Chromium und scannt, danach im Intervall (5–60 min, Standard 10).
- **AUS:** Die Datenbank setzt den laufenden Scan sofort auf „abgebrochen“. Der Worker schließt Chromium innerhalb weniger Sekunden. Daten eines abgebrochenen Laufs nimmt die Datenbank nicht mehr an, auch nicht von einem hängenden Worker. Bereits übernommene Züge bleiben.
- **Jetzt scannen:** einmaliger Scan, auch bei AUS. Der Schalter bleibt, wie er ist. Mindestabstand 60 s.
- Der Schalter betrifft nur den Webscanner. Der EFA-Abruf (pg_cron `collect-efa`) läuft weiter.

## Fehlerfälle

| Fall | Verhalten |
|---|---|
| Seite nicht erreichbar, HTTP-Fehler, Zeitüberschreitung (45 s/Seite, 12 min/Scan) | Fehler im Dashboard, Abstand verdoppelt sich je Fehler bis 60 min |
| 401/403/429, Login, CAPTCHA, Umleitung, robots.txt-Sperre | Abbruch mit Meldung, keine Umgehung |
| Seite umgebaut (keine Abfahrten erkannt) | Fehler, vorhandene Daten bleiben unverändert |
| Eine Quelle fällt aus | „teilweise“, die andere wird übernommen |
| Verbindung zu Supabase weg | nach 20 s Abbruch, weil der Schalter nicht mehr prüfbar ist |
| Rechner schläft während eines Scans ein | Abbruch mit „Rechner war … im Ruhezustand“, zählt nicht als Fehler der Quelle; weiter beim nächsten Termin |
| Worker stürzt ab | Dashboard zeigt „Worker offline“; der nächste Worker räumt den offenen Lauf auf |
| Zweiter Worker | wird abgewiesen, solange der erste lebt |

## Datenregeln

- Schlüssel ist Zugnummer + Betriebstag (`web_trains`), also keine Dubletten. Verlauf in `web_observations`, nur bei Änderung.
- Fehlt eine Angabe, bleibt sie `NULL` und steht in `missing`. `quality`: `complete`, `partial`, `minimal`.
- Verspätung 0 nur, wenn die Seite den Zug ausdrücklich als pünktlich ausweist.
- Fahrzeugnummern: ganze Einheiten (`T0423309` → `423 309`), nur wenn die Nummer zu den angezeigten Wagen passt. Einzelwagen stehen in `formations.groups`. Je Fahrt höchstens drei Versuche, höchstens 70 Fahrten je Scan (4 s Pause je Fahrt, nach 10 min folgt der Rest beim nächsten Scan).
- Reihenfolge der Wagenreihungen: S1, S2, S3, danach S4, S5, S6, S60, S62, S11. Gelesen werden alle Züge, die gerade fahren oder in 10 min starten und über Stuttgart Hbf (tief) laufen. Bereits gelesene Züge werden übersprungen. Die Einstellung „lookbehind“ von bahn.expert zeigt Abfahrten der letzten 90 min.
- Vergibt EFA nach einem Fahrplanwechsel neue Fahrt-IDs, gilt die zuletzt aktualisierte Kopie; Wagenreihungen der alten Kopie werden weiter angezeigt. Nichts wird gelöscht.
- Nicht mehr gesehene Züge werden nicht gelöscht, sondern als „zuletzt gesehen“ geführt.
- Zug nur auf der Webseite bekannt: Er kommt auf die Karte, wenn alle Halte bekannt sind und eine Fahrt derselben Linie mit exakt gleicher Haltfolge existiert. Deren Fahrzeiten werden verschoben (geschätzt). Sonst erscheint er nur in der Liste.
- EFA-Echtzeit wird nie überschrieben. Nur wenn sie fehlt, wirkt die abgelesene Verspätung ab dem Erfassungsbahnhof.

## Einrichten

Schlüssel (liegen nur in `worker/.env`, in der Datenbank stehen nur Hashes):

```bash
npm run scanner:keys
```

Das ausgegebene SQL im Supabase SQL Editor ausführen. `SCANNER_CONTROL_KEY` aus `worker/.env` nutzt nur der lokale Webserver. Im Dashboard reicht die Anmeldung.

**Mac:** Autostart einrichten, `uninstall` entfernt ihn wieder.

```bash
worker/mac.sh install
```

**Mac wach halten:** Schalter-App „Mac wach halten.app“ im Projektordner bauen. Ein Doppelklick zeigt den Zustand und schaltet um. Der Schalter gilt bis zum Ausschalten, Abmelden oder Neustart und ändert keine Systemeinstellung.

```bash
worker/mac.sh wach app
```

Im Terminal geht dasselbe mit `worker/mac.sh wach ein`, `aus` und `status`.

**Server:** Ordner `worker/` samt `.env` kopieren, dort:

```bash
docker compose up -d --build
```

Nicht zwei Worker gleichzeitig betreiben; der zweite wartet nur.

## Scan auf Knopfdruck (eigener Rechner)

Mit `npm run dev` gibt es auf der Karte, in der Fahrzeugsuche und unter `/scanner` den Knopf „Jetzt scannen“. Dort braucht es weder Schlüssel noch ein zweites Terminal:

- `src/app/api/scanner/route.ts` liest `SCANNER_CONTROL_KEY` auf dem Server aus `worker/.env`. Der Schlüssel wird nie an den Browser gesendet.
- Ist kein Worker online, startet der Knopf (oder EIN) ihn. Das Öffnen einer Seite startet nichts. Der Worker endet mit dem Webserver.
- Die Route gilt nur im Entwicklungsserver und nur für Anfragen der eigenen Seite vom selben Rechner (Host, Origin, Absender). `npm run dev` lauscht nur auf `localhost`.
- In einem veröffentlichten Build ist die Route abgeschaltet. Dort steuert jedes angemeldete Konto den Scanner, und der Worker muss separat laufen.
