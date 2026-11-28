"use client";

/**
 * Standortnotizen je Wochentag (z. B. „Plochingen – Montag: Putzer kommt um 08:00“). Eigene Angaben, nie Zugbewegungen.
 * Je Notiz: stand diese Woche zur Notizzeit ein Zug am Standort?
 */
import { useMemo, useState } from "react";
import { checkNote, type NoteDraft } from "@/hooks/useStablingUser";
import { notesOn, staysAtNote, WEEKDAYS, WEEKDAYS_SHORT, weekdayOf, type StationNote } from "@/lib/stablingModel";
import { C, NoteMark, Vehicles, type ViewProps } from "./shared";

/** Die Abstellanlagen; dazu kommen die Standorte aus dem Protokoll */
const SITES: [string, string][] = [
  ["de:08119:7600", "Backnang"],
  ["de:08118:1400", "Bietigheim"],
  ["de:08118:7503", "Marbach (N)"],
  ["de:08111:6002", "Vaihingen"],
  ["de:08115:4512", "Herrenberg"],
  ["de:08116:7802", "Plochingen"],
  ["de:08119:7703", "Schorndorf"],
  ["de:08116:4211", "Kirchheim (T)"],
  ["de:08115:7301", "Leonberg"],
  ["de:08111:6052", "Schwabstraße"],
];

const EMPTY: NoteDraft = { station_id: "", station_name: "", weekday: 1, time_from: null, time_to: null, text: "" };

const timeText = (n: StationNote) => (n.time_from ? `${n.time_from}${n.time_to ? `–${n.time_to}` : ""}` : "ganztägig");

