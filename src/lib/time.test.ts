import { describe, expect, it } from "vitest";
import { delayMinutes, delayTone, fmtDelay, fmtTime } from "./time";
import { platformInfo, looksLikeVehicleNumber, tripMatchesQuery } from "./trips";
import type { LiveTrip } from "./api";

describe("delayMinutes", () => {
  it("berechnet Minuten aus est − planned", () => {
    expect(delayMinutes("2026-11-23T10:00:00Z", "2026-11-23T10:04:00Z")).toBe(4);
    expect(delayMinutes("2026-11-23T10:00:00Z", "2026-11-23T09:59:00Z")).toBe(-1);
  });
  it("rundet auf ganze Minuten und vermeidet -0", () => {
    expect(delayMinutes("2026-11-23T10:00:00Z", "2026-11-23T10:01:29Z")).toBe(1);
    expect(delayMinutes("2026-11-23T10:00:00Z", "2026-11-23T10:01:31Z")).toBe(2);
    expect(Object.is(delayMinutes("2026-11-23T10:00:00Z", "2026-11-23T09:59:50Z"), -0)).toBe(false);
  });
  it("liefert null ohne Echtzeit oder bei ungültigen Werten", () => {
    expect(delayMinutes("2026-11-23T10:00:00Z", null)).toBeNull();
    expect(delayMinutes(null, "2026-11-23T10:00:00Z")).toBeNull();
    expect(delayMinutes("kaputt", "2026-11-23T10:00:00Z")).toBeNull();
  });
});

describe("delayTone / fmtDelay", () => {
  it("stuft Verspätungen ein", () => {
    expect(delayTone(null)).toBe("unknown");
    expect(delayTone(-1)).toBe("ontime");
    expect(delayTone(0)).toBe("ontime");
    expect(delayTone(2)).toBe("slight");
    expect(delayTone(5)).toBe("late");
    expect(delayTone(15)).toBe("severe");
    expect(fmtDelay(3)).toBe("+3");
    expect(fmtDelay(0)).toBe("pünktlich");
  });
});

describe("Anzeige-Hilfen", () => {
  it("formatiert in Europe/Berlin", () => {
    expect(fmtTime("2026-11-23T10:00:00Z")).toBe("11:00");
    expect(fmtTime("2026-07-01T10:00:00Z")).toBe("12:00");
  });
  it("erkennt Gleisänderungen", () => {
    const base = {
      seq: 1, station_id: "x", station_name: "x", lat: 0, lon: 0,
      arr_planned: null, arr_est: null, dep_planned: null, dep_est: null, cancelled: false,
    };
    expect(platformInfo({ ...base, platform: "2", planned_platform: "1" }).changed).toBe(true);
    expect(platformInfo({ ...base, platform: null, planned_platform: "1" })).toEqual({ current: "1", planned: "1", changed: false, planOnly: true });
    // Normalisierung: keine falsche Gleisänderung
    expect(platformInfo({ ...base, platform: "Gleis 101", planned_platform: "101" }).changed).toBe(false);
    expect(platformInfo({ ...base, platform: "Gl. 3a", planned_platform: "3 A" }).changed).toBe(false);
    expect(platformInfo({ ...base, platform: null, planned_platform: null }).current).toBeNull();
  });
  it("erkennt Fahrzeugnummern", () => {
    expect(looksLikeVehicleNumber("423 502")).toBe(true);
    expect(looksLikeVehicleNumber("4235021")).toBe(true);
    expect(looksLikeVehicleNumber("7143")).toBe(false);
  });
});

describe("tripMatchesQuery", () => {
  it("verträgt Zahlen in trip_code/train_number", () => {
    const t = {
      id: "x", line_id: "S1", train_number: 7143, trip_code: 12345, origin_name: null, destination_name: "Kirchheim",
      direction: null, shape_id: null, has_realtime: false, cancelled: false, updated_at: null, source: null, stops: [], formation: null,
    } as unknown as LiveTrip;
    expect(tripMatchesQuery(t, "123")).toBe(true);
    expect(tripMatchesQuery(t, "7143")).toBe(true);
    expect(tripMatchesQuery(t, "kirch")).toBe(true);
    expect(tripMatchesQuery(t, "zzz")).toBe(false);
  });
});

import { bahnExpertUrl, normalizeVehicle, parseTrainNumber, tripsWithVehicle, unitNumber } from "./trips";

describe("Fahrzeugmeldungen", () => {
  it("normalisiert Fahrzeugnummern", () => {
    expect(normalizeVehicle("423502")).toBe("423 502");
    expect(normalizeVehicle(" 423 502 ")).toBe("423 502");
    expect(normalizeVehicle("423-502")).toBe("423 502");
    expect(normalizeVehicle("42350")).toBeNull();
    expect(normalizeVehicle("abc")).toBeNull();
  });
  it("führt Wagennummern auf die Einheit zurück", () => {
    for (const car of ["423 810", "433 810", "433 310", "423310"]) expect(unitNumber(car)).toBe("423 310");
    for (const car of ["430 537", "431 537", "431 037"]) expect(unitNumber(car)).toBe("430 037");
    expect(unitNumber("430 728")).toBe("430 228");
    expect(unitNumber("7172")).toBeNull();
  });
  it("erkennt Zugnummern", () => {
    for (const q of ["7172", "S1 7172", "s 7172", "S7172", "Zug 7172", " Zugnummer 7172 "]) expect(parseTrainNumber(q)).toBe("7172");
    for (const q of ["423 502", "423502", "Kirchheim", "S1", "717"]) expect(parseTrainNumber(q)).not.toBe("7172");
  });
  it("findet Fahrten über Zugnummer mit Linie und über Wagennummer", () => {
    const t = {
      line_id: "S1", train_number: "7172", trip_code: "444", origin_name: "Herrenberg", destination_name: "Kirchheim (T)",
      stops: [], formation: { vehicles: ["423 310"], observed_at: null, station_name: null, source: "bahn.expert" },
    } as unknown as Parameters<typeof tripMatchesQuery>[0];
    for (const q of ["7172", "S1 7172", "Zug 7172", "S 7172", "S7172", "7172 kirchheim", "423 310", "423 810", "423810"]) expect(tripMatchesQuery(t, q)).toBe(true);
    for (const q of ["S2 7172", "Zug 7173", "423 311", "444 herrenberg"]) expect(tripMatchesQuery(t, q)).toBe(false);
  });
  it("findet Fahrten mit gemeldetem Fahrzeug", () => {
    const trips = [
      { id: "a", formation: { vehicles: ["423 502", "423 019"], observed_at: null, station_name: null, source: "manual" } },
      { id: "b", formation: null },
    ];
    expect(tripsWithVehicle(trips, "423502").map((h) => [h.trip.id, h.vehicle])).toEqual([["a", "423 502"]]);
    expect(tripsWithVehicle(trips, "019")[0].vehicle).toBe("423 019");
    expect(tripsWithVehicle(trips, "42")).toEqual([]);
  });
  it("baut bahn.expert-Links mit Sonderfall Hbf (tief)", () => {
    expect(bahnExpertUrl("Stuttgart Hauptbahnhof (tief)")).toBe("https://bahn.expert/Stuttgart%20Hbf%20(tief)");
    expect(bahnExpertUrl("Hauptbahnhof (tief)")).toBe("https://bahn.expert/Stuttgart%20Hbf%20(tief)");
    expect(bahnExpertUrl("Schwabstraße")).toBe("https://bahn.expert/Schwabstra%C3%9Fe");
  });
});
