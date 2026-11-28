import { describe, expect, it } from "vitest";
import type { StablingEntry } from "./stabling";
import {
  assignLanes,
  dayRange,
  drawEnd,
  findRelations,
  nightSpan,
  notesInRange,
  notesOn,
  recurringSlots,
  slotLabel,
  segmentsIn,
  stationChains,
  stayDuration,
  staysAtNote,
  toStays,
  vehicleRuns,
  weekdayOf,
  weekNights,
  type StationNote,
} from "./stablingModel";

const T = (d: number, hm: string) => `2026-11-${d}T${hm}:00+01:00`;
const at = (d: number, hm: string) => Date.parse(T(d, hm));
let n = 0;
const E = (station: string, arr: string, dep: string | null, vehicles: string[], o: Partial<StablingEntry> = {}): StablingEntry => ({
  station_id: station, station_name: station, service_date: arr.slice(0, 10), line_id: "S1", train_number: String(7100 + n++), origin_name: "Herrenberg",
  arrived_at: arr, arr_platform: "2", vehicles, cars: vehicles.length * 4, departed_at: dep, dep_platform: null, dep_line_id: null, dep_train_number: null,
  dep_destination: null, seen_again_at: dep, seen_again_station: dep ? station : null, confidence: 0.8, state: dep ? "departed" : "open", ...o,
});
const NOW = at(28, "12:00");
const segs = (list: StablingEntry[], r: [number, number]) => segmentsIn(toStays(list), r, NOW);
const span = (s: { from: number; to: number }) => [new Date(s.from).toISOString(), new Date(s.to).toISOString()];

describe("Abstellungen in Tag, Nacht und Woche", () => {
  it("Fall 1: Mi 22:00 bis Do 01:00 erscheint am Mittwoch, in der Nacht Mi → Do und am Donnerstag", () => {
    const e = [E("Plochingen", T(25, "22:00"), T(26, "01:00"), ["430 101"])];
    expect(segs(e, dayRange("2026-11-25")).map(span)).toEqual([[T(25, "22:00"), T(26, "00:00")].map((x) => new Date(x).toISOString())]);
    expect(segs(e, dayRange("2026-11-26")).map(span)).toEqual([[T(26, "00:00"), T(26, "01:00")].map((x) => new Date(x).toISOString())]);
    const night = segs(e, [nightSpan("2026-11-25").from, nightSpan("2026-11-25").to]);
    expect(night).toHaveLength(1);
    expect(night[0].from).toBe(at(26, "00:00"));
    expect(night[0].to).toBe(at(26, "01:00"));
    expect(night[0].clipStart).toBe(true);
    // nicht in der Nacht Di → Mi
    expect(segs(e, [nightSpan("2026-11-24").from, nightSpan("2026-11-24").to])).toHaveLength(0);
  });

  it("Fall 2: Do 01:00 bis 05:00 liegt vollständig in der Nacht Mi → Do und am Donnerstag", () => {
    const e = [E("Backnang", T(26, "01:00"), T(26, "05:00"), ["430 102"])];
    const n = nightSpan("2026-11-25");
    expect([n.evening, n.morning]).toEqual(["2026-11-25", "2026-11-26"]);
    const s = segs(e, [n.from, n.to]);
    expect(s).toHaveLength(1);
    expect([s[0].from, s[0].to, s[0].clipStart, s[0].clipEnd]).toEqual([at(26, "01:00"), at(26, "05:00"), false, false]);
    expect(segs(e, dayRange("2026-11-26"))).toHaveLength(1);
    expect(segs(e, dayRange("2026-11-25"))).toHaveLength(0);
  });

  it("Nachtfenster ist einstellbar, auch ab dem Vorabend", () => {
    const n = nightSpan("2026-11-25", -2, 8);
    expect(n.from).toBe(at(25, "22:00"));
    expect(n.to).toBe(at(26, "08:00"));
    const nights = weekNights("2026-11-23");
    expect(nights.map((x) => `${x.evening}>${x.morning}`)).toEqual([
      "2026-11-23>2026-11-24", "2026-11-24>2026-11-25", "2026-11-25>2026-11-26", "2026-11-26>2026-11-27",
      "2026-11-27>2026-11-28", "2026-11-28>2026-11-29", "2026-11-29>2026-11-30",
    ]);
  });

  it("Fall 3: Freitagabend bis Samstagmorgen wird an der Tagesgrenze geteilt", () => {
    const e = [E("Herrenberg", T(27, "21:30"), T(28, "06:10"), ["423 201"])];
    expect(segs(e, dayRange("2026-11-27"))[0].clipEnd).toBe(true);
    expect(segs(e, dayRange("2026-11-28"))[0].to).toBe(at(28, "06:10"));
    const night = segs(e, [nightSpan("2026-11-27").from, nightSpan("2026-11-27").to]);
    expect([night[0].from, night[0].to, night[0].clipEnd]).toEqual([at(28, "00:00"), at(28, "06:00"), true]);
  });

  it("Fall 4: mehrere Tage am selben Standort – jeder Tag dazwischen voll belegt", () => {
    const e = [E("Kirchheim", T(23, "10:00"), T(25, "08:00"), ["430 103"])];
    const tue = segs(e, dayRange("2026-11-24"))[0];
    expect([tue.from, tue.to, tue.clipStart, tue.clipEnd]).toEqual([at(24, "00:00"), at(25, "00:00"), true, true]);
    expect(stayDuration(toStays(e)[0], NOW)).toEqual({ ms: 46 * 3_600_000, kind: "exact" });
  });

  it("Fall 5: mehrere gleichzeitig am selben Standort bekommen eigene Spuren", () => {
    const e = [
      E("Plochingen", T(23, "08:00"), T(23, "11:00"), ["430 104"]),
      E("Plochingen", T(23, "10:00"), T(23, "14:00"), ["430 105"]),
      E("Plochingen", T(23, "10:30"), T(23, "12:00"), ["430 106"]),
      E("Plochingen", T(23, "15:00"), T(23, "16:00"), ["430 107"]),
    ];
    const s = segs(e, dayRange("2026-11-23"));
    const lanes = assignLanes(s);
    const l = (v: string) => lanes.get(s.find((x) => x.stay.vehicles[0] === v)!.stay.key)!;
    expect(new Set(["430 104", "430 105", "430 106"].map((v) => l(v).lane)).size).toBe(3);
    expect(l("430 104").lanes).toBe(3);
    expect(l("430 107")).toEqual({ lane: 0, lanes: 1 });
  });

  it("Zeitumstellung: Tag mit 25 Stunden, Nacht bleibt richtig zugeordnet", () => {
    const [a, b] = dayRange("2026-10-25");
    expect((b - a) / 3_600_000).toBe(25);
    expect(nightSpan("2026-10-24").from).toBe(Date.parse("2026-10-24T22:00:00Z"));
  });
});

