"use client";

import { useEffect, useId, useState } from "react";
import { reportFormation, type LiveTrip } from "@/lib/api";
import { normalizeVehicle, unitNumber } from "@/lib/trips";

const PIN_KEY = "sbahn-live.report-pin";
const MAX_UNITS = 12;

function readPin(): string {
  try {
    return window.localStorage.getItem(PIN_KEY) ?? "";
  } catch {
    return "";
  }
}
function writePin(pin: string | null) {
  try {
    if (pin) window.localStorage.setItem(PIN_KEY, pin);
    else window.localStorage.removeItem(PIN_KEY);
  } catch {
    /* localStorage nicht verfügbar (z. B. privater Modus) */
  }
}

interface Props {
  trip: LiveTrip;
  /** Index (trip.stops) des aktuellen bzw. letzten Halts laut Position */
  defaultStopIdx: number | null;
  onDone: (vehicles: string[]) => void;
  onCancel: () => void;
}

export function ReportFormation({ trip, defaultStopIdx, onDone, onCancel }: Props) {
  const uid = useId();
  const initial = trip.formation?.vehicles?.length ? trip.formation.vehicles.map(String) : [""];
  const [units, setUnits] = useState<string[]>(initial.slice(0, MAX_UNITS));
  const defaultStation = defaultStopIdx != null ? trip.stops[defaultStopIdx]?.station_id ?? "" : "";
  const [stationId, setStationId] = useState(defaultStation);
  const [savedPin, setSavedPin] = useState("");
  const [pin, setPin] = useState("");
  const [remember, setRemember] = useState(true);
  const [editPin, setEditPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const p = readPin();
    setSavedPin(p);
    setEditPin(!p);
  }, []);

  const filled = units.map((u) => u.trim()).filter(Boolean);
  const invalid = units.map((u) => u.trim() !== "" && normalizeVehicle(u) == null);
  const canSubmit = filled.length > 0 && !invalid.some(Boolean) && (editPin ? pin.trim() !== "" : savedPin !== "") && !busy;

  const stopOptions = trip.stops
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s.cancelled && s.station_id);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    const usePin = editPin ? pin.trim() : savedPin;
    const vehicles = [...new Set(filled.map((u) => unitNumber(u)!))];
    setBusy(true);
    setError(null);
    const res = await reportFormation(usePin, trip.id, vehicles, stationId || null);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      if (/pin/i.test(res.error) && !editPin) {
        // Gespeicherte PIN ist offenbar falsch → neu eingeben
        writePin(null);
        setSavedPin("");
        setEditPin(true);
      }
      return;
    }
    if (editPin) {
      writePin(remember ? usePin : null);
      setSavedPin(remember ? usePin : "");
    }
    onDone(res.vehicles);
  };

  return (
    <form onSubmit={submit} className="anim-in mt-3 rounded-md border border-line bg-black/20 p-3">
      <div className="mb-2 text-[12px] font-medium text-fg">Fahrzeuge melden</div>

      <div className="space-y-1.5">
        {units.map((u, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <label htmlFor={`${uid}-u${i}`} className="w-16 shrink-0 text-[11px] text-faint">
              Einheit {i + 1}
            </label>
            <input
              id={`${uid}-u${i}`}
              value={u}
              inputMode="numeric"
              autoComplete="off"
              placeholder="423 310"
              aria-invalid={invalid[i]}
              onChange={(e) => setUnits((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
              onBlur={(e) => {
                const n = unitNumber(e.target.value);
                if (n) setUnits((prev) => prev.map((x, j) => (j === i ? n : x)));
              }}
              className={`tnum h-8 compact:h-11 min-w-0 flex-1 rounded-md border bg-black/30 px-2 text-[13px] placeholder:text-faint focus:outline-none ${
                invalid[i] ? "border-bad/60" : "border-line focus:border-[var(--line-strong)]"
              }`}
            />
            {units.length > 1 && (
              <button
                type="button"
                onClick={() => setUnits((prev) => prev.filter((_, j) => j !== i))}
                className="grid h-8 w-7 compact:h-11 compact:w-11 place-items-center rounded-md text-faint hover:bg-white/5 hover:text-fg"
                aria-label={`Einheit ${i + 1} entfernen`}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      {invalid.some(Boolean) && (
        <p className="mt-1 text-[11px] text-bad">Bitte 6-stellige Nummern eingeben, z. B. 423 310.</p>
      )}
      {units.length < MAX_UNITS && (
        <button
          type="button"
          onClick={() => setUnits((prev) => [...prev, ""])}
          className="mt-1.5 text-[11.5px] text-muted compact:min-h-11 compact:text-[13px] hover:text-fg"
        >
          + weitere Einheit
        </button>
      )}
      <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
        Die Fahrzeugnummer steht innen über den Türen bzw. außen am Fahrzeug. Wagennummern wie 423 810 werden der Einheit 423 310 zugeordnet.
      </p>

      <label className="mt-3 grid grid-cols-[4.5rem_1fr] items-center gap-1.5 text-[12px]">
        <span className="text-[11px] text-faint">gesehen an</span>
        <select
          value={stationId}
          onChange={(e) => setStationId(e.target.value)}
          className="h-8 compact:h-11 min-w-0 rounded-md border border-line bg-black/30 px-2 text-[12px] focus:outline-none"
        >
          <option value="" className="bg-[var(--panel-solid)]">
            keine Angabe
          </option>
          {stopOptions.map(({ s, i }) => (
            <option key={`${s.station_id}-${i}`} value={s.station_id} className="bg-[var(--panel-solid)]">
              {s.station_name}
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3">
        {editPin ? (
          <div className="grid grid-cols-[4.5rem_1fr] items-center gap-1.5">
            <label htmlFor={`${uid}-pin`} className="text-[11px] text-faint">
              PIN
            </label>
            <input
              id={`${uid}-pin`}
              type="password"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="h-8 compact:h-11 min-w-0 rounded-md border border-line bg-black/30 px-2 text-[13px] focus:border-[var(--line-strong)] focus:outline-none"
            />
            <span />
            <label className="flex items-center gap-1.5 text-[11px] text-muted compact:min-h-11 compact:gap-2.5 compact:text-[13px]">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              PIN auf diesem Gerät merken
            </label>
          </div>
        ) : (
          <div className="flex items-center justify-between text-[11.5px] text-muted">
            <span>PIN gespeichert</span>
            <button
              type="button"
              onClick={() => {
                writePin(null);
                setSavedPin("");
                setPin("");
                setEditPin(true);
              }}
              className="compact:min-h-11 compact:text-[13px] text-muted underline decoration-[var(--line-strong)] underline-offset-2 hover:text-fg"
            >
              PIN vergessen / ändern
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-2.5 rounded border border-bad/40 bg-bad/10 px-2 py-1.5 text-[12px] text-[#ffb4b4]">
          {error}
        </p>
      )}
      {touched && filled.length === 0 && <p className="mt-2 text-[11px] text-bad">Mindestens eine Fahrzeugnummer angeben.</p>}

      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" onClick={onCancel} className="h-8 compact:h-11 compact:text-[14px] rounded-md px-3 text-[12px] text-muted hover:text-fg">
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="h-8 compact:h-11 compact:text-[14px] rounded-md border border-[var(--line-strong)] bg-white/[0.08] px-3 text-[12px] font-medium hover:bg-white/[0.12] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Wird gesendet …" : "Meldung senden"}
        </button>
      </div>
    </form>
  );
}
