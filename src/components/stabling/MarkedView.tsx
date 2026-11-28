"use client";

/**
 * Markierte Fahrzeuge: letzter bekannter Standort und letzte Abstellungen.
 * „Aktuell“ nur bei frischer Sichtung; sonst ausdrücklich „zuletzt bekannt“. Kein Echtzeitstandort wird vorgetäuscht.
 */
import { useEffect, useState } from "react";
import { searchVehicle, type VehicleSearchResult } from "@/lib/api";
import { vehicleStatusLabel } from "@/lib/parking";
import { byStart, type Stay } from "@/lib/stablingModel";
import { fmtDateTime, fmtRelative, fmtTime } from "@/lib/time";
import { C, durationText, endText, MarkButton, startText, STATUS, statusOf, Swatch, TransferMark, type ViewProps } from "./shared";

const FRESH_MS = 20 * 60_000;
const REFRESH_MS = 60_000;
const SHOW_STAYS = 4;

type Info = { r: VehicleSearchResult | null; error: string | null; at: number };

export function MarkedView(p: ViewProps) {
  const { marks, allStays, now, select, selected } = p;
  const ids = [...marks.ids].sort((a, b) => a.localeCompare(b, "de"));
  const [info, setInfo] = useState<Map<string, Info>>(() => new Map());
  const [add, setAdd] = useState("");
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const key = ids.join("|");

  useEffect(() => {
    if (!key) return;
    let alive = true;
    const load = () =>
      Promise.all(
        key.split("|").map((id) =>
          searchVehicle(id).then(
            (rs): [string, Info] => [id, { r: rs.find((x) => x.vehicle.id === id) ?? null, error: null, at: Date.now() }],
            (e: Error): [string, Info] => [id, { r: null, error: e.message, at: Date.now() }],
          ),
        ),
      ).then((rows) => alive && setInfo(new Map(rows)));
    void load();
    const t = window.setInterval(() => document.visibilityState !== "hidden" && void load(), REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [key]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = add.trim().replace(/\s+/g, " ").replace(/^(\d{3})(\d{3})$/, "$1 $2");
    if (!/^\d{3} \d{3}$/.test(v)) return setAddMsg("Bitte eine Fahrzeugnummer wie 430 101 eingeben.");
    if (marks.isMarked(v)) return setAddMsg(`${v} ist schon markiert.`);
    setAddMsg(null);
    setAdd("");
    void marks.toggle(v);
  };

  return (
    <section aria-label="Markierte Fahrzeuge" className="space-y-4">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="mark-add">Fahrzeug markieren</label>
        <input
          id="mark-add"
          value={add}
          onChange={(e) => setAdd(e.target.value)}
          placeholder="Fahrzeug, z. B. 430 101"
          inputMode="numeric"
          className="h-9 w-52 rounded-md border border-line bg-black/30 px-2 text-[13px] text-fg compact:h-11 compact:text-[16px] max-sm:flex-1"
        />
        <button type="submit" className="h-9 rounded-md border px-3 text-[13px] font-medium compact:h-11" style={{ borderColor: `${C.marked}80`, color: C.marked }}>
          ★ Markieren
        </button>
        {addMsg && <span role="alert" className="text-[12.5px] text-bad">{addMsg}</span>}
        <span className="text-[12px] text-faint sm:ml-auto">Markieren geht auch mit einem Klick auf ☆ in Details und Protokoll.</span>
      </form>

      {!marks.loaded && <p className="text-[13px] text-faint">Markierungen werden geladen …</p>}
      {marks.loaded && ids.length === 0 && (
        <p className="rounded-lg border border-line px-5 py-8 text-center text-[13px] text-muted">
          Noch kein Fahrzeug markiert. Markierte Fahrzeuge erscheinen in Woche, Tag, Nacht, Protokoll, Analyse und auf der Karte mit <span style={{ color: C.marked }}>★</span>.
        </p>
      )}

      <ul className="grid gap-3 md:grid-cols-2">
        {ids.map((id) => {
          const stays = allStays.filter((s) => s.vehicles.includes(id)).sort((a, b) => byStart(b, a));
          return (
            <li key={id} className="overflow-hidden rounded-lg border" style={{ borderColor: `${C.marked}55` }}>
              <div className="flex items-center gap-2 border-b border-line bg-raised px-3 py-2">
                <MarkButton vehicle={id} marks={marks} />
                <a href={`/fahrzeuge?q=${encodeURIComponent(id)}`} className="tnum text-[16px] font-semibold hover:underline" style={{ color: C.marked }}>
                  {id}
                </a>
              </div>
              <div className="px-4 py-3 text-[13px]">
                <Whereabouts info={info.get(id)} stays={stays} now={now} />
                <h3 className="mt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Letzte Abstellungen (Woche und Vorwoche)</h3>
                {stays.length === 0 ? (
                  <p className="mt-1 text-[12.5px] text-muted">Keine Abstellung im Protokoll dieses Zeitraums.</p>
                ) : (
                  <ul className="mt-1 divide-y divide-[var(--line)]">
                    {stays.slice(0, SHOW_STAYS).map((s) => (
                      <StayLine key={s.key} s={s} now={now} on={selected === s.key} onClick={() => select(selected === s.key ? null : s.key)} />
                    ))}
                  </ul>
                )}
                {stays.length > SHOW_STAYS && <p className="mt-1 text-[12px] text-faint">und {stays.length - SHOW_STAYS} weitere im Protokoll</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StayLine({ s, now, on, onClick }: { s: Stay; now: number; on: boolean; onClick: () => void }) {
  const st = statusOf(s);
  return (
    <li>
      <button onClick={onClick} aria-pressed={on} className={`flex w-full items-start gap-2 py-2 text-left hover:bg-white/[0.035] ${on ? "bg-white/[0.07]" : ""}`}>
        <Swatch status={st} className="mt-1.5 h-2.5 w-3" />
        <span className="min-w-0 flex-1">
          <span className="font-medium">
            <TransferMark s={s} />
            {s.stationName}
          </span>
          <span className="tnum block text-[12px] text-muted">
            {startText(s)} – {s.entry.transfer_to ? `nach ${s.entry.transfer_to} überführt` : endText(s, now)}
          </span>
        </span>
        <span className="tnum shrink-0 text-[12px] text-muted" title={STATUS[st].hint}>{durationText(s, now)}</span>
      </button>
    </li>
  );
}

/** Wo ist das Fahrzeug? Aktuell nur mit frischer Sichtung, sonst zuletzt bekannt. */
function Whereabouts({ info, stays, now }: { info: Info | undefined; stays: Stay[]; now: number }) {
  const standing = stays.find((s) => s.endKind === "ongoing");
  const v = info?.r?.vehicle;
  const last = v?.last_seen ? Date.parse(v.last_seen) : null;
  const fresh = last != null && now - last < FRESH_MS;
  const parking = info?.r?.parking;
  return (
    <div className="space-y-1">
      {standing ? (
        <p>
          <span className="font-medium" style={{ color: C.standing }}>Steht laut Scans in {standing.stationName}</span>{" "}
          <span className="tnum text-muted">seit {startText(standing)}</span>
          <span className="block text-[12px] text-faint">Annahme aus den letzten Scans, keine Live-Ortung.</span>
        </p>
      ) : null}
      {!info ? (
        <p className="text-[12.5px] text-faint">Stand wird geladen …</p>
      ) : info.error ? (
        <p className="text-[12.5px] text-bad">Stand nicht abrufbar: {info.error}</p>
      ) : !v ? (
        <p className="text-[12.5px] text-muted">Zu diesem Fahrzeug liegen keine Sichtungen vor.</p>
      ) : (
        <p>
          {fresh ? (
            <span className="font-medium text-ok">Aktuell (Sichtung {fmtRelative(last, now)})</span>
          ) : (
            <span className="font-medium text-muted">Zuletzt bekannt ({last ? fmtRelative(last, now) : "Zeit unbekannt"})</span>
          )}
          :{" "}
          {v.last_station_name ?? "Ort unbekannt"}
          {v.last_line_id && (
            <span className="text-muted">
              {" "}
              · {v.last_line_id}
              {v.last_train_number ? ` Zug ${v.last_train_number}` : ""}
              {v.last_destination ? ` nach ${v.last_destination}` : ""}
            </span>
          )}
          <span className="tnum block text-[12px] text-faint">
            {last ? `${fmtDateTime(last)} · ` : ""}Status: {vehicleStatusLabel(v.status)}
            {!fresh && " · kein aktueller Standort"}
          </span>
        </p>
      )}
      {parking?.station_name && !standing && (
        <p className="text-[12px] text-muted">
          Schätzung: {parking.station_name}
          {parking.status && ` (${vehicleStatusLabel(parking.status)})`}
          {parking.last_sighting_at && `, letzte Sichtung ${fmtTime(parking.last_sighting_at)}`}
        </p>
      )}
    </div>
  );
}
