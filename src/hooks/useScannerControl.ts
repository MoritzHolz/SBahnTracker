"use client";

import { useCallback, useEffect, useState } from "react";
import { localScannerAvailable, localScannerControl, scannerControl, type ScannerAction, type ScannerStatus } from "@/lib/scanner";

/** local = eigener Rechner, der Webserver kann den Worker starten; member = angemeldet, Worker läuft woanders */
export type ControlMode = "checking" | "local" | "member";

export function useScannerControl(apply: (s: ScannerStatus) => void) {
  const [mode, setMode] = useState<ControlMode>("checking");
  const [busy, setBusy] = useState<ScannerAction | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    localScannerAvailable().then((local) => off || setMode(local ? "local" : "member"));
    return () => {
      off = true;
    };
  }, []);

  const send = useCallback(
    async (action: ScannerAction, value?: number): Promise<boolean> => {
      setBusy(action);
      setMsg(null);
      try {
        apply(mode === "local" ? await localScannerControl(action, value) : await scannerControl(null, action, value));
        return true;
      } catch (e) {
        setMsg((e as Error).message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [mode, apply],
  );

  return { mode, busy, msg, send };
}
