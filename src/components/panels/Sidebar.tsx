"use client";

import Link from "next/link";
import { useState } from "react";
import { Delay, LineBadge, Platform } from "@/components/ui/Badges";
import { fmtTime } from "@/lib/time";
import type { LiveTrip } from "@/lib/api";
import { looksLikeVehicleNumber, parseTrainNumber, platformInfo, STATUS_LABEL, type TripSummary } from "@/lib/trips";

export type StatusFilter =
  | "alle"
  | "unterwegs"
  | "fahrend"
  | "am_halt"
  | "vor_abfahrt"
  | "angekommen"
  | "geplant"
  | "ausfall"
  | "verspaetet";

export const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  alle: "Alle",
  unterwegs: "Unterwegs (auf Karte)",
  fahrend: "Fahrend",
  am_halt: "Am Halt",
  vor_abfahrt: "Vor Abfahrt",
  angekommen: "Angekommen",
  geplant: "Geplant",
  ausfall: "Ausfall",
  verspaetet: "Verspätet (≥ 3 min)",
};

export interface Filters {
  dest: string;
  station: string;
  status: StatusFilter;
}

export interface LineInfo {
  id: string;
  color: string;
  textColor: string;
  count: number;
}

interface SidebarProps {
  query: string;
  onQuery: (q: string) => void;
  lines: LineInfo[];
  hiddenLines: Set<string>;
  onToggleLine: (id: string) => void;
  focusLine: string | null;
  onFocusLine: (id: string | null) => void;
  filters: Filters;
  onFilters: (f: Filters) => void;
  destinations: string[];
  stations: string[];
  items: TripSummary[];
  totalCount: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  lineStyle: (id: string) => { color: string; textColor: string };
  loading: boolean;
  /** Fahrten, deren gemeldete Wagenreihung die gesuchte Fahrzeugnummer enthält */
  vehicleHits: { trip: LiveTrip; vehicle: string }[];
  /** Scan-Knopf unter der Suche */
  scan?: React.ReactNode;
}

const STATUS_DOT: Record<string, string> = {
  fahrend: "bg-ok",
  am_halt: "bg-accent",
  vor_abfahrt: "bg-muted",
  angekommen: "bg-faint",
  geplant: "bg-faint",
  beendet: "bg-faint",
  ausfall: "bg-bad",
};

