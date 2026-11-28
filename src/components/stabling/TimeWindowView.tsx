"use client";

/**
 * Tages- und Nachtansicht: waagrechte Zeitachse, je Standort gruppiert, je Abstellung eine Zeile.
 * Die Nacht „Mi → Do“ ist nur ein anderes Zeitfenster (Standard Do 00:00–06:00) derselben Abstellungen.
 */
import { useMemo } from "react";
import { addDays, dayKey, dayStart, fmtDay } from "@/lib/stabling";
import { dayRange, nightSpan, notesInRange, segmentsIn, staysAtNote, weekdayOf, weekNights, WEEKDAYS, WEEKDAYS_SHORT, type NoteAt, type Range, type Seg } from "@/lib/stablingModel";
import { fmtTime } from "@/lib/time";
import { blockBackground, blockRing, C, durationText, endText, Legend, NoteMark, RelBadge, startText, TransferMark, Vehicles, type ViewProps } from "./shared";
import { FilterBar, H, stayTitle, useScrollToSelected, useStayFilter } from "./TimeShared";

const NIGHT_FROM: [number, string][] = [
  [-6, "18:00 (Vorabend)"],
  [-4, "20:00 (Vorabend)"],
  [-2, "22:00 (Vorabend)"],
  [0, "00:00"],
];
const NIGHT_TO: [number, string][] = [
  [4, "04:00"],
  [6, "06:00"],
  [8, "08:00"],
  [10, "10:00"],
];

