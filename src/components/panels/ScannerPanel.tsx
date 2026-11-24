"use client";

import { useEffect, useMemo, useState } from "react";
import { DataBadge, Delay, LineBadge } from "@/components/ui/Badges";
import { useNow } from "@/hooks/useLiveData";
import { useScannerStatus } from "@/hooks/useScanner";
import { useScannerControl } from "@/hooks/useScannerControl";
import { fetchLines, lineColor, lineTextColor, type Line } from "@/lib/api";
import {
  fetchWebTrains,
  MISSING_LABEL,
  QUALITY_TEXT,
  webSeenState,
  type ScannerStatus,
  type ScanRun,
  type WebTrain,
} from "@/lib/scanner";
import { fmtDateTime, fmtRelative, fmtTime, fmtTimeSec } from "@/lib/time";
import { AppNav } from "./StatusBar";

const RUN_LABEL: Record<ScanRun["status"], [string, string]> = {
  running: ["läuft", "text-accent"],
  ok: ["erfolgreich", "text-ok"],
  partial: ["teilweise", "text-warn"],
  error: ["Fehler", "text-bad"],
  aborted: ["abgebrochen", "text-muted"],
};

function stateText(s: ScannerStatus): [string, string] {
  switch (s.scan_state) {
    case "running":
      return s.worker_online ? ["Läuft", "text-accent"] : ["Verbindung zum Worker verloren", "text-bad"];
    case "waiting":
      return ["Wartet", "text-ok"];
    case "error":
      return [s.worker_online ? "Fehler" : "Fehler: Worker offline", "text-bad"];
    case "off":
      return ["Aus", "text-muted"];
  }
}

function countdown(iso: string | null, now: number): string {
  if (!iso) return "–";
  const sec = Math.round((Date.parse(iso) - now) / 1000);
  if (sec <= 0) return "gleich";
  return `in ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")} min`;
}