export function Sidebar(p: SidebarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters =
    (p.filters.dest ? 1 : 0) + (p.filters.station ? 1 : 0) + (p.filters.status !== "alle" ? 1 : 0);
  const vehicleLike = looksLikeVehicleNumber(p.query);
  const train = parseTrainNumber(p.query);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Suche */}
      <div className="px-4 pt-3">
        <label className="relative block">
          <span className="sr-only">Suche</span>
          <svg className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" viewBox="0 0 16 16" fill="none">
            <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
            <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            value={p.query}
            onChange={(e) => p.onQuery(e.target.value)}
            placeholder="Zugnummer, Ziel, Station, Fahrzeug …"
            className="h-9 w-full rounded-md border border-line bg-black/30 pl-8 pr-8 text-[13px] text-fg placeholder:text-faint focus:border-[var(--line-strong)] focus:outline-none"
          />
          {p.query && (
            <button
              onClick={() => p.onQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-1 text-xs text-faint hover:text-fg"
              aria-label="Suche leeren"
            >
              ✕
            </button>
          )}
        </label>
        {p.vehicleHits.length > 0 && (
          <ul className="mt-2 space-y-1">
            {p.vehicleHits.map(({ trip, vehicle }) => {
              const ls = p.lineStyle(trip.line_id);
              return (
                <li key={trip.id}>
                  <button
                    onClick={() => p.onSelect(trip.id)}
                    className="flex w-full items-center gap-2 rounded-md border border-accent/30 bg-accent/[0.06] px-2.5 py-1.5 text-left text-[12px] hover:border-accent/60"
                  >
                    <LineBadge id={trip.line_id} color={ls.color} textColor={ls.textColor} size="sm" />
                    <span className="min-w-0 flex-1 truncate">
                      Fahrzeug <span className="tnum font-medium">{vehicle}</span>
                      <span className="text-muted">
                        {" "}
                        · {trip.line_id} Zug {trip.train_number ?? "–"} → {trip.destination_name ?? "–"}
                      </span>
                    </span>
                    <span aria-hidden className="text-faint">
                      ⌖
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {(vehicleLike || train) && (
          <Link
            href={`/fahrzeuge?q=${encodeURIComponent(train ?? p.query.trim())}`}
            className="mt-2 flex items-center justify-between rounded-md border border-line px-2.5 py-1.5 text-[12px] text-muted hover:border-[var(--line-strong)] hover:text-fg"
          >
            <span>
              {train ? `Alle Fahrten von Zug ${train}` : `Fahrzeug „${p.query.trim()}“`} in der Fahrzeugsuche öffnen
            </span>
            <span aria-hidden>→</span>
          </Link>
        )}
      </div>

      {p.scan && <div className="px-4 pt-2">{p.scan}</div>}

      {/* Linien-Chips */}
      <div className="px-4 pt-3">
        <div className="mb-1.5 flex items-baseline justify-between">
          <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Linien</h2>
          {p.focusLine && (
            <button onClick={() => p.onFocusLine(null)} className="text-[11px] text-muted hover:text-fg">
              Hervorhebung aufheben
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {p.lines.length === 0 && <span className="text-[12px] text-faint">{p.loading ? "Lädt …" : "Keine Linien"}</span>}
          {p.lines.map((l) => {
            const hidden = p.hiddenLines.has(l.id);
            const focused = p.focusLine === l.id;
            return (
              <div
                key={l.id}
                className={`group flex h-7 items-stretch overflow-hidden rounded-md border text-[12px] transition-colors ${
                  focused ? "border-[var(--line-strong)] bg-white/[0.06]" : "border-line"
                } ${hidden ? "opacity-45" : ""}`}
              >
                <button
                  onClick={() => p.onToggleLine(l.id)}
                  title={hidden ? `${l.id} einblenden` : `${l.id} ausblenden`}
                  aria-pressed={!hidden}
                  className="grid w-6 place-items-center hover:bg-white/5"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full border-2"
                    style={{ borderColor: l.color, background: hidden ? "transparent" : l.color }}
                  />
                </button>
                <button
                  onClick={() => p.onFocusLine(focused ? null : l.id)}
                  disabled={hidden}
                  title={`${l.id} hervorheben`}
                  className="flex items-center gap-1.5 border-l border-line pl-1.5 pr-2 font-semibold hover:bg-white/5 disabled:cursor-not-allowed"
                >
                  {l.id}
                  <span className="tnum font-normal text-faint">{l.count}</span>
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10.5px] text-faint">Punkt: ein-/ausblenden · Name: hervorheben</p>
      </div>

      {/* Filter */}
      <div className="px-4 pt-3">
        <button
          onClick={() => setFiltersOpen((v) => !v)}
          className="flex w-full items-center justify-between text-[10px] font-medium uppercase tracking-[0.12em] text-faint hover:text-muted"
          aria-expanded={filtersOpen}
        >
          <span>
            Filter {activeFilters > 0 && <span className="ml-1 rounded bg-accent/15 px-1 text-accent">{activeFilters}</span>}
          </span>
          <span className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`}>▾</span>
        </button>
        {filtersOpen && (
          <div className="anim-in mt-2 grid grid-cols-1 gap-2">
            <Select
              label="Richtung / Ziel"
              value={p.filters.dest}
              onChange={(v) => p.onFilters({ ...p.filters, dest: v })}
              options={[["", "Alle Ziele"], ...p.destinations.map((d) => [d, d] as [string, string])]}
            />
            <Select
              label="Station"
              value={p.filters.station}
              onChange={(v) => p.onFilters({ ...p.filters, station: v })}
              options={[["", "Alle Stationen"], ...p.stations.map((d) => [d, d] as [string, string])]}
            />
            <Select
              label="Status"
              value={p.filters.status}
              onChange={(v) => p.onFilters({ ...p.filters, status: v as StatusFilter })}
              options={Object.entries(STATUS_FILTER_LABEL) as [string, string][]}
            />
            {activeFilters > 0 && (
              <button
                onClick={() => p.onFilters({ dest: "", station: "", status: "alle" })}
                className="justify-self-start text-[11px] text-muted hover:text-fg"
              >
                Filter zurücksetzen
              </button>
            )}
          </div>
        )}
      </div>

      {/* Zugliste */}
      <div className="mt-3 flex items-baseline justify-between border-t border-line px-4 pb-1.5 pt-2.5">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Züge</h2>
        <span className="tnum text-[11px] text-faint">
          {p.items.length} / {p.totalCount}
        </span>
      </div>
      <ul className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-4">
        {p.loading && p.items.length === 0 && <li className="px-4 py-6 text-[12px] text-faint">Lade Fahrten …</li>}
        {!p.loading && p.items.length === 0 && (
          <li className="px-4 py-6 text-[12px] leading-relaxed text-faint">
            Keine Fahrten für die aktuelle Auswahl. Filter oder Suche anpassen.
          </li>
        )}
        {p.items.map((s) => (
          <TrainRow
            key={s.trip.id}
            s={s}
            selected={s.trip.id === p.selectedId}
            onSelect={p.onSelect}
            lineStyle={p.lineStyle(s.trip.line_id)}
          />
        ))}
      </ul>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="grid grid-cols-[6.5rem_1fr] items-center gap-2 text-[12px]">
      <span className="text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-0 rounded-md border border-line bg-black/30 px-2 text-[12px] text-fg focus:outline-none"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v} className="bg-[var(--panel-solid)]">
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function TrainRow({
  s,
  selected,
  onSelect,
  lineStyle,
}: {
  s: TripSummary;
  selected: boolean;
  onSelect: (id: string) => void;
  lineStyle: { color: string; textColor: string };
}) {
  const t = s.trip;
  const plat = platformInfo(s.nextStop);
  const onMap = s.position != null;
  return (
    <li>
      <button
        onClick={() => onSelect(t.id)}
        className={`relative grid w-full grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0.5 border-b border-line px-4 py-2.5 text-left transition-colors hover:bg-white/[0.03] ${
          selected ? "bg-white/[0.05]" : ""
        } ${t.cancelled ? "opacity-70" : ""}`}
      >
        {selected && <span className="absolute inset-y-0 left-0 w-0.5" style={{ background: lineStyle.color }} />}
        <div className="row-span-2 pt-0.5">
          <LineBadge id={t.line_id} color={lineStyle.color} textColor={lineStyle.textColor} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] text-fg">
            <span className={t.cancelled ? "line-through" : ""}>→ {t.destination_name ?? "Ziel unbekannt"}</span>
          </div>
        </div>
        <div className="text-right text-[12px]">
          <Delay minutes={s.delay} compact />
        </div>
        <div className="min-w-0 truncate text-[11.5px] text-muted">
          <span className="tnum text-faint">{t.train_number ?? "–"}</span>
          <span className="mx-1.5 text-faint">·</span>
          {s.status === "ausfall" ? (
            <span className="text-bad">Fahrt fällt aus</span>
          ) : s.nextStop ? (
            <>
              {s.lastStop && s.status !== "vor_abfahrt" ? <span className="text-faint">{s.lastStop.station_name} › </span> : null}
              <span>{s.nextStop.station_name}</span>
              <span className={`tnum ml-1.5 ${s.nextArrKind === "derived" ? "text-muted" : "text-fg"}`} title={s.nextArrKind === "derived" ? "Prognose (abgeleitet)" : undefined}>
                {s.nextArrKind === "derived" ? "≈" : ""}
                {fmtTime(s.nextArr)}
              </span>
            </>
          ) : (
            <span>{s.lastStop?.station_name ?? "–"}</span>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 text-[11px] text-muted">
          {s.nextStop && <Platform {...plat} />}
          <span className="flex items-center gap-1" title={onMap ? "Position geschätzt" : undefined}>
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[s.status] ?? "bg-faint"}`} />
            {STATUS_LABEL[s.status]}
          </span>
        </div>
      </button>
    </li>
  );
}