export function NotesView(p: ViewProps) {
  const { notes, allStays, days, now, marks, select } = p;
  const stations = useMemo(() => {
    const m = new Map<string, string>(SITES);
    for (const s of allStays) if (!m.has(s.station)) m.set(s.station, s.stationName);
    for (const n of notes.list) if (!m.has(n.station_id)) m.set(n.station_id, n.station_name);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "de"));
  }, [allStays, notes.list]);

  const [draft, setDraft] = useState<NoteDraft & { id?: number }>(EMPTY);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");

  const edit = (n: StationNote) => {
    setDraft({ id: n.id, station_id: n.station_id, station_name: n.station_name, weekday: n.weekday, time_from: n.time_from, time_to: n.time_to, text: n.text });
    setMsg(null);
    document.getElementById("notiz-form")?.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = checkNote(draft);
    if (problem) return setMsg({ ok: false, text: problem });
    setBusy(true);
    const err = await notes.save(draft);
    setBusy(false);
    if (err) return setMsg({ ok: false, text: err });
    setMsg({ ok: true, text: draft.id ? "Notiz geändert." : "Notiz gespeichert." });
    setDraft({ ...EMPTY, station_id: draft.station_id, station_name: draft.station_name, weekday: draft.weekday });
  };
  const remove = async (n: StationNote) => {
    if (!window.confirm(`Notiz löschen?\n\n${n.station_name}, ${WEEKDAYS[n.weekday - 1]} ${timeText(n)}:\n${n.text}`)) return;
    const err = await notes.remove(n.id);
    setMsg(err ? { ok: false, text: err } : { ok: true, text: "Notiz gelöscht." });
    if (!err && draft.id === n.id) setDraft(EMPTY);
  };

  // Notizen nach Standort, darin nach Wochentag
  const byStation = useMemo(() => {
    const m = new Map<string, { name: string; list: StationNote[] }>();
    for (const n of notes.list) {
      if (filter && n.station_id !== filter) continue;
      const g = m.get(n.station_id) ?? { name: n.station_name, list: [] };
      g.list.push(n);
      m.set(n.station_id, g);
    }
    return [...m].sort((a, b) => a[1].name.localeCompare(b[1].name, "de"));
  }, [notes.list, filter]);

  /** Züge, die diese Woche zur Notizzeit am Standort standen */
  const trainsAt = (n: StationNote) => {
    const day = days.find((d) => weekdayOf(d) === n.weekday)!;
    const occ = notesOn([n], day)[0];
    return occ ? staysAtNote(allStays, occ, now) : [];
  };

  const input = "h-9 min-w-0 rounded-md border border-line bg-black/30 px-2 text-[13px] text-fg compact:h-11 compact:text-[16px] [color-scheme:dark]";
  const label = "text-[11px] text-muted";

  return (
    <section aria-label="Standortnotizen" className="space-y-5">
      <form id="notiz-form" onSubmit={submit} className="rounded-lg p-4" style={{ border: `1px dashed ${C.note}80`, background: `${C.note}0d` }}>
        <h2 className="flex items-center gap-2 text-[14px] font-semibold">
          <NoteMark title="Standortnotiz" /> {draft.id ? "Notiz bearbeiten" : "Neue Notiz"}
        </h2>
        <p className="mt-1 text-[12px] text-muted">Gilt jede Woche am gewählten Wochentag. Notizen sind eigene Angaben und werden nie als Zugbewegung gewertet.</p>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_1fr_0.8fr_0.8fr]">
          <label className="flex flex-col gap-1 max-sm:col-span-2">
            <span className={label}>Standort</span>
            <select
              required
              value={draft.station_id}
              onChange={(e) => setDraft({ ...draft, station_id: e.target.value, station_name: stations.find(([id]) => id === e.target.value)?.[1] ?? "" })}
              className={input}
            >
              <option value="">Standort wählen</option>
              {stations.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 max-sm:col-span-2">
            <span className={label}>Wochentag</span>
            <select value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })} className={input}>
              {WEEKDAYS.map((w, i) => (
                <option key={w} value={i + 1}>
                  {w}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>von (optional)</span>
            <input type="time" value={draft.time_from ?? ""} onChange={(e) => setDraft({ ...draft, time_from: e.target.value || null, time_to: e.target.value ? draft.time_to : null })} className={input} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>bis (optional)</span>
            <input type="time" value={draft.time_to ?? ""} disabled={!draft.time_from} onChange={(e) => setDraft({ ...draft, time_to: e.target.value || null })} className={`${input} disabled:opacity-40`} />
          </label>
        </div>
        <label className="mt-2 flex flex-col gap-1">
          <span className={label}>Notiz</span>
          <textarea
            required
            maxLength={500}
            rows={2}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            placeholder="z. B. Der Putzer kommt um 08:00 Uhr"
            className="min-h-[4.5rem] rounded-md border border-line bg-black/30 px-2 py-1.5 text-[13px] text-fg compact:text-[16px]"
          />
        </label>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="submit" disabled={busy} className="h-9 rounded-md px-3 text-[13px] font-medium text-black disabled:opacity-50 compact:h-11" style={{ background: C.note }}>
            {busy ? "Speichert …" : draft.id ? "Änderung speichern" : "Notiz speichern"}
          </button>
          {draft.id && (
            <button type="button" onClick={() => (setDraft(EMPTY), setMsg(null))} className="h-9 rounded-md border border-line px-3 text-[13px] text-muted hover:text-fg compact:h-11">
              Abbrechen
            </button>
          )}
          {msg && (
            <span role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-ok" : "text-bad"}`}>
              {msg.text}
            </span>
          )}
        </div>
      </form>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">Alle Notizen</h2>
        <span className="tnum text-[12.5px] text-muted">{notes.list.length}</span>
        <select aria-label="Notizen nach Standort filtern" value={filter} onChange={(e) => setFilter(e.target.value)} className={`${input} ml-auto`}>
          <option value="">Alle Standorte</option>
          {stations
            .filter(([id]) => notes.list.some((n) => n.station_id === id))
            .map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
        </select>
      </div>
      {notes.error && <p role="alert" className="text-[13px] text-bad">Notizen nicht abrufbar: {notes.error}</p>}
      {!notes.loaded && <p className="text-[13px] text-faint">Notizen werden geladen …</p>}
      {notes.loaded && byStation.length === 0 && (
        <p className="rounded-lg px-5 py-8 text-center text-[13px] text-muted" style={{ border: `1px dashed ${C.note}55` }}>
          Noch keine Notizen. Lege oben die erste an, z. B. „Plochingen – Montag 08:00: Der Putzer kommt“.
        </p>
      )}

      {byStation.map(([id, g]) => (
        <section key={id} className="overflow-hidden rounded-lg" style={{ border: `1px dashed ${C.note}55` }}>
          <h3 className="flex items-center gap-2 border-b px-4 py-2.5 text-[15px] font-semibold" style={{ borderColor: `${C.note}33`, background: `${C.note}0d` }}>
            <NoteMark title={`Notizen ${g.name}`} /> {g.name}
            <span className="tnum ml-auto text-[12px] font-normal text-muted">{g.list.length}</span>
          </h3>
          {/* Wochentags-Spalten: auf breiten Bildschirmen Mo–So nebeneinander, sonst untereinander */}
          <div className="grid lg:grid-cols-7 lg:divide-x lg:divide-[var(--line)] max-lg:divide-y max-lg:divide-[var(--line)]">
            {WEEKDAYS.map((w, i) => {
              const list = g.list.filter((n) => n.weekday === i + 1).sort((a, b) => (a.time_from ?? "").localeCompare(b.time_from ?? ""));
              if (!list.length) return <div key={w} className="px-3 py-2 text-[12px] text-faint max-lg:hidden"><div className="font-medium">{WEEKDAYS_SHORT[i]}</div>–</div>;
              return (
                <div key={w} className="min-w-0 px-3 py-2">
                  <div className="text-[12px] font-medium text-muted"><span className="lg:hidden">{w}</span><span className="max-lg:hidden">{WEEKDAYS_SHORT[i]}</span></div>
                  <ul className="mt-1 space-y-2">
                    {list.map((n) => {
                      const hits = trainsAt(n);
                      return (
                        <li key={n.id} className="text-[12.5px]">
                          <div className="tnum text-[11.5px]" style={{ color: C.note }}>{timeText(n)}</div>
                          <p className="break-words">{n.text}</p>
                          {hits.length > 0 && (
                            <p className="mt-0.5 text-[11.5px] text-muted">
                              Diese Woche stand {n.time_from ? "um die Zeit" : "an dem Tag"} dort:{" "}
                              {hits.map((s, j) => (
                                <span key={s.key}>
                                  {j > 0 && ", "}
                                  <button onClick={() => select(s.key)} className="underline decoration-white/30 underline-offset-2 hover:text-fg">
                                    <Vehicles ids={s.vehicles} marks={marks} link={false} />
                                  </button>
                                </span>
                              ))}
                            </p>
                          )}
                          <div className="mt-1 flex gap-1">
                            <button onClick={() => edit(n)} className="h-7 rounded px-1.5 text-[11.5px] text-muted hover:bg-white/[0.06] hover:text-fg compact:h-9" aria-label={`Notiz bearbeiten: ${n.text}`}>
                              Bearbeiten
                            </button>
                            <button onClick={() => void remove(n)} className="h-7 rounded px-1.5 text-[11.5px] text-muted hover:bg-white/[0.06] hover:text-bad compact:h-9" aria-label={`Notiz löschen: ${n.text}`}>
                              Löschen
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </section>
  );
}
