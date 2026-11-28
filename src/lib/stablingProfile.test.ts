import { describe, expect, it } from "vitest";
import type { StablingEntry } from "./stabling";
import { toStays } from "./stablingModel";
import { buildProfile, clockSpread, hhmm, searchables, spreadText, suggest, tipWindowText, visitTips, type Target } from "./stablingProfile";

const Z = (iso: string) => `${iso}:00+01:00`;
let n = 0;
const E = (station: string, arr: string, dep: string | null, vehicles: string[], o: Partial<StablingEntry> = {}): StablingEntry => ({
  station_id: station, station_name: station, service_date: arr.slice(0, 10), line_id: "S1", train_number: String(7100 + n++), origin_name: "Herrenberg",
  arrived_at: Z(arr), arr_platform: "2", vehicles, cars: 4, departed_at: dep && Z(dep), dep_platform: null, dep_line_id: null, dep_train_number: null,
  dep_destination: null, seen_again_at: dep && Z(dep), seen_again_station: dep ? station : null, confidence: 0.8, state: dep ? "departed" : "open", ...o,
});
const NOW = Date.parse(Z("2026-12-20T12:00"));
const V: Target = { kind: "fahrzeug", id: "430 101", label: "430 101" };

// Beispiel aus der Aufgabe: Mo–Do vormittags rund 4 h in Plochingen, Fr kurz
const week = [
  E("Plochingen", "2026-12-14T08:15", "2026-12-14T12:30", ["430 101"]),
  E("Plochingen", "2026-12-15T08:05", "2026-12-15T12:45", ["430 101"]),
  E("Plochingen", "2026-12-16T08:20", "2026-12-16T12:15", ["430 101"]),
  E("Plochingen", "2026-12-17T08:10", "2026-12-17T12:40", ["430 101"]),
  E("Plochingen", "2026-12-18T10:30", "2026-12-18T11:15", ["430 101"]),
  E("Backnang", "2026-12-18T22:00", "2026-12-19T05:00", ["430 202"]),
];

describe("Suche", () => {
  const all = searchables(toStays(week));
  it("findet Fahrzeuge in jeder Schreibweise", () => {
    for (const q of ["430 101", "430101", "101", "431 601"]) expect(suggest(all, q)[0]).toMatchObject({ kind: "fahrzeug", id: "430 101" });
  });
  it("findet Standorte über Namensteile und Zugnummern", () => {
    expect(suggest(all, "ploch")[0]).toMatchObject({ kind: "ort", id: "Plochingen" });
    const z = week[0].train_number;
    expect(suggest(all, `S1 ${z}`)[0]).toMatchObject({ kind: "zug", id: z });
  });
});

describe("Uhrzeiten", () => {
  it("Nachtzeiten über Mitternacht bleiben zusammen", () => {
    const c = clockSpread([23 * 60 + 50, 10, 23 * 60 + 40, 20])!;
    expect(hhmm(c.median)).toBe("00:00");
    expect(spreadText(c)).toBe("zwischen 23:48 und 00:13 Uhr");
  });
});

describe("Profil eines Fahrzeugs", () => {
  const p = buildProfile(toStays(week), V, NOW, 7);
  it("zählt, mittelt und zeigt das Typische", () => {
    expect(p.counts).toEqual({ 7: 5, 14: 5, 30: 5 });
    expect(p.stays[0].entry.arrived_at).toContain("2026-12-18T10:30");
    expect(spreadText(p.start!)).toBe("zwischen 08:10 und 08:20 Uhr");
    expect(p.durationBasis).toBe(5);
    expect(p.places).toEqual([{ id: "Plochingen", name: "Plochingen", count: 5 }]);
    expect(p.weekdays.map((w) => w.count)).toEqual([1, 1, 1, 1, 1, 0, 0]);
  });
  it("hebt den Freitag als Abweichung hervor", () => {
    expect([...p.deviations.values()]).toEqual(["ungewöhnliche Uhrzeit (sonst gegen 08:15)"]);
  });
  it("ein Einzelfall ist nur „zu wenig Daten“", () => {
    const tips = visitTips(p, NOW);
    expect(tips.every((t) => t.level === "zu wenig Daten")).toBe(true);
  });
});

