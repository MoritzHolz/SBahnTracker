import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from "maplibre-gl";
import { FONT_BOLD, FONT_REGULAR, type BaseStyleKind } from "./maplibre";

export const SRC_ROUTES = "sb-routes";
export const SRC_STATIONS = "sb-stations";
/** Eine Quelle für alle Züge (Körper als LineString, Kopf als Point) → ein setData pro Tick */
export const SRC_TRAINS = "sb-trains";

/** Geschätzte Abstellungen */
export const SRC_PARKING = "sb-parking";
export const PARKING_LAYER = "sb-parking";

export const TRAIN_LAYERS = ["sb-train-body", "sb-train-head", "sb-train-arrow"];
/** Ab dieser Zoomstufe werden Züge als Modellzug (Linienstück) gezeichnet. */
export const MODEL_ZOOM = 13;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const IS_LINE: ExpressionSpecification = ["==", ["geometry-type"], "LineString"];
const IS_POINT: ExpressionSpecification = ["==", ["geometry-type"], "Point"];

const dimmed = (on: number, off: number): ExpressionSpecification => [
  "case",
  ["get", "dim"],
  off,
  on,
];

/** Deckkraft für Züge: Fahrplan-Schätzung transparenter als Echtzeit-Schätzung. */
const trainOpacity: ExpressionSpecification = [
  "case",
  ["get", "dim"],
  0.18,
  ["get", "rt"],
  0.95,
  0.62,
];

