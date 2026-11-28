"use client";

/**
 * Wochenübersicht: Mo–So als Spalten mit senkrechter Zeitachse. Jede Abstellung ist ein Block, so hoch wie ihre Dauer;
 * über Mitternacht wird sie an der Tagesgrenze geteilt. Zwischen den Tagen führt ein Knopf zur Nachtübersicht.
 */
import { useMemo } from "react";
import { fmtDay } from "@/lib/stabling";
import { assignLanes, dayRange, notesOn, segmentsIn, staysAtNote, weekNights, WEEKDAYS, WEEKDAYS_SHORT, type Seg } from "@/lib/stablingModel";
import { fmtTime } from "@/lib/time";
import { blockBackground, blockRing, C, Legend, NoteMark, STATUS, statusOf, TransferMark, type ViewProps } from "./shared";
import { FilterBar, H, stayTitle, useScrollToSelected, useStayFilter } from "./TimeShared";

const HOUR = 28;
const DAY_H = 24 * HOUR;
const AXIS = 44;
const GUT = 24;
const COL_MIN = 122;
const TICKS = Array.from({ length: 25 }, (_, h) => h);

export function WeekView(p: ViewProps) {
  const { days, now, today, marks, selected } = p;
  const f = useStayFilter(p);
  const cols = useMemo(
    () =>
      days.map((d) => {
        const r = dayRange(d);
        const segs = segmentsIn(f.filtered, r, now);
        const notes = notesOn(p.notes.list, d).filter((n) => !f.station || n.note.station_id === f.station);
        return { d, r, segs, lanes: assignLanes(segs, 25 * 60_000), notes };
      }),
    [days, f.filtered, f.station, now, p.notes.list],
  );
  const nights = useMemo(
    () => weekNights(p.week, p.nightHours[0], p.nightHours[1]).map((n) => ({ n, count: segmentsIn(f.filtered, [n.from, n.to], now).length })),
    [p.week, p.nightHours, f.filtered, now],
  );
  useScrollToSelected(selected, cols);
  const inWeek = cols.reduce((n, c) => n + c.segs.filter((s) => !s.clipStart).length, 0);
  const nightLabel = (i: number) => `${WEEKDAYS_SHORT[i]} → ${WEEKDAYS_SHORT[(i + 1) % 7]}`;
  const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const grid = { gridTemplateColumns: `${AXIS}px repeat(7, minmax(${COL_MIN}px, 1fr) ${GUT}px)`, minWidth: AXIS + 7 * (COL_MIN + GUT) };

  return (
    <section aria-label="Wochenübersicht" className="space-y-3">
      <FilterBar f={f} marked={marks.ids.size}>
        <p className="text-[12.5px] text-muted">
          {inWeek} {inWeek === 1 ? "Abstellung" : "Abstellungen"} begonnen · Block anklicken für Details · ☾ zwischen den Tagen öffnet die Nacht
        </p>
      </FilterBar>
      {f.onlyMarked && marks.ids.size === 0 && (
        <p className="text-[12.5px] text-muted">Noch kein Fahrzeug markiert. Markieren geht mit ☆ in den Details einer Abstellung.</p>
      )}

      <div className="scroll-thin overflow-x-auto rounded-lg border border-line">
        <div className="grid w-full" style={grid}>
          {/* Kopfzeile */}
          <div className="sticky left-0 z-[3] border-b border-line bg-[var(--panel-solid)]" />
          {cols.map((c, i) => {
            const started = c.segs.filter((s) => !s.clipStart).length;
            const allDay = c.notes.filter((n) => n.at == null);
            return [
              <div key={c.d} className={`border-b border-line px-1.5 py-2 ${c.d === today ? "bg-[#c4a7ff]/[0.06]" : ""}`}>
                <button
                  onClick={() => p.goTo("tag", { day: c.d })}
                  title={`Tagesansicht ${WEEKDAYS[i]} öffnen`}
                  className="tnum w-full rounded px-1 text-left text-[13px] font-semibold hover:bg-white/[0.06]"
                >
                  {fmtDay(c.r[0] + H)}
                  {c.d === today && <span className="ml-1 text-[11px] font-normal" style={{ color: C.stay }}>heute</span>}
                </button>
                <div className="tnum px-1 text-[11px] text-muted">
                  {started} {started === 1 ? "Abstellung" : "Abstellungen"}
                  {c.segs.length > started && <span className="block text-faint">+{c.segs.length - started} vom Vortag</span>}
                </div>
                {allDay.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {allDay.slice(0, 2).map((n) => (
                      <button
                        key={n.note.id}
                        onClick={() => p.goTo("notizen")}
                        title={`${n.note.station_name}, ganztägig: ${n.note.text}`}
                        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-[10.5px] hover:bg-white/[0.05]"
                        style={{ border: `1px dashed ${C.note}66`, color: C.note }}
                      >
                        <NoteMark title={n.note.text} />
                        <span className="truncate">{n.note.station_name}: {n.note.text}</span>
                      </button>
                    ))}
                    {allDay.length > 2 && <div className="px-1 text-[10.5px]" style={{ color: C.note }}>+{allDay.length - 2} Notizen</div>}
                  </div>
                )}
              </div>,
              <div key={`${c.d}-g`} className="border-b border-line" />,
            ];
          })}

          {/* Zeitachse */}
          <div className="sticky left-0 bg-[var(--panel-solid)]" style={{ height: DAY_H, zIndex: 2 }} aria-hidden>
            {TICKS.filter((h) => h % 3 === 0).map((h) => (
              <span
                key={h}
                className={`tnum absolute right-1.5 text-[10.5px] text-muted ${h === 0 ? "" : h === 24 ? "-translate-y-full" : "-translate-y-1/2"}`}
                style={{ top: h * HOUR }}
              >
                {hourLabel(h)}
              </span>
            ))}
          </div>

          {cols.map((c, i) => {
            const span = c.r[1] - c.r[0];
            const y = (t: number) => ((t - c.r[0]) / span) * DAY_H;
            const nowY = c.d === today && now >= c.r[0] && now < c.r[1] ? y(now) : null;
            const night = nights[i];
            return [
              <div key={c.d} className={`relative border-l border-line ${c.d === today ? "bg-[#c4a7ff]/[0.03]" : ""}`} style={{ height: DAY_H }}>
                {/* Nachtbereich 00–06 dezent hinterlegt */}
                <div aria-hidden className="absolute inset-x-0 top-0 bg-white/[0.025]" style={{ height: 6 * HOUR }} />
                {TICKS.slice(1, -1).map((h) => (
                  <div key={h} aria-hidden className={`absolute inset-x-0 h-px ${h % 3 ? "bg-white/[0.03]" : "bg-white/[0.07]"}`} style={{ top: h * HOUR }} />
                ))}
                {c.segs.map((s) => (
                  <Block key={s.stay.key} s={s} y={y} lane={c.lanes.get(s.stay.key)!} p={p} />
                ))}
                {c.notes
                  .filter((n) => n.at != null)
                  .map((n) => {
                    const present = staysAtNote(p.allStays, n, now);
                    const top = y(Math.max(n.at!, c.r[0]));
                    const h = n.until ? Math.max(2, y(Math.min(n.until, c.r[1])) - top) : 0;
                    const title = `${n.note.station_name} ${fmtTime(n.at!)}${n.until ? `–${fmtTime(n.until)}` : ""}: ${n.note.text}\n${
                      present.length ? `Zu der Zeit dort abgestellt: ${present.map((s) => s.vehicles.join(" + ")).join(", ")}` : "Zu der Zeit stand dort laut Scans kein Zug"
                    }`;
                    return (
                      <div key={`n${n.note.id}`} className="pointer-events-none absolute inset-x-0 z-[4]" style={{ top }}>
                        {h > 0 && <div className="absolute inset-x-0" style={{ height: h, background: `${C.note}14`, borderLeft: `2px dashed ${C.note}99` }} />}
                        <div className="absolute inset-x-0 top-0 h-0" style={{ borderTop: `1.5px dashed ${C.note}` }} />
                        <button
                          onClick={() => p.goTo("notizen")}
                          title={title}
                          aria-label={title}
                          className="pointer-events-auto absolute -top-2.5 right-0.5 flex h-5 items-center gap-0.5 rounded-[4px] px-1 text-[10.5px] font-semibold leading-none"
                          style={present.length ? { background: C.note, color: "#0b0d10" } : { background: "var(--panel-solid)", border: `1px dashed ${C.note}`, color: C.note }}
                        >
                          ✎{present.length > 0 && <span className="tnum">{present.length}</span>}
                        </button>
                      </div>
                    );
                  })}
                {nowY != null && (
                  <div aria-label={`jetzt ${fmtTime(now)}`} className="pointer-events-none absolute inset-x-0 z-[5] h-px bg-white/70" style={{ top: nowY }}>
                    <span className="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full bg-white" />
                  </div>
                )}
              </div>,
              <div key={`${c.d}-g`} className="relative border-l border-line" style={{ height: DAY_H }}>
                <button
                  onClick={() => p.goTo("nacht", { night: c.d })}
                  title={`Nachtübersicht ${WEEKDAYS[i]} → ${WEEKDAYS[(i + 1) % 7]}: ${night.count} ${night.count === 1 ? "Abstellung" : "Abstellungen"}`}
                  aria-label={`Nachtübersicht ${WEEKDAYS[i]} → ${WEEKDAYS[(i + 1) % 7]}, ${night.count} Abstellungen`}
                  className="absolute inset-x-0.5 top-1 flex flex-col items-center gap-1 rounded-md border border-line bg-[#0e1115] py-1.5 text-[10.5px] text-muted hover:border-white/30 hover:text-fg"
                  style={{ height: 6 * HOUR - 8 }}
                >
                  <span aria-hidden className="text-[12px]" style={{ color: C.stay }}>☾</span>
                  <span className="tnum font-medium [writing-mode:vertical-rl]">{nightLabel(i)}</span>
                  {night.count > 0 && <span className="tnum mt-auto rounded bg-white/[0.08] px-0.5 text-fg">{night.count}</span>}
                </button>
              </div>,
            ];
          })}
        </div>
      </div>

      <Legend parts={["status", "marked", "rel", "recur", "note", "transfer"]} />
      <p className="text-[12px] text-faint">
        ☾ Mo → Di usw.: Nachtübersicht {String((24 + p.nightHours[0]) % 24).padStart(2, "0")}:00–{String(p.nightHours[1]).padStart(2, "0")}:00 Uhr. Hellere Fläche oben in jeder Spalte = 00–06 Uhr.
        Offene Enden reichen bis jetzt (höchstens 48 h) und sind schraffiert.
      </p>
    </section>
  );
}

