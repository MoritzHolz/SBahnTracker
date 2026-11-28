"use client";

/** Details einer Abstellung: von jeder Ansicht aus geöffnet, verbindet Woche, Tag, Nacht, Protokoll und Analyse. */
import { useEffect } from "react";
import { LineBadge } from "@/components/ui/Badges";
import { addDays, dayKey, fmtDay, weekNumber, weekOf } from "@/lib/stabling";
import { drawEnd, nightSpan, notesOn, slotLabel, staysAtNote, type Stay } from "@/lib/stablingModel";
import { fmtTime } from "@/lib/time";
import { C, durationText, endText, fmtGap, MarkButton, NoteMark, RecurBadge, RelBadge, startText, STATUS, statusOf, Swatch, TransferMark, Vehicles, type ViewProps } from "./shared";

const WD = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });

/** Nächte (Abende), deren Fenster die Abstellung berührt */
export function nightsOf(s: Stay, now: number, hours: [number, number]): string[] {
  const end = drawEnd(s, now);
  const out: string[] = [];
  for (let k = addDays(dayKey(s.start), -1); k <= dayKey(end); k = addDays(k, 1)) {
    const n = nightSpan(k, hours[0], hours[1]);
    if (s.start < n.to && end > n.from) out.push(k);
  }
  return out;
}