describe("Zusammenhänge nur aus Abstellzeiten", () => {
  const mon = [
    E("Plochingen", T(23, "08:00"), T(23, "11:00"), ["430 104"], { train_number: "7001" }),
    E("Plochingen", T(23, "10:00"), T(23, "14:00"), ["430 105"]),
    E("Plochingen", T(23, "14:12"), T(23, "16:40"), ["430 107"]),
    E("Plochingen", T(24, "08:05"), T(24, "10:30"), ["430 108"], { train_number: "7001" }),
    E("Backnang", T(23, "10:15"), T(23, "12:00"), ["430 300"]),
  ];

  it("Fall 6: tatsächliche Überschneidung 10:00–11:00 ist Kategorie A", () => {
    const r = findRelations(toStays(mon), 30, NOW);
    const a = r.find((x) => x.category === "A")!;
    expect([a.a.vehicles[0], a.b.vehicles[0]]).toEqual(["430 104", "430 105"]);
    expect([a.from, a.to]).toEqual([at(23, "10:00"), at(23, "11:00")]);
    expect(a.certainty).toBe("sicher");
  });

  it("Fall 7: 12 min nach der Abfahrt ist Kategorie B, mit Fenster 15/30, nicht mit 10", () => {
    const b = findRelations(toStays(mon), 15, NOW).filter((x) => x.category === "B");
    expect(b).toHaveLength(1);
    expect([b[0].a.vehicles[0], b[0].b.vehicles[0], b[0].gapMin, b[0].kind]).toEqual(["430 105", "430 107", 12, "follow"]);
    expect(findRelations(toStays(mon), 10, NOW).filter((x) => x.category === "B")).toHaveLength(0);
  });

  it("Fall 8: selber Standort an einem anderen Tag ist kein Zusammenhang und keine Wiederholung", () => {
    const r = findRelations(toStays(mon), 60, NOW);
    expect(r.some((x) => x.a.vehicles.includes("430 108") || x.b.vehicles.includes("430 108"))).toBe(false);
    // Mo 08:00 und Di 08:05 liegen in derselben Woche → zählt nicht als Woche für Woche
    expect(recurringSlots(toStays(mon), 60).slots).toHaveLength(0);
  });

  it("andere Standorte werden nie über die Zeit verknüpft", () => {
    const r = findRelations(toStays(mon), 60, NOW);
    expect(r.some((x) => x.a.station !== x.b.station)).toBe(false);
  });

  it("Abstellfolgen: zusammenhängende Gruppe am Standort", () => {
    const c = stationChains(findRelations(toStays(mon), 30, NOW));
    expect(c).toHaveLength(1);
    expect(c[0].stays.map((s) => s.vehicles[0])).toEqual(["430 104", "430 105", "430 107"]);
    expect(c[0].links.map((l) => l.category).sort()).toEqual(["A", "B"]);
  });

  it("Fall 9: unbekanntes Ende wird nicht erfunden und gibt nur einen möglichen Zusammenhang", () => {
    const e = [
      E("Filderstadt", T(27, "20:00"), null, ["423 301"], { state: "unconfirmed" }),
      E("Filderstadt", T(27, "22:00"), T(27, "23:00"), ["423 302"]),
    ];
    const [u] = toStays(e);
    expect(u.end).toBeNull();
    expect(u.endKind).toBe("unknown");
    expect(stayDuration(u, NOW)).toEqual({ ms: null, kind: "unknown" });
    // gezeichnet höchstens bis jetzt, gekennzeichnet als offen
    expect(drawEnd(u, NOW)).toBe(NOW);
    expect(segs(e, dayRange("2026-11-27")).find((s) => s.stay.key === u.key)!.openEnd).toBe(true);
    const r = findRelations(toStays(e), 30, NOW);
    expect(r).toHaveLength(1);
    expect([r[0].category, r[0].kind, r[0].certainty]).toEqual(["B", "possible_overlap", "möglich"]);
  });

  it("steht noch: Überschneidung bis jetzt ist belegt", () => {
    const e = [
      E("Backnang", T(28, "00:40"), null, ["430 109"], { state: "open" }),
      E("Backnang", T(28, "02:00"), T(28, "05:00"), ["430 110"]),
    ];
    const r = findRelations(toStays(e), 30, NOW);
    expect([r[0].category, r[0].certainty, r[0].to]).toEqual(["A", "wahrscheinlich", at(28, "05:00")]);
  });

  it("Fall 10: markiertes Fahrzeug mit neuer Abstellung – Umlauf über die Fahrzeugnummer", () => {
    const e = [
      E("Plochingen", T(25, "22:00"), T(26, "01:00"), ["430 101"]),
      E("Kirchheim", T(27, "18:40"), T(27, "23:10"), ["430 101"]),
    ];
    const before = vehicleRuns(toStays(e.slice(0, 1)));
    expect(before).toHaveLength(0);
    const runs = vehicleRuns(toStays(e));
    expect(runs[0].vehicle).toBe("430 101");
    expect(runs[0].stays.map((s) => s.stationName)).toEqual(["Plochingen", "Kirchheim"]);
    expect(runs[0].hops[0].transfer).toBe(false);
  });

  it("Überführung: alte und neue Zeile sind eine Kette, keine Überschneidung", () => {
    const e = [
      E("Backnang", T(24, "00:19"), null, ["430 077"], { state: "seen_again", seen_again_at: T(24, "11:31"), seen_again_station: "Vaihingen", transfer_to: "Vaihingen" }),
      E("Vaihingen", T(24, "00:19"), T(24, "11:31"), ["430 077"], { transfer_from: "Backnang", seen_again_at: null, seen_again_station: null }),
    ];
    const runs = vehicleRuns(toStays(e));
    expect(runs[0].stays.map((s) => s.stationName)).toEqual(["Backnang", "Vaihingen"]);
    expect(runs[0].hops[0].transfer).toBe(true);
    expect(toStays(e)[1].startKind).toBe("lower");
    expect(stayDuration(toStays(e)[1], NOW).kind).toBe("max");
  });
});

