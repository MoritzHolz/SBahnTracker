import { describe, expect, it } from "vitest";
import type { LiveTrip, RouteShape, TripStop } from "./api";
import { Polyline, haversineM, type LngLat } from "./geo";
import {
  buildTrack,
  computeTripPosition,
  deriveTimes,
  easeTrain,
  effectiveTimes,
  positionQuality,
  projectStops,
  smoothDistance,
  TrackCache,
  trainLengthM,
} from "./position";

/* Test-Fixtures (nur in Tests): drei Halte auf einer West-Ost-Linie. */
const T0 = Date.parse("2026-11-23T10:00:00Z");
const iso = (offsetMin: number) => new Date(T0 + offsetMin * 60_000).toISOString();

function stop(seq: number, lon: number, arrMin: number | null, depMin: number | null, extra: Partial<TripStop> = {}): TripStop {
  return {
    seq,
    station_id: `st${seq}`,
    station_name: `Halt ${seq}`,
    lat: 48.78,
    lon,
    platform: "1",
    planned_platform: "1",
    arr_planned: arrMin == null ? null : iso(arrMin),
    arr_est: null,
    dep_planned: depMin == null ? null : iso(depMin),
    dep_est: null,
    cancelled: false,
    ...extra,
  };
}

function trip(stops: TripStop[], extra: Partial<LiveTrip> = {}): LiveTrip {
  return {
    id: "trip-1",
    line_id: "S1",
    train_number: "7143",
    trip_code: null,
    origin_name: "Halt 1",
    destination_name: "Halt 3",
    direction: "H",
    shape_id: 1,
    has_realtime: false,
    cancelled: false,
    updated_at: null,
    source: null,
    stops,
    formation: null,
    ...extra,
  };
}

const shape: RouteShape = {
  id: 1,
  line_id: "S1",
  coords: [
    [9.0, 48.78],
    [9.05, 48.78],
    [9.1, 48.78],
    [9.15, 48.78],
    [9.2, 48.78],
  ],
  stop_ids: null,
  length_m: null,
};

const baseStops = () => [stop(1, 9.0, null, 0), stop(2, 9.1, 10, 11), stop(3, 9.2, 21, null)];

describe("Polyline", () => {
  it("interpoliert Punkte entlang kumulierter Distanzen", () => {
    const line = new Polyline(shape.coords);
    const total = haversineM([9.0, 48.78], [9.2, 48.78]);
    expect(Math.abs(line.length - total) / total).toBeLessThan(0.001);
    const mid = line.pointAt(line.length / 2);
    expect(mid[0]).toBeCloseTo(9.1, 5);
    expect(line.pointAt(-10)).toEqual([9.0, 48.78]);
    expect(line.pointAt(line.length + 10)[0]).toBeCloseTo(9.2, 8);
  });

  it("liefert Bearing ~90° für Ost-Richtung und Slice mit korrekter Länge", () => {
    const line = new Polyline(shape.coords);
    expect(line.bearingAt(1000)).toBeCloseTo(90, 0);
    const sl = line.slice(1000, 1140);
    let len = 0;
    for (let i = 1; i < sl.length; i++) len += haversineM(sl[i - 1], sl[i]);
    expect(len).toBeCloseTo(140, 0);
  });
});

describe("effectiveTimes", () => {
  it("nutzt est vor planned und ergänzt fehlende Ankunft/Abfahrt", () => {
    const s = stop(1, 9, 5, null, { arr_est: iso(7) });
    const t = effectiveTimes(s);
    expect(t.arr).toBe(T0 + 7 * 60_000);
    expect(t.dep).toBe(T0 + 7 * 60_000);
    expect(t.arrIsEst).toBe(true);
  });
});

