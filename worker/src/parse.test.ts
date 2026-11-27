import { describe, expect, it } from "vitest";
import { inWindow, parseDelay, parseFormation, resolveTime, toBoardRecord, type RawBoardRow } from "./parse.ts";
import { isAllowed, parseRobots } from "./robots.ts";
import { onlyDocument } from "./sites.ts";

const NOW = Date.parse("2026-11-23T17:55:00Z"); // 18:55 Ortszeit

const row = (o: Partial<RawBoardRow> = {}): RawBoardRow => ({
  train: "S 7156", line: "S S1", no: "7156", linetype: "sbahn", from: "Herrenberg", to: "Kirchheim(Teck)", platform: "102",
  arrival: "18:55", departure: "18:55", routePrev: "Herrenberg|Nufringen", routeNext: "Plochingen|Kirchheim(Teck)",
  timeClass: "time a-bit-delayed", timeText: "\n 18:55 ⇒\n18:59 ", info: null, cancelled: false, ...o,
});

describe("resolveTime", () => {
  it("nimmt Ortszeit", () => expect(resolveTime("18:55", NOW)!.toISOString()).toBe("2026-11-23T17:55:00.000Z"));
  it("springt über Mitternacht", () => {
    expect(resolveTime("00:05", Date.parse("2026-11-23T22:50:00Z"))!.toISOString()).toBe("2026-11-23T23:05:00.000Z");
    expect(resolveTime("23:58", Date.parse("2026-11-23T23:10:00Z"))!.toISOString()).toBe("2026-11-23T22:58:00.000Z");
  });
  it("Sommerzeit und Zeitumstellung", () => {
    expect(resolveTime("12:00", Date.parse("2026-07-01T10:30:00Z"))!.toISOString()).toBe("2026-07-01T10:00:00.000Z");
    expect(resolveTime("08:00", Date.parse("2026-10-25T05:00:00Z"))!.toISOString()).toBe("2026-10-25T07:00:00.000Z");
  });
  it("Unsinn ergibt null", () => ["", null, "25:00", "abc"].forEach((v) => expect(resolveTime(v, NOW)).toBeNull()));
});

describe("parseDelay", () => {
  it("liest Verspätung", () => expect(parseDelay("time delayed", "18:54 ⇒ 18:59")).toBe(5));
  it("über Mitternacht", () => expect(parseDelay("time delayed", "23:58 ⇒ 00:03")).toBe(5));
  it("pünktlich nur bei ausgewiesener Echtzeit", () => {
    expect(parseDelay("time on-time", "18:59")).toBe(0);
    expect(parseDelay("time ", "19:33")).toBeNull();
  });
});

describe("toBoardRecord", () => {
  it("übernimmt sichtbare Werte", () => {
    const r = toBoardRecord(row(), "Stuttgart Hbf (tief)", NOW)!;
    expect(r).toMatchObject({ train_number: "7156", line: "S1", delay_min: 4, platform: "102", origin: "Herrenberg" });
    expect(r.route).toEqual(["Herrenberg", "Nufringen", "Stuttgart Hbf (tief)", "Plochingen", "Kirchheim(Teck)"]);
  });
  it("erfindet nichts", () => {
    const r = toBoardRecord(row({ platform: "", timeClass: "time ", timeText: "18:55", line: "?" }), "X", NOW)!;
    expect(r).toMatchObject({ platform: null, delay_min: null, line: null });
  });
  it("Ausfall ohne Verspätung und ohne Route", () =>
    expect(toBoardRecord(row({ cancelled: true, timeClass: "time on-time", timeText: "18:55" }), "X", NOW)).toMatchObject({ delay_min: null, route: [] }));
  it("ignoriert andere Züge", () => {
    expect(toBoardRecord(row({ linetype: "fern" }), "X", NOW)).toBeNull();
    expect(toBoardRecord(row({ no: "" }), "X", NOW)).toBeNull();
    expect(toBoardRecord(row({ arrival: "", departure: "" }), "X", NOW)).toBeNull();
  });
  it("Zeitfenster", () => {
    expect(inWindow(toBoardRecord(row(), "X", NOW)!, NOW)).toBe(true);
    expect(inWindow(toBoardRecord(row({ arrival: "21:55", departure: "21:55", timeText: "21:55" }), "X", NOW)!, NOW)).toBe(false);
  });
});

describe("parseFormation", () => {
  const unit = (t: string[], br: string, name: string) => ["ABDp", t[0], "Bp", t[1], "Bp", t[2], "ABDp", t[3], br, name];
  it("liest mehrere Einheiten in Anzeigereihenfolge", () => {
    const u = parseFormation(["S 7661", "20:12", "101", "D", "C",
      ...unit(["0423 309", "0433 309", "0433 809", "0423 809"], "BR423", "T0423309"),
      ...unit(["0423 810", "0433 810", "0433 310", "0423 310"], "BR423", "T0423310"), "Legende"]);
    expect(u.map((x) => x.unit)).toEqual(["423 309", "423 310"]);
    expect(u[1].cars).toEqual(["423 810", "433 810", "433 310", "423 310"]);
  });
  it("ohne Einheitsnummer keine Einheit", () => expect(parseFormation(["ABDp", "0423 309", "BR423", "Legende"])).toEqual([]));
  it("verwirft unpassende Einheitsnummer", () => expect(parseFormation(["0423 309", "BR423", "T0423111"])).toEqual([]));
  it("leer bei fehlender Wagenreihung", () => expect(parseFormation(["S 7661", "20:12"])).toEqual([]));
});

describe("robots", () => {
  const r = parseRobots("User-agent: *\nDisallow: /map/\nDisallow: /z/\nCrawl-delay: 20\n\nUser-agent: Foo\nDisallow: /");
  it("beachtet Regeln und Abstand", () => {
    expect(r.crawlDelaySec).toBe(20);
    expect(isAllowed(r, "/Stuttgart%20Hbf%20(tief)?past=1")).toBe(true);
    expect(isAllowed(r, "/z/S%207156")).toBe(false);
    expect(isAllowed(r, "/map/123")).toBe(false);
    expect(isAllowed(r, "/Stuttgart-Feuerbach?past=1")).toBe(true);
  });
  it("lädt bei DBF nur die Seite selbst, keine Nebenanfragen", () => {
    const u = "https://dbf.finalrewind.org/Stuttgart%20Hbf%20(tief)?past=1";
    expect(onlyDocument("document", u, u)).toBe(true);
    expect(onlyDocument("script", "https://dbf.finalrewind.org/static/v110/js/dbf.min.js", u)).toBe(false);
    expect(onlyDocument("stylesheet", "https://dbf.finalrewind.org/static/v110/css/light.min.css", u)).toBe(false);
    expect(onlyDocument("document", "https://dbf.finalrewind.org/z/S%207156", u)).toBe(false);
  });
  it("Allow: *", () => expect(isAllowed(parseRobots("User-agent: *\nAllow: *"), "/x")).toBe(true));
  it("Komplettsperre", () => expect(isAllowed(parseRobots("User-agent: *\nDisallow: /"), "/x")).toBe(false));
});
