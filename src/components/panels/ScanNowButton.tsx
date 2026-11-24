"use client";

import { useEffect, useRef, useState } from "react";
import { useScannerControl } from "@/hooks/useScannerControl";
import { fmtRelative } from "@/lib/time";
import type { ScannerStatus } from "@/lib/scanner";

interface Props {
  status: ScannerStatus | null;
  apply: (s: ScannerStatus) => void;
  now: number;
  /** nach einem abgeschlossenen Scan (Daten neu laden) */
  onFinished?: () => void;
}

const RESULT: Record<string, string> = { ok: "Fertig", partial: "Teilweise gelesen", error: "Fehler", aborted: "Abgebrochen" };

/** Einmaliger Scan auf Knopfdruck. Der Schalter EIN/AUS bleibt unverändert. */
export function ScanNowButton({ status: s, apply, now, onFinished }: Props) {
  const { mode, busy, msg, send } = useScannerControl(apply);
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const running = s?.scan_state === "running" && s.worker_online;
  const recent = requestedAt !== null && now - requestedAt < 25_000;
  const pending = !running && (s?.manual_pending ?? false) && (s!.worker_online || recent);

  const lastId = s?.last_run?.id ?? null;
  const prev = useRef(lastId);
  useEffect(() => {
    if (prev.current !== null && lastId !== null && lastId !== prev.current) {
      onFinished?.();
      setRequestedAt(null);
    }
    prev.current = lastId;
  }, [lastId, onFinished]);

  if (!s || mode === "checking") return null;
  const cls =
    "flex h-9 compact:h-11 w-full items-center justify-center gap-2 rounded-md border border-[var(--line-strong)] bg-white/[0.06] px-3 text-[13px] font-medium hover:bg-white/[0.1] disabled:cursor-default disabled:opacity-60";
  const remoteOffline = mode === "member" && !s.worker_online;
  const stuck = requestedAt !== null && !recent && !running && s.manual_pending && !s.worker_online;
  const run = s.last_run;

  return (
    <div>
      <button
        className={cls}
        disabled={busy != null || running || pending || remoteOffline}
        onClick={() => {
          setRequestedAt(Date.now());
          void send("scan_now");
        }}
      >
        {(running || pending) && <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-accent" />}
        {running ? "Scan läuft …" : pending ? "Scan startet …" : "Jetzt scannen"}
      </button>
      <p className={`mt-1 text-[11px] leading-snug ${msg || stuck ? "text-bad" : "text-faint"}`} aria-live="polite">
        {msg
          ? msg
          : remoteOffline
            ? "Der Worker ist offline. Es kann gerade nicht gescannt werden."
            : stuck
              ? "Der Worker ist nicht gestartet. Details stehen im Terminal des Webservers."
              : running
                ? s.step ?? "Seiten werden gelesen"
                : pending
                  ? "Kann bis zu einer Minute dauern (Mindestabstand der Quelle)."
                  : run
                    ? `${RESULT[run.status] ?? "Letzter Scan"} ${fmtRelative(run.finished_at ?? run.started_at, now)}: ${run.trains_captured} Züge, ${run.formations_found} mit neuen Fahrzeugnummern`
                    : "Liest einmalig Züge und Fahrzeugnummern."}
      </p>
    </div>
  );
}
