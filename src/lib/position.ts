/**
 * Positionsschätzung für Züge. Es gibt KEINE GPS-Daten: Die Position wird
 * ausschließlich aus Ist-/Sollzeiten je Halt und der Streckengeometrie
 * berechnet. Alle Funktionen hier sind rein (keine Seiteneffekte außer dem
 * explizit übergebenen Cache).
 */
import type { LiveTrip, RouteShape, TripStop } from "./api";
import { haversineM, Polyline, type LngLat } from "./geo";

export const PRE_DEPARTURE_WINDOW_MS = 5 * 60_000;
export const POST_ARRIVAL_WINDOW_MS = 5 * 60_000;
export const DEFAULT_TRAIN_LENGTH_M = 140;
export const UNIT_LENGTH_M = 68;
/** Ab diesem mittleren Abstand Halt↔Shape gilt die Shape als unpassend. */
const SHAPE_MISFIT_M = 800;

export type TripPhase = "vor_abfahrt" | "fahrend" | "am_halt" | "angekommen";
export type PositionQuality = "echtzeit" | "fahrplan";

export const PHASE_LABEL: Record<TripPhase, string> = {
  vor_abfahrt: "Vor Abfahrt",
  fahrend: "Fahrend",
  am_halt: "Am Halt",
  angekommen: "Angekommen",
};

export const QUALITY_LABEL: Record<PositionQuality, string> = {
  echtzeit: "geschätzt (Echtzeit-Zeiten)",
  fahrplan: "geschätzt (Fahrplan)",
};

/* ------------------------------------------------------------------------- */
/* Zeiten                                                                    */
/* ------------------------------------------------------------------------- */

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export interface EffectiveTimes {
  arr: number | null;
  dep: number | null;
  /** true, wenn die jeweilige Zeit aus einer Echtzeit-Schätzung stammt */
  arrIsEst: boolean;
  depIsEst: boolean;
}

/** Effektive Zeit je Halt = est ?? planned; fehlt Ankunft/Abfahrt, das andere nehmen. */
export function effectiveTimes(stop: TripStop): EffectiveTimes {
  const arrEst = ms(stop.arr_est);
  const depEst = ms(stop.dep_est);
  let arr = arrEst ?? ms(stop.arr_planned);
  let dep = depEst ?? ms(stop.dep_planned);
  let arrIsEst = arrEst != null;
  let depIsEst = depEst != null;
  if (arr == null && dep != null) {
    arr = dep;
    arrIsEst = depIsEst;
  }
  if (dep == null && arr != null) {
    dep = arr;
    depIsEst = arrIsEst;
  }
  return { arr, dep, arrIsEst, depIsEst };
}

const qualityMemo = new WeakMap<LiveTrip, PositionQuality>();
export function positionQuality(trip: LiveTrip): PositionQuality {
  let q = qualityMemo.get(trip);
  if (q) return q;
  q = trip.has_realtime && trip.stops.some((s) => s.arr_est != null || s.dep_est != null) ? "echtzeit" : "fahrplan";
  qualityMemo.set(trip, q);
  return q;
}

/** Herkunft einer Zeit: echte Echtzeit, aus vorheriger Verspätung abgeleitet, oder Plan. */
export type TimeKind = "est" | "derived" | "plan";

export interface StopTiming {
  arr: number | null;
  dep: number | null;
  arrKind: TimeKind;
  depKind: TimeKind;
}

const timingMemo = new WeakMap<LiveTrip, StopTiming[]>();

/**
 * Zeiten je Halt mit Verspätungsweitergabe: Hat ein Halt keine *_est, wird
 * die zuletzt bekannte (positive) Verspätung übernommen. Die Verspätung
 * ändert sich nur durch echte Ist-Daten; abgeleitete Abfahrten liegen nie vor
 * der Planzeit. Fehlt nur arr_est: arr = min(arr_planned + Verspätung, dep_est).
 */
