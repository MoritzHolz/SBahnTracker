"use client";

/** Gemeinsames für Wochen-, Tages- und Nachtansicht: Filter, Auswahl sichtbar machen, Texte für Blöcke. */
import { useEffect, useMemo, useState } from "react";
import type { Stay } from "@/lib/stablingModel";
import { durationText, endText, startText, type ViewProps } from "./shared";

export interface StayFilter {
  station: string;
  setStation: (s: string) => void;
  onlyMarked: boolean;
  setOnlyMarked: (b: boolean) => void;
  /** Standorte mit Abstellungen oder Notizen, alphabetisch */
  stations: [string, string][];
  /** gefilterte Abstellungen (aus allStays, keine Kopien) */
  filtered: Stay[];
}

export function useStayFilter(p: ViewProps): StayFilter {
  const [station, setStation] = useState("");
  const [onlyMarked, setOnlyMarked] = useState(false);
  const { allStays, notes, marks } = p;
  const stations = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of allStays) m.set(s.station, s.stationName);
    for (const n of notes.list) if (!m.has(n.station_id)) m.set(n.station_id, n.station_name);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "de"));
  }, [allStays, notes.list]);
  const markedIds = marks.ids;
  const filtered = useMemo(
    () => allStays.filter((s) => (!station || s.station === station) && (!onlyMarked || s.vehicles.some((v) => markedIds.has(v)))),
    [allStays, station, onlyMarked, markedIds],
  );
  return { station, setStation, onlyMarked, setOnlyMarked, stations, filtered };
}

const select =
  "h-9 min-w-0 rounded-md border border-line bg-black/30 px-2 text-[13px] text-fg compact:h-11 compact:text-[16px] [color-scheme:dark]";

export function FilterBar({ f, marked, children }: { f: StayFilter; marked: number; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      <select aria-label="Standort" value={f.station} onChange={(e) => f.setStation(e.target.value)} className={`${select} max-sm:flex-1 sm:ml-auto`}>
        <option value="">Alle Standorte</option>
        {f.stations.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <label className={`flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 text-[13px] compact:h-11 ${marked === 0 ? "text-faint" : "text-muted"}`}>
        <input type="checkbox" checked={f.onlyMarked} onChange={(e) => f.setOnlyMarked(e.target.checked)} className="accent-[#facc15]" />
        nur markierte
      </label>
    </div>
  );
}

/** ausgewählte Abstellung in den sichtbaren Bereich holen */
export function useScrollToSelected(selected: string | null, ready: unknown) {
  useEffect(() => {
    if (!selected) return;
    const el = document.querySelector(`[data-stay="${CSS.escape(selected)}"]`);
    el?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [selected, ready]);
}

/** Tooltip/Vorlesetext eines Blocks */
export function stayTitle(s: Stay, now: number): string {
  const end = s.entry.transfer_to ? `nach ${s.entry.transfer_to} überführt` : endText(s, now);
  const from = s.entry.transfer_from ? `aus ${s.entry.transfer_from} überführt, ${startText(s)}` : startText(s);
  return `${s.vehicles.join(" + ")} · ${s.stationName}\n${from} – ${end}\nDauer: ${durationText(s, now)}`;
}

export const H = 3_600_000;
