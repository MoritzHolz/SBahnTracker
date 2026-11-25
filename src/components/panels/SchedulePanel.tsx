"use client";

import { useEffect, useState } from "react";
import { scheduleText, SUGGESTED_WINDOWS, setSchedule, type ScannerStatus, type ScheduleWindow } from "@/lib/scanner";

const windowsKey = (list: ScheduleWindow[]) => list.map((w) => `${w.from}-${w.to}`).sort().join();

/** Optionaler Zeitplan: schaltet den Scanner zu festen Uhrzeiten ein und wieder aus. */
export function SchedulePanel({ status: s, apply, now }: { status: ScannerStatus; apply: (s: ScannerStatus) => void; now: number }) {
  const p = s.schedule;
  const saved = JSON.stringify(p.windows);
  const [windows, setWindows] = useState<ScheduleWindow[]>(p.windows);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  // Änderungen von einem anderen Gerät übernehmen
  useEffect(() => setWindows(JSON.parse(saved) as ScheduleWindow[]), [saved]);
  const dirty = windowsKey(windows) !== windowsKey(p.windows);

  const save = async (enabled: boolean, w: ScheduleWindow[], keepAwake: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      apply(await setSchedule(enabled, w, keepAwake));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = () => {
    const w = windows.length ? windows : SUGGESTED_WINDOWS;
    setWindows(w);
    void save(!p.enabled, w, p.keep_awake);
  };
  const edit = (i: number, patch: Partial<ScheduleWindow>) => setWindows(windows.map((w, j) => (j === i ? { ...w, ...patch } : w)));

  const btn =
    "h-9 compact:h-11 rounded-md border border-[var(--line-strong)] bg-white/[0.06] px-3 text-[13px] font-medium hover:bg-white/[0.1] disabled:cursor-not-allowed disabled:opacity-50";
  const input = "tnum h-9 compact:h-11 min-w-0 max-sm:flex-1 rounded-md border border-line bg-black/30 px-2 text-[14px] text-fg compact:text-[16px] [color-scheme:dark]";

  return (
    <section className="mt-4 rounded-lg border border-line bg-raised p-5 max-sm:p-4">
      <div className="flex items-center gap-4">
        <button
          role="switch"
          aria-checked={p.enabled}
          aria-label="Zeitplan ein- oder ausschalten"
          disabled={busy}
          onClick={toggle}
          className={`relative h-7 w-[52px] shrink-0 rounded-full border transition-colors disabled:opacity-50 compact:h-8 compact:w-[60px] ${
            p.enabled ? "border-accent/50 bg-accent/30" : "border-[var(--line-strong)] bg-black/40"
          }`}
        >
          <span
            className={`absolute left-1 top-1 h-[18px] w-[18px] rounded-full transition-transform duration-200 compact:h-[22px] compact:w-[22px] ${
              p.enabled ? "translate-x-6 bg-accent compact:translate-x-7" : "bg-muted"
            }`}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-tight">
            Zeitplan: <span className={p.enabled ? "text-accent" : "text-muted"}>{p.enabled ? "EIN" : "AUS"}</span>
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-muted">{scheduleText(s, now)}</div>
        </div>
      </div>

      <div className="mt-4 border-t border-line pt-4">
        {windows.length === 0 && (
          <p className="text-[12px] leading-relaxed text-muted">
            Noch kein Zeitfenster. Beim Einschalten werden Vorschläge für die Abstellungen eingetragen:{" "}
            {SUGGESTED_WINDOWS.map((w) => `${w.from}–${w.to}`).join(" und ")} Uhr.
          </p>
        )}
        <ul className="space-y-2">
          {windows.map((w, i) => (
            <li key={i} className="flex items-center gap-2 text-[13px] text-muted">
              <input type="time" required aria-label={`Zeitfenster ${i + 1} von`} value={w.from} disabled={busy} onChange={(e) => edit(i, { from: e.target.value })} className={input} />
              <span>bis</span>
              <input type="time" required aria-label={`Zeitfenster ${i + 1} bis`} value={w.to} disabled={busy} onChange={(e) => edit(i, { to: e.target.value })} className={input} />
              {w.from && w.to && w.to < w.from && <span className="text-[12px] text-faint max-sm:hidden">nächster Tag</span>}
              <button
                onClick={() => setWindows(windows.filter((_, j) => j !== i))}
                disabled={busy}
                aria-label={`Zeitfenster ${i + 1} entfernen`}
                className="ml-auto grid h-9 w-9 place-items-center rounded-md text-muted hover:bg-white/5 hover:text-fg compact:h-11 compact:w-11"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={btn} disabled={busy || windows.length >= 6} onClick={() => setWindows([...windows, windows.length ? { from: "12:00", to: "13:00" } : SUGGESTED_WINDOWS[0]])}>
            Zeitfenster hinzufügen
          </button>
          {dirty && (
            <>
              <button className={`${btn} border-accent/50 text-accent`} disabled={busy || windows.some((w) => !w.from || !w.to)} onClick={() => save(p.enabled && windows.length > 0, windows, p.keep_awake)}>
                Speichern
              </button>
              <button className={btn} disabled={busy} onClick={() => setWindows(p.windows)}>
                Verwerfen
              </button>
            </>
          )}
        </div>
        <label className="mt-3 flex items-center gap-2 text-[12px] text-muted compact:min-h-11 compact:text-[14px]">
          <input type="checkbox" checked={p.keep_awake} disabled={busy} onChange={(e) => save(p.enabled, p.windows, e.target.checked)} />
          Mac während des Zeitfensters wach halten
        </label>
        <p className="mt-2 text-[12px] leading-relaxed text-faint">
          Gilt täglich (deutsche Zeit). Zu Beginn muss der Worker laufen und der Mac wach sein, ein schlafender Mac wird nicht geweckt. Der Schalter oben
          hat Vorrang: Was du von Hand ausschaltest, bleibt bis zum nächsten Zeitfenster aus. Was du von Hand einschaltest, bleibt ein.
        </p>
        {msg && <p role="alert" className="mt-2 text-[12px] text-bad">{msg}</p>}
      </div>
    </section>
  );
}