describe("computeTripPosition – Status", () => {
  const tr = trip(baseStops());
  const track = buildTrack(tr, shape)!;

  it("blendet Züge > 5 min vor Abfahrt aus und zeigt sie davor am Starthalt", () => {
    expect(computeTripPosition(tr, track, T0 - 6 * 60_000)).toBeNull();
    const p = computeTripPosition(tr, track, T0 - 2 * 60_000)!;
    expect(p.phase).toBe("vor_abfahrt");
    expect(p.dist).toBeCloseTo(0, 0);
  });

  it("ist fahrend zwischen Abfahrt und Ankunft und interpoliert", () => {
    const p = computeTripPosition(tr, track, T0 + 5 * 60_000)!;
    expect(p.phase).toBe("fahrend");
    expect(p.lastIdx).toBe(0);
    expect(p.nextIdx).toBe(1);
    const half = track.stopDist[1]! / 2;
    expect(p.dist!).toBeCloseTo(half, 0); // Ease ist symmetrisch → Mitte bleibt Mitte
  });

  it("ist am Halt zwischen Ankunft und Abfahrt", () => {
    const p = computeTripPosition(tr, track, T0 + 10.5 * 60_000)!;
    expect(p.phase).toBe("am_halt");
    expect(p.lastIdx).toBe(1);
    expect(p.dist!).toBeCloseTo(track.stopDist[1]!, 0);
  });

  it("ist angekommen bis 5 min nach Ankunft, danach ausgeblendet", () => {
    const p = computeTripPosition(tr, track, T0 + 23 * 60_000)!;
    expect(p.phase).toBe("angekommen");
    expect(p.nextIdx).toBeNull();
    expect(computeTripPosition(tr, track, T0 + 27 * 60_000)).toBeNull();
  });

  it("verwendet Echtzeit-Schätzungen statt Fahrplan", () => {
    const st = baseStops();
    st[1] = stop(2, 9.1, 10, 11, { arr_est: iso(14), dep_est: iso(15) });
    const t2 = trip(st, { has_realtime: true });
    const p = computeTripPosition(t2, buildTrack(t2, shape), T0 + 12 * 60_000)!;
    expect(p.phase).toBe("fahrend");
    expect(positionQuality(t2)).toBe("echtzeit");
    expect(positionQuality(tr)).toBe("fahrplan");
  });

  it("überspringt ausgefallene Halte und ignoriert ausgefallene Trips", () => {
    const st = baseStops();
    st[1] = { ...st[1], cancelled: true };
    const t2 = trip(st);
    const p = computeTripPosition(t2, buildTrack(t2, shape), T0 + 10.5 * 60_000)!;
    expect(p.phase).toBe("fahrend");
    expect(p.nextIdx).toBe(2);
    expect(computeTripPosition(trip(baseStops(), { cancelled: true }), track, T0 + 5 * 60_000)).toBeNull();
  });

  it("Easing bleibt monoton in [0,1]", () => {
    let prev = -1;
    for (let f = 0; f <= 1.0001; f += 0.05) {
      const e = easeTrain(f);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
    expect(easeTrain(0)).toBe(0);
    expect(easeTrain(1)).toBe(1);
  });
});

describe("Kilometrierung / Monotonie", () => {
  it("dreht eine entgegengesetzt orientierte Shape um", () => {
    const rev: RouteShape = { ...shape, coords: [...shape.coords].reverse() };
    const tr = trip(baseStops());
    const track = buildTrack(tr, rev)!;
    expect(track.approximate).toBe(false);
    expect(track.stopDist[0]!).toBeLessThan(track.stopDist[2]!);
  });

  it("korrigiert nicht-monotone Projektionen lokal", () => {
    // Linie geht nach Osten und kehrt nach Westen zurück (Schleife, versetzt)
    const line = new Polyline([
      [9.0, 48.78],
      [9.2, 48.78],
      [9.2, 48.781],
      [9.0, 48.781],
    ]);
    // Dritter Punkt liegt nahe am Hinweg, gehört aber zum Rückweg
    const pts: LngLat[] = [
      [9.0, 48.78],
      [9.2, 48.7805],
      [9.1, 48.7804],
    ];
    const { dist } = projectStops(line, pts);
    expect(dist[1]!).toBeGreaterThanOrEqual(dist[0]!);
    expect(dist[2]!).toBeGreaterThanOrEqual(dist[1]!);
  });

  it("ordnet Halte auf einer Schleifen-Shape sequentiell zu (Hin- und Rückweg)", () => {
    // Hinweg nach Osten, Wende, Rückweg ~170 m nördlich parallel nach Westen
    const loop: RouteShape = {
      ...shape,
      coords: [
        [9.0, 48.78],
        [9.2, 48.78],
        [9.2, 48.7815],
        [9.0, 48.7815],
      ],
    };
    const st = [
      stop(1, 9.0, null, 0),
      { ...stop(2, 9.1, 5, 6), lat: 48.7809 }, // Hinweg (100 m), Rückweg wäre näher (67 m)
      { ...stop(3, 9.2, 10, 11), lat: 48.7807 }, // Wende
      { ...stop(4, 9.1, 15, 16), lat: 48.7806 }, // Rückweg (100 m), Hinweg wäre näher (67 m)
      { ...stop(5, 9.0, 20, null), lat: 48.7815 },
    ];
    const track = buildTrack(trip(st), loop)!;
    expect(track.approximate).toBe(false);
    const hinweg = new Polyline(loop.coords.slice(0, 2)).length;
    const d = track.stopDist as number[];
    expect(d[1]).toBeLessThan(hinweg); // auf dem Hinweg
    expect(d[3]).toBeGreaterThan(hinweg); // auf dem Rückweg
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1]);
    expect(d[4]).toBeCloseTo(track.line.length, -1);
  });

  it("klemmt auf den Vorgängerwert, wenn keine plausible Projektion existiert", () => {
    const line = new Polyline(shape.coords);
    const { dist } = projectStops(line, [
      [9.1, 48.78],
      [9.05, 48.78], // liegt eindeutig davor
    ]);
    expect(dist[1]).toBe(dist[0]);
  });
});