describe("Notizen und Datenbasis", () => {
  const notes: StationNote[] = [
    { id: 1, station_id: "Plochingen", station_name: "Plochingen", weekday: 1, time_from: "08:00", time_to: "09:00", text: "Putzer", updated_at: "" },
    { id: 2, station_id: "Backnang", station_name: "Backnang", weekday: 4, time_from: "23:30", time_to: "01:00", text: "Rangieren", updated_at: "" },
    { id: 3, station_id: "Backnang", station_name: "Backnang", weekday: 4, time_from: null, time_to: null, text: "ganztägig", updated_at: "" },
  ];

  it("Fall 11: Notiz überschneidet sich mit einer Abstellung", () => {
    const stays = toStays([E("Plochingen", T(23, "08:00"), T(23, "11:00"), ["430 104"]), E("Plochingen", T(23, "09:30"), T(23, "10:00"), ["430 105"])]);
    expect(weekdayOf("2026-11-23")).toBe(1);
    const [n1] = notesOn(notes, "2026-11-23");
    expect([n1.at, n1.until]).toEqual([at(23, "08:00"), at(23, "09:00")]);
    expect(staysAtNote(stays, n1, NOW).map((s) => s.vehicles[0])).toEqual(["430 104"]);
  });

  it("Notiz über Mitternacht und ganztägige Notiz", () => {
    const on = notesOn(notes, "2026-11-26");
    expect(on.map((x) => x.note.id)).toEqual([3, 2]);
    expect(on[1].until).toBe(at(27, "01:00"));
    // erscheint in der Nacht Do → Fr (00–06) und, ab 22 Uhr, schon vorher
    expect(notesInRange(notes, [nightSpan("2026-11-26").from, nightSpan("2026-11-26").to]).map((x) => x.note.id)).toEqual([2]);
    expect(notesInRange(notes, [nightSpan("2026-11-25").from, nightSpan("2026-11-25").to])).toHaveLength(0);
  });

  it("Fall 12: eine Abstellung in mehreren Ansichten und doppelt geladen bleibt ein Objekt", () => {
    const e = E("Plochingen", T(25, "22:00"), T(26, "01:00"), ["430 101"]);
    const stays = toStays([e, { ...e }, e]);
    expect(stays).toHaveLength(1);
    const wed = segmentsIn(stays, dayRange("2026-11-25"), NOW)[0];
    const thu = segmentsIn(stays, dayRange("2026-11-26"), NOW)[0];
    const night = segmentsIn(stays, [nightSpan("2026-11-25").from, nightSpan("2026-11-25").to], NOW)[0];
    expect(wed.stay).toBe(thu.stay);
    expect(night.stay).toBe(stays[0]);
    expect(new Set([wed, thu, night].map((s) => s.stay.key)).size).toBe(1);
  });
});

