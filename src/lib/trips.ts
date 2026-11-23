import type { LiveTrip, TripStop } from "./api";
import { computeTripPosition, deriveTimes, PHASE_LABEL, type TimeKind, type Track, type TripPhase, type TripPosition } from "./position";
import { delayMinutes } from "./time";

export type TripStatus = TripPhase | "ausfall" | "geplant" | "beendet";

export const STATUS_LABEL: Record<TripStatus, string> = {
  ...PHASE_LABEL,
  ausfall: "Ausfall",
  geplant: "Geplant",
  beendet: "Beendet",
};

export interface PlatformInfo {
  /** anzuzeigendes Gleis (aktuell, sonst Plan) */
  current: string | null;
  planned: string | null;
  changed: boolean;
  /** nur das Plangleis ist bekannt */
  planOnly: boolean;
}

/** Entfernt Präfixe wie „Gleis“/„Gl.“ und Leerraum. */
export function cleanPlatform(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim().replace(/^(gleis|gl\.?)\s*/i, "").trim();
  return s || null;
}

function normPlatform(v: string | null): string | null {
  return v ? v.replace(/\s+/g, "").toLowerCase() : null;
}

export function platformInfo(stop: TripStop | null | undefined): PlatformInfo {
  const current = cleanPlatform(stop?.platform);
  const planned = cleanPlatform(stop?.planned_platform);
  const nc = normPlatform(current);
  const np = normPlatform(planned);
  return {
    current: current ?? planned,
    planned,
    changed: nc != null && np != null && nc !== np,
    planOnly: current == null && planned != null,
  };
}

/** Index des letzten nicht ausgefallenen Halts (Endstation). */
export function endStopIndex(trip: LiveTrip): number {
  for (let i = trip.stops.length - 1; i >= 0; i--) if (!trip.stops[i].cancelled) return i;
  return trip.stops.length - 1;
}

/** Verspätung an einem Halt: Ankunft bevorzugt, sonst Abfahrt. */
export function stopDelay(stop: TripStop, prefer: "arr" | "dep" = "arr"): number | null {
  const arr = delayMinutes(stop.arr_planned, stop.arr_est);
  const dep = delayMinutes(stop.dep_planned, stop.dep_est);
  return prefer === "arr" ? arr ?? dep : dep ?? arr;
}

export interface TripSummary {
  trip: LiveTrip;
  status: TripStatus;
  position: TripPosition | null;
  lastStop: TripStop | null;
  nextStop: TripStop | null;
  /** effektive Ankunft am nächsten Halt (ms) */
  nextArr: number | null;
  /** Herkunft von nextArr: Echtzeit, abgeleitete Prognose oder Plan */
  nextArrKind: TimeKind;
  delay: number | null;
}

export function summarizeTrip(trip: LiveTrip, track: Track | null, now: number): TripSummary {
  const stops = trip.stops;
  const base = { trip, nextArr: null, nextArrKind: "plan" } as const;
  if (trip.cancelled) {
    return { ...base, status: "ausfall", position: null, lastStop: null, nextStop: stops[0] ?? null, delay: null };
  }
  const times = deriveTimes(trip);
  const pos = computeTripPosition(trip, track, now);
  if (pos) {
    const lastStop = stops[pos.lastIdx] ?? null;
    const nextStop = pos.nextIdx != null ? stops[pos.nextIdx] : null;
    const t = pos.nextIdx != null ? times[pos.nextIdx] : null;
    // Nur echte Ist-Daten: nächster Halt, sonst zuletzt verlassener Halt
    const delay = (nextStop ? stopDelay(nextStop, "arr") : null) ?? (lastStop ? stopDelay(lastStop, "dep") : null);
    return {
      ...base,
      status: pos.phase,
      position: pos,
      lastStop,
      nextStop,
      nextArr: t?.arr ?? null,
      nextArrKind: t?.arrKind ?? "plan",
      delay,
    };
  }
  // Nicht im Anzeigefenster: vor Beginn oder nach Ende
  const firstT = times[0] ?? null;
  const before = firstT?.dep != null && now < firstT.dep;
  if (before) {
    return {
      ...base,
      status: "geplant",
      position: null,
      lastStop: null,
      nextStop: stops[0] ?? null,
      nextArr: firstT?.dep ?? null,
      nextArrKind: firstT?.depKind ?? "plan",
      delay: stops[0] ? stopDelay(stops[0], "dep") : null,
    };
  }
  const last = stops[endStopIndex(trip)] ?? null;
  return { ...base, status: "beendet", position: null, lastStop: last, nextStop: null, delay: last ? stopDelay(last) : null };
}

export type StopState = "abgefahren" | "am_halt" | "naechster" | "geplant" | "ausfall";

/** Zustand jedes Halts für die Timeline im Detailpanel. */
export function stopStates(trip: LiveTrip, summary: TripSummary): StopState[] {
  const pos = summary.position;
  return trip.stops.map((s, i) => {
    if (s.cancelled || trip.cancelled) return "ausfall";
    if (summary.status === "beendet") return "abgefahren";
    if (!pos) return "geplant";
    if (pos.phase === "angekommen") return i === pos.lastIdx ? "am_halt" : "abgefahren";
    if (pos.phase === "am_halt" && i === pos.lastIdx) return "am_halt";
    if (pos.phase === "vor_abfahrt" && i === pos.lastIdx) return "am_halt";
    if (i <= pos.lastIdx) return "abgefahren";
    if (i === pos.nextIdx) return "naechster";
    return "geplant";
  });
}

