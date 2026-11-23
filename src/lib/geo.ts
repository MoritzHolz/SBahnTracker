/**
 * Leichtgewichtige Geometrie für Polylinien in WGS84 ([lon, lat]).
 * Für die Region Stuttgart reicht eine lokale equirektangulare Projektion
 * (Fehler << 1 %). Alle Distanzen in Metern.
 */

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

/** Großkreisdistanz in Metern. */
export function haversineM(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * DEG;
  const dLon = (b[0] - a[0]) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Kurs (0 = Nord, im Uhrzeigersinn) von a nach b in Grad. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const φ1 = a[1] * DEG;
  const φ2 = b[1] * DEG;
  const Δλ = (b[0] - a[0]) * DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

export interface Projection {
  /** Position entlang der Linie (m ab Anfang). */
  along: number;
  /** Abstand des Punktes zur Linie (m). */
  distance: number;
  /** Index des Segments. */
  segment: number;
}

/**
 * Polylinie mit vorberechneten kumulierten Distanzen. Punktabfragen per
 * Binärsuche (O(log n)), damit der Animationsloop pro Frame billig bleibt.
 */
export class Polyline {
  readonly coords: LngLat[];
  readonly cum: Float64Array;
  readonly length: number;
  private readonly kx: number;
  private readonly ky: number;

  constructor(input: LngLat[]) {
    // Doppelte aufeinanderfolgende Punkte entfernen (Null-Segmente).
    const coords: LngLat[] = [];
    for (const c of input) {
      if (!Number.isFinite(c?.[0]) || !Number.isFinite(c?.[1])) continue;
      const last = coords[coords.length - 1];
      if (!last || last[0] !== c[0] || last[1] !== c[1]) coords.push([c[0], c[1]]);
    }
    this.coords = coords;
    const meanLat =
      coords.length > 0 ? coords.reduce((s, c) => s + c[1], 0) / coords.length : 48.78;
    this.ky = EARTH_RADIUS_M * DEG;
    this.kx = this.ky * Math.cos(meanLat * DEG);
    this.cum = new Float64Array(coords.length);
    for (let i = 1; i < coords.length; i++) {
      this.cum[i] = this.cum[i - 1] + this.segLen(coords[i - 1], coords[i]);
    }
    this.length = coords.length > 0 ? this.cum[coords.length - 1] : 0;
  }

  private segLen(a: LngLat, b: LngLat): number {
    const dx = (b[0] - a[0]) * this.kx;
    const dy = (b[1] - a[1]) * this.ky;
    return Math.hypot(dx, dy);
  }

  get isValid(): boolean {
    return this.coords.length >= 2 && this.length > 0;
  }

  reversed(): Polyline {
    return new Polyline([...this.coords].reverse());
  }

  /** Index i mit cum[i] <= d < cum[i+1]. */
  private segmentAt(d: number): number {
    const n = this.coords.length;
    if (d <= 0) return 0;
    if (d >= this.length) return Math.max(0, n - 2);
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  /** Punkt bei Distanz d (geklemmt auf [0, length]). */
  pointAt(d: number): LngLat {
    const n = this.coords.length;
    if (n === 0) return [0, 0];
    if (n === 1) return this.coords[0];
    const dd = Math.min(Math.max(d, 0), this.length);
    const i = this.segmentAt(dd);
    const a = this.coords[i];
    const b = this.coords[i + 1];
    const seg = this.cum[i + 1] - this.cum[i];
    const t = seg > 0 ? (dd - this.cum[i]) / seg : 0;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  /** Fahrtrichtung bei d aus Punkten d±window. */
  bearingAt(d: number, window = 30): number {
    let a = Math.max(0, d - window);
    let b = Math.min(this.length, d + window);
    if (b - a < 1) {
      a = Math.max(0, b - 2 * window);
      b = Math.min(this.length, a + 2 * window);
    }
    return bearingDeg(this.pointAt(a), this.pointAt(b));
  }

  /** Teilstück zwischen d0 und d1 (lineSliceAlong-Äquivalent). */
  slice(d0: number, d1: number): LngLat[] {
    const n = this.coords.length;
    if (n < 2) return n === 1 ? [this.coords[0], this.coords[0]] : [];
    let s = Math.min(Math.max(Math.min(d0, d1), 0), this.length);
    const e = Math.min(Math.max(Math.max(d0, d1), 0), this.length);
    if (e - s < 0.01) s = Math.max(0, e - 0.01);
    const out: LngLat[] = [this.pointAt(s)];
    const i0 = this.segmentAt(s);
    const i1 = this.segmentAt(e);
    for (let i = i0 + 1; i <= i1; i++) {
      if (this.cum[i] > s && this.cum[i] < e) out.push(this.coords[i]);
    }
    out.push(this.pointAt(e));
    return out;
  }

  /** Abstand und Kilometrierung des nächsten Punkts auf Segment i (ab minAlong). */
  private projectOnSegment(p: LngLat, i: number, minAlong: number): Projection {
    const segStart = this.cum[i];
    const segEnd = this.cum[i + 1];
    const a = this.coords[i];
    const b = this.coords[i + 1];
    const bx = (b[0] - a[0]) * this.kx;
    const by = (b[1] - a[1]) * this.ky;
    const px = (p[0] - a[0]) * this.kx;
    const py = (p[1] - a[1]) * this.ky;
    const len2 = bx * bx + by * by;
    let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
    t = Math.min(1, Math.max(0, t));
    const segLen = segEnd - segStart;
    if (segStart + t * segLen < minAlong && segLen > 0) t = Math.min(1, (minAlong - segStart) / segLen);
    return { along: segStart + t * segLen, distance: Math.hypot(px - t * bx, py - t * by), segment: i };
  }

  /**
   * Sequentielle Projektion für Halte in Fahrtreihenfolge: Sucht ab
   * `minAlong` vorwärts den ersten Abschnitt, der näher als `hitRadius` am
   * Punkt liegt, und nimmt dort das lokale Minimum. So werden Schleifen und
   * doppelt befahrene Abschnitte korrekt zugeordnet. Ohne Treffer: nächstes
   * Minimum ab `minAlong`.
   */
  projectForward(p: LngLat, minAlong = 0, hitRadius = 150): Projection {
    const n = this.coords.length;
    if (n < 2) return this.project(p);
    let best: Projection = { along: Math.max(0, minAlong), distance: Infinity, segment: 0 };
    let hit: Projection | null = null;
    for (let i = 0; i < n - 1; i++) {
      if (this.cum[i + 1] < minAlong) continue;
      const pr = this.projectOnSegment(p, i, minAlong);
      if (hit) {
        if (pr.distance >= hitRadius) break; // Ende des Trefferbereichs
        if (pr.distance < hit.distance) hit = pr;
        continue;
      }
      if (pr.distance < hitRadius) {
        hit = pr;
        continue;
      }
      if (pr.distance < best.distance) best = pr;
    }
    return hit ?? best;
  }

  /**
   * Projiziert einen Punkt auf die Linie (nächster Punkt). Optional nur auf
   * den Bereich [minAlong, maxAlong] beschränkt.
   */
  project(p: LngLat, minAlong = -Infinity, maxAlong = Infinity): Projection {
    const n = this.coords.length;
    if (n === 0) return { along: 0, distance: Infinity, segment: 0 };
    if (n === 1) {
      return { along: 0, distance: this.segLen(this.coords[0], p), segment: 0 };
    }
    let best: Projection = { along: 0, distance: Infinity, segment: 0 };
    for (let i = 0; i < n - 1; i++) {
      const segStart = this.cum[i];
      const segEnd = this.cum[i + 1];
      if (segEnd < minAlong || segStart > maxAlong) continue;
      const a = this.coords[i];
      const b = this.coords[i + 1];
      const bx = (b[0] - a[0]) * this.kx;
      const by = (b[1] - a[1]) * this.ky;
      const px = (p[0] - a[0]) * this.kx;
      const py = (p[1] - a[1]) * this.ky;
      const len2 = bx * bx + by * by;
      let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
      t = Math.min(1, Math.max(0, t));
      let along = segStart + t * (segEnd - segStart);
      // Auf zulässigen Bereich klemmen
      if (along < minAlong || along > maxAlong) {
        along = Math.min(Math.max(along, minAlong), maxAlong);
        const segLen = segEnd - segStart;
        t = segLen > 0 ? (along - segStart) / segLen : 0;
      }
      const dx = px - t * bx;
      const dy = py - t * by;
      const dist = Math.hypot(dx, dy);
      if (dist < best.distance) best = { along, distance: dist, segment: i };
    }
    return best;
  }
}