export function addAppLayers(map: MlMap, baseKind: BaseStyleKind) {
  if (baseKind === "positron-abgedunkelt") {
    // Helle Basiskarte abdunkeln
    map.addLayer({
      id: "sb-darken",
      type: "background",
      paint: { "background-color": "#0b0d10", "background-opacity": 0.78 },
    });
  }

  map.addSource(SRC_ROUTES, { type: "geojson", data: EMPTY });
  map.addSource(SRC_STATIONS, { type: "geojson", data: EMPTY });
  map.addSource(SRC_PARKING, { type: "geojson", data: EMPTY });
  map.addSource(SRC_TRAINS, { type: "geojson", data: EMPTY });

  // Strecken: leichter Glow + dünne Linie
  map.addLayer({
    id: "sb-routes-glow",
    type: "line",
    source: SRC_ROUTES,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 4, 14, 10],
      "line-blur": ["interpolate", ["linear"], ["zoom"], 9, 3, 14, 8],
      "line-opacity": dimmed(0.16, 0.03),
    },
  });
  map.addLayer({
    id: "sb-routes",
    type: "line",
    source: SRC_ROUTES,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["interpolate", ["linear"], ["zoom"], 9, 1.1, 14, 2.4],
      "line-opacity": dimmed(0.85, 0.18),
    },
  });

  // Stationen
  map.addLayer({
    id: "sb-stations",
    type: "circle",
    source: SRC_STATIONS,
    minzoom: 9,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1.6, 13, 3.2, 16, 5],
      "circle-color": "#0b0d10",
      "circle-stroke-color": "#c9ced6",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 14, 1.4],
      "circle-stroke-opacity": 0.85,
    },
  });
  map.addLayer({
    id: "sb-station-labels",
    type: "symbol",
    source: SRC_STATIONS,
    minzoom: 12,
    layout: {
      "text-field": ["get", "name"],
      "text-font": FONT_REGULAR,
      "text-size": 11,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
      "text-optional": true,
    },
    paint: {
      "text-color": "#aeb4bd",
      "text-halo-color": "#0b0d10",
      "text-halo-width": 1.4,
    },
  });

  // Abstellungen: „A“ mit Anzahl; blass, wenn der Ort nur unsicher ist. Liegt unter den Zügen.
  map.addLayer({
    id: PARKING_LAYER,
    type: "symbol",
    source: SRC_PARKING,
    minzoom: 8.5,
    layout: {
      "icon-image": "sb-stabling",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 14, 1.15],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": ["step", ["zoom"], ["get", "count"], 12, ["get", "label"]],
      "text-font": FONT_BOLD,
      "text-size": 11,
      "text-offset": [1.2, 0],
      "text-max-width": 20,
      "text-anchor": "left",
      "text-optional": true,
    },
    paint: {
      "icon-opacity": ["case", ["get", "sel"], 1, ["get", "sure"], 0.95, 0.6],
      "text-color": "#c4a7ff",
      "text-halo-color": "#0b0d10",
      "text-halo-width": 1.6,
      "text-opacity": ["case", ["get", "sel"], 1, ["get", "sure"], 1, 0.75],
    },
  });

  // Modellzug (ab MODEL_ZOOM): Rand → Körper → Spitze
  map.addLayer({
    id: "sb-train-casing-rt",
    type: "line",
    source: SRC_TRAINS,
    minzoom: MODEL_ZOOM,
    filter: ["all", IS_LINE, ["==", ["get", "rt"], true]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#f2f4f7",
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, 7, 17, 22],
      "line-opacity": dimmed(0.9, 0.15),
    },
  });
  map.addLayer({
    id: "sb-train-casing-plan",
    type: "line",
    source: SRC_TRAINS,
    minzoom: MODEL_ZOOM,
    filter: ["all", IS_LINE, ["!=", ["get", "rt"], true]],
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: {
      "line-color": "#f2f4f7",
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, 7, 17, 22],
      "line-dasharray": [1, 0.7],
      "line-opacity": dimmed(0.7, 0.12),
    },
  });
  map.addLayer({
    id: "sb-train-body",
    type: "line",
    source: SRC_TRAINS,
    minzoom: MODEL_ZOOM,
    filter: IS_LINE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 13, 4.5, 17, 17],
      "line-opacity": trainOpacity,
    },
  });
  map.addLayer({
    id: "sb-train-head",
    type: "symbol",
    source: SRC_TRAINS,
    filter: IS_POINT,
    minzoom: MODEL_ZOOM,
    layout: {
      "icon-image": "train-head",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 13, 0.45, 17, 1.1],
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": ["get", "label"],
      "text-font": FONT_BOLD,
      "text-size": 11,
      "text-offset": [0, -1.6],
      "text-optional": true,
    },
    paint: {
      "icon-color": "#f2f4f7",
      "icon-opacity": trainOpacity,
      "text-color": "#e8ebef",
      "text-halo-color": "#0b0d10",
      "text-halo-width": 1.5,
      "text-opacity": dimmed(1, 0.2),
    },
  });

  // Niedrige Zoomstufen: gedrehter Pfeil + Linienkürzel
  map.addLayer({
    id: "sb-train-arrow",
    type: "symbol",
    source: SRC_TRAINS,
    filter: IS_POINT,
    maxzoom: MODEL_ZOOM,
    layout: {
      "icon-image": "train-arrow",
      "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.55, 12.9, 0.85],
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["case", ["get", "sel"], 2, ["get", "dim"], 0, 1],
      "text-field": ["get", "line"],
      "text-font": FONT_BOLD,
      "text-size": ["interpolate", ["linear"], ["zoom"], 9, 9, 12.9, 11],
      "text-offset": [1.15, 0],
      "text-anchor": "left",
      "text-optional": true,
      "text-allow-overlap": false,
    },
    paint: {
      "icon-color": ["get", "color"],
      "icon-halo-color": ["case", ["get", "rt"], "#f2f4f7", "rgba(242,244,247,0.55)"],
      "icon-halo-width": 1.2,
      "icon-opacity": trainOpacity,
      "text-color": ["get", "color"],
      "text-halo-color": "#0b0d10",
      "text-halo-width": 1.6,
      "text-opacity": dimmed(1, 0.15),
    },
  });

  // Auswahl-Ring
  map.addLayer({
    id: "sb-train-selected",
    type: "circle",
    source: SRC_TRAINS,
    filter: ["all", IS_POINT, ["==", ["get", "sel"], true]],
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 11, 15, 22],
      "circle-color": "rgba(0,0,0,0)",
      "circle-stroke-color": "#f2f4f7",
      "circle-stroke-width": 1.2,
      "circle-stroke-opacity": 0.9,
    },
  });
}

export function setSourceData(map: MlMap, id: string, data: GeoJSON.FeatureCollection) {
  const src = map.getSource<GeoJSONSource>(id);
  if (src) void src.setData(data);
}
