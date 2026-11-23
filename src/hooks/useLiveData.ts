"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchLines,
  fetchLiveTrips,
  fetchRouteShapes,
  fetchRouteShapesByIds,
  fetchSourceStatus,
  type Line,
  type LiveTrip,
  type RouteShape,
  type SourceStatus,
} from "@/lib/api";

const TRIPS_INTERVAL_MS = 30_000;
const LINES_INTERVAL_MS = 10 * 60_000;
/** Fehlende Shapes frühestens nach dieser Zeit erneut anfragen */
const SHAPE_RETRY_MS = 3 * 60_000;

export interface LiveData {
  trips: LiveTrip[];
  shapes: Map<number, RouteShape>;
  shapeList: RouteShape[];
  lines: Map<string, Line>;
  lineList: Line[];
  status: SourceStatus | null;
  /** Zeitpunkt des letzten erfolgreichen Trip-Abrufs im Browser */
  fetchedAt: number | null;
  loading: boolean;
  /** Fehler bei Trips/Status (für Banner) */
  error: string | null;
}

function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    ref.current();
    const id = window.setInterval(() => {
      if (document.visibilityState !== "hidden") ref.current();
    }, ms);
    const onVis = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [ms]);
}

/**
 * Liefert eine Funktion, die Anfragen durchnummeriert: Nur die Antwort der
 * jeweils neuesten Anfrage wird übernommen, ältere werden verworfen.
 */
function useLatest() {
  const seq = useRef(new Map<string, number>());
  return useCallback(<T,>(kind: string, p: Promise<T>, onOk: (v: T) => void, onErr: (e: Error) => void) => {
    const n = (seq.current.get(kind) ?? 0) + 1;
    seq.current.set(kind, n);
    p.then(
      (v) => {
        if (seq.current.get(kind) === n) onOk(v);
      },
      (e: Error) => {
        if (seq.current.get(kind) === n) onErr(e);
      },
    );
  }, []);
}

export function useLiveData(): LiveData {
  const [trips, setTrips] = useState<LiveTrip[]>([]);
  const [shapes, setShapes] = useState<Map<number, RouteShape>>(() => new Map());
  const [lineList, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const latest = useLatest();

  const setErr = useCallback(
    (k: string, v: string | null) => setErrors((e) => (e[k] === v ? e : { ...e, [k]: v })),
    [],
  );

  const mergeShapes = useCallback((list: RouteShape[]) => {
    if (list.length === 0) return;
    setShapes((prev) => {
      const next = new Map(prev);
      for (const s of list) next.set(s.id, s);
      return next;
    });
  }, []);

  /* Trips + Status alle 30 s */
  useInterval(() => {
    latest(
      "trips",
      fetchLiveTrips(),
      (t) => {
        setTrips(t);
        setFetchedAt(Date.now());
        setErr("trips", null);
        setLoading(false);
      },
      (e) => {
        setErr("trips", e.message);
        setLoading(false);
      },
    );
    latest(
      "status",
      fetchSourceStatus(),
      (s) => {
        setStatus(s);
        setErr("status", null);
      },
      (e) => setErr("status", e.message),
    );
  }, TRIPS_INTERVAL_MS);

  /* Linien selten */
  useInterval(() => {
    latest("lines", fetchLines(), setLines, (e) => console.warn(e.message));
  }, LINES_INTERVAL_MS);

  /* Shapes: einmal alle, danach nur fehlende IDs */
  const initialShapes = useRef<"pending" | "done" | "failed">("pending");
  const requested = useRef(new Map<number, number>());
  useEffect(() => {
    fetchRouteShapes().then(
      (list) => {
        initialShapes.current = "done";
        mergeShapes(list);
      },
      (e: Error) => {
        initialShapes.current = "failed";
        console.warn(e.message);
      },
    );
  }, [mergeShapes]);

  useEffect(() => {
    if (initialShapes.current === "pending") return;
    const now = Date.now();
    const missing = [
      ...new Set(trips.map((t) => t.shape_id).filter((id): id is number => id != null && !shapes.has(id))),
    ].filter((id) => now - (requested.current.get(id) ?? 0) > SHAPE_RETRY_MS);
    if (missing.length === 0) return;
    missing.forEach((id) => requested.current.set(id, now));
    fetchRouteShapesByIds(missing).then(mergeShapes, (e: Error) => console.warn(e.message));
  }, [trips, shapes, mergeShapes]);

  const shapeList = useMemo(() => [...shapes.values()], [shapes]);
  const lines = useMemo(() => new Map(lineList.map((l) => [l.id, l])), [lineList]);
  const error = [errors.trips, errors.status].filter(Boolean).join(" · ") || null;

  return { trips, shapes, shapeList, lines, lineList, status, fetchedAt, loading, error };
}

/** Tick für UI-Aktualisierungen (Listen, relative Zeiten). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