describe("Fallback ohne Shape", () => {
  it("nutzt Gerade zwischen Halten und markiert als ungenau", () => {
    const tr = trip(baseStops(), { shape_id: null });
    const track = buildTrack(tr, null)!;
    expect(track.approximate).toBe(true);
    expect(track.stopDist[0]).toBe(0);
    expect(track.stopDist[2]!).toBeCloseTo(track.line.length, 6);
    const p = computeTripPosition(tr, track, T0 + 5 * 60_000)!;
    expect(p.phase).toBe("fahrend");
    expect(p.dist!).toBeGreaterThan(0);
  });

  it("verwirft eine Shape, die nicht zu den Halten passt", () => {
    const far: RouteShape = {
      ...shape,
      coords: shape.coords.map(([x, y]) => [x, y + 0.1] as [number, number]),
    };
    const track = buildTrack(trip(baseStops()), far)!;
    expect(track.approximate).toBe(true);
  });

  it("cacht Tracks pro Trip", () => {
    const cache = new TrackCache();
    const tr = trip(baseStops());
    expect(cache.get(tr, shape)).toBe(cache.get(tr, shape));
  });
});

describe("Verspätungsweitergabe", () => {
  it("überträgt die letzte Ist-Verspätung auf Halte ohne Echtzeit – kein Sprung", () => {
    const st = baseStops();
    st[0] = stop(1, 9.0, null, 0, { dep_est: iso(5) }); // +5 an Halt 1
    const t2 = trip(st, { has_realtime: true });
    const times = deriveTimes(t2);
    expect(times[1].arr).toBe(T0 + 15 * 60_000);
    expect(times[1].arrKind).toBe("derived");
    expect(times[1].dep).toBe(T0 + 16 * 60_000);
    const track = buildTrack(t2, shape)!;
    // Zum Planankunftszeitpunkt (10 min) ist der Zug noch unterwegs, nicht am Halt
    const p = computeTripPosition(t2, track, T0 + 10 * 60_000)!;
    expect(p.phase).toBe("fahrend");
    expect(p.dist!).toBeLessThan(track.stopDist[1]!);
    // Kontinuität: kleine Zeitschritte → kleine Ortsänderung
    let prev = computeTripPosition(t2, track, T0 + 4 * 60_000)!.dist!;
    for (let m = 4; m < 30; m += 0.25) {
      const q = computeTripPosition(t2, track, T0 + m * 60_000);
      if (!q || q.dist == null) continue;
      expect(Math.abs(q.dist - prev)).toBeLessThan(300);
      prev = q.dist;
    }
  });

  it("fehlt nur arr_est: arr = min(Plan + Verspätung, dep_est)", () => {
    const st = baseStops();
    st[0] = stop(1, 9.0, null, 0, { dep_est: iso(5) });
    st[1] = stop(2, 9.1, 10, 11, { dep_est: iso(13) });
    const times = deriveTimes(trip(st));
    expect(times[1].arr).toBe(T0 + 13 * 60_000);
    expect(times[1].dep).toBe(T0 + 13 * 60_000);
    // Neue Ist-Verspätung (+2) gilt für den Rest
    expect(times[2].arr).toBe(T0 + 23 * 60_000);
  });

  it("fährt nie vor Plan ab, Verspätung sinkt nur mit Ist-Daten", () => {
    const st = baseStops();
    st[0] = stop(1, 9.0, null, 0, { dep_est: iso(-1) }); // zu früh
    const times = deriveTimes(trip(st));
    expect(times[1].dep).toBe(T0 + 11 * 60_000);
    expect(times[1].depKind).toBe("plan");
  });
});

describe("smoothDistance", () => {
  it("springt nicht bei Abweichung > 300 m, sondern gleicht über 2 s an", () => {
    let s = smoothDistance(undefined, 1000, "k", 0);
    expect(s.display).toBe(1000);
    s = smoothDistance(s, 2000, "k", 100);
    expect(s.display).toBe(1000);
    s = smoothDistance(s, 2000, "k", 1100);
    expect(s.display).toBeGreaterThan(1000);
    expect(s.display).toBeLessThan(2000);
    s = smoothDistance(s, 2010, "k", 2200);
    expect(s.display).toBe(2010);
  });

  it("folgt kleinen Änderungen direkt", () => {
    const s = smoothDistance(smoothDistance(undefined, 1000, "k", 0), 1100, "k", 33);
    expect(s.display).toBe(1100);
  });
});

describe("trainLengthM", () => {
  it("nutzt 140 m ohne Wagenreihung, sonst Einheiten × 68 m", () => {
    expect(trainLengthM(trip(baseStops()))).toBe(140);
    expect(
      trainLengthM(trip(baseStops(), { formation: { vehicles: ["a", "b", "c"], observed_at: null, station_name: null, source: null } })),
    ).toBe(204);
  });
});