export function DetailPanel(p: ViewProps & { stay: Stay; onClose: () => void }) {
  const { stay: s, now, marks, lineStyle, goTo, select, relByStay, notes, allStays, onClose } = p;
  const e = s.entry;
  const st = STATUS[statusOf(s)];
  const rels = relByStay.get(s.key) ?? [];
  const nights = nightsOf(s, now, p.nightHours);
  const slot = p.recur.get(s.key);
  const end = drawEnd(s, now);
  const noteHits = [];
  for (let k = dayKey(s.start); k <= dayKey(end); k = addDays(k, 1)) {
    for (const n of notesOn(notes.list, k)) if (n.note.station_id === s.station && staysAtNote(allStays, n, now).includes(s)) noteHits.push(n);
  }

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const row = "grid grid-cols-[6.5rem_1fr] gap-x-3 py-1.5";
  const btn = "h-8 rounded-md border border-line px-2.5 text-[12.5px] text-muted hover:bg-white/[0.06] hover:text-fg compact:h-10";
  return (
    <aside
      aria-label="Details der Abstellung"
      className="scroll-thin fixed z-30 overflow-y-auto border-line bg-[var(--panel-solid)] shadow-2xl max-lg:inset-x-0 max-lg:bottom-0 max-lg:max-h-[72dvh] max-lg:rounded-t-xl max-lg:border-t max-lg:pb-[env(safe-area-inset-bottom)] lg:bottom-0 lg:right-0 lg:top-[57px] lg:w-[390px] lg:border-l"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-[var(--panel-solid)] px-4 py-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.1em] text-faint">Abstellung</div>
          <h2 className="truncate text-[16px] font-semibold">
            <TransferMark s={s} />
            {s.stationName}
          </h2>
        </div>
        <button onClick={onClose} aria-label="Details schließen" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[18px] text-muted hover:bg-white/[0.08] hover:text-fg compact:h-10 compact:w-10">
          ×
        </button>
      </div>

      <div className="px-4 py-3 text-[13px]">
        <ul className="space-y-1">
          {s.vehicles.map((v) => (
            <li key={v} className="flex items-center gap-2">
              <MarkButton vehicle={v} marks={marks} />
              <span className="text-[15px]"><Vehicles ids={[v]} marks={marks} /></span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
          <LineBadge id={e.line_id} {...lineStyle(e.line_id)} size="sm" />
          <span className="tnum">Zug {e.train_number}</span>
          {e.origin_name && <span>aus {e.origin_name}</span>}
          <span>· {e.cars} Waggons</span>
        </div>

        <dl className="mt-3 divide-y divide-[var(--line)] border-y border-line">
          <div className={row}>
            <dt className="text-faint">Status</dt>
            <dd className="flex items-center gap-2" title={st.hint}>
              <Swatch status={statusOf(s)} /> {st.label}
            </dd>
          </div>
          <div className={row}>
            <dt className="text-faint">Tag</dt>
            <dd>{WD.format(s.start)}</dd>
          </div>
          <div className={row}>
            <dt className="text-faint">Beginn</dt>
            <dd className="tnum">
              {e.transfer_from ? <>aus {e.transfer_from} überführt, {startText(s)}</> : startText(s)}
              {e.arr_platform && <span className="text-faint"> · Gl. {e.arr_platform}</span>}
            </dd>
          </div>
          <div className={row}>
            <dt className="text-faint">Ende</dt>
            <dd className="tnum">
              {e.transfer_to ? <>nach {e.transfer_to} überführt, Zeitpunkt unbekannt (dort ab {fmtTime(s.end!)})</> : endText(s, now)}
              {e.departed_at && (
                <span className="block text-[12px] text-faint">
                  {e.dep_line_id} Zug {e.dep_train_number ?? "–"}
                  {e.dep_destination && ` nach ${e.dep_destination}`}
                  {e.dep_platform && ` · Gl. ${e.dep_platform}`}
                </span>
              )}
              {!e.departed_at && e.seen_again_at && !e.transfer_to && (
                <span className="block text-[12px] text-faint">
                  wieder gesehen {fmtDay(e.seen_again_at)} {fmtTime(e.seen_again_at)}
                  {e.seen_again_station && ` in ${e.seen_again_station}`}
                  {e.next_line_id && ` als ${e.next_line_id} Zug ${e.next_train_number ?? "–"}`}
                </span>
              )}
            </dd>
          </div>
          <div className={row}>
            <dt className="text-faint">Dauer</dt>
            <dd className="tnum">{durationText(s, now)}</dd>
          </div>
          <div className={row}>
            <dt className="text-faint">Sicherheit</dt>
            <dd className="tnum">{Math.round(e.confidence * 100)} %</dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button className={btn} onClick={() => goTo("woche", { day: dayKey(s.start), key: s.key })}>In der Woche</button>
          <button className={btn} onClick={() => goTo("tag", { day: dayKey(s.start), key: s.key })}>Tag {fmtDay(s.start)}</button>
          {nights.slice(0, 3).map((k) => (
            <button key={k} className={btn} onClick={() => goTo("nacht", { night: k, key: s.key })}>
              Nacht {fmtDay(`${k}T12:00:00Z`).slice(0, 2)} → {fmtDay(`${addDays(k, 1)}T12:00:00Z`).slice(0, 2)}
            </button>
          ))}
          <button className={btn} onClick={() => goTo("protokoll", { key: s.key })}>Im Protokoll</button>
        </div>

        <section className="mt-4">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Zusammenhänge am Standort</h3>
          {rels.length === 0 ? (
            <p className="mt-1.5 text-[12.5px] text-muted">Keine Abstellung am selben Standort gleichzeitig oder innerhalb von {p.windowMin} min davor/danach.</p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {rels.map((r) => {
                const o = r.a.key === s.key ? r.b : r.a;
                return (
                  <li key={r.id}>
                    <button onClick={() => select(o.key)} className="w-full rounded-md border border-line px-2.5 py-2 text-left hover:bg-white/[0.05]">
                      <span className="flex items-center gap-2">
                        <RelBadge category={r.category} />
                        <span className="min-w-0 truncate"><Vehicles ids={o.vehicles} marks={marks} link={false} /></span>
                        <span className="tnum ml-auto shrink-0 text-[12px] text-muted">
                          {r.kind === "follow" ? `Abstand ${fmtGap(r.gapMin)}` : `${fmtTime(r.from)}–${fmtTime(r.to)}`}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[12px] text-faint">{r.reason} · {r.certainty}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {slot && (
          <section className="mt-4">
            <h3 className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
              Wiederkehrend <RecurBadge slot={slot} compact />
            </h3>
            <p className="mt-1.5 text-[12.5px] text-muted">
              In {slot.weeks.length} Wochen wurde hier {slotLabel(slot)} ein Zug abgestellt (Uhrzeit ±{p.recurTol} min, Zug und Fahrzeug egal).
            </p>
            <ul className="mt-1.5 space-y-1">
              {slot.stays.map((o) => (
                <li key={o.key}>
                  <button
                    onClick={() => (o.key === s.key ? undefined : goTo("woche", { day: dayKey(o.start), key: o.key }))}
                    aria-current={o.key === s.key || undefined}
                    className={`flex w-full items-baseline gap-2 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-white/[0.05] ${o.key === s.key ? "bg-white/[0.07]" : ""}`}
                  >
                    <span className="tnum w-12 shrink-0 text-faint">KW {weekNumber(weekOf(dayKey(o.start)))}</span>
                    <span className="tnum w-24 shrink-0">{fmtDay(o.start)} {fmtTime(o.start)}</span>
                    <span className="min-w-0 truncate"><Vehicles ids={o.vehicles} marks={marks} link={false} /></span>
                    {o.key === s.key && <span className="ml-auto shrink-0 text-[11px] text-faint">diese</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {noteHits.length > 0 && (
          <section className="mt-4">
            <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Notizen während der Abstellung</h3>
            <ul className="mt-1.5 space-y-1.5">
              {noteHits.map((n) => (
                <li key={`${n.note.id}-${n.day}`} className="flex gap-2 rounded-md px-2.5 py-2 text-[12.5px]" style={{ border: `1px dashed ${C.note}66` }}>
                  <NoteMark title={n.note.text} />
                  <span>
                    <span className="tnum text-muted">
                      {fmtDay(`${n.day}T12:00:00Z`)} {n.at == null ? "ganztägig" : `${fmtTime(n.at)}${n.until ? `–${fmtTime(n.until)}` : ""}`}
                    </span>{" "}
                    {n.note.text}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