export function ScannerPanel() {
  const { status: s, error, apply } = useScannerStatus(3_000);
  const now = useNow(1000);
  const { mode, busy, msg: controlMsg, send } = useScannerControl(apply);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);
  const msg = controlMsg ?? loadMsg;
  const [trains, setTrains] = useState<WebTrain[]>([]);
  const [lines, setLines] = useState<Map<string, Line>>(() => new Map());

  const runId = s?.recent_runs[0]?.id;
  const runCount = s?.recent_runs[0]?.trains_captured;
  const runStatus = s?.recent_runs[0]?.status;
  const runForm = s?.recent_runs[0]?.formations_found;
  useEffect(() => {
    fetchWebTrains().then(setTrains, (e: Error) => setLoadMsg(e.message));
  }, [runId, runCount, runStatus, runForm]);
  useEffect(() => {
    fetchLines().then((l) => setLines(new Map(l.map((x) => [x.id, x]))), () => {});
  }, []);

  const rows = useMemo(
    () =>
      trains
        .map((t) => ({ t, seen: webSeenState({ last_seen_at: t.last_seen_at, run_id: t.last_run_id }, s, now) }))
        .sort((a, b) => a.seen.localeCompare(b.seen) || (a.t.dep_planned ?? a.t.arr_planned ?? "").localeCompare(b.t.dep_planned ?? b.t.arr_planned ?? "")),
    [trains, s, now],
  );
  const current = rows.filter((r) => r.seen === "erfasst").length;
  const run = s?.scan_state === "running" ? s.recent_runs[0] : s?.last_run ?? null;
  const locked = mode === "checking";
  const local = mode === "local";
  const scanRunning = s?.scan_state === "running" && s.worker_online;

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-[var(--panel)] backdrop-blur-md">
        <div className="page-x mx-auto max-w-4xl py-3 compact:py-1.5 compact:pt-[calc(0.375rem+env(safe-area-inset-top))]">
          <AppNav active="scanner" />
        </div>
      </header>

      <div className="page-x page-b mx-auto max-w-4xl pt-8 compact:pt-5">
        <h1 className="text-xl font-semibold tracking-tight">Live-Webscanner</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">
          Öffnet die hinterlegten Webseiten in einem echten Browser, liest die sichtbaren S-Bahn-Fahrten ab und ergänzt damit die Karte.
          Läuft nur, wenn er hier eingeschaltet wird.
        </p>

        {error && <p className="mt-4 text-[13px] text-bad">Status nicht abrufbar: {error}</p>}
        {!s && !error && <p className="mt-6 text-[13px] text-faint">Status wird geladen …</p>}

        {s && (
          <>
            {/* Schalter */}
            <section className="mt-6 rounded-lg border border-line bg-raised p-5 max-sm:p-4">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-4">
                <button
                  role="switch"
                  aria-checked={s.enabled}
                  aria-label="Webscanner ein- oder ausschalten"
                  disabled={locked || busy != null}
                  onClick={() => send(s.enabled ? "disable" : "enable")}
                  className={`relative h-10 w-[76px] shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    s.enabled ? "border-ok/50 bg-ok/30" : "border-[var(--line-strong)] bg-black/40"
                  }`}
                >
                  <span
                    className={`absolute left-1 top-1 h-[30px] w-[30px] rounded-full transition-transform duration-200 ${
                      s.enabled ? "translate-x-9 bg-ok" : "bg-muted"
                    }`}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="text-[17px] font-semibold leading-tight">
                    Scanner: <span className={s.enabled ? "text-ok" : "text-muted"}>{s.enabled ? "EIN" : "AUS"}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {s.enabled_changed_at ? `Geschaltet ${fmtRelative(s.enabled_changed_at, now)}` : "Noch nie eingeschaltet"}
                  </div>
                </div>
                <div className="flex gap-2 max-sm:w-full">
                  {scanRunning && !s.enabled && (
                    <button
                      onClick={() => send("disable")}
                      disabled={locked || busy != null}
                      className="h-10 compact:h-12 max-sm:flex-1 rounded-md border border-bad/40 px-4 text-[13px] font-medium text-bad hover:bg-bad/10 disabled:opacity-50"
                    >
                      Scan abbrechen
                    </button>
                  )}
                  <button
                    onClick={() => send("scan_now")}
                    disabled={locked || busy != null || scanRunning || s.manual_pending || (!s.worker_online && !local)}
                    title={!s.worker_online && !local ? "Worker offline" : undefined}
                    className="h-10 compact:h-12 max-sm:flex-1 rounded-md border border-[var(--line-strong)] bg-white/[0.06] px-4 text-[13px] font-medium hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {scanRunning ? "Scan läuft …" : s.manual_pending ? "Angefordert …" : "Jetzt scannen"}
                  </button>
                </div>
              </div>

              {!s.worker_online && local && (
                <p className="mt-3 text-[12px] text-muted">Der Worker startet automatisch, sobald du einschaltest oder scannst.</p>
              )}
              {!s.worker_online && !local && (
                <p role="alert" className="mt-4 rounded-md border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] leading-relaxed text-[#ffb4b4]">
                  Der Worker ist nicht erreichbar{s.heartbeat_at ? ` (zuletzt ${fmtRelative(s.heartbeat_at, now)})` : ""}. Es wird nichts erfasst.
                  Starte ihn auf deinem Mac mit <code className="font-mono">npm run scanner</code>.
                </p>
              )}
              {s.manual_pending && s.worker_online && (
                <p className="mt-3 text-[12px] text-muted">Startet, sobald seit dem letzten Scan mindestens 60 Sekunden vergangen sind (Regel der Quelle).</p>
              )}
              {!s.enabled && (scanRunning || s.manual_pending) && (
                <p className="mt-3 text-[12px] text-muted">Einmaliger Scan. Der Scanner bleibt danach AUS.</p>
              )}

              {!locked && (
                <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-4 text-[12px] text-muted compact:text-[14px]">
                  <label className="flex items-center gap-2 compact:min-h-11">
                    Intervall
                    <select
                      value={s.interval_min}
                      disabled={busy != null}
                      onChange={(e) => send("set_interval", Number(e.target.value))}
                      className="h-8 compact:h-11 rounded-md border border-line bg-black/30 px-2 text-fg"
                    >
                      {[...new Set([5, 6, 7, 8, 9, 10, 15, 20, 30, 60, s.interval_min])].sort((a, b) => a - b).map((m) => (
                        <option key={m} value={m} className="bg-[var(--panel-solid)]">
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 compact:min-h-11">
                    <input
                      type="checkbox"
                      checked={s.formations_enabled}
                      disabled={busy != null}
                      onChange={(e) => send("set_formations", e.target.checked ? 1 : 0)}
                    />
                    Fahrzeugnummern lesen (bahn.expert)
                  </label>
                </div>
              )}
              {msg && <p role="alert" className="mt-3 text-[12px] text-bad">{msg}</p>}
            </section>

            {/* Status */}
            <section className="mt-4 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
              <Cell k="Scanstatus">
                <span className={stateText(s)[1]}>{stateText(s)[0]}</span>
              </Cell>
              <Cell k="Letzter erfolgreicher Scan">
                {s.last_success_at ? (
                  <>
                    {fmtTimeSec(s.last_success_at)} <span className="text-muted">· {fmtRelative(s.last_success_at, now)}</span>
                  </>
                ) : (
                  <span className="text-faint">noch keiner</span>
                )}
              </Cell>
              <Cell k="Nächster geplanter Scan">
                {s.next_scan_at ? (
                  <>
                    {fmtTimeSec(s.next_scan_at)} <span className="text-muted">· {countdown(s.next_scan_at, now)}</span>
                  </>
                ) : (
                  <span className="text-faint">keiner</span>
                )}
              </Cell>
              <Cell k="Aktuell erfasste Züge">
                {current} <span className="text-muted">· {rows.length - current} zuletzt gesehen (3 h)</span>
              </Cell>
              <Cell k="Neu erkannt (letzter Scan)">{run ? run.trains_new : "–"}</Cell>
              <Cell k="Aktualisiert (letzter Scan)">
                {run ? run.trains_updated : "–"}
                {run && <span className="text-muted"> · {run.formations_found} Wagenreihungen</span>}
              </Cell>
              <Cell k="Aktuelle Webseite" wide>
                {s.scan_state === "running" && s.worker_online && s.current_url ? (
                  <>
                    <a href={s.current_url} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
                      {decodeURI(s.current_url)}
                    </a>
                    {s.step && <span className="block text-[12px] text-muted">{s.step}</span>}
                  </>
                ) : scanRunning && s.step ? (
                  <span className="text-muted">{s.step}</span>
                ) : (
                  <span className="text-faint">keine, es wird gerade nichts abgerufen</span>
                )}
              </Cell>
              <Cell k="Letzte Fehlermeldung" wide>
                {s.last_error ? (
                  <>
                    <span className="break-words text-bad">{s.last_error}</span>
                    <span className="block text-[12px] text-muted">
                      {fmtDateTime(s.last_error_at)}
                      {s.consecutive_errors > 1 && ` · ${s.consecutive_errors} Fehler in Folge, Abstand verlängert`}
                    </span>
                  </>
                ) : (
                  <span className="text-faint">keine</span>
                )}
              </Cell>
            </section>

            {/* Quellen */}
            <section className="mt-8">
              <H2>Quellen</H2>
              <ul className="mt-2 divide-y divide-line text-[13px]">
                {s.pages.map((p) => (
                  <li key={p.url} className="flex flex-wrap items-baseline justify-between gap-x-4 py-2">
                    <a href={p.url} target="_blank" rel="noreferrer" className="hover:underline compact:py-1.5">
                      {p.label}
                    </a>
                    <span className="text-[12px] text-faint">
                      {p.kind === "board" ? "Linie, Zugnummer, Start/Ziel, Zeiten, Verspätung, Gleis" : s.formations_enabled ? "Fahrzeugnummern, je Fahrt einmal" : "ausgeschaltet"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] leading-relaxed text-faint">
                Der Schalter steuert nur den Webscanner. Der Fahrplanabruf (NVBW EFA) läuft unabhängig davon weiter. Positionen auf der Karte sind
                immer geschätzt; keine der Quellen nennt Fahrzeugpositionen.
              </p>
            </section>

            {/* Läufe */}
            <section className="mt-8">
              <H2>Letzte Scans</H2>
              {s.recent_runs.length === 0 ? (
                <p className="mt-2 text-[13px] text-faint">Noch keine Scans.</p>
              ) : (
                <>
                <ul className="mt-2 divide-y divide-line border-y border-line md:hidden">
                  {s.recent_runs.map((r) => (
                    <li key={r.id} className="tnum py-2.5 text-[13px]">
                      <div className="flex items-baseline justify-between gap-3">
                        <span>
                          {fmtTimeSec(r.started_at)} <span className="text-muted">· {r.trigger === "manual" ? "manuell" : "automatisch"}</span>
                        </span>
                        <span className={RUN_LABEL[r.status][1]}>{RUN_LABEL[r.status][0]}</span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-muted">
                        {r.trains_captured} erfasst · {r.trains_new} neu · {r.trains_updated} aktualisiert · {r.formations_found} Wagenreihungen
                      </div>
                      {r.error && <p className="mt-0.5 break-words text-[12px] text-faint">{r.error}</p>}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 overflow-x-auto max-md:hidden">
                  <table className="tnum w-full min-w-[560px] text-left text-[12px]">
                    <thead className="text-faint">
                      <tr>
                        {["Start", "Auslöser", "Ergebnis", "Erfasst", "Neu", "Aktualisiert", "Wagenreihungen"].map((h) => (
                          <th key={h} className="py-1.5 pr-4 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.recent_runs.map((r) => (
                        <tr key={r.id} className="border-t border-line align-top">
                          <td className="py-1.5 pr-4">{fmtTimeSec(r.started_at)}</td>
                          <td className="py-1.5 pr-4 text-muted">{r.trigger === "manual" ? "manuell" : "automatisch"}</td>
                          <td className="max-w-[16rem] py-1.5 pr-4">
                            <span className={RUN_LABEL[r.status][1]}>{RUN_LABEL[r.status][0]}</span>
                            {r.error && <span className="block break-words text-[11px] text-faint">{r.error}</span>}
                          </td>
                          <td className="py-1.5 pr-4">{r.trains_captured}</td>
                          <td className="py-1.5 pr-4">{r.trains_new}</td>
                          <td className="py-1.5 pr-4">{r.trains_updated}</td>
                          <td className="py-1.5">{r.formations_found}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </section>

            {/* Züge */}
            <section className="mt-8">
              <H2>Erfasste Züge</H2>
              {rows.length === 0 ? (
                <p className="mt-2 text-[13px] text-faint">In den letzten drei Stunden wurde nichts erfasst.</p>
              ) : (
                <>
                <ul className="mt-2 divide-y divide-line border-y border-line md:hidden">
                  {rows.map(({ t, seen }) => (
                    <li key={t.id} className={`tnum py-2.5 text-[13px] ${seen === "zuletzt" ? "opacity-70" : ""}`}>
                      <div className="flex items-center gap-2.5">
                        {t.line_id ? (
                          <LineBadge id={t.line_id} color={lineColor(lines, t.line_id)} textColor={lineTextColor(lines, t.line_id)} />
                        ) : (
                          <Na />
                        )}
                        <span className="min-w-0 flex-1 truncate text-[14px]">→ {t.destination_name ?? "?"}</span>
                        <span>{fmtTime(t.dep_planned ?? t.arr_planned)}</span>
                        <span className="min-w-6 text-right">{t.delay_min == null ? <Na /> : <Delay minutes={t.delay_min} compact />}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
                        <span>Zug {t.train_number}</span>
                        <span>{t.platform ? `Gl. ${t.platform}` : "Gleis n. v."}</span>
                        {t.cancelled && <span className="text-bad">Ausfall</span>}
                        <span className="ml-auto">
                          {seen === "erfasst" ? <DataBadge state="live" label="Erfasst" /> : <DataBadge state="zuletzt" label={`Zuletzt ${fmtTime(t.last_seen_at)}`} />}
                        </span>
                      </div>
                      <div className="mt-1 text-[12px]">
                        {t.vehicles ? (
                          <span className="flex flex-wrap gap-1.5">
                            {t.vehicles.map((v) => (
                              <a key={v} href={`/fahrzeuge?q=${encodeURIComponent(v)}`} className="flex h-9 items-center rounded-md border border-line px-2.5 text-[13px]">
                                {v}
                              </a>
                            ))}
                          </span>
                        ) : (
                          <span className="text-faint">Fahrzeuge {vehicleText(t, now)}</span>
                        )}
                      </div>
                      {t.position_kind === "none" && !t.cancelled && <p className="mt-0.5 text-[11.5px] text-faint">Nicht auf der Karte: Position nicht berechenbar</p>}
                    </li>
                  ))}
                </ul>
                <div className="scroll-thin mt-2 max-h-[32rem] overflow-auto rounded-lg border border-line max-md:hidden">
                  <table className="tnum w-full min-w-[760px] text-left text-[12px]">
                    <thead className="sticky top-0 bg-[var(--panel-solid)] text-faint">
                      <tr>
                        {["Linie", "Zug", "Start → Ziel", "Abfahrt", "Versp.", "Gl.", "Fahrzeuge", "Qualität", "Stand"].map((h) => (
                          <th key={h} className="px-2.5 py-2 font-normal">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ t, seen }) => (
                        <tr key={t.id} className={`border-t border-line align-top ${seen === "zuletzt" ? "opacity-60" : ""}`}>
                          <td className="px-2.5 py-1.5">
                            {t.line_id ? (
                              <LineBadge id={t.line_id} color={lineColor(lines, t.line_id)} textColor={lineTextColor(lines, t.line_id)} size="sm" />
                            ) : (
                              <Na />
                            )}
                          </td>
                          <td className="px-2.5 py-1.5">{t.train_number}</td>
                          <td className="px-2.5 py-1.5">
                            {t.origin_name ?? "?"} → {t.destination_name ?? "?"}
                            {t.cancelled && <span className="ml-1.5 text-bad">Ausfall</span>}
                            {t.position_kind === "none" && !t.cancelled && <span className="block text-[11px] text-faint">nicht auf der Karte: Position nicht berechenbar</span>}
                          </td>
                          <td className="px-2.5 py-1.5" title={`ab ${t.board_station_name}`}>{fmtTime(t.dep_planned ?? t.arr_planned)}</td>
                          <td className="px-2.5 py-1.5">{t.delay_min == null ? <Na /> : <Delay minutes={t.delay_min} compact />}</td>
                          <td className="px-2.5 py-1.5">{t.platform ?? <Na />}</td>
                          <td className="px-2.5 py-1.5">
                            {t.vehicles ? (
                              t.vehicles.map((v) => (
                                <a key={v} href={`/fahrzeuge?q=${encodeURIComponent(v)}`} className="mr-1.5 whitespace-nowrap hover:underline">
                                  {v}
                                </a>
                              ))
                            ) : (
                              <span className="text-faint">{vehicleText(t, now)}</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1.5 text-muted" title={t.missing.length ? `Nicht verfügbar: ${t.missing.map((m) => MISSING_LABEL[m] ?? m).join(", ")}` : undefined}>
                            {QUALITY_TEXT[t.quality]}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-1.5" title={`${fmtDateTime(t.last_seen_at)} · ${t.source}`}>
                            {seen === "erfasst" ? <DataBadge state="live" label="Erfasst" /> : <DataBadge state="zuletzt" label={`Zuletzt ${fmtTime(t.last_seen_at)}`} />}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function vehicleText(t: WebTrain, now: number): string {
  if (t.vehicle_state === "not_available") return "nicht verfügbar";
  return Date.parse(t.dep_planned ?? t.arr_planned ?? "") < now - 30 * 60_000 ? "nicht erfasst" : "noch nicht gelesen";
}

const Na = () => <span className="text-faint" title="Auf der Webseite nicht angegeben">n. v.</span>;

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[13px] font-semibold">{children}</h2>;
}

function Cell({ k, wide = false, children }: { k: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`bg-bg px-4 py-3 ${wide ? "sm:col-span-2 lg:col-span-3" : ""}`}>
      <div className="text-[11px] text-faint">{k}</div>
      <div className="tnum mt-0.5 text-[14px]">{children}</div>
    </div>
  );
}
