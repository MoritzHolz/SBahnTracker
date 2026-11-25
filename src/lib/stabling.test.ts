import { describe, expect, it } from "vitest";
import { addDays, chronicle, daySegments, dayStart, FIRST_WEEK, fmtDay, fmtStay, groupByStation, LIVE_FROM, stayText, weekDays, weekLabel, weekNumber, weekOf, type StablingEntry } from "./stabling";

const e = (o: Partial<StablingEntry>): StablingEntry => ({
  station_id: "b", station_name: "Backnang", service_date: "2026-11-25", line_id: "S3", train_number: "7301", origin_name: "Vaihingen",
  arrived_at: "2026-11-25T22:30:00Z", arr_platform: "1", vehicles: ["430 001"], cars: 4, departed_at: "2026-11-26T04:10:00Z", dep_platform: "1",
  dep_line_id: "S3", dep_train_number: "7302", dep_destination: "Vaihingen", seen_again_at: "2026-11-26T04:10:00Z", seen_again_station: "Backnang",
  confidence: 0.9, state: "departed", ...o,
});

describe("Abstellprotokoll", () => {
  it("rechnet Wochen von Montag bis Sonntag", () => {
    expect(weekOf("2026-11-25")).toBe(FIRST_WEEK);
    expect(weekOf("2026-11-29")).toBe("2026-11-23");
    expect(weekOf("2026-11-30")).toBe("2026-11-30");
    expect(weekDays("2026-11-23").at(-1)).toBe("2026-11-29");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(fmtDay(LIVE_FROM)).toBe("Mi 25.11.");
  });

  it("zählt Kalenderwochen nach ISO, auch über den Jahreswechsel", () => {
    expect(weekLabel("2026-11-23")).toBe("KW 48 · 23.11.–29.11.2026");
    expect(weekNumber("2026-12-28")).toBe(53);
    expect(weekNumber("2027-01-04")).toBe(1);
    expect(weekLabel("2026-12-28")).toBe("KW 53 · 28.12.–03.01.2027");
    expect(weekNumber("2025-12-29")).toBe(1);
  });

  it("kennt Mitternacht in Sommer- und Winterzeit", () => {
    expect(new Date(dayStart("2026-11-25")).toISOString()).toBe("2026-11-24T23:00:00.000Z");
    expect(new Date(dayStart("2026-07-01")).toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });

  it("zeigt die Standzeit über Mitternacht und nur belegte Dauern", () => {
    const now = Date.parse("2026-11-26T01:00:00Z");
    expect(stayText(e({}), now)).toBe("5 h 40 min");
    expect(stayText(e({ departed_at: null, state: "seen_again" }), now)).toBe("höchstens 5 h 40 min");
    expect(stayText(e({ departed_at: null, seen_again_at: null, state: "open" }), now)).toBe("bisher 2 h 30 min");
    expect(stayText(e({ departed_at: null, seen_again_at: null, state: "unconfirmed" }), now)).toBe("unbekannt");
    expect(fmtStay(47 * 3_600_000)).toBe("47 h");
    expect(fmtStay(50 * 3_600_000)).toBe("2 Tage 2 h");
  });

  it("teilt Balken an der Tagesgrenze", () => {
    const now = Date.parse("2026-11-26T12:00:00Z");
    const [a] = daySegments([e({})], "2026-11-25", now);
    expect([a.from, a.to, a.before, a.after]).toEqual([23.5 / 24, 1, false, true]);
    const [b] = daySegments([e({})], "2026-11-26", now);
    expect(b.from).toBe(0);
    expect(b.to).toBeCloseTo(5 / 24 + 10 / 1440);
    expect([b.before, b.after]).toEqual([true, false]);
    expect(daySegments([e({})], "2026-11-27", now)).toEqual([]);
  });

  it("zeichnet unbestätigte Abstellungen höchstens 48 h", () => {
    const now = Date.parse("2026-12-02T12:00:00Z");
    const open = { departed_at: null, seen_again_at: null };
    expect(daySegments([e({ ...open, state: "unconfirmed" })], "2026-11-30", now)).toEqual([]);
    expect(daySegments([e({ ...open, state: "open" })], "2026-11-30", now)).toHaveLength(1);
  });

  it("sortiert nach Bahnhof und darin nach Zeit", () => {
    const g = groupByStation([
      e({ station_id: "v", station_name: "Vaihingen" }),
      e({ train_number: "2", arrived_at: "2026-11-25T23:00:00Z" }),
      e({ train_number: "1", cars: 8 }),
    ]);
    expect(g.map((x) => [x.name, x.cars, x.entries.map((y) => y.train_number)])).toEqual([
      ["Backnang", 12, ["1", "2"]],
      ["Vaihingen", 4, ["7301"]],
    ]);
  });

  it("listet Ereignisse chronologisch und erfindet keine Abfahrt", () => {
    const c = chronicle([
      e({}),
      e({ train_number: "9", arrived_at: "2026-11-25T21:00:00Z", departed_at: null, seen_again_at: "2026-11-26T07:00:00Z", state: "seen_again" }),
      e({ train_number: "8", arrived_at: "2026-11-25T21:30:00Z", departed_at: null, seen_again_at: null, state: "open" }),
    ]);
    expect(c.map((x) => `${x.entry.train_number}:${x.kind}`)).toEqual(["9:in", "8:in", "7301:in", "7301:out", "9:seen"]);
  });
});
