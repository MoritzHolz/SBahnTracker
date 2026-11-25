import { describe, expect, it } from "vitest";
import { groupBySite, parkedMatching, parkingLevel, vehicleStatusLabel, type ParkedVehicle } from "./parking";

const v = (o: Partial<ParkedVehicle>): ParkedVehicle => ({
  vehicle_id: "430 001", status: "parked_assumed", confidence: 0.8, reason: null, station_id: "a", station_name: "Backnang",
  arrived_at: "2026-11-25T08:00:00Z", line_id: "S3", train_number: "7301", origin_name: "Vaihingen", estimated_at: null,
  site_kind: "yard", lat: 48.9, lon: 9.4, ...o,
});

describe("Abstellungen", () => {
  it("trennt vermutete und unsichere Fahrzeuge je Ort", () => {
    const sites = groupBySite([
      v({ vehicle_id: "430 003", station_id: "b", station_name: "Herrenberg", status: "absent" }),
      v({ vehicle_id: "430 001", confidence: 0.6 }),
      v({ vehicle_id: "430 002", confidence: 0.9 }),
      v({ vehicle_id: "430 004", status: "absent" }),
    ]);
    expect(sites.map((s) => s.name)).toEqual(["Backnang", "Herrenberg"]);
    expect(sites[0].parked.map((x) => x.vehicle_id)).toEqual(["430 002", "430 001"]);
    expect(sites[0].absent.map((x) => x.vehicle_id)).toEqual(["430 004"]);
  });

  it("erfindet keinen Ort, wenn keiner bekannt ist", () => {
    expect(groupBySite([v({ station_id: null, station_name: null })])).toEqual([]);
  });

  it("stuft die Sicherheit ein", () => {
    expect(parkingLevel(v({ confidence: 0.75 }))).toBe("wahrscheinlich");
    expect(parkingLevel(v({ confidence: 0.5 }))).toBe("vermutlich");
    expect(parkingLevel(v({ status: "absent", confidence: 0.89 }))).toBe("unsicher");
  });

  it("findet Fahrzeugnummern mit und ohne Leerzeichen", () => {
    const list = [v({ vehicle_id: "430 061" }), v({ vehicle_id: "423 010" })];
    expect(parkedMatching(list, "430061").map((x) => x.vehicle_id)).toEqual(["430 061"]);
    expect(parkedMatching(list, "423 0").map((x) => x.vehicle_id)).toEqual(["423 010"]);
    expect(parkedMatching(list, "43")).toEqual([]);
    expect(parkedMatching(list, "Backnang 430")).toEqual([]);
  });

  it("führt verschobene Fahrzeuge getrennt und nie als abgestellt", () => {
    const [p] = groupBySite([
      v({ vehicle_id: "430 001", station_id: "p", station_name: "Plochingen", status: "moved_depot", moved_at: "2026-11-25T10:00:00Z", confidence: 0.1 }),
      v({ vehicle_id: "430 002", station_id: "p", station_name: "Plochingen" }),
    ]);
    expect(p.parked.map((x) => x.vehicle_id)).toEqual(["430 002"]);
    expect(p.moved.map((x) => x.vehicle_id)).toEqual(["430 001"]);
    expect(parkingLevel(p.moved[0])).toBe("verschoben");
  });

  it("übersetzt Status", () => {
    expect(vehicleStatusLabel("absent")).toBe("nicht im Einsatz, Ort unsicher");
    expect(vehicleStatusLabel(null)).toBe("unbekannt");
  });
});