describe("Besuchstipp über mehrere Wochen", () => {
  // Mittwoch abends in Herrenberg, 3 der 4 Mittwoche seit Aufzeichnungsbeginn, einmal Abholung unbekannt
  const w = [
    E("Herrenberg", "2026-12-02T22:10", "2026-12-03T05:00", ["423 001"]),
    E("Herrenberg", "2026-12-09T22:20", "2026-12-10T05:10", ["423 001"]),
    E("Herrenberg", "2026-12-16T22:15", null, ["423 001"], { state: "unconfirmed" }),
  ];
  const T: Target = { kind: "fahrzeug", id: "423 001", label: "423 001" };
  it("nennt Wochentag, Ort und Fenster und sagt, wie oft es zutraf", () => {
    const p = buildProfile(toStays(w), T, NOW, 30);
    const [t] = visitTips(p, NOW);
    expect([t.stationName, t.wd, t.seen, t.of, t.level]).toEqual(["Herrenberg", 3, 3, 4, "mittel"]);
    // unbekannte Abholung: nur der Ankunftszeitpunkt zählt, daher nur „gegen“ die späteste Ankunft
    expect(tipWindowText(t)).toBe("Mittwoch gegen 22:20 Uhr");
    expect(p.durationBasis).toBe(2);
  });
  it("ohne den unsicheren Eintrag: gemeinsames Fenster bis zum Morgen", () => {
    const p = buildProfile(toStays(w.slice(0, 2)), T, NOW, 30);
    const [t] = visitTips(p, NOW);
    expect(tipWindowText(t)).toBe("Mittwoch 22:20–05:00 Uhr (bis Donnerstag früh)");
    expect([t.seen, t.of, t.level]).toEqual([2, 4, "schwach"]);
  });
  it("zählt nur ab Aufzeichnungsbeginn", () => {
    const p = buildProfile(toStays(w), T, Date.parse(Z("2026-11-30T12:00")), 30);
    expect(p.clipped).toBe(true);
    expect(new Date(p.from).toISOString()).toBe("2026-11-22T23:00:00.000Z");
  });
});

describe("Profil eines Standorts", () => {
  it("zählt je Stunde die Tage, an denen dort nachweislich ein Zug stand", () => {
    const p = buildProfile(toStays(week), { kind: "ort", id: "Backnang", label: "Backnang" }, NOW, 7);
    expect(p.hours[22]).toBe(1);
    expect(p.hours[3]).toBe(1);
    expect(p.hours[12]).toBe(0);
    expect(p.vehicles).toEqual([{ id: "430 202", count: 1 }]);
  });
});

describe("Besuchstipps zusammenfassen", () => {
  it("Mo–Do vormittags in Plochingen wird ein Tipp", async () => {
    const { groupTips, groupWindowText } = await import("./stablingProfile");
    const list: StablingEntry[] = [];
    for (const w of [0, 7]) for (let d = 0; d < 4; d++) list.push(E("Plochingen", `2026-12-${String(7 + w + d).padStart(2, "0")}T08:1${d}`, `2026-12-${String(7 + w + d).padStart(2, "0")}T12:3${d}`, ["430 101"]));
    const p = buildProfile(toStays(list), V, NOW, 30);
    const g = groupTips(visitTips(p, NOW));
    expect(g).toHaveLength(1);
    expect(groupWindowText(g[0])).toBe("Mo–Do 08:13–12:30 Uhr");
    expect([g[0].seen, g[0].of, g[0].level]).toEqual([8, 16, "schwach"]);
  });
});
