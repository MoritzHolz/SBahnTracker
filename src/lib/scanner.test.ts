import { describe, expect, it } from "vitest";
import type { LiveTrip, TripStop } from "./api";
import { applyWebDelay, isStaleWebOnly, scheduleText, webSeenState, type ScannerSchedule, type ScanRun, type WebInfo } from "./scanner";

const NOW = Date.parse("2026-11-23T18:00:00Z");
const stop = (seq: number, id: string, min: number, est: string | null = null): TripStop => {
  const t = new Date(NOW + min * 60_000).toISOString();
  return { seq, station_id: id, station_name: id, lat: 48, lon: 9, platform: null, planned_platform: null, arr_planned: t, arr_est: est, dep_planned: t, dep_est: est, cancelled: false };
};
const web = (o: Partial<WebInfo> = {}): WebInfo => ({
  first_seen_at: "2026-11-23T17:50:00Z", last_seen_at: "2026-11-23T17:55:00Z", run_id: 5, delay_min: 4, platform: "101", board_station_id: "de:08111:6118", board_station_name: "Stuttgart Hbf (tief)",
  cancelled: false, message: null, quality: "partial", missing: [], vehicle_state: "not_checked", source: "dbf.finalrewind.org", ...o,
});
const trip = (o: Partial<LiveTrip> = {}): LiveTrip => ({
  id: "t", line_id: "S1", train_number: "7100", trip_code: 1, origin_name: "A", destination_name: "B", direction: "H", shape_id: 1, has_realtime: false, cancelled: false,
  updated_at: null, source: "efa_nvbw", formation: null, stops: [stop(0, "a", -10), stop(1, "de:08111:6118", 0), stop(2, "b", 10)], web: web(), ...o,
});
const run = (id: number, status: ScanRun["status"] = "ok") => ({ last_run: { id, status } as ScanRun });

describe("applyWebDelay", () => {
  it("wirkt erst ab dem Erfassungsbahnhof", () => {
    const t = applyWebDelay(trip(), NOW);
    expect(t.stops[0].dep_est).toBeNull();
    expect(t.stops[1].dep_est).toBe(new Date(NOW + 4 * 60_000).toISOString());
    expect(t.web_delay_applied).toBe(true);
  });
  it("überschreibt nie EFA-Echtzeit", () => {
    const x = trip({ stops: [stop(0, "a", -10), stop(1, "de:08111:6118", 0, "2026-11-23T18:01:00Z")] });
    expect(applyWebDelay(x, NOW)).toBe(x);
  });
  it("ignoriert alte, fehlende und ausgefallene Angaben", () => {
    for (const w of [web({ last_seen_at: "2026-11-23T17:00:00Z" }), web({ delay_min: null }), web({ cancelled: true }), null]) {
      const x = trip({ web: w });
      expect(applyWebDelay(x, NOW)).toBe(x);
    }
  });
});

describe("webSeenState", () => {
  it("im letzten Scan erfasst", () => expect(webSeenState(web(), run(5), NOW)).toBe("erfasst"));
  it("im letzten Scan nicht mehr dabei", () => expect(webSeenState(web(), run(6), NOW)).toBe("zuletzt"));
  it("ein fehlgeschlagener Scan stuft nicht herab", () => expect(webSeenState(web(), run(6, "error"), NOW)).toBe("erfasst"));
  it("zu alt", () => expect(webSeenState(web({ last_seen_at: "2026-11-23T17:30:00Z" }), run(5), NOW)).toBe("zuletzt"));
});

it("nur alte reine Webfahrten werden abgeblendet", () => {
  const old = web({ last_seen_at: "2026-11-23T17:00:00Z" });
  expect(isStaleWebOnly(trip({ source: "web_dbf", web: old }), NOW)).toBe(true);
  expect(isStaleWebOnly(trip({ source: "web_dbf" }), NOW)).toBe(false);
  expect(isStaleWebOnly(trip({ web: old }), NOW)).toBe(false);
});

describe("scheduleText", () => {
  const at = Date.parse("2026-11-25T20:00:00Z"); // 21:00 Uhr
  const st = (o: Partial<ScannerSchedule> = {}, enabled = false, worker_online = true) => ({
    enabled, worker_online,
    schedule: { enabled: true, windows: [], keep_awake: true, on: false, window_end: null, next_start: "2026-11-26T03:45:00Z", ...o },
  });
  it("nennt das nächste Einschalten", () => {
    expect(scheduleText(st(), at)).toBe("Schaltet morgen um 04:45 Uhr ein.");
    expect(scheduleText(st({ next_start: "2026-11-25T21:00:00Z" }), at)).toBe("Schaltet heute um 22:00 Uhr ein.");
  });
  it("unterscheidet Zeitplan und Schalter von Hand", () => {
    const end = { window_end: "2026-11-26T00:15:00Z" };
    expect(scheduleText(st({ ...end, on: true }, true), at)).toBe("Vom Zeitplan eingeschaltet, schaltet um 01:15 Uhr aus.");
    expect(scheduleText(st(end, true), at)).toContain("Von Hand eingeschaltet");
    expect(scheduleText(st(end), at)).toContain("von Hand ausgeschaltet");
    expect(scheduleText(st(end, false, false), at)).toContain("Worker ist offline");
  });
  it("ausgeschaltet", () => expect(scheduleText(st({ enabled: false }), at)).toContain("festen Uhrzeiten"));
});