export function deriveTimes(trip: LiveTrip): StopTiming[] {
  const memo = timingMemo.get(trip);
  if (memo) return memo;
  let delay = 0;
  const out = trip.stops.map((stop): StopTiming => {
    const aP = ms(stop.arr_planned);
    const aE = ms(stop.arr_est);
    const dP = ms(stop.dep_planned);
    const dE = ms(stop.dep_est);
    const carry = Math.max(0, delay);

    let arr: number | null = null;
    let arrKind: TimeKind = "plan";
    if (aE != null) {
      arr = aE;
      arrKind = "est";
      if (aP != null) delay = aE - aP;
    } else if (aP != null) {
      arr = carry > 0 ? Math.min(aP + carry, dE ?? Infinity) : aP;
      arrKind = arr !== aP ? "derived" : "plan";
    }

    let dep: number | null = null;
    let depKind: TimeKind = "plan";
    const carryDep = Math.max(0, delay);
    if (dE != null) {
      dep = dE;
      depKind = "est";
      if (dP != null) delay = dE - dP;
    } else if (dP != null) {
      dep = dP + carryDep;
      depKind = carryDep > 0 ? "derived" : "plan";
    }

    if (arr == null && dep != null) {
      arr = dep;
      arrKind = depKind;
    }
    if (dep == null && arr != null) {
      dep = arr;
      depKind = arrKind;
    }
    return { arr, dep, arrKind, depKind };
  });
  timingMemo.set(trip, out);
  return out;
}

/* ------------------------------------------------------------------------- */
/* Geometrie je Trip (gecacht)                                               */
/* ------------------------------------------------------------------------- */

export interface Track {
  key: string;
  line: Polyline;
  /** Kilometrierung (m) je Halt-Index in trip.stops; null wenn ohne Koordinate */
  stopDist: (number | null)[];
  /** true = keine/unpassende Shape, Gerade zwischen Halten */
  approximate: boolean;
}

function stopLngLat(s: TripStop): LngLat | null {
  if (s.lat == null || s.lon == null) return null;
  if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) return null;
  return [s.lon, s.lat];
}

/**
 * Projiziert die Halte sequentiell auf die Linie: Jeder Halt wird ab der
 * Kilometrierung seines Vorgängers gesucht (erster Treffer < 150 m, sonst
 * nächstes Minimum). Dadurch ist die Kilometrierung monoton und Schleifen
 * bzw. doppelt befahrene Abschnitte werden richtig zugeordnet.
 */
export function projectStops(line: Polyline, points: (LngLat | null)[]): {
  dist: (number | null)[];
  offsets: number[];
} {
  const dist: (number | null)[] = [];
  const offsets: number[] = [];
  let prev = 0;
  for (const p of points) {
    if (!p) {
      dist.push(null);
      continue;
    }
    const pr = line.projectForward(p, prev);
    const d = Math.max(pr.along, prev);
    dist.push(d);
    offsets.push(pr.distance);
    prev = d;
  }
  return { dist, offsets };
}

