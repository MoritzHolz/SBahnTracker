/**
 * Protokoll der Abstellungen (RPC get_stabling_log). Einträge entstehen in der
 * Datenbank aus gelesenen Zügen; hier wird nur angezeigt und sortiert.
 * Per Regel nach Plochingen verschobene Züge sind nicht enthalten.
 */
import { getSupabase } from "./supabase";
import { TZ } from "./time";

export type StablingState = "departed" | "seen_again" | "open" | "unconfirmed";

export interface StablingEntry {
  station_id: string;
  station_name: string;
  service_date: string;
  line_id: string;
  train_number: string;
  origin_name: string | null;
  arrived_at: string;
  arr_platform: string | null;
  vehicles: string[];
  cars: number;
  departed_at: string | null;
  dep_platform: string | null;
  dep_line_id: string | null;
  dep_train_number: string | null;
  dep_destination: string | null;
  seen_again_at: string | null;
  seen_again_station: string | null;
  confidence: number;
  state: StablingState;
}

export interface StablingLog {
  /** per Regel verschobene Fahrzeuge, nicht im Protokoll */
  moved: number;
  entries: StablingEntry[];
}

/** Auswertungszeitraum: ab Beginn der Aufzeichnung bis einschließlich Mi 02.12.2026, alle Tage */
export const LOG_FROM = "2026-11-25T14:35:00+01:00";
export const LOG_TO = "2026-12-03T00:00:00+01:00";

export async function fetchStablingLog(from = LOG_FROM, to = LOG_TO, weekdaysOnly = false): Promise<StablingLog> {
  const { data, error } = await getSupabase().rpc("get_stabling_log", { p_from: from, p_to: to, p_weekdays_only: weekdaysOnly });
  if (error) throw new Error(`get_stabling_log: ${error.message}`);
  const d = (data ?? {}) as Partial<StablingLog>;
  return { moved: d.moved ?? 0, entries: Array.isArray(d.entries) ? d.entries : [] };
}

export const entryKey = (e: StablingEntry) => `${e.service_date}|${e.line_id}|${e.train_number}|${e.vehicles.join()}`;

const dayKeyFmt = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit" });
const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" });

/** Kalendertag in Deutschland, z. B. 2026-11-25 */
export const dayKey = (t: string | number) => dayKeyFmt.format(new Date(t));

/** „Mi 25.11.“ */
export const fmtDay = (t: string | number) => dayFmt.format(new Date(t)).replace(/\.?,/, "");

/** Mitternacht des Tages in Deutschland (auch bei Zeitumstellung) */
export function dayStart(key: string): number {
  const utc = Date.parse(`${key}T00:00:00Z`);
  for (const h of [1, 2]) {
    const t = utc - h * 3_600_000;
    if (dayKey(t) === key && Number(hourFmt.format(t)) === 0) return t;
  }
  return utc;
}

const nextDay = (key: string) => new Date(Date.parse(`${key}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Alle Kalendertage im Zeitraum, auch Samstag und Sonntag */
export function periodDays(from = LOG_FROM, to = LOG_TO): string[] {
  const days: string[] = [];
  for (let k = dayKey(from); dayStart(k) < Date.parse(to); k = nextDay(k)) days.push(k);
  return days;
}

/** „5 h 40 min“, „2 Tage 3 h“ */
export function fmtStay(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  return h % 24 ? `${Math.floor(h / 24)} Tage ${h % 24} h` : `${h / 24} Tage`;
}

/** Standzeit; ohne beobachtete Abfahrt nur so genau, wie es belegt ist */
export function stayText(e: StablingEntry, now: number): string {
  const a = Date.parse(e.arrived_at);
  if (e.departed_at) return fmtStay(Date.parse(e.departed_at) - a);
  if (e.seen_again_at) return `höchstens ${fmtStay(Date.parse(e.seen_again_at) - a)}`;
  if (e.state === "open") return `bisher ${fmtStay(now - a)}`;
  return "unbekannt";
}

export interface StationGroup {
  id: string;
  name: string;
  cars: number;
  entries: StablingEntry[];
}

const byArrival = (a: StablingEntry, b: StablingEntry) =>
  Date.parse(a.arrived_at) - Date.parse(b.arrived_at) || a.train_number.localeCompare(b.train_number, "de") || a.vehicles.join().localeCompare(b.vehicles.join(), "de");

/** nach Bahnhof (alphabetisch), darin zeitlich */
export function groupByStation(list: StablingEntry[]): StationGroup[] {
  const m = new Map<string, StationGroup>();
  for (const e of list) {
    const g = m.get(e.station_id) ?? { id: e.station_id, name: e.station_name, cars: 0, entries: [] };
    g.cars += e.cars;
    g.entries.push(e);
    m.set(e.station_id, g);
  }
  for (const g of m.values()) g.entries.sort(byArrival);
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "de"));
}

export interface Segment {
  entry: StablingEntry;
  /** Anteil des Tages, 0–1 */
  from: number;
  to: number;
  /** begann am Vortag bzw. geht am nächsten Tag weiter */
  before: boolean;
  after: boolean;
}

/** Balken eines Tages; Abstellungen über Mitternacht werden an der Tagesgrenze geteilt. */
export function daySegments(list: StablingEntry[], key: string, now: number): Segment[] {
  const a = dayStart(key);
  const b = dayStart(nextDay(key));
  const out: Segment[] = [];
  for (const entry of list) {
    const s = Date.parse(entry.arrived_at);
    const end = Date.parse(entry.departed_at ?? entry.seen_again_at ?? "");
    const running = !Number.isFinite(end);
    const e = running ? Math.max(now, s) : end;
    if (s >= b || e <= a) continue;
    out.push({ entry, from: (Math.max(s, a) - a) / (b - a), to: (Math.min(e, b) - a) / (b - a), before: s < a, after: e > b });
  }
  return out.sort((x, y) => byArrival(x.entry, y.entry));
}

export interface ChronicleItem {
  at: string;
  kind: "in" | "out" | "seen";
  entry: StablingEntry;
}

/** Was wann passierte: abgestellt, ausgefahren, anderswo wieder gesehen. */
export function chronicle(list: StablingEntry[]): ChronicleItem[] {
  const out: ChronicleItem[] = [];
  for (const entry of list) {
    out.push({ at: entry.arrived_at, kind: "in", entry });
    if (entry.departed_at) out.push({ at: entry.departed_at, kind: "out", entry });
    else if (entry.seen_again_at) out.push({ at: entry.seen_again_at, kind: "seen", entry });
  }
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || byArrival(a.entry, b.entry));
}
