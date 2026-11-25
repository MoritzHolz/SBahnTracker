import { getVersion, setWorkerUrl, type Map as MlMap, type StyleSpecification } from "maplibre-gl";

/* ----------------------------------------------------------------------------
 * Worker: MapLibre v6 sucht seinen Worker relativ zu import.meta.url. Das wird
 * vom Bundler umgeschrieben, deshalb kopiert scripts/copy-maplibre-worker.mjs
 * die Datei nach public/maplibre/ und wir setzen die URL explizit.
 * ------------------------------------------------------------------------- */
let workerConfigured = false;
export function configureMaplibre() {
  if (workerConfigured || typeof window === "undefined") return;
  setWorkerUrl(new URL(`/maplibre/maplibre-gl-worker.mjs?v=${getVersion()}`, window.location.href).href);
  workerConfigured = true;
}

/* ----------------------------------------------------------------------------
 * Basiskarte
 * ------------------------------------------------------------------------- */
export const STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";
export const STYLE_POSITRON = "https://tiles.openfreemap.org/styles/positron";
export const GLYPHS_URL = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const FONT_REGULAR = ["Noto Sans Regular"];
export const FONT_BOLD = ["Noto Sans Bold"];

export const EXTRA_ATTRIBUTION = [
  "Fahrplan/Echtzeit: NVBW EFA (MobiData BW)",
  "© OpenStreetMap-Mitwirkende",
];

export type BaseStyleKind = "dark" | "positron-abgedunkelt" | "minimal";

export interface ResolvedStyle {
  style: StyleSpecification;
  kind: BaseStyleKind;
}

async function fetchStyle(url: string, timeoutMs = 4000): Promise<StyleSpecification | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const json = (await res.json()) as StyleSpecification;
    return json && json.version === 8 && Array.isArray(json.layers) ? json : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Minimaler dunkler Style ohne Kacheln – letzter Fallback. */
export function minimalStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: GLYPHS_URL,
    sources: {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": "#0b0d10" } }],
  };
}

/**
 * Lädt den dunklen OpenFreeMap-Style; bei Fehler Positron (wird beim Einfügen
 * der eigenen Layer per Overlay abgedunkelt), sonst minimaler eigener Style.
 */
export async function resolveBaseStyle(): Promise<ResolvedStyle> {
  const dark = await fetchStyle(STYLE_DARK);
  if (dark) return { style: dark, kind: "dark" };
  const light = await fetchStyle(STYLE_POSITRON);
  if (light) return { style: light, kind: "positron-abgedunkelt" };
  return { style: minimalStyle(), kind: "minimal" };
}

/* ----------------------------------------------------------------------------
 * Icons (SDF, damit sie per icon-color in Linienfarbe eingefärbt werden)
 * ------------------------------------------------------------------------- */

const SDF_RADIUS = 8;
const SDF_CUTOFF = 0.25;

/**
 * Rastert eine Form und berechnet ein Signed-Distance-Field (wie tiny-sdf:
 * Kante bei Alpha 191, ~32 Alpha-Stufen je Pixel).
 */
function sdfFromDrawing(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#fff";
  draw(ctx, size);
  const src = ctx.getImageData(0, 0, size, size).data;
  const inside = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) inside[i] = src[i * 4 + 3] > 127 ? 1 : 0;

  // Grenzpixel sammeln (Pixel, deren Nachbar die andere Seite ist)
  const edges: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = inside[y * size + x];
      if (
        (x > 0 && inside[y * size + x - 1] !== v) ||
        (x < size - 1 && inside[y * size + x + 1] !== v) ||
        (y > 0 && inside[(y - 1) * size + x] !== v) ||
        (y < size - 1 && inside[(y + 1) * size + x] !== v)
      ) {
        edges.push(x, y);
      }
    }
  }
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let best = Infinity;
      for (let k = 0; k < edges.length; k += 2) {
        const dx = edges[k] - x;
        const dy = edges[k + 1] - y;
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      const dist = Math.sqrt(best) - 0.5;
      const signed = inside[y * size + x] ? -dist : dist; // positiv = außen
      const a = 255 - 255 * (signed / SDF_RADIUS + SDF_CUTOFF);
      const i = (y * size + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = 255;
      out[i + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  }
  return { width: size, height: size, data: out };
}

/** Pfeil nach Norden (wird per icon-rotate gedreht) – niedrige Zoomstufen. */
function drawArrow(ctx: CanvasRenderingContext2D, s: number) {
  const c = s / 2;
  ctx.beginPath();
  ctx.moveTo(c, 10);
  ctx.lineTo(s - 14, s - 12);
  ctx.lineTo(c, s - 20);
  ctx.lineTo(14, s - 12);
  ctx.closePath();
  ctx.fill();
}

/** Kleine Zugspitze (Dreieck) vorn am Modellzug. */
function drawHead(ctx: CanvasRenderingContext2D, s: number) {
  const c = s / 2;
  ctx.beginPath();
  ctx.moveTo(c, 12);
  ctx.lineTo(s - 12, s - 14);
  ctx.lineTo(12, s - 14);
  ctx.closePath();
  ctx.fill();
}

/** Abstellung: violettes Kästchen mit „A“ (Farbe der Kennzeichnung „Vermutung“). */
function parkingIcon(): ImageData | null {
  const s = 36;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#0b0d10";
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = "#c4a7ff";
  ctx.fillRect(3, 3, s - 6, s - 6);
  ctx.fillStyle = "#17131f";
  ctx.font = "bold 24px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("A", s / 2, s / 2 + 1);
  return ctx.getImageData(0, 0, s, s);
}

export function addIcons(map: MlMap) {
  const icons: [string, (ctx: CanvasRenderingContext2D, s: number) => void, number][] = [
    ["train-arrow", drawArrow, 56],
    ["train-head", drawHead, 40],
  ];
  for (const [id, draw, size] of icons) {
    if (map.hasImage(id)) continue;
    const img = sdfFromDrawing(size, draw);
    if (img) map.addImage(id, img, { sdf: true, pixelRatio: 2 });
  }
  // Eigener Name: „parking“ gibt es schon im Sprite der Basiskarte
  if (!map.hasImage("sb-stabling")) {
    const img = parkingIcon();
    if (img) map.addImage("sb-stabling", img, { pixelRatio: 2 });
  }
}