export function directionLabel(d: LiveTrip["direction"]): string {
  if (d === "H") return "Hinrichtung";
  if (d === "R") return "Rückrichtung";
  return "unbekannt";
}

/**
 * Einheit zu einer Wagennummer: 423 810, 433 310 und 433 810 gehören zu 423 310, 431 537 zu 430 037.
 * Gespeichert werden immer Einheiten. Regel an den Wagenlisten von bahn.expert geprüft (BR 423 und 430).
 */
export function unitNumber(input: string): string | null {
  const n = normalizeVehicle(input);
  const type = n && { "423": "423", "433": "423", "430": "430", "431": "430" }[n.slice(0, 3)];
  if (!n || !type) return n;
  return `${type} ${String(Number(n.slice(4)) % 500).padStart(3, "0")}`;
}

/** Zugnummer aus Eingaben wie „7172“, „S1 7172“, „S7172“ oder „Zug 7172“, sonst null. */
export function parseTrainNumber(q: string): string | null {
  return q.trim().match(/^(?:zug(?:nummer)?\s*)?(?:s\s*\d{0,2}(?:\s+|(?=\d{4,5}$)))?(\d{4,5})$/i)?.[1] ?? null;
}

/** Grobe Heuristik: sieht die Eingabe wie eine Fahrzeugnummer aus (z. B. „423 502“)? */
export function looksLikeVehicleNumber(q: string): boolean {
  const s = q.trim().replace(/[\s.-]/g, "");
  return /^\d{6,7}$/.test(s) || /^\d{3}\s\d{3}/.test(q.trim());
}

/** Echtzeit-Datenstand eines Trips: live (≤ 5 min alt), zuletzt erfasst oder nicht verfügbar. */
export function realtimeState(trip: LiveTrip, now: number): "live" | "zuletzt" | "na" {
  if (!trip.has_realtime) return "na";
  const u = trip.updated_at ? Date.parse(trip.updated_at) : NaN;
  return Number.isFinite(u) && now - u <= 5 * 60_000 ? "live" : "zuletzt";
}

export function tripMatchesQuery(trip: LiveTrip, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const compact = s.replace(/\s+/g, "");
  const hay: unknown[] = [
    trip.line_id,
    trip.train_number,
    trip.trip_code,
    trip.origin_name,
    trip.destination_name,
    ...trip.stops.map((x) => x.station_name),
  ];
  if (hay.some((h) => h != null && String(h).toLowerCase().includes(s))) return true;
  const unit = unitNumber(s)?.replace(/\s+/g, "");
  const hasVehicle = (trip.formation?.vehicles ?? []).some((v) => {
    const id = String(v).replace(/\s+/g, "").toLowerCase();
    return id.includes(compact) || id === unit;
  });
  if (hasVehicle || unit) return hasVehicle;
  // „S1 7172“, „Zug 7172“, „7172 Kirchheim“: jedes Wort muss irgendwo vorkommen
  const words = s.replace(/^(zug(nummer)?|s)\s*(?=\d{4,5}\b)/, "").replace(/^zug(nummer)?\s+/, "").split(/\s+/);
  const wordHay = hay.filter((h) => h !== trip.trip_code && h != null).map((h) => String(h).toLowerCase());
  return words.every((w) => wordHay.some((h) => h.includes(w)));
}

/** Normalisiert eine Fahrzeugnummer auf „423 502“ (6 Ziffern), sonst null. */
export function normalizeVehicle(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  return /^\d{6}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3)}` : null;
}

/** Aktive Fahrten, in deren gemeldeter Wagenreihung die Nummer vorkommt. */
export function tripsWithVehicle<T extends { formation: LiveTrip["formation"] }>(
  trips: T[],
  query: string,
): { trip: T; vehicle: string }[] {
  const q = query.replace(/\D/g, "");
  const unit = unitNumber(query)?.replace(/\D/g, "");
  // Vier- und fünfstellige Eingaben sind Zugnummern
  if (q.length < 3 || parseTrainNumber(query)) return [];
  const out: { trip: T; vehicle: string }[] = [];
  for (const t of trips) {
    const v = (t.formation?.vehicles ?? []).find((x) => {
      const id = String(x).replace(/\D/g, "");
      return id.includes(q) || id === unit;
    });
    if (v) out.push({ trip: t, vehicle: String(v) });
  }
  return out;
}

/** Stationsname für bahn.expert (Abfahrtstafel). */
export function bahnExpertStationName(efaName: string): string {
  if (/(hauptbahnhof|hbf)\.?\s*\(tief\)/i.test(efaName)) return "Stuttgart Hbf (tief)";
  return efaName;
}

export function bahnExpertUrl(efaName: string): string {
  return `https://bahn.expert/${encodeURIComponent(bahnExpertStationName(efaName))}`;
}
