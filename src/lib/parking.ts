/**
 * Geschätzte Abstellungen: Fahrzeuge, die an einer Endstation angekommen und
 * danach in keiner Rückfahrt mehr aufgetaucht sind (RPC get_parked_vehicles).
 * Immer eine Vermutung, nie eine Ortung.
 */
export type SiteKind = "yard" | "siding" | "turning_loop" | "station";

export interface ParkedVehicle {
  vehicle_id: string;
  status: "parked_assumed" | "absent" | "moved_depot";
  confidence: number | null;
  reason: string | null;
  station_id: string | null;
  station_name: string | null;
  arrived_at: string | null;
  line_id: string | null;
  train_number: string | number | null;
  origin_name: string | null;
  estimated_at: string | null;
  /** Regel „nach Plochingen“: wann und von wo verschoben (Annahme, keine Fahrt) */
  moved_at?: string | null;
  moved_from_name?: string | null;
  site_kind: SiteKind;
  lat: number | null;
  lon: number | null;
}

export interface ParkingSite {
  id: string;
  name: string;
  kind: SiteKind;
  lat: number | null;
  lon: number | null;
  /** am Ort vermutet, sicherste zuerst */
  parked: ParkedVehicle[];
  /** fährt nicht, zuletzt hier angekommen – Standort unsicher */
  absent: ParkedVehicle[];
  /** per Regel hierher verschoben (Annahme), zuletzt verschobene zuerst */
  moved: ParkedVehicle[];
}

export const SITE_KIND_LABEL: Record<SiteKind, string> = {
  yard: "Abstellgleise",
  siding: "Abstellgleis",
  turning_loop: "Wendeschleife",
  station: "Bahnhof, Abstellgleis nicht bekannt",
};

export type ParkingLevel = "wahrscheinlich" | "vermutlich" | "unsicher" | "verschoben";

export function parkingLevel(v: Pick<ParkedVehicle, "status" | "confidence">): ParkingLevel {
  if (v.status === "moved_depot") return "verschoben";
  if (v.status === "absent") return "unsicher";
  return (v.confidence ?? 0) >= 0.75 ? "wahrscheinlich" : "vermutlich";
}

export const PARKING_LEVEL_LABEL: Record<ParkingLevel, string> = {
  wahrscheinlich: "wahrscheinlich hier",
  vermutlich: "vermutlich hier",
  unsicher: "Ort unsicher",
  verschoben: "Annahme",
};

/** Deutsche Bezeichnung der Status aus Datenbank (vehicles.status, parking_estimates.status). */
const VEHICLE_STATUS: Record<string, string> = {
  in_service: "im Einsatz",
  turning: "wendet an der Endstation",
  parked_assumed: "vermutlich abgestellt",
  absent: "nicht im Einsatz, Ort unsicher",
  moved_depot: "nach Plochingen verschoben (Annahme)",
  last_known: "zuletzt gesehen",
  maintenance_possible: "evtl. Werkstatt",
  unknown: "unbekannt",
};

export function vehicleStatusLabel(status: string | null | undefined): string {
  if (!status) return "unbekannt";
  return VEHICLE_STATUS[status] ?? status;
}

export function groupBySite(list: ParkedVehicle[]): ParkingSite[] {
  const sites = new Map<string, ParkingSite>();
  for (const v of list) {
    const id = v.station_id ?? v.station_name;
    if (!id) continue;
    let s = sites.get(id);
    if (!s) {
      s = { id, name: v.station_name ?? "Ort unbekannt", kind: v.site_kind, lat: v.lat, lon: v.lon, parked: [], absent: [], moved: [] };
      sites.set(id, s);
    }
    (v.status === "moved_depot" ? s.moved : v.status === "absent" ? s.absent : s.parked).push(v);
  }
  const byArrival = (a: ParkedVehicle, b: ParkedVehicle) =>
    Date.parse(b.arrived_at ?? "") - Date.parse(a.arrived_at ?? "") || a.vehicle_id.localeCompare(b.vehicle_id, "de");
  for (const s of sites.values()) {
    s.parked.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || byArrival(a, b));
    s.absent.sort(byArrival);
    s.moved.sort((a, b) => Date.parse(b.moved_at ?? "") - Date.parse(a.moved_at ?? "") || a.vehicle_id.localeCompare(b.vehicle_id, "de"));
  }
  return [...sites.values()].sort(
    (a, b) => b.parked.length - a.parked.length || b.absent.length - a.absent.length || b.moved.length - a.moved.length || a.name.localeCompare(b.name, "de"),
  );
}

/** Abgestellte Fahrzeuge, deren Nummer die Suche enthält (ab 3 Ziffern). */
export function parkedMatching(list: ParkedVehicle[], query: string): ParkedVehicle[] {
  if (!/^[\d\s-]+$/.test(query)) return [];
  const q = query.replace(/\D/g, "");
  if (q.length < 3) return [];
  return list.filter((v) => v.vehicle_id.replace(/\D/g, "").includes(q));
}
