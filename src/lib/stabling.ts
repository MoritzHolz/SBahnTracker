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

/** Laufende Aufzeichnung seit hier; davor rückwirkend aus den vorhandenen Scans ergänzt */
export const LIVE_FROM = "2026-11-25T14:35:00+01:00";
/** Montag der ersten Woche mit Daten */
export const FIRST_WEEK = "2026-11-23";

async function fetchRange(from: number, to: number): Promise<StablingLog> {
  const { data, error } = await getSupabase().rpc("get_stabling_log", {
    p_from: new Date(from).toISOString(),
    p_to: new Date(to).toISOString(),
    p_weekdays_only: false,
  });
  if (error) throw new Error(`get_stabling_log: ${error.message}`);
  const d = (data ?? {}) as Partial<StablingLog>;
  return { moved: d.moved ?? 0, entries: Array.isArray(d.entries) ? d.entries : [] };
}

export interface StablingWeek {
  /** Montag der Woche */
  week: string;
  moved: number;
  /** in dieser Woche abgestellt */
  entries: StablingEntry[];
  /** in der Woche davor abgestellt (für Standzeiten über den Wochenwechsel) */
  earlier: StablingEntry[];
}

export async function fetchStablingWeek(week: string): Promise<StablingWeek> {
  const a = dayStart(week);
  const [cur, prev] = await Promise.all([fetchRange(a, dayStart(addDays(week, 7))), fetchRange(dayStart(addDays(week, -7)), a)]);
  return { week, moved: cur.moved, entries: cur.entries, earlier: prev.entries };
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

/** Kalendertag plus n Tage */
export const addDays = (key: string, n: number) => new Date(Date.parse(`${key}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Montag der Woche, in der der Kalendertag liegt */
export function weekOf(key: string): string {
  const wd = new Date(`${key}T12:00:00Z`).getUTCDay();
  return addDays(key, -((wd + 6) % 7));
}

/** Montag bis Sonntag */
export const weekDays = (week: string) => Array.from({ length: 7 }, (_, i) => addDays(week, i));

/** Kalenderwoche nach ISO 8601 (wie in Deutschland üblich) */
export function weekNumber(week: string): number {
  const thursday = addDays(week, 3);
  const first = weekOf(`${thursday.slice(0, 4)}-01-04`);
  return Math.round((Date.parse(week) - Date.parse(first)) / (7 * 86_400_000)) + 1;
}

const dm = (key: string) => `${key.slice(8)}.${key.slice(5, 7)}.`;

/** „KW 48 · 23.11.–29.11.2026“ */
export function weekLabel(week: string): string {
  const end = addDays(week, 6);
  return `KW ${weekNumber(week)} · ${dm(week)}–${dm(end)}${end.slice(0, 4)}`;
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
  const b = dayStart(addDays(key, 1));
  const out: Segment[] = [];
  for (const entry of list) {
    const s = Date.parse(entry.arrived_at);
    const end = Date.parse(entry.departed_at ?? entry.seen_again_at ?? "");
    const running = !Number.isFinite(end);
    // Ohne Bestätigung nicht endlos weiterzeichnen (nach 48 h greift ohnehin die Plochingen-Regel)
    const e = !running ? end : Math.max(s, entry.state === "unconfirmed" ? Math.min(now, s + 48 * 3_600_000) : now);
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
