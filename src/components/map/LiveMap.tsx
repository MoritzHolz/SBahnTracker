"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MlMap, NavigationControl, type MapMouseEvent } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { lineColor, type Line, type LiveTrip, type RouteShape } from "@/lib/api";
import type { LngLat } from "@/lib/geo";
import {
  computeTripPosition,
  positionQuality,
  smoothDistance,
  trainLengthM,
  type SmoothState,
  type TrackCache,
} from "@/lib/position";
import { FallbackMap } from "./FallbackMap";
import type { ParkingSite } from "@/lib/parking";
import { isStaleWebOnly } from "@/lib/scanner";
import { addAppLayers, MODEL_ZOOM, PARKING_LAYER, setSourceData, SRC_PARKING, SRC_ROUTES, SRC_STATIONS, SRC_TRAINS, TRAIN_LAYERS } from "./layers";
import { addIcons, configureMaplibre, EXTRA_ATTRIBUTION, resolveBaseStyle, type BaseStyleKind } from "./maplibre";

export interface LiveMapProps {
  trips: LiveTrip[];
  shapes: Map<number, RouteShape>;
  shapeList: RouteShape[];
  lines: Map<string, Line>;
  trackCache: TrackCache;
  hiddenLines: Set<string>;
  focusLine: string | null;
  /** Trips, die den aktuellen Filtern entsprechen (null = kein Filter aktiv) */
  matchIds: Set<string> | null;
  selectedId: string | null;
  follow: boolean;
  onSelect: (id: string | null) => void;
  /** Geschätzte Abstellungen */
  sites: ParkingSite[];
  selectedSite: string | null;
  onSelectSite: (id: string) => void;
  onFollowChange: (follow: boolean) => void;
  onBaseStyle?: (kind: BaseStyleKind) => void;
  /** Von Panels verdeckte Ränder (px), damit Zentrierung im sichtbaren Bereich erfolgt */
  padding: { top: number; bottom: number; left: number; right: number };
}

/** setData-Takt (~12 Hz); die Interpolation bleibt zeitbasiert. */
const FRAME_MS = 1000 / 12;
/** So oft wird die Karte nach einem Ausfall der Grafik von selbst neu aufgebaut */
const MAX_REBUILDS = 3;
const CONTEXT_RESTORE_MS = 4000;
/** Danach wird die vereinfachte Karte gezeigt, bis die richtige fertig ist */
const SLOW_MS = 10_000;
/** Läuft die Karte so lange ohne Ausfall, zählen frühere Ausfälle nicht mehr */
const STABLE_MS = 60_000;
/** Hintergrundkarte nicht erreichbar: einmal später erneut versuchen */
const BASE_RETRY_MS = 30_000;
const GEO_BLEND_MS = 2000;
const TOUCH_RADIUS_PX = 18;

interface TrainAnim {
  smooth: SmoothState;
  head: LngLat | null;
  geoFrom: LngLat | null;
  geoStart: number;
}