export function TimeWindowView(p: ViewProps & { mode: "tag" | "nacht" }) {
  const { mode, now, days, today, marks } = p;
  const isNight = mode === "nacht";
  const f = useStayFilter(p);
  const range: Range = useMemo(() => {
    if (!isNight) return dayRange(p.day);
    const n = nightSpan(p.night, p.nightHours[0], p.nightHours[1]);
    return [n.from, n.to];
  }, [isNight, p.day, p.night, p.nightHours]);
  const [a, b] = range;
  const span = b - a;
  const segs = useMemo(() => segmentsIn(f.filtered, range, now), [f.filtered, range, now]);
  const notes = useMemo(() => notesInRange(p.notes.list, range).filter((n) => !f.station || n.note.station_id === f.station), [p.notes.list, range, f.station]);
  useScrollToSelected(p.selected, segs);

  // Standorte mit Abstellungen oder Notizen im Fenster
  const groups = useMemo(() => {
    const m = new Map<string, { id: string; name: string; segs: Seg[]; notes: NoteAt[] }>();
    const g = (id: string, name: string) => m.get(id) ?? m.set(id, { id, name, segs: [], notes: [] }).get(id)!;
    for (const s of segs) g(s.stay.station, s.stay.stationName).segs.push(s);
    for (const n of notes) g(n.note.station_id, n.note.station_name).notes.push(n);
    return [...m.values()].sort((x, y) => x.name.localeCompare(y.name, "de"));
  }, [segs, notes]);

  const stepH = span <= 8 * H ? 1 : span <= 14 * H ? 2 : 3;
  const ticks: number[] = [];
  for (let t = a; t <= b + 1; t += stepH * H) ticks.push(t);
  const x = (t: number) => ((t - a) / span) * 100;
  const nowAt = now >= a && now < b ? x(now) : null;
  const tickLabel = (t: number) => (t >= b && !isNight ? "24:00" : fmtTime(t));
  const wdName = (key: string) => WEEKDAYS[weekdayOf(key) - 1];
  const count = (r: Range) => segmentsIn(f.filtered, r, now).length;

  const chip = (on: boolean) =>
    `tnum h-8 shrink-0 rounded-md border px-2.5 text-[12.5px] compact:h-11 compact:px-3 ${on ? "border-[#c4a7ff]/60 bg-[#c4a7ff]/10 text-fg" : "border-line text-muted hover:text-fg"}`;
  const select =
    "h-9 rounded-md border border-line bg-black/30 px-2 text-[13px] text-fg compact:h-11 compact:text-[16px] [color-scheme:dark]";

  const heading = isNight
    ? `${wdName(p.night)} → ${wdName(addDays(p.night, 1))} | Nachtübersicht`
    : `${wdName(p.day)}, ${fmtDay(dayStart(p.day) + H).slice(3)} | Tagesansicht`;

  return (
    <section aria-label={heading} className="space-y-3">
      <div role="group" aria-label={isNight ? "Nacht wählen" : "Tag wählen"} className="scroll-thin flex gap-1.5 overflow-x-auto pb-0.5">
        {isNight
          ? weekNights(p.week, p.nightHours[0], p.nightHours[1]).map((n, i) => {
              const c = count([n.from, n.to]);
              return (
                <button key={n.evening} aria-pressed={n.evening === p.night} onClick={() => p.goTo("nacht", { night: n.evening })} className={chip(n.evening === p.night)}>
                  <span aria-hidden style={{ color: C.stay }}>☾ </span>
                  {WEEKDAYS_SHORT[i]} → {WEEKDAYS_SHORT[(i + 1) % 7]}
                  {c > 0 && <span className="ml-1 text-faint">{c}</span>}
                </button>
              );
            })
          : days.map((d) => {
              const c = count(dayRange(d));
              return (
                <button key={d} aria-pressed={d === p.day} onClick={() => p.goTo("tag", { day: d })} className={chip(d === p.day)}>
                  {fmtDay(dayStart(d) + H)}
                  {d === today && <span className="text-faint"> heute</span>}
                  {c > 0 && <span className="ml-1 text-faint">{c}</span>}
                </button>
              );
            })}
      </div>

      <div className="rounded-lg border border-line p-4 max-sm:p-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div>
            <h2 className="text-[15px] font-semibold">{heading}</h2>
            <p className="tnum text-[12.5px] text-muted">
              {fmtDay(a)} {fmtTime(a)} – {fmtDay(b - 1)} {tickLabel(b)} · {segs.length} {segs.length === 1 ? "Abstellung" : "Abstellungen"}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {isNight ? (
              <>
                <button className={chip(false)} onClick={() => p.goTo("tag", { day: p.night })}>Tag {fmtDay(dayStart(p.night) + H)}</button>
                <button className={chip(false)} onClick={() => p.goTo("tag", { day: addDays(p.night, 1) })}>Tag {fmtDay(dayStart(addDays(p.night, 1)) + H)}</button>
              </>
            ) : (
              <>
                <button className={chip(false)} onClick={() => p.goTo("nacht", { night: addDays(p.day, -1) })}>
                  <span style={{ color: C.stay }}>☾</span> Nacht davor
                </button>
                <button className={chip(false)} onClick={() => p.goTo("nacht", { night: p.day })}>
                  <span style={{ color: C.stay }}>☾</span> Nacht danach
                </button>
              </>
            )}
          </div>
        </div>

        <div className="mt-3 space-y-2">
            {isNight && (
              <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
                <span>Zeitspanne</span>
                <label className="flex items-center gap-1.5">
                  von
                  <select aria-label="Nacht beginnt" value={p.nightHours[0]} onChange={(e) => p.setNightHours([Number(e.target.value), p.nightHours[1]])} className={select}>
                    {NIGHT_FROM.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  bis
                  <select aria-label="Nacht endet" value={p.nightHours[1]} onChange={(e) => p.setNightHours([p.nightHours[0], Number(e.target.value)])} className={select}>
                    {NIGHT_TO.map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
          <FilterBar f={f} marked={marks.ids.size} />
        </div>

        {groups.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-muted">
            {isNight
              ? `In dieser Nacht (${fmtTime(a)}–${fmtTime(b)} Uhr) stand nach den Scans kein Zug${f.station || f.onlyMarked ? " für diese Auswahl" : ""}.`
              : `An diesem Tag stand nach den Scans kein Zug${f.station || f.onlyMarked ? " für diese Auswahl" : ""}.`}
          </p>
        ) : (
          <>
            <div className="tnum relative mt-4 h-4 text-[10.5px] text-faint" aria-hidden>
              {ticks.map((t, i) => (
                <span
                  key={t}
                  className={`absolute ${i === 0 ? "" : t >= b ? "-translate-x-full" : "-translate-x-1/2"} ${stepH === 1 && i % 2 && ticks.length > 9 ? "max-sm:hidden" : ""} ${stepH === 3 && i % 2 ? "max-sm:hidden" : ""}`}
                  style={{ left: `${Math.min(100, x(t))}%` }}
                >
                  {tickLabel(t)}
                </span>
              ))}
            </div>
            <div className="space-y-4">
              {groups.map((g) => (
                <div key={g.id}>
                  <h3 className="text-[13px] font-semibold">{g.name}</h3>
                  {g.notes.map((n) => {
                    const present = staysAtNote(p.allStays, n, now);
                    return (
                      <button
                        key={`${n.note.id}-${n.day}`}
                        onClick={() => p.goTo("notizen")}
                        className="mt-1 flex w-full items-start gap-1.5 rounded-md px-2 py-1 text-left text-[12px] hover:bg-white/[0.04]"
                        style={{ border: `1px dashed ${C.note}66` }}
                      >
                        <NoteMark title={n.note.text} />
                        <span className="min-w-0">
                          <span className="tnum" style={{ color: C.note }}>
                            {fmtDay(n.at!)} {fmtTime(n.at!)}
                            {n.until && `–${fmtTime(n.until)}`}
                          </span>{" "}
                          {n.note.text}
                          <span className="block text-faint">
                            {present.length
                              ? `Zu der Zeit dort abgestellt: ${present.map((s) => s.vehicles.join(" + ")).join(", ")}`
                              : "Zu der Zeit stand dort laut Scans kein Zug."}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                  <ul className="mt-1 space-y-1.5">
                    {g.segs.map((s) => (
                      <Row key={s.stay.key} s={s} p={p} x={x} ticks={ticks} notes={g.notes} nowAt={nowAt} withDay={isNight || dayKey(s.stay.start) !== p.day} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="mt-4 border-t border-line pt-3">
          <Legend parts={["status", "marked", "rel", "note", "transfer"]} />
        </div>
      </div>
    </section>
  );
}

function Row({ s, p, x, ticks, notes, nowAt, withDay }: { s: Seg; p: ViewProps; x: (t: number) => number; ticks: number[]; notes: NoteAt[]; nowAt: number | null; withDay: boolean }) {
  const { stay } = s;
  const marked = p.marks.anyMarked(stay.vehicles);
  const sel = p.selected === stay.key;
  const rels = p.relByStay.get(stay.key) ?? [];
  const nA = rels.filter((r) => r.category === "A").length;
  const nB = rels.length - nA;
  const e = stay.entry;
  const start = e.transfer_from ? `aus ${e.transfer_from} (${startText(stay, withDay)})` : startText(stay, withDay);
  const end = e.transfer_to ? `nach ${e.transfer_to} überführt` : endText(stay, p.now, true);
  const title = stayTitle(stay, p.now);
  return (
    <li>
      <button
        data-stay={stay.key}
        onClick={() => p.select(sel ? null : stay.key)}
        aria-pressed={sel}
        title={title}
        className={`w-full rounded-md px-1.5 py-1 text-left ${sel ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}
      >
        <span className="flex items-baseline justify-between gap-x-3 gap-y-0.5 text-[12px] max-sm:flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate">
              <TransferMark s={stay} />
              <Vehicles ids={stay.vehicles} marks={p.marks} link={false} />
            </span>
            {nA > 0 && <RelBadge category="A" count={nA} />}
            {nB > 0 && <RelBadge category="B" count={nB} />}
          </span>
          <span className="tnum shrink-0 text-right text-muted max-sm:text-left">
            {start} – {end}
            <span className="text-faint max-sm:hidden"> · {durationText(stay, p.now)}</span>
          </span>
        </span>
        <span className="relative mt-1 block h-3 rounded-[4px] bg-white/[0.04]">
          {ticks.slice(1, -1).map((t) => (
            <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-white/[0.06]" style={{ left: `${x(t)}%` }} />
          ))}
          {notes.map((n) => (
            <span
              key={`${n.note.id}-${n.day}`}
              aria-hidden
              className="absolute -inset-y-1"
              style={{
                left: `${Math.max(0, x(n.at!))}%`,
                width: n.until ? `${Math.max(0, Math.min(100, x(n.until)) - Math.max(0, x(n.at!)))}%` : 0,
                borderLeft: `1.5px dashed ${C.note}`,
                background: n.until ? `${C.note}1a` : undefined,
              }}
            />
          ))}
          <span
            className={`absolute inset-y-0 min-w-[3px] ${s.clipStart ? "" : "rounded-l-[4px]"} ${s.clipEnd || s.openEnd ? "" : "rounded-r-[4px]"}`}
            style={{ left: `${x(s.from)}%`, width: `${x(s.to) - x(s.from)}%`, background: blockBackground(stay), ...blockRing(marked, sel) }}
          />
          {nowAt != null && <span aria-hidden className="absolute -inset-y-0.5 w-px bg-white/60" style={{ left: `${nowAt}%` }} />}
        </span>
      </button>
    </li>
  );
}