function Block({ s, y, lane, p }: { s: Seg; y: (t: number) => number; lane: { lane: number; lanes: number }; p: ViewProps }) {
  const { stay } = s;
  const marked = p.marks.anyMarked(stay.vehicles);
  const sel = p.selected === stay.key;
  const top = y(s.from);
  const h = Math.max(5, y(s.to) - top);
  const hatched = STATUS[statusOf(stay)].hatched;
  const rels = p.relByStay.get(stay.key) ?? [];
  const relA = rels.some((r) => r.category === "A");
  const relB = !relA && rels.length > 0;
  const slot = p.recur.get(stay.key);
  const roomy = h >= 30 && lane.lanes <= 2;
  const some = h >= 15 && lane.lanes <= 2;
  const vertical = !roomy && !some && h >= 52 && lane.lanes <= 5;
  const first = stay.vehicles[0];
  const more = stay.vehicles.length > 1 ? ` +${stay.vehicles.length - 1}` : "";
  const text = hatched ? { background: "rgba(11,13,16,0.78)", color: "var(--fg)" } : { color: "#0b0d10" };
  const title = stayTitle(stay, p.now);
  return (
    <button
      data-stay={stay.key}
      onClick={() => p.select(sel ? null : stay.key)}
      title={title}
      aria-label={title.replace(/\n/g, ", ")}
      aria-pressed={sel}
      className={`absolute overflow-hidden text-left leading-tight transition-[filter] hover:brightness-110 ${s.clipStart ? "" : "rounded-t-[4px]"} ${s.clipEnd || s.openEnd ? "" : "rounded-b-[4px]"}`}
      style={{
        top,
        height: h,
        left: `calc(${(lane.lane / lane.lanes) * 100}% + 2px)`,
        width: `calc(${100 / lane.lanes}% - 4px)`,
        background: blockBackground(stay),
        zIndex: sel ? 3 : marked ? 2 : 1,
        ...blockRing(marked, sel),
      }}
    >
      {(roomy || some) && (
        <span className="m-[2px] inline-block max-w-[calc(100%-4px)] truncate rounded-[3px] px-[3px] text-[10.5px] font-semibold" style={text}>
          {marked && <span style={{ color: hatched ? C.marked : "#7a5b00" }}>★</span>}
          {stay.entry.transfer_from && roomy && <TransferMark s={stay} />}
          {first}
          {roomy && more}
        </span>
      )}
      {vertical && (
        <span className="absolute left-1/2 top-[3px] max-h-[calc(100%-6px)] -translate-x-1/2 truncate rounded-[3px] px-[1px] py-[3px] text-[10px] font-semibold [writing-mode:vertical-rl]" style={text}>
          {marked && "★"}
          {first}
        </span>
      )}
      {roomy && h >= 44 && (
        <span className="mx-[2px] block max-w-[calc(100%-4px)] truncate rounded-[3px] px-[3px] text-[10px]" style={text}>
          {stay.stationName}
        </span>
      )}
      {slot && (
        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: C.recur }} />
      )}
      {slot && h >= 15 && lane.lanes <= 3 && (
        <span aria-hidden className="tnum absolute right-[2px] top-[2px] rounded-[3px] px-[3px] text-[9.5px] font-bold leading-[13px]" style={{ background: "#0b0d10", color: C.recur }}>
          ↻{slot.weeks.length}
        </span>
      )}
      {(relA || relB) && (
        <span
          aria-hidden
          className="absolute bottom-[3px] right-[3px] h-[7px] w-[7px] rounded-full"
          style={relA ? { background: C.overlap, boxShadow: "0 0 0 1px #0b0d10" } : { border: `1.5px dashed ${C.near}`, background: "#0b0d10" }}
        />
      )}
    </button>
  );
}
