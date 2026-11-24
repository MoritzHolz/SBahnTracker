"use client";

import { useCallback, useRef, useState } from "react";

export type Snap = "peek" | "half" | "full";

/** Platz oben für die Navigationsleiste (px, ohne Notch) */
export const TOP_BAR_PX = 56;
/** Ab dieser Bewegung gilt eine Berührung als Ziehen, nicht als Tippen */
const DRAG_START_PX = 6;
const FLICK_PX_PER_MS = 0.35;
const ORDER: Snap[] = ["peek", "half", "full"];

export function sheetHeightCss(snap: Snap, peekPx: number): string {
  if (snap === "peek") return `calc(${peekPx}px + env(safe-area-inset-bottom))`;
  if (snap === "half") return "50dvh";
  return `calc(100dvh - ${TOP_BAR_PX}px - env(safe-area-inset-top))`;
}

/** Raststufe beim Loslassen: bei schnellem Wischen die nächste in Wischrichtung, sonst die nächstgelegene. */
export function snapAfterDrag(heightPx: number, velocityUp: number, viewportPx: number, peekPx: number): Snap {
  const px: Record<Snap, number> = { peek: peekPx, half: viewportPx / 2, full: viewportPx - TOP_BAR_PX };
  if (velocityUp > FLICK_PX_PER_MS) return ORDER.find((s) => px[s] > heightPx) ?? "full";
  if (velocityUp < -FLICK_PX_PER_MS) return [...ORDER].reverse().find((s) => px[s] < heightPx) ?? "peek";
  return ORDER.reduce((a, b) => (Math.abs(px[b] - heightPx) < Math.abs(px[a] - heightPx) ? b : a));
}

/** Blatt am unteren Bildschirmrand, das sich am Griff ziehen lässt (nur Handy-Ansicht). */
export function useBottomSheet(initial: Snap, peekPx: number) {
  const [snap, setSnap] = useState<Snap>(initial);
  const [dragPx, setDragPx] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startH: number; y: number; t: number; v: number; active: boolean } | null>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const suppressClick = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    suppressClick.current = false;
    if (!sheetRef.current || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    drag.current = { startY: e.clientY, startH: sheetRef.current.offsetHeight, y: e.clientY, t: e.timeStamp, v: 0, active: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.active) {
      if (Math.abs(e.clientY - d.startY) < DRAG_START_PX) return;
      d.active = true;
      suppressClick.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dt = e.timeStamp - d.t;
    if (dt > 0) d.v = (d.y - e.clientY) / dt;
    d.y = e.clientY;
    d.t = e.timeStamp;
    const max = window.innerHeight - TOP_BAR_PX;
    setDragPx(Math.round(Math.min(max, Math.max(peekPx, d.startH + d.startY - e.clientY))));
  }, [peekPx]);

  const end = useCallback((e: React.PointerEvent, cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    setDragPx(null);
    if (cancelled) return;
    // Wer vor dem Loslassen anhält, wischt nicht mehr
    const v = e.timeStamp - d.t > 80 ? 0 : d.v;
    setSnap(snapAfterDrag(d.startH + d.startY - d.y, v, window.innerHeight, peekPx));
  }, [peekPx]);

  const onPointerUp = useCallback((e: React.PointerEvent) => end(e, false), [end]);
  const onPointerCancel = useCallback((e: React.PointerEvent) => end(e, true), [end]);
  // Nach dem Ziehen keinen Klick auf Knöpfe im Griffbereich auslösen
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClick.current) return;
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const toggle = useCallback(() => setSnap((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek")), []);

  return {
    snap,
    setSnap,
    toggle,
    dragging: dragPx != null,
    height: dragPx != null ? `${dragPx}px` : sheetHeightCss(snap, peekPx),
    sheetRef,
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onClickCapture },
  };
}
