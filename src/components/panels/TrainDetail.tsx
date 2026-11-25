"use client";

import Link from "next/link";
import { useState } from "react";
import { DataBadge, Delay, Kv, LineBadge, Platform } from "@/components/ui/Badges";
import type { TripStop } from "@/lib/api";
import { DEFAULT_TRAIN_LENGTH_M, positionQuality, QUALITY_LABEL, trainLengthM, type Track } from "@/lib/position";
import { MISSING_LABEL, QUALITY_TEXT, webSeenState, type ScannerStatus } from "@/lib/scanner";
import { delayMinutes, fmtRelative, fmtTime } from "@/lib/time";
import { ReportFormation } from "./ReportFormation";
import {
  bahnExpertUrl,
  directionLabel,
  endStopIndex,
  platformInfo,
  realtimeState,
  STATUS_LABEL,
  stopStates,
  type StopState,
  type TripSummary,
} from "@/lib/trips";

interface Props {
  summary: TripSummary;
  track: Track | null;
  lineStyle: { color: string; textColor: string };
  scanner: ScannerStatus | null;
  now: number;
  follow: boolean;
  onFollow: (v: boolean) => void;
  onClose: () => void;
  /** nach erfolgreicher Meldung (Daten neu laden) */
  onReported: () => void;
  /** Handy: macht den Kopf zum Ziehgriff des Blatts */
  handleProps?: React.HTMLAttributes<HTMLDivElement>;
  onHandleTap?: () => void;
}

function statusSentence(s: TripSummary): string {
  const last = s.lastStop?.station_name;
  const next = s.nextStop?.station_name;
  switch (s.status) {
    case "fahrend":
      return `Fährt von ${last ?? "–"} nach ${next ?? "–"}`;
    case "am_halt":
      return `Hält in ${last ?? "–"}`;
    case "vor_abfahrt":
      return `Wartet auf Abfahrt in ${last ?? "–"}`;
    case "angekommen":
      return `Angekommen in ${last ?? "–"}`;
    case "geplant":
      return `Abfahrt in ${next ?? "–"} geplant`;
    case "beendet":
      return "Fahrt beendet";
    case "ausfall":
      return "Fahrt fällt aus";
  }
}

