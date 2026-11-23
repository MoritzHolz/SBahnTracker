"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchScannerStatus, type ScannerStatus } from "@/lib/scanner";

/** Liest nur den Status. Öffnen der Seite startet nie einen Scan. */
export function useScannerStatus(intervalMs: number) {
  const [status, setStatus] = useState<ScannerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const n = ++seq.current;
    fetchScannerStatus().then(
      (s) => {
        if (n !== seq.current) return;
        setStatus(s);
        setError(null);
      },
      (e: Error) => n === seq.current && setError(e.message),
    );
  }, []);

  /** Antwort eines Steuerbefehls übernehmen; ältere, noch laufende Abfragen verwerfen. */
  const apply = useCallback((s: ScannerStatus) => {
    seq.current++;
    setStatus(s);
    setError(null);
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(() => document.visibilityState !== "hidden" && refresh(), intervalMs);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refresh, intervalMs]);

  return { status, error, refresh, apply };
}