function median(xs: number[]): number {
  if (xs.length === 0) return Infinity;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Gerade Verbindung der Halte – Fallback ohne Shape. */
function straightTrack(trip: LiveTrip, key: string): Track | null {
  const pts = trip.stops.map(stopLngLat);
  const line = new Polyline(pts.filter((p): p is LngLat => p != null));
  if (!line.isValid) return null;
  // Kilometrierung exakt aus der Gerade (Halte liegen auf den Stützpunkten)
  const stopDist: (number | null)[] = [];
  let k = 0;
  let lastP: LngLat | null = null;
  for (const p of pts) {
    if (!p) {
      stopDist.push(null);
      continue;
    }
    if (lastP && (lastP[0] !== p[0] || lastP[1] !== p[1])) k++;
    stopDist.push(line.cum[Math.min(k, line.cum.length - 1)]);
    lastP = p;
  }
  return { key, line, stopDist, approximate: true };
}

export function trackKey(trip: LiveTrip, shape: RouteShape | null | undefined): string {
  const stopsSig = trip.stops
    .map((s) => `${s.seq}:${s.lat?.toFixed(5)},${s.lon?.toFixed(5)}`)
    .join("|");
  const shapeSig = shape ? `${shape.id}/${shape.coords.length}/${shape.length_m ?? ""}` : "none";
  return `${trip.id}#${shapeSig}#${stopsSig}`;
}

export function buildTrack(trip: LiveTrip, shape: RouteShape | null | undefined): Track | null {
  const key = trackKey(trip, shape);
  if (shape && shape.coords.length >= 2) {
    let line = new Polyline(shape.coords);
    if (line.isValid) {
      const pts = trip.stops.map(stopLngLat);
      const valid = pts.filter((p): p is LngLat => p != null);
      if (valid.length >= 2) {
        // Richtung der Shape über Abstände der End-Halte zu Shape-Anfang/-Ende prüfen
        const a = valid[0];
        const z = valid[valid.length - 1];
        const s0 = line.coords[0];
        const s1 = line.coords[line.coords.length - 1];
        if (haversineM(a, s1) + haversineM(z, s0) < haversineM(a, s0) + haversineM(z, s1)) {
          line = line.reversed();
        }
        const { dist, offsets } = projectStops(line, pts);
        if (median(offsets) <= SHAPE_MISFIT_M) {
          return { key, line, stopDist: dist, approximate: false };
        }
      }
    }
  }
  return straightTrack(trip, key);
}

/**
 * Cache: pro Trip wird die Projektion nur einmal berechnet. Schneller Pfad
 * über das Trip-Objekt (WeakMap, ein Objekt je Datenabruf); über Abrufe
 * hinweg wird per Schlüssel (Trip, Shape, Halt-Koordinaten) wiederverwendet.
 */
export class TrackCache {
  private byKey = new Map<string, Track | null>();
  private byTrip = new WeakMap<LiveTrip, { shape: RouteShape | null; track: Track | null }>();

  get(trip: LiveTrip, shape: RouteShape | null | undefined): Track | null {
    const sh = shape ?? null;
    const fast = this.byTrip.get(trip);
    if (fast && fast.shape === sh) return fast.track;
    const key = trackKey(trip, sh);
    let t = this.byKey.get(key);
    if (t === undefined) {
      t = buildTrack(trip, sh);
      this.byKey.set(key, t);
    }
    this.byTrip.set(trip, { shape: sh, track: t });
    return t;
  }

  /** Entfernt Einträge, deren Trip nicht mehr existiert. */
  prune(activeTripIds: Set<string>) {
    for (const k of this.byKey.keys()) {
      if (!activeTripIds.has(k.slice(0, k.indexOf("#")))) this.byKey.delete(k);
    }
  }
}

/* ------------------------------------------------------------------------- */
/* Position zu einem Zeitpunkt                                               */
/* ------------------------------------------------------------------------- */

/** Leichtes Ease-in-out: Mischung aus linear und Smoothstep. */
export function easeTrain(f: number): number {
  const x = Math.min(1, Math.max(0, f));
  const smooth = x * x * (3 - 2 * x);
  return 0.6 * x + 0.4 * smooth;
}

export interface TripTimelineEntry {
  /** Index in trip.stops */
  idx: number;
  arr: number;
  dep: number;
}

const timelineMemo = new WeakMap<LiveTrip, TripTimelineEntry[]>();

/**
 * Halte mit Zeiten (ohne ausgefallene Halte), inkl. Verspätungsweitergabe,
 * zeitlich monoton gemacht. Gecacht pro Trip-Objekt.
 */
export function timeline(trip: LiveTrip): TripTimelineEntry[] {
  const memo = timelineMemo.get(trip);
  if (memo) return memo;
  const times = deriveTimes(trip);
  const out: TripTimelineEntry[] = [];
  trip.stops.forEach((s, idx) => {
    if (s.cancelled) return;
    const t = times[idx];
    if (t.arr == null || t.dep == null) return;
    const prevDep = out.length ? out[out.length - 1].dep : -Infinity;
    const arr = Math.max(t.arr, prevDep);
    const dep = Math.max(t.dep, arr);
    out.push({ idx, arr, dep });
  });
  timelineMemo.set(trip, out);
  return out;
}

export interface TripPosition {
  phase: TripPhase;
  /** Index (trip.stops) des zuletzt erreichten / verlassenen Halts */
  lastIdx: number;
  /** Index des nächsten Halts (null bei angekommen) */
  nextIdx: number | null;
  /** Fortschritt zwischen lastIdx und nextIdx (0..1), nur bei fahrend */
  progress: number;
  /** Position entlang track.line (m) – null, wenn kein Track */
  dist: number | null;
}

/**
 * Status und Kilometrierung zum Zeitpunkt `now`. Gibt null zurück, wenn der
 * Zug (noch/nicht mehr) angezeigt werden soll oder keine Zeiten hat.
 */
export function computeTripPosition(
  trip: LiveTrip,
  track: Track | null,
  now: number,
): TripPosition | null {
  if (trip.cancelled) return null;
  const tl = timeline(trip);
  if (tl.length < 2) return null;
  const first = tl[0];
  const last = tl[tl.length - 1];
  const distOf = (idx: number): number | null => track?.stopDist[idx] ?? null;

  if (now < first.dep) {
    if (first.dep - now > PRE_DEPARTURE_WINDOW_MS) return null;
    return { phase: "vor_abfahrt", lastIdx: first.idx, nextIdx: tl[1].idx, progress: 0, dist: distOf(first.idx) };
  }
  if (now >= last.arr) {
    if (now - last.arr > POST_ARRIVAL_WINDOW_MS) return null;
    return { phase: "angekommen", lastIdx: last.idx, nextIdx: null, progress: 1, dist: distOf(last.idx) };
  }

  // Binärsuche: letzter Eintrag k mit arr_k <= now
  let lo = 0;
  let hi = tl.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tl[mid].arr <= now) lo = mid;
    else hi = mid - 1;
  }
  const k = lo;
  const cur = tl[k];
  if (now < cur.dep) {
    return {
      phase: "am_halt",
      lastIdx: cur.idx,
      nextIdx: tl[k + 1]?.idx ?? null,
      progress: 0,
      dist: distOf(cur.idx),
    };
  }
  const nxt = tl[k + 1];
  const span = nxt.arr - cur.dep;
  const f = span > 0 ? (now - cur.dep) / span : 1;
  const d0 = distOf(cur.idx);
  const d1 = distOf(nxt.idx);
  const dist = d0 != null && d1 != null ? d0 + (d1 - d0) * easeTrain(f) : d0 ?? d1;
  return { phase: "fahrend", lastIdx: cur.idx, nextIdx: nxt.idx, progress: f, dist };
}