export function TrainDetail({ summary: s, track, lineStyle, scanner, now, follow, onFollow, onClose, onReported, handleProps, onHandleTap }: Props) {
  const [reporting, setReporting] = useState(false);
  const [justReported, setJustReported] = useState<string[] | null>(null);
  const t = s.trip;
  const quality = positionQuality(t);
  const rt = realtimeState(t, now);
  const nextPlanned = s.nextStop?.arr_planned ?? s.nextStop?.dep_planned ?? null;
  const endIdx = endStopIndex(t);
  const KIND_LABEL = { est: "Echtzeit", derived: "Prognose (abgeleitet)", plan: "Plan" } as const;
  const states = stopStates(t, s);
  const vehicles = (t.formation?.vehicles ?? []).map(String);
  const manualFormation = !t.formation?.source || t.formation.source === "manual";
  // bahn.expert: aktueller Halt (wenn der Zug steht), sonst nächster Halt
  const expertStop =
    s.status === "am_halt" || s.status === "vor_abfahrt" ? s.lastStop : s.nextStop ?? s.lastStop ?? t.stops[0] ?? null;

  const badges = (
    <div className="flex flex-wrap items-center gap-1.5">
      <DataBadge state="geschaetzt" label="Position geschätzt" title={`Positionsqualität: ${QUALITY_LABEL[quality]}`} />
      <DataBadge
        state={rt}
        label={rt === "na" ? "Echtzeit nicht verfügbar" : undefined}
        title={rt === "na" ? "Für diese Fahrt liegen nur Fahrplandaten vor." : undefined}
      />
      {track?.approximate && (
        <span
          className="rounded-full border border-warn/30 px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] text-warn"
          title="Für diese Fahrt ist noch kein Streckenverlauf geladen; die Position wird auf einer Geraden zwischen den Halten geschätzt."
        >
          Streckenverlauf ungenau
        </span>
      )}
    </div>
  );
  const closeButton = (
    <button
      onClick={onClose}
      className="-mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-white/5 hover:text-fg compact:h-11 compact:w-11"
      aria-label="Details schließen"
    >
      ✕
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Kopf (Handy): kompakt, zugleich Griff zum Ziehen */}
      <div {...handleProps} className="hidden shrink-0 touch-none select-none border-b border-line pb-2.5 pl-4 pr-3 compact:block">
        <button
          type="button"
          className="flex h-5 w-full items-center justify-center md:hidden"
          onClick={onHandleTap}
          aria-label="Größe der Details ändern"
        >
          <span className="h-1 w-9 rounded-full bg-white/25" />
        </button>
        <div className="flex items-center gap-3 md:pt-2">
          <LineBadge id={t.line_id} color={lineStyle.color} textColor={lineStyle.textColor} size="lg" />
          <div className="min-w-0 flex-1">
            <div className={`truncate text-[16px] font-semibold leading-snug ${t.cancelled ? "line-through" : ""}`}>{t.destination_name ?? "–"}</div>
            <div className="line-clamp-2 text-[12.5px] leading-snug text-muted">
              <span className="tnum">Zug {t.train_number ?? "unbekannt"}</span> · {statusSentence(s)}
            </div>
          </div>
          {s.position && (
            <button
              type="button"
              aria-pressed={follow}
              aria-label="Zug auf der Karte folgen"
              onClick={() => onFollow(!follow)}
              className={`h-11 shrink-0 rounded-md border px-3 text-[13px] font-medium ${
                follow ? "border-accent/50 bg-accent/15 text-accent" : "border-[var(--line-strong)] text-fg"
              }`}
            >
              Folgen
            </button>
          )}
          {closeButton}
        </div>
      </div>

      {/* Kopf (Desktop) */}
      <div className="border-b border-line px-5 pb-4 pt-4 compact:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <LineBadge id={t.line_id} color={lineStyle.color} textColor={lineStyle.textColor} size="lg" />
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-faint">Zug</div>
              <div className="tnum text-[15px] font-semibold leading-tight">{t.train_number ?? "unbekannt"}</div>
            </div>
          </div>
          {closeButton}
        </div>
        <div className="mt-3 text-[15px] leading-snug">
          <span className="text-muted">{t.origin_name ?? "–"}</span>
          <span className="mx-1.5 text-faint">→</span>
          <span className={`font-medium ${t.cancelled ? "line-through" : ""}`}>{t.destination_name ?? "–"}</span>
        </div>
        <div className="mt-1 text-[13px] text-muted">{statusSentence(s)}</div>
        <div className="mt-3">{badges}</div>
        {s.position && (
          <label className="mt-3 inline-flex cursor-pointer select-none items-center gap-2 text-[12px] text-muted">
            <input
              type="checkbox"
              checked={follow}
              onChange={(e) => onFollow(e.target.checked)}
              className="peer sr-only"
            />
            <span className="relative h-4 w-7 rounded-full border border-[var(--line-strong)] bg-black/40 transition-colors peer-checked:bg-accent/40 after:absolute after:left-0.5 after:top-0.5 after:h-2.5 after:w-2.5 after:rounded-full after:bg-fg after:transition-transform peer-checked:after:translate-x-3" />
            Zug auf der Karte folgen
          </label>
        )}
      </div>

      <div className="scroll-thin sheet-b min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="hidden border-b border-line px-5 py-3 compact:block">
          <div className="mb-2 text-[13px] leading-snug text-muted">
            {t.origin_name ?? "–"} <span className="text-faint">→</span> {t.destination_name ?? "–"}
          </div>
          {badges}
        </div>
        {/* Kennzahlen */}
        <dl className="border-b border-line px-5 py-3">
          <Kv k="Status">{STATUS_LABEL[s.status]}{s.position?.inLoop && " · Wendeschleife (geschätzt)"}</Kv>
          <Kv k="Fahrtrichtung">
            {directionLabel(t.direction)}
            <span className="text-faint"> · nach {t.destination_name ?? "–"}</span>
          </Kv>
          <Kv k="Letzte Station">{s.status === "vor_abfahrt" || s.status === "geplant" ? "–" : s.lastStop?.station_name ?? "–"}</Kv>
          <Kv k="Nächste Station">
            {s.nextStop ? (
              <div className="flex flex-col gap-0.5">
                <span>{s.nextStop.station_name}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-muted">
                  <span className={`tnum ${s.nextArrKind === "derived" ? "text-muted" : "text-fg"}`}>
                    {s.nextArrKind === "derived" ? "≈ " : ""}
                    {fmtTime(s.nextArr)}
                  </span>
                  {s.nextArrKind !== "plan" &&
                    nextPlanned &&
                    s.nextArr != null &&
                    delayMinutes(nextPlanned, new Date(s.nextArr).toISOString()) !== 0 && (
                      <span className="tnum text-faint line-through">{fmtTime(nextPlanned)}</span>
                    )}
                  <span
                    className="text-faint"
                    title={
                      s.nextArrKind === "derived"
                        ? "Keine Echtzeit für diesen Halt – aus der zuletzt gemeldeten Verspätung abgeleitet."
                        : undefined
                    }
                  >
                    {KIND_LABEL[s.nextArrKind]}
                  </span>
                  <Platform {...platformInfo(s.nextStop)} />
                </span>
              </div>
            ) : (
              "–"
            )}
          </Kv>
          <Kv k="Verspätung">
            <Delay minutes={s.delay} />
            {s.delay != null && s.delay !== 0 && <span className="text-muted"> min</span>}
            {s.delay == null && <span className="text-faint"> keine Echtzeit</span>}
          </Kv>
          <Kv k="Endstation">{t.stops[endIdx]?.station_name ?? t.destination_name ?? "–"}</Kv>
          <Kv k="Datenstand">
            <span title={t.updated_at ?? undefined}>{t.updated_at ? fmtRelative(t.updated_at, now) : "unbekannt"}</span>
            {t.source && <span className="text-faint"> · {t.source}</span>}
          </Kv>
          <Kv k="Positionsqualität">
            {QUALITY_LABEL[quality]}
            {track?.approximate && <span className="text-warn"> · Streckenverlauf ungenau</span>}
          </Kv>
          <Kv k="Zuglänge">
            {vehicles.length > 0 ? (
              <span className="tnum">{trainLengthM(t)} m ({vehicles.length} Einheiten)</span>
            ) : (
              <span className="text-muted">
                Standard {DEFAULT_TRAIN_LENGTH_M} m angenommen <span className="text-faint">(Länge unbekannt)</span>
              </span>
            )}
          </Kv>
        </dl>

        {/* Webscanner */}
        {t.web && (
          <section className="border-b border-line px-5 py-3">
            <h3 className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
              Webscanner
              {webSeenState(t.web, scanner, now) === "erfasst" ? (
                <DataBadge state="live" label="Im letzten Scan" />
              ) : (
                <DataBadge state="zuletzt" label="Zuletzt gesehen" />
              )}
            </h3>
            <dl>
              <Kv k="Erfasst">
                {fmtRelative(t.web.last_seen_at, now)} <span className="text-faint">· {t.web.source}</span>
              </Kv>
              <Kv k={`Ab ${t.web.board_station_name.replace("Stuttgart", "").trim()}`}>
                {t.web.cancelled ? <span className="text-bad">Ausfall gemeldet</span> : <Delay minutes={t.web.delay_min} />}
                <span className="text-muted"> · {t.web.platform ? `Gl. ${t.web.platform}` : "Gleis nicht verfügbar"}</span>
              </Kv>
              {t.web.message && <Kv k="Meldung">{t.web.message}</Kv>}
              <Kv k="Datenqualität">
                {QUALITY_TEXT[t.web.quality]}
                {t.web.missing.length > 0 && (
                  <span className="block text-[11px] text-faint">Nicht verfügbar: {t.web.missing.map((m) => MISSING_LABEL[m] ?? m).join(", ")}</span>
                )}
              </Kv>
            </dl>
            {t.source === "web_dbf" && (
              <p className="mt-1 text-[11px] text-warn">Nur vom Webscanner bekannt. Fahrzeiten von einer Fahrt mit gleicher Haltfolge übertragen (geschätzt).</p>
            )}
            {t.web_delay_applied && <p className="mt-1 text-[11px] text-faint">Verspätung dieser Fahrt stammt vom Webscanner.</p>}
          </section>
        )}

        {/* Fahrzeuge */}
        <section className="border-b border-line px-5 py-3">
          <h3 className="mb-2 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
            Fahrzeuge
            {vehicles.length > 0 ? (
              <DataBadge
                state="zuletzt"
                label={manualFormation ? "Gemeldet" : "Webscanner"}
                title={manualFormation ? "Manuell gemeldete Wagenreihung" : `Wagenreihung von ${t.formation?.source}`}
              />
            ) : (
              <DataBadge state="na" />
            )}
          </h3>
          {vehicles.length > 0 ? (
            <div>
              <div className="flex flex-wrap items-center gap-1">
                {vehicles.map((v, i) => (
                  <span key={`${v}-${i}`} className="flex items-center gap-1">
                    {i > 0 && <span className="text-faint">·</span>}
                    <Link
                      href={`/fahrzeuge?q=${encodeURIComponent(v)}`}
                      className="tnum rounded border border-line px-1.5 py-0.5 text-[12.5px] hover:border-[var(--line-strong)] compact:flex compact:h-10 compact:items-center compact:px-3 compact:text-[14px]"
                      title={`Fahrtenbuch von ${v}`}
                    >
                      {v}
                    </Link>
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-faint">
                {manualFormation ? "gemeldet" : "erfasst"} {fmtTime(t.formation?.observed_at)}
                {t.formation?.station_name ? ` an ${t.formation.station_name}` : ""}
                {manualFormation ? " (manuell)" : ` (${t.formation?.source})`}
              </p>
            </div>
          ) : (
            <p className="text-[12px] leading-relaxed text-muted">
              Für diese Fahrt ist noch keine Fahrzeugnummer erfasst.
            </p>
          )}

          {justReported && !reporting && (
            <p role="status" className="anim-in mt-2 rounded border border-ok/30 bg-ok/10 px-2 py-1.5 text-[12px] text-ok">
              Danke! Gemeldet: {justReported.join(" · ")}
            </p>
          )}

          {reporting ? (
            <ReportFormation
              trip={t}
              defaultStopIdx={s.position ? s.position.lastIdx : null}
              onCancel={() => setReporting(false)}
              onDone={(v) => {
                setReporting(false);
                setJustReported(v);
                onReported();
              }}
            />
          ) : (
            <button
              onClick={() => {
                setJustReported(null);
                setReporting(true);
              }}
              className="mt-2.5 h-7 rounded-md border border-[var(--line-strong)] px-2.5 text-[12px] text-fg hover:bg-white/5 compact:h-11 compact:w-full compact:text-[14px]"
            >
              {vehicles.length > 0 ? "Fahrzeuge korrigieren" : "Fahrzeug melden"}
            </button>
          )}

          {expertStop && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
              <a
                href={bahnExpertUrl(expertStop.station_name)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline compact:flex compact:min-h-11 compact:items-center compact:text-[13px]"
              >
                Auf bahn.expert nachsehen ↗
              </a>
              <span className="text-faint">
                Zug {t.line_id} {t.train_number ?? ""} suchen
              </span>
            </div>
          )}
        </section>

        {/* Timeline */}
        <section className="px-5 py-3">
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Halte</h3>
          <ol className="relative">
            {t.stops.map((stop, i) => (
              <StopRow
                key={`${stop.seq}-${stop.station_id}`}
                stop={stop}
                state={states[i]}
                isFirst={i === 0}
                isLast={i === t.stops.length - 1}
                isEnd={i === endIdx}
                color={lineStyle.color}
                nextState={states[i + 1]}
              />
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function TimeCell({ planned, est, label }: { planned: string | null; est: string | null; label: string }) {
  if (!planned && !est) return <span className="text-faint">–</span>;
  const d = delayMinutes(planned, est);
  const changed = est != null && d != null && d !== 0;
  return (
    <span className="tnum inline-flex items-baseline gap-1" title={label}>
      {changed ? (
        <>
          <span className="text-faint line-through">{fmtTime(planned)}</span>
          <span className={d! > 0 ? (d! > 3 ? "text-late" : "text-warn") : "text-ok"}>{fmtTime(est)}</span>
        </>
      ) : (
        <span>{fmtTime(est ?? planned)}</span>
      )}
    </span>
  );
}

const STATE_TEXT: Record<StopState, string> = {
  abgefahren: "text-faint",
  am_halt: "text-fg font-medium",
  naechster: "text-fg font-medium",
  geplant: "text-muted",
  ausfall: "text-bad",
};

function StopRow({
  stop,
  state,
  nextState,
  isFirst,
  isLast,
  isEnd,
  color,
}: {
  stop: TripStop;
  state: StopState;
  nextState: StopState | undefined;
  isFirst: boolean;
  isLast: boolean;
  isEnd: boolean;
  color: string;
}) {
  const plat = platformInfo(stop);
  const hasArr = !!(stop.arr_planned || stop.arr_est);
  const hasDep = !!(stop.dep_planned || stop.dep_est);
  const passed = state === "abgefahren";
  const segPassed = passed && nextState !== undefined && (nextState === "abgefahren" || nextState === "am_halt" || nextState === "naechster");
  const marker =
    state === "am_halt" ? (
      <span className="h-3 w-3 rounded-full border-2" style={{ borderColor: color, background: color }} />
    ) : state === "naechster" ? (
      <span className="h-3 w-3 rounded-full border-2 bg-[var(--bg)]" style={{ borderColor: color }} />
    ) : state === "ausfall" ? (
      <span className="h-2.5 w-2.5 rounded-full border border-bad bg-[var(--bg)]" />
    ) : (
      <span
        className={`h-2 w-2 rounded-full ${passed ? "" : "border border-[var(--line-strong)] bg-[var(--bg)]"}`}
        style={passed ? { background: color, opacity: 0.45 } : undefined}
      />
    );

  return (
    <li className={`relative grid grid-cols-[1.25rem_1fr_auto] gap-x-2 py-1.5 ${STATE_TEXT[state]}`}>
      {/* Verbindungslinie */}
      {!isLast && (
        <span
          className="absolute left-[calc(0.625rem-0.5px)] top-[1.05rem] h-full w-px"
          style={{ background: segPassed ? color : "var(--line-strong)", opacity: segPassed ? 0.5 : 1 }}
        />
      )}
      <span className="relative z-10 grid h-5 place-items-center">{marker}</span>
      <div className="min-w-0">
        <div className={`truncate text-[13px] ${state === "ausfall" ? "line-through" : ""}`}>{stop.station_name}</div>
        <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
          {state === "naechster" && <span className="text-accent">Nächster Halt</span>}
          {state === "am_halt" && <span className="text-accent">{isEnd ? "Angekommen" : "Hier"}</span>}
          {isEnd && <span className="text-faint">Endstation</span>}
          {state === "ausfall" && <span className="text-bad">Halt entfällt</span>}
          <Platform {...plat} />
        </div>
      </div>
      <div className="flex flex-col items-end text-[12px] leading-5">
        {!isFirst && (hasArr || !hasDep) && <TimeCell planned={stop.arr_planned} est={stop.arr_est} label="Ankunft" />}
        {!isLast && hasDep && (
          <span className={isFirst || !hasArr ? "" : "text-[11px] opacity-75"}>
            <TimeCell planned={stop.dep_planned} est={stop.dep_est} label="Abfahrt" />
          </span>
        )}
      </div>
    </li>
  );
}