function easeInOut(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export default function LiveMap(props: LiveMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const propsRef = useRef(props);
  const animRef = useRef(new Map<string, TrainAnim>());
  const headsRef = useRef(new Map<string, LngLat>());
  const [ready, setReady] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);
  /** Zähler für Neuaufbau der Karte */
  const [build, setBuild] = useState(0);
  const [failed, setFailed] = useState(false);
  const [slow, setSlow] = useState(false);
  const viewRef = useRef<{ center: [number, number]; zoom: number }>({ center: [9.18, 48.78], zoom: 10 });
  const autoRef = useRef(0);
  const baseRetried = useRef(false);

  const rebuild = useCallback((auto: boolean) => {
    if (auto && autoRef.current >= MAX_REBUILDS) {
      setReady(false);
      setFailed(true);
      return;
    }
    autoRef.current = auto ? autoRef.current + 1 : 0;
    setFailed(false);
    setSlow(false);
    setBuild((n) => n + 1);
  }, []);

  useEffect(() => {
    propsRef.current = props;
  });

  /* --------------------------- Karte erzeugen ---------------------------- */
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let restoreTimer = 0;
    let stableTimer = 0;
    let baseTimer = 0;
    setReady(false);
    configureMaplibre();
    const slowTimer = window.setTimeout(() => setSlow(true), SLOW_MS);
    // Nach Ruhezustand oder Grafikfehler kann die Zeichenfläche tot sein
    const onVisible = () => {
      const map = mapRef.current;
      if (document.visibilityState === "hidden" || !map) return;
      if (map.getCanvas().getContext("webgl2")?.isContextLost()) rebuild(true);
      else map.triggerRepaint();
    };
    document.addEventListener("visibilitychange", onVisible);

    (async () => {
      const base = await resolveBaseStyle();
      if (cancelled || !containerRef.current) return;
      propsRef.current.onBaseStyle?.(base.kind);
      setStyleError(base.kind === "minimal" ? "Basiskarte nicht erreichbar – vereinfachte Darstellung" : null);

      if (base.kind === "minimal" && !baseRetried.current) {
        baseRetried.current = true;
        baseTimer = window.setTimeout(() => rebuild(true), BASE_RETRY_MS);
      }

      const map = new MlMap({
        container: containerRef.current,
        style: base.style,
        center: viewRef.current.center,
        zoom: viewRef.current.zoom,
        minZoom: 7,
        maxZoom: 18,
        attributionControl: { compact: true, customAttribution: EXTRA_ATTRIBUTION },
        dragRotate: false,
        pitchWithRotate: false,
      });
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new NavigationControl({ showCompass: false }), "bottom-right");

      map.on("moveend", () => {
        const c = map.getCenter();
        viewRef.current = { center: [c.lng, c.lat], zoom: map.getZoom() };
      });
      map.on("webglcontextlost", () => {
        window.clearTimeout(stableTimer);
        window.clearTimeout(restoreTimer);
        restoreTimer = window.setTimeout(() => !cancelled && rebuild(true), CONTEXT_RESTORE_MS);
      });
      map.on("webglcontextrestored", () => window.clearTimeout(restoreTimer));

      // Nicht auf „load“ warten: das kommt erst, wenn auch alle Kacheln und Schriften da sind
      map.on("style.load", () => {
        if (cancelled) return;
        addIcons(map);
        // Nach einem Grafikfehler stellt MapLibre den Stil samt eigenen Ebenen selbst wieder her
        if (map.getSource(SRC_TRAINS)) return;
        window.clearTimeout(slowTimer);
        setSlow(false);
        // Handy und kleinere Laptops: Quellenangabe nach einigen Sekunden hinter das (i) einklappen
        if (window.matchMedia("(max-width: 1700px), (max-height: 560px)").matches) {
          window.setTimeout(() => {
            if (cancelled) return;
            const attrib = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
            attrib?.classList.remove("maplibregl-compact-show");
            attrib?.removeAttribute("open");
          }, 5000);
        }
        addAppLayers(map, base.kind);
        setReady(true);
        stableTimer = window.setTimeout(() => {
          autoRef.current = 0;
        }, STABLE_MS);
      });
      // Fehlende Glyphen/Icons des Basisstyles nicht als harten Fehler behandeln
      map.on("styleimagemissing", () => undefined);

      // Finger treffen ungenauer als die Maus: im Umkreis suchen, nächstgelegener Zugkopf gewinnt
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      map.on("click", (e: MapMouseEvent) => {
        if (!map.getLayer(TRAIN_LAYERS[0])) return;
        const r = coarse ? TOUCH_RADIUS_PX : 2;
        const { x, y } = e.point;
        const hits = map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers: TRAIN_LAYERS });
        let best: { id: string; d: number } | null = null;
        for (const f of hits) {
          const id = f.properties?.id;
          const head = typeof id === "string" ? headsRef.current.get(id) : undefined;
          if (!head) continue;
          const p = map.project(head);
          const d = Math.hypot(p.x - x, p.y - y);
          if (!best || d < best.d) best = { id, d };
        }
        if (best) {
          propsRef.current.onSelect(best.id);
          return;
        }
        // Züge haben Vorrang vor Abstellungen
        const site = map.queryRenderedFeatures([[x - r, y - r], [x + r, y + r]], { layers: [PARKING_LAYER] })[0]?.properties?.id;
        if (typeof site === "string") propsRef.current.onSelectSite(site);
      });
      map.on("mouseenter", [...TRAIN_LAYERS, PARKING_LAYER], () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", [...TRAIN_LAYERS, PARKING_LAYER], () => {
        map.getCanvas().style.cursor = "";
      });
      map.on("dragstart", () => {
        if (propsRef.current.follow) propsRef.current.onFollowChange(false);
      });

      /* ------------------- Ein einziger Animationsloop ------------------- */
      let last = 0;
      let loggedError = false;
      const frame = (t: number) => {
        raf = requestAnimationFrame(frame);
        if (t - last < FRAME_MS) return;
        last = t;
        if (!map.getSource(SRC_TRAINS)) return;
        try {
          renderTrains(map, Date.now());
        } catch (err) {
          // Ein fehlerhafter Datensatz darf den Loop nicht dauerhaft stoppen
          if (!loggedError) console.error("Zugdarstellung fehlgeschlagen", err);
          loggedError = true;
        }
      };
      raf = requestAnimationFrame(frame);
    })().catch((err: unknown) => {
      // z. B. WebGL abgeschaltet oder vom Browser gesperrt
      console.error("Karte konnte nicht aufgebaut werden", err);
      if (!cancelled) setFailed(true);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.clearTimeout(slowTimer);
      window.clearTimeout(restoreTimer);
      window.clearTimeout(stableTimer);
      window.clearTimeout(baseTimer);
      document.removeEventListener("visibilitychange", onVisible);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [build, rebuild]);

  /* ------------------------ Züge pro Frame zeichnen ---------------------- */
  function renderTrains(map: MlMap, now: number) {
    const p = propsRef.current;
    const anims = animRef.current;
    const heads = headsRef.current;
    const bodies: GeoJSON.Feature[] = [];
    const points: GeoJSON.Feature[] = [];
    const withBody = map.getZoom() >= MODEL_ZOOM - 0.5;
    const seen = new Set<string>();
    heads.clear();

    for (const trip of p.trips) {
      if (p.hiddenLines.has(trip.line_id)) continue;
      const shape = trip.shape_id != null ? p.shapes.get(trip.shape_id) : null;
      const track = p.trackCache.get(trip, shape);
      if (!track) continue;
      const pos = computeTripPosition(trip, track, now);
      if (!pos || pos.dist == null) continue;
      seen.add(trip.id);

      const prev = anims.get(trip.id);
      const smooth = smoothDistance(prev?.smooth, pos.dist, track.key, now);
      const d = smooth.display;
      let head = track.line.pointAt(d);
      let body = withBody ? track.line.slice(d - trainLengthM(trip), d) : null;

      // Geometriewechsel (z. B. Gerade → echte Shape): räumlich weich angleichen
      let geoFrom = prev?.geoFrom ?? null;
      let geoStart = prev?.geoStart ?? 0;
      if (prev && prev.smooth.trackKey !== track.key && prev.head) {
        geoFrom = prev.head;
        geoStart = now;
      }
      if (geoFrom) {
        const e = easeInOut((now - geoStart) / GEO_BLEND_MS);
        if (e >= 1) geoFrom = null;
        else {
          const dx = (geoFrom[0] - head[0]) * (1 - e);
          const dy = (geoFrom[1] - head[1]) * (1 - e);
          head = [head[0] + dx, head[1] + dy];
          body = body?.map(([x, y]) => [x + dx, y + dy] as LngLat) ?? null;
        }
      }
      anims.set(trip.id, { smooth, head, geoFrom, geoStart });
      heads.set(trip.id, head);

      const dim =
        (p.focusLine != null && p.focusLine !== trip.line_id) ||
        (p.matchIds != null && !p.matchIds.has(trip.id)) ||
        isStaleWebOnly(trip, now);
      const props = {
        id: trip.id,
        line: trip.line_id,
        label: trip.train_number ? `${trip.line_id} · ${trip.train_number}` : trip.line_id,
        color: lineColor(p.lines, trip.line_id),
        rt: positionQuality(trip) === "echtzeit",
        dim: dim && trip.id !== p.selectedId,
        sel: trip.id === p.selectedId,
        bearing: track.line.bearingAt(d),
      };
      if (body) bodies.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: body } });
      points.push({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: head } });
    }
    for (const id of anims.keys()) if (!seen.has(id)) anims.delete(id);

    // Ausgewählter Zug zuletzt → oben
    points.sort((a, b) => Number(a.properties?.sel) - Number(b.properties?.sel));
    setSourceData(map, SRC_TRAINS, { type: "FeatureCollection", features: [...bodies, ...points] });

    if (p.follow && p.selectedId) {
      const h = heads.get(p.selectedId);
      if (h && !map.isMoving()) map.jumpTo({ center: h });
    }
  }

  /* ----------------------------- Strecken -------------------------------- */
  const { shapeList, lines, hiddenLines, focusLine, trips, selectedId } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const features: GeoJSON.Feature[] = shapeList
      .filter((s) => !hiddenLines.has(s.line_id))
      .map((s) => ({
        type: "Feature",
        properties: {
          line: s.line_id,
          color: lineColor(lines, s.line_id),
          dim: focusLine != null && focusLine !== s.line_id,
        },
        geometry: { type: "LineString", coordinates: s.coords },
      }));
    setSourceData(map, SRC_ROUTES, { type: "FeatureCollection", features });
  }, [ready, shapeList, lines, hiddenLines, focusLine]);

  /* ---------------------- Stationen aus den Halten ----------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const byId = new Map<string, GeoJSON.Feature>();
    for (const t of trips) {
      if (hiddenLines.has(t.line_id)) continue;
      for (const s of t.stops) {
        if (s.lat == null || s.lon == null || byId.has(s.station_id)) continue;
        byId.set(s.station_id, {
          type: "Feature",
          properties: { id: s.station_id, name: s.station_name },
          geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        });
      }
    }
    setSourceData(map, SRC_STATIONS, { type: "FeatureCollection", features: [...byId.values()] });
  }, [ready, trips, hiddenLines]);

  /* --------------------------- Abstellungen ------------------------------ */
  const { sites, selectedSite } = props;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    setSourceData(map, SRC_PARKING, {
      type: "FeatureCollection",
      features: sites.flatMap((s): GeoJSON.Feature[] => {
        if (s.lat == null || s.lon == null) return [];
        const n = s.parked.length || s.absent.length + s.moved.length;
        const count = s.parked.length ? `${n}` : `${n}?`;
        return [
          {
            type: "Feature",
            properties: { id: s.id, count, label: `${s.name}: ${n} ${s.parked.length ? "abgestellt" : s.absent.length ? "unsicher" : "verschoben"}`, sure: s.parked.length > 0, sel: s.id === selectedSite },
            geometry: { type: "Point", coordinates: [s.lon, s.lat] },
          },
        ];
      }),
    });
  }, [ready, sites, selectedSite]);

  /* ------------------------ Sichtbarer Bereich -------------------------- */
  const { top, bottom, left, right } = props.padding;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.easeTo({ padding: { top, bottom, left, right }, duration: 250 });
  }, [ready, top, bottom, left, right]);

  /* Zur Abstellung fliegen – nach der Anpassung der Ränder, die den Flug sonst abbricht */
  useEffect(() => {
    const map = mapRef.current;
    const s = propsRef.current.sites.find((x) => x.id === selectedSite);
    if (!map || !ready || s?.lat == null || s.lon == null) return;
    map.flyTo({ center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 14), padding: propsRef.current.padding, speed: 1.4, essential: true });
  }, [ready, selectedSite]);

  /* ------------------- Hinfliegen bei neuer Auswahl ---------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedId) return;
    const fly = () => {
      const h = headsRef.current.get(selectedId);
      // Ränder mitgeben: flyTo bricht die laufende Anpassung der Ränder ab
      if (h) map.flyTo({ center: h, zoom: Math.max(map.getZoom(), 14), padding: propsRef.current.padding, speed: 1.4, essential: true });
      return !!h;
    };
    // Position steht evtl. erst nach dem nächsten Frame fest
    if (!fly()) {
      const id = window.setTimeout(fly, 120);
      return () => window.clearTimeout(id);
    }
  }, [ready, selectedId]);

  return (
    <div className="absolute inset-0">
      {/* Inline-Style, da .maplibregl-map (unlayered CSS) sonst Tailwind-Utilities überschreibt */}
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} aria-label="Karte der S-Bahn Stuttgart" />
      {!ready && (failed || slow) && (
        <FallbackMap
          {...props}
          note={
            failed
              ? "Dein Browser kann die Karte gerade nicht zeichnen (Grafikbeschleunigung). Meist hilft: Browser ganz beenden und neu öffnen."
              : "Die Karte lädt ungewöhnlich lange."
          }
          onRetry={() => rebuild(false)}
        />
      )}
      {!ready && !failed && !slow && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="text-xs tracking-wide text-[var(--muted)]">Karte wird geladen …</span>
        </div>
      )}
      {styleError && (
        <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2 rounded border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-[11px] text-[var(--muted)]">
          {styleError}
        </div>
      )}
    </div>
  );
}