/* ------------------------------------------------------------------------- */
/* Darstellung                                                               */
/* ------------------------------------------------------------------------- */

export function trainLengthM(trip: LiveTrip): number {
  const n = trip.formation?.vehicles?.length ?? 0;
  return n > 0 ? n * UNIT_LENGTH_M : DEFAULT_TRAIN_LENGTH_M;
}

export interface SmoothState {
  trackKey: string;
  display: number;
  blendFrom: number | null;
  blendStart: number;
}

/**
 * Verhindert Teleportieren: Weicht die neue Berechnung um mehr als
 * `threshold` Meter von der zuletzt angezeigten Position ab, wird über
 * `duration` ms weich angeglichen.
 */
export function smoothDistance(
  prev: SmoothState | undefined,
  target: number,
  key: string,
  now: number,
  threshold = 300,
  duration = 2000,
): SmoothState {
  if (!prev || prev.trackKey !== key) {
    return { trackKey: key, display: target, blendFrom: null, blendStart: 0 };
  }
  if (prev.blendFrom != null) {
    const t = (now - prev.blendStart) / duration;
    if (t < 1) {
      const e = t * t * (3 - 2 * t);
      return { ...prev, display: prev.blendFrom + (target - prev.blendFrom) * e };
    }
    return { trackKey: key, display: target, blendFrom: null, blendStart: 0 };
  }
  if (Math.abs(target - prev.display) > threshold) {
    return { trackKey: key, display: prev.display, blendFrom: prev.display, blendStart: now };
  }
  return { trackKey: key, display: target, blendFrom: null, blendStart: 0 };
}
