import { getSupabase } from "./supabase";

/* ----------------------------------------------------------------------------
 * Typen – entsprechen den RPC-Rückgaben des Backends (Supabase).
 * ------------------------------------------------------------------------- */

export interface TripStop {
  seq: number;
  station_id: string;
  station_name: string;
  lat: number | null;
  lon: number | null;
  platform: string | null;
  planned_platform: string | null;
  arr_planned: string | null;
  arr_est: string | null;
  dep_planned: string | null;
  dep_est: string | null;
  cancelled: boolean | null;
}

export interface Formation {
  vehicles: string[];
  observed_at: string | null;
  station_name: string | null;
  source: string | null;
}

export interface LiveTrip {
  id: string;
  line_id: string;
  train_number: string | null;
  /** kommt aus der DB als Zahl, ggf. auch als Text */
  trip_code: number | string | null;
  origin_name: string | null;
  destination_name: string | null;
  direction: "H" | "R" | null;
  shape_id: number | null;
  has_realtime: boolean;
  cancelled: boolean;
  updated_at: string | null;
  source: string | null;
  stops: TripStop[];
  formation: Formation | null;
}

export interface RouteShape {
  id: number;
  line_id: string;
  coords: [number, number][];
  stop_ids: string[] | null;
  length_m: number | null;
}

export interface Line {
  id: string;
  name: string | null;
  color: string | null;
  text_color: string | null;
  sort: number | null;
}

export interface SourceRun {
  source: string | null;
  started_at: string | null;
  finished_at: string | null;
  ok: boolean | null;
  trips_seen: number | null;
  error: string | null;
}

export interface SourceStatus {
  live: SourceRun | null;
  last_ok: string | null;
  formation_source: { available: boolean; note: string | null } | null;
}

export interface Vehicle {
  id: string;
  vehicle_type_id: string | null;
  first_seen: string | null;
  last_seen: string | null;
  last_trip_id: string | null;
  last_station_name: string | null;
  status: string | null;
}

export interface Parking {
  station_name: string | null;
  status: string | null;
  confidence: number | null;
  last_sighting_at: string | null;
  reason: string | null;
}

export interface Sighting {
  observed_at: string;
  station_name: string | null;
  trip_id: string | null;
  position_in_formation: number | null;
  source: string | null;
}

export interface SplitEvent {
  station_name: string | null;
  detected_at: string;
  missing_vehicles: string[] | null;
  new_vehicles: string[] | null;
  kind: string | null;
  confidence: number | null;
}

export interface VehicleSearchResult {
  vehicle: Vehicle;
  parking: Parking | null;
  sightings: Sighting[];
  splits: SplitEvent[];
}

/* ----------------------------------------------------------------------------
 * Hilfen
 * ------------------------------------------------------------------------- */

export const FALLBACK_LINE_COLOR = "#8a8f98";

function asArray<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data == null) return [];
  // Manche RPCs liefern ein einzelnes JSON-Objekt mit Array darin
  return [data as T];
}

function asObject<T>(data: unknown): T | null {
  if (data == null) return null;
  if (Array.isArray(data)) return (data[0] as T) ?? null;
  return data as T;
}

/* ----------------------------------------------------------------------------
 * RPC-Aufrufe
 * ------------------------------------------------------------------------- */

export async function fetchLiveTrips(now?: Date): Promise<LiveTrip[]> {
  const args = now ? { p_now: now.toISOString() } : {};
  const { data, error } = await getSupabase().rpc("get_live_trips", args);
  if (error) throw new Error(`get_live_trips: ${error.message}`);
  return asArray<LiveTrip>(data).map((t) => ({
    ...t,
    stops: Array.isArray(t.stops) ? [...t.stops].sort((a, b) => a.seq - b.seq) : [],
  }));
}

export async function fetchRouteShapes(): Promise<RouteShape[]> {
  const { data, error } = await getSupabase().rpc("get_route_shapes");
  if (error) throw new Error(`get_route_shapes: ${error.message}`);
  return asArray<RouteShape>(data).filter(
    (s) => Array.isArray(s.coords) && s.coords.length >= 2,
  );
}

/** Lädt nur die angegebenen Shapes (RPC get_route_shapes_by_ids). */
export async function fetchRouteShapesByIds(ids: number[]): Promise<RouteShape[]> {
  if (ids.length === 0) return [];
  const { data, error } = await getSupabase().rpc("get_route_shapes_by_ids", { p_ids: ids });
  if (error) throw new Error(`get_route_shapes_by_ids: ${error.message}`);
  return asArray<RouteShape>(data).filter(
    (s) => Array.isArray(s.coords) && s.coords.length >= 2,
  );
}

export async function fetchSourceStatus(): Promise<SourceStatus | null> {
  const { data, error } = await getSupabase().rpc("get_source_status");
  if (error) throw new Error(`get_source_status: ${error.message}`);
  return asObject<SourceStatus>(data);
}

export async function searchVehicle(query: string): Promise<VehicleSearchResult[]> {
  const { data, error } = await getSupabase().rpc("search_vehicle", { p_query: query });
  if (error) throw new Error(`search_vehicle: ${error.message}`);
  return asArray<VehicleSearchResult>(data).map((r) => ({
    ...r,
    sightings: Array.isArray(r.sightings) ? r.sightings : [],
    splits: Array.isArray(r.splits) ? r.splits : [],
  }));
}

export async function fetchLines(): Promise<Line[]> {
  const { data, error } = await getSupabase().from("lines").select("*");
  if (error) throw new Error(`lines: ${error.message}`);
  return ((data ?? []) as Line[]).sort(
    (a, b) => (a.sort ?? 999) - (b.sort ?? 999) || a.id.localeCompare(b.id, "de", { numeric: true }),
  );
}

export function lineColor(lines: Map<string, Line>, id: string): string {
  return lines.get(id)?.color || FALLBACK_LINE_COLOR;
}

export function lineTextColor(lines: Map<string, Line>, id: string): string {
  return lines.get(id)?.text_color || "#ffffff";
}
