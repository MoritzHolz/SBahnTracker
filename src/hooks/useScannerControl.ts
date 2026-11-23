"use client";

import { useCallback, useEffect, useState } from "react";
import { localScannerAvailable, localScannerControl, scannerControl, type ScannerAction, type ScannerStatus } from "@/lib/scanner";

const KEY_STORE = "scanner-key";

function readKey(): string {
  try {
    return window.localStorage.getItem(KEY_STORE) ?? "";
  } catch {
    return "";
  }
}
function storeKey(v: string | null) {
  try {
    if (v) window.localStorage.setItem(KEY_STORE, v);
    else window.localStorage.removeItem(KEY_STORE);
  } catch {
    /* ohne Speicher bleibt der Schlüssel nur bis zum Neuladen gültig */
  }
}

/** local = eigener Rechner, ohne Schlüssel; key = mit Schlüssel entsperrt; locked = Schlüssel nötig */
export type ControlMode = "checking" | "local" | "key" | "locked";

export function useScannerControl(apply: (s: ScannerStatus) => void) {
  const [mode, setMode] = useState<ControlMode>("checking");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<ScannerAction | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // Prüft nur, ob bedient werden darf. Ändert nichts am Scanner.
  useEffect(() => {
    let off = false;
    (async () => {
      if (await localScannerAvailable()) return void (off || setMode("local"));
      const k = readKey();
      const valid = k !== "" && (await scannerControl(k, "check").then(() => true, () => false));
      if (off) return;
      if (valid) setKey(k);
      setMode(valid ? "key" : "locked");
    })();
    return () => {
      off = true;
    };
  }, []);

  const send = useCallback(
    async (action: ScannerAction, value?: number): Promise<boolean> => {
      setBusy(action);
      setMsg(null);
      try {
        apply(mode === "local" ? await localScannerControl(action, value) : await scannerControl(key, action, value));
        return true;
      } catch (e) {
        const m = (e as Error).message;
        setMsg(m);
        if (mode === "key" && m.startsWith("Steuerschlüssel")) {
          storeKey(null);
          setKey("");
          setMode("locked");
        }
        return false;
      } finally {
        setBusy(null);
      }
    },
    [mode, key, apply],
  );

  const unlock = useCallback(
    async (k: string): Promise<boolean> => {
      setBusy("check");
      setMsg(null);
      try {
        apply(await scannerControl(k, "check"));
        setKey(k);
        storeKey(k);
        setMode("key");
        return true;
      } catch (e) {
        setMsg((e as Error).message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [apply],
  );

  const lock = useCallback(() => {
    storeKey(null);
    setKey("");
    setMode("locked");
  }, []);

  return { mode, busy, msg, send, unlock, lock };
}