describe("Wiederkehrend Woche für Woche", () => {
  const Z = (iso: string) => `${iso}:00+01:00`;
  const hb = (iso: string, v: string, station = "Herrenberg") => E(station, Z(iso), null, [v], { state: "departed" });
  // Herrenberg, montags gegen 23:40, jedes Mal ein anderes Fahrzeug und ein anderer Zug
  const weeks = [hb("2026-11-23T23:35", "423 001"), hb("2026-11-30T23:50", "423 002"), hb("2026-12-07T23:41", "430 003")];

  it("gleicher Ort, gleicher Wochentag, ähnliche Uhrzeit in drei Wochen ergibt ein Zeitfenster", () => {
    const { slots, byStay } = recurringSlots(toStays(weeks), 30);
    expect(slots).toHaveLength(1);
    expect(slots[0].stationName).toBe("Herrenberg");
    expect(slots[0].weeks).toEqual(["2026-11-23", "2026-11-30", "2026-12-07"]);
    expect(slotLabel(slots[0])).toBe("Mo ca. 23:41 (23:35–23:50)");
    expect(byStay.size).toBe(3);
  });

  it("Zug- und Fahrzeugnummer spielen keine Rolle, der Abstellort schon", () => {
    const other = [hb("2026-11-23T23:35", "423 001"), hb("2026-11-30T23:40", "423 002", "Backnang")];
    expect(recurringSlots(toStays(other), 60).slots).toHaveLength(0);
  });

  it("die Toleranz entscheidet, was als ähnliche Uhrzeit gilt", () => {
    const far = [hb("2026-11-23T22:30", "423 001"), hb("2026-11-30T23:50", "423 002")];
    expect(recurringSlots(toStays(far), 30).slots).toHaveLength(0);
    expect(recurringSlots(toStays(far), 60).slots).toHaveLength(1);
  });

  it("gezählt werden verschiedene Wochen, nicht Abstellungen", () => {
    const twice = [hb("2026-11-23T23:35", "423 001"), hb("2026-11-23T23:45", "423 002"), hb("2026-11-30T23:40", "423 003")];
    expect(recurringSlots(toStays(twice), 30, 3).slots).toHaveLength(0);
    const sl = recurringSlots(toStays(twice), 30, 2).slots;
    expect(sl).toHaveLength(1);
    expect(sl[0].weeks).toHaveLength(2);
    expect(sl[0].stays).toHaveLength(3);
  });

  it("anderer Wochentag zur gleichen Uhrzeit zählt nicht", () => {
    const wd = [hb("2026-11-23T23:35", "423 001"), hb("2026-12-01T23:35", "423 002")];
    expect(recurringSlots(toStays(wd), 120).slots).toHaveLength(0);
  });
});
