import type { LiveTrip } from "./api";
import { getSupabase } from "./supabase";
import { fmtDateTime, fmtTime } from "./time";

/** Stand des Webscanners zu einer Fahrt (Teil von get_live_trips). */
export interface WebInfo {
  first_seen_at: string;
  last_seen_at: string;
  run_id: number | null;
  delay_min: number | null;
  platform: string | null;
  board_station_id: string;
  board_station_name: string;
  cancelled: boolean;
  message: string | null;
  quality: "complete" | "partial" | "minimal";
  missing: string[];
  vehicle_state: "not_checked" | "available" | "not_available";
  source: string;
}

export interface ScanRun {
  id: number;
  trigger: "interval" | "manual";
  started_at: string;
  finished_at: string | null;
  status: "running" | "ok" | "partial" | "error" | "aborted";
  trains_captured: number;
  trains_new: number;
  trains_updated: number;
  formations_found: number;
  error: string | null;
}

export interface ScheduleWindow {
  /** HH:MM, deutsche Zeit; „to“ vor „from“ heißt: am nächsten Tag */
  from: string;
  to: string;
}

export interface ScannerSchedule {
  enabled: boolean;
  windows: ScheduleWindow[];
  keep_awake: boolean;
  /** Scanner wurde vom Zeitplan eingeschaltet */
  on: boolean;
  /** Ende des laufenden Zeitfensters */
  window_end: string | null;
  next_start: string | null;
}

/** Abend und Morgen: die Ankünfte vor und die Abfahrten nach der nächtlichen Abstellung */
export const SUGGESTED_WINDOWS: ScheduleWindow[] = [
  { from: "04:45", to: "09:30" },
  { from: "20:30", to: "01:15" },
];

export interface ScannerStatus {
  now: string;
  enabled: boolean;
  enabled_changed_at: string | null;
  interval_min: number;
  formations_enabled: boolean;
  schedule: ScannerSchedule;
  manual_pending: boolean;
  worker_online: boolean;
  heartbeat_at: string | null;
  scan_state: "running" | "waiting" | "error" | "off";
  step: string | null;
  current_url: string | null;
  next_scan_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  consecutive_errors: number;
  last_run: ScanRun | null;
  recent_runs: ScanRun[];
  pages: { label: string; url: string; kind: "board" | "formation" }[];
}

export interface WebTrain {
  id: number;
  service_date: string;
  train_number: string;
  line_id: string | null;
  origin_name: string | null;
  destination_name: string | null;
  board_station_name: string;
  arr_planned: string | null;
  dep_planned: string | null;
  delay_min: number | null;
  platform: string | null;
  cancelled: boolean;
  message: string | null;
  vehicles: string[] | null;
  vehicle_state: WebInfo["vehicle_state"];
  position_kind: "none" | "estimated";
  source: string;
  quality: WebInfo["quality"];
  missing: string[];
  first_seen_at: string;
  last_seen_at: string;
  last_run_id: number | null;
}

export type ScannerAction = "check" | "enable" | "disable" | "scan_now" | "set_interval" | "set_formations";

export async function fetchScannerStatus(): Promise<ScannerStatus> {
  const { data, error } = await getSupabase().rpc("scanner_status");
  if (error) throw new Error(`scanner_status: ${error.message}`);
  if (!data) throw new Error("Nicht angemeldet.");
  return data as ScannerStatus;
}

/** key nur für den lokalen Webserver; angemeldete Konten brauchen keinen. */
export async function scannerControl(key: string | null, action: ScannerAction, value?: number): Promise<ScannerStatus> {
  const { data, error } = await getSupabase().rpc("scanner_control", { p_key: key ?? "", p_action: action, p_value: value ?? null });
  if (error) throw new Error(error.message);
  const r = data as { ok: boolean; error?: string; status?: ScannerStatus };
  if (!r.ok || !r.status) throw new Error(r.error ?? "Unbekannter Fehler");
  return r.status;
}

export async function setSchedule(enabled: boolean, windows: ScheduleWindow[], keepAwake: boolean): Promise<ScannerStatus> {
  const { data, error } = await getSupabase().rpc("scanner_schedule", { p_enabled: enabled, p_windows: windows, p_keep_awake: keepAwake });
  if (error) throw new Error(error.message);
  const r = data as { ok: boolean; error?: string; status?: ScannerStatus };
  if (!r.ok || !r.status) throw new Error(r.error ?? "Unbekannter Fehler");
  return r.status;
}

