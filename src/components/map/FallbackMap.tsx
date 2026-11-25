"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { lineColor } from "@/lib/api";
import type { LngLat } from "@/lib/geo";
import { computeTripPosition } from "@/lib/position";
import { LOOP_DRAWN, LOOP_SIDING } from "@/lib/schwabLoop";
import type { LiveMapProps } from "./LiveMap";

/** Vereinfachte Karte ohne WebGL: Strecken, Halte, Züge und Abstellungen als SVG. */
const KX = Math.cos((48.78 * Math.PI) / 180) * 1000;
const x = (p: LngLat) => (p[0] - 9.18) * KX;
const y = (p: LngLat) => (48.78 - p[1]) * 1000;
const points = (c: LngLat[]) => c.map((p) => `${x(p).toFixed(2)},${y(p).toFixed(2)}`).join(" ");

const START_SPAN = 520; // sichtbare Breite in Tausendstelgrad
const clampSpan = (s: number) => Math.min(900, Math.max(6, s));

export function FallbackMap(p: LiveMapProps & { note: string; onRetry: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [view, setView] = useState({ cx: 0, cy: 0, span: START_SPAN });
  const [now, setNow] = useState(() => Date.now());
  const drag = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth || 1000, h: el.clientHeight || 700 }));
    ro.observe(el);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    // passive: false, sonst scrollt die Seite mit
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => ({ ...v, span: clampSpan(v.span * Math.exp(e.deltaY * 0.0015)) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      ro.disconnect();
      window.clearInterval(id);
      el.removeEventListener("wheel", onWheel);
    };
  }, []);

  const { left, right, top, bottom } = p.padding;
  // Maßstab: Einheiten je Pixel, bezogen auf den nicht verdeckten Bereich
  const u = view.span / Math.max(200, size.w - left - right);
  const vb = { w: size.w * u, h: size.h * u };
  const vx = view.cx - (left + (size.w - left - right) / 2) * u;
  const vy = view.cy - (top + (size.h - top - bottom) / 2) * u;

  const routes = useMemo(
    () => p.shapeList.filter((s) => !p.hiddenLines.has(s.line_id)).map((s) => ({ id: s.id, line: s.line_id, d: points(s.coords) })),
    [p.shapeList, p.hiddenLines],
  );
  const stations = useMemo(() => {
    const m = new Map<string, { name: string; c: LngLat }>();
    for (const t of p.trips) for (const s of t.stops) if (s.lat != null && s.lon != null && !m.has(s.station_id)) m.set(s.station_id, { name: s.station_name, c: [s.lon, s.lat] });
    return [...m.values()];
  }, [p.trips]);

  const trains = p.trips.flatMap((t) => {
    if (p.hiddenLines.has(t.line_id)) return [];
    const track = p.trackCache.get(t, t.shape_id != null ? p.shapes.get(t.shape_id) : null);
    const pos = track && computeTripPosition(t, track, now);
    if (!track || pos?.dist == null) return [];
    const dim = (p.focusLine != null && p.focusLine !== t.line_id) || (p.matchIds != null && !p.matchIds.has(t.id));
    return [{ t, c: track.line.pointAt(pos.dist), b: track.line.bearingAt(pos.dist), dim: dim && t.id !== p.selectedId }];
  });

  // Auswahl in die Mitte holen
  const sel = p.selectedId ? trains.find((k) => k.t.id === p.selectedId) : null;
  const selKey = p.selectedId ?? p.selectedSite;
  const target = sel?.c ?? p.sites.flatMap((s): LngLat[] => (s.id === p.selectedSite && s.lat != null && s.lon != null ? [[s.lon, s.lat]] : []))[0];
  const [shownKey, setShownKey] = useState<string | null>(null);
  if (selKey !== shownKey && (!selKey || target)) {
    setShownKey(selKey ?? null);
    if (target) setView((v) => ({ cx: x(target), cy: y(target), span: Math.min(v.span, 60) }));
  }

  const btn = "grid h-9 w-9 place-items-center border border-line bg-[var(--panel-solid)] text-[18px] hover:bg-white/10 compact:h-11 compact:w-11";
  return (
    <div className="absolute inset-0">
      <svg
        ref={svg}
        className="h-full w-full touch-none cursor-grab select-none"
        viewBox={`${vx} ${vy} ${vb.w} ${vb.h}`}
        role="img"
        aria-label="Vereinfachte Karte der S-Bahn Stuttgart"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || e.buttons === 0) return;
          const dx = (e.clientX - d.x) * u;
          const dy = (e.clientY - d.y) * u;
          drag.current = { x: e.clientX, y: e.clientY };
          setView((v) => ({ ...v, cx: v.cx - dx, cy: v.cy - dy }));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      >
        {routes.map((r) => (
          <polyline
            key={r.id}
            points={r.d}
            fill="none"
            stroke={lineColor(p.lines, r.line)}
            strokeWidth={1.8 * u}
            strokeLinejoin="round"
            opacity={p.focusLine && p.focusLine !== r.line ? 0.15 : 0.8}
          />
        ))}
        {[LOOP_DRAWN, LOOP_SIDING].map((c, i) => (
          <polyline key={i} points={points(c)} fill="none" stroke="#c9ced6" strokeWidth={1.4 * u} strokeDasharray={`${4 * u} ${2 * u}`} opacity={i ? 0.55 : 0.85} />
        ))}
        {stations.map((s) => (
          <g key={s.name}>
            <circle cx={x(s.c)} cy={y(s.c)} r={2.6 * u} fill="#0b0d10" stroke="#c9ced6" strokeWidth={u} />
            {view.span < 160 && (
              <text x={x(s.c)} y={y(s.c) + 14 * u} fontSize={11 * u} fill="#aeb4bd" textAnchor="middle">
                {s.name}
              </text>
            )}
          </g>
        ))}
        {p.sites.map((s) =>
          s.lat == null || s.lon == null ? null : (
            <g key={s.id} className="cursor-pointer" opacity={s.parked.length ? 1 : 0.65} onClick={() => p.onSelectSite(s.id)}>
              <rect x={x([s.lon, s.lat]) - 8 * u} y={y([s.lon, s.lat]) - 8 * u} width={16 * u} height={16 * u} fill="#c4a7ff" />
              <text x={x([s.lon, s.lat])} y={y([s.lon, s.lat]) + 4.5 * u} fontSize={12 * u} fontWeight="bold" fill="#17131f" textAnchor="middle">
                A
              </text>
              <text x={x([s.lon, s.lat]) + 12 * u} y={y([s.lon, s.lat]) + 4 * u} fontSize={11 * u} fontWeight="bold" fill="#c4a7ff">
                {s.parked.length || `${s.absent.length + s.moved.length}?`}
              </text>
            </g>
          ),
        )}
        {trains.map(({ t, c, b, dim }) => (
          <g
            key={t.id}
            className="cursor-pointer"
            opacity={dim ? 0.2 : 1}
            transform={`translate(${x(c)} ${y(c)}) scale(${u})`}
            onClick={() => p.onSelect(t.id)}
          >
            <circle r={14} fill="transparent" stroke={t.id === p.selectedId ? "#f2f4f7" : "none"} />
            <path d="M0-9 7 8 0 4-7 8Z" transform={`rotate(${b})`} fill={lineColor(p.lines, t.line_id)} stroke="#f2f4f7" strokeWidth={1} />
            <text x={11} y={4} fontSize={11} fontWeight="bold" fill={lineColor(p.lines, t.line_id)}>
              {t.line_id}
            </text>
          </g>
        ))}
      </svg>
      <div
        role="status"
        style={{ left: left + (size.w - left - right) / 2, maxWidth: Math.min(416, size.w - left - right - 24) }}
        className="absolute top-[calc(4.5rem+env(safe-area-inset-top))] flex w-max -translate-x-1/2 flex-wrap md:top-[5.75rem] items-center gap-x-3 gap-y-2 rounded-md border border-warn/40 bg-[var(--panel)] px-3 py-2 text-[12px] leading-snug text-[#ffe2a3]"
      >
        <span className="min-w-0 flex-1 basis-52">{p.note} Solange siehst du eine vereinfachte Karte.</span>
        <button onClick={p.onRetry} className="h-9 rounded-md border border-[var(--line-strong)] bg-white/[0.06] px-3 text-[13px] font-medium text-fg hover:bg-white/[0.1] compact:h-11">
          Karte neu laden
        </button>
      </div>
      <div style={{ right: right + 12 }} className="absolute bottom-12 flex flex-col overflow-hidden rounded-md max-md:bottom-[calc(var(--map-bottom,0px)+0.75rem)]">
        <button className={btn} aria-label="Vergrößern" onClick={() => setView((v) => ({ ...v, span: clampSpan(v.span / 1.6) }))}>+</button>
        <button className={btn} aria-label="Verkleinern" onClick={() => setView((v) => ({ ...v, span: clampSpan(v.span * 1.6) }))}>−</button>
      </div>
      <div style={{ right: right + 12 }} className="pointer-events-none absolute bottom-7 text-[10px] text-faint max-md:hidden">© OpenStreetMap-Mitwirkende · Fahrplan/Echtzeit: NVBW EFA (MobiData BW)</div>
    </div>
  );
}
