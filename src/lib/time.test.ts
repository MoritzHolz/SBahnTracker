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