/** Was der Zeitplan gerade tut oder als Nächstes tut. */
export function scheduleText(s: Pick<ScannerStatus, "schedule" | "enabled" | "worker_online">, now: number): string {
  const p = s.schedule;
  if (!p.enabled) return "Schaltet den Scanner zu festen Uhrzeiten ein und wieder aus.";
  const next = p.next_start ? `${sameDay(p.next_start, now) ? "heute" : "morgen"} um ${fmtTime(p.next_start)} Uhr` : null;
  if (p.window_end) {
    if (p.on) return `Vom Zeitplan eingeschaltet, schaltet um ${fmtTime(p.window_end)} Uhr aus.${s.worker_online ? "" : " Der Worker ist gerade offline."}`;
    if (s.enabled) return "Zeitfenster läuft. Von Hand eingeschaltet, bleibt danach an.";
    if (!s.worker_online) return "Zeitfenster läuft, aber der Worker ist offline.";
    return `Für dieses Zeitfenster von Hand ausgeschaltet.${next ? ` Nächstes Einschalten ${next}.` : ""}`;
  }
  if (s.enabled && !p.on) return `Von Hand eingeschaltet, der Zeitplan schaltet nicht aus.${next ? ` Nächstes Zeitfenster ${next}.` : ""}`;
  return next ? `Schaltet ${next} ein.` : "Kein Zeitfenster eingetragen.";
}

function sameDay(iso: string, now: number): boolean {
  return fmtDateTime(iso).slice(0, 10) === fmtDateTime(now).slice(0, 10);
}

/** Läuft die Seite auf dem eigenen Rechner (npm run dev)? Dann geht die Steuerung ohne Schlüssel. */
export async function localScannerAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/scanner", { cache: "no-store" });
    return res.ok && ((await res.json()) as { local?: boolean }).local === true;
  } catch {
    return false;
  }
}

/** Steuerbefehl über den eigenen Webserver. Startet bei Bedarf den Worker. */
export async function localScannerControl(action: ScannerAction, value?: number): Promise<ScannerStatus> {
  const res = await fetch("/api/scanner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, value }),
  });
  const r = (await res.json().catch(() => null)) as { status?: ScannerStatus; error?: string } | null;
  if (!res.ok || !r?.status) throw new Error(r?.error ?? "Der Webserver antwortet nicht.");
  return r.status;
}

const TRAIN_COLS =
  "id,service_date,train_number,line_id,origin_name,destination_name,board_station_name,arr_planned,dep_planned,delay_min,platform,cancelled,message,vehicles,vehicle_state,position_kind,source,quality,missing,first_seen_at,last_seen_at,last_run_id";

export async function fetchWebTrains(): Promise<WebTrain[]> {
  const since = new Date(Date.now() - 3 * 3600_000).toISOString();
  const { data, error } = await getSupabase()
    .from("web_trains")
    .select(TRAIN_COLS)
    .gte("last_seen_at", since)
    .order("last_seen_at", { ascending: false })
    .limit(400);
  if (error) throw new Error(`web_trains: ${error.message}`);
  return (data ?? []) as WebTrain[];
}

/* ------------------------------------------------------------------------- */

/** Ab diesem Alter gilt eine Erfassung nur noch als „zuletzt gesehen“. */
export const WEB_FRESH_MS = 20 * 60_000;

export const MISSING_LABEL: Record<string, string> = {
  line: "Linie",
  origin: "Start",
  destination: "Ziel",
  delay: "Verspätung",
  platform: "Gleis",
  vehicles: "Fahrzeugnummer",
};

export const QUALITY_TEXT: Record<WebInfo["quality"], string> = {
  complete: "vollständig",
  partial: "teilweise",
  minimal: "lückenhaft",
};

/** „erfasst“ = im letzten abgeschlossenen Scan gesehen und nicht zu alt; sonst „zuletzt gesehen“. */
export function webSeenState(
  w: { last_seen_at: string; run_id: number | null },
  status: Pick<ScannerStatus, "last_run"> | null,
  now: number,
): "erfasst" | "zuletzt" {
  const age = now - Date.parse(w.last_seen_at);
  if (!Number.isFinite(age) || age > WEB_FRESH_MS) return "zuletzt";
  if (status?.last_run && (w.run_id ?? 0) < status.last_run.id && status.last_run.status !== "error") return "zuletzt";
  return "erfasst";
}

/** Nur vom Webscanner bekannte Fahrt, die länger nicht mehr gesehen wurde → auf der Karte abgeblendet. */
export function isStaleWebOnly(t: LiveTrip, now: number): boolean {
  return t.source === "web_dbf" && (!t.web || now - Date.parse(t.web.last_seen_at) > WEB_FRESH_MS);
}

/**
 * Hat der Fahrplanabruf keine Echtzeit, der Webscanner aber eine frische Verspätung, wird sie ab dem
 * Erfassungsbahnhof übernommen. Echte EFA-Zeiten werden nie überschrieben.
 */
export function applyWebDelay(t: LiveTrip, now: number): LiveTrip {
  const w = t.web;
  if (!w || w.delay_min == null || w.cancelled || t.cancelled || t.source === "web_dbf") return t;
  if (now - Date.parse(w.last_seen_at) > WEB_FRESH_MS) return t;
  if (t.stops.some((s) => s.arr_est || s.dep_est)) return t;
  const from = t.stops.findIndex((s) => s.station_id === w.board_station_id);
  if (from < 0) return t;
  const shift = (v: string | null) => (v ? new Date(Date.parse(v) + w.delay_min! * 60_000).toISOString() : null);
  return {
    ...t,
    web_delay_applied: true,
    stops: t.stops.map((s, i) => (i < from ? s : { ...s, arr_est: shift(s.arr_planned), dep_est: shift(s.dep_planned) })),
  };
}
