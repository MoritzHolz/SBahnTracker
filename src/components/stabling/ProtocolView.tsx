"use client";

/**
 * Protokoll: alle Abstellungen der Woche, filterbar. Liste (nach Tag), nach Bahnhof oder als Chronik.
 * Zeile anklicken öffnet die Details (gleiche Auswahl wie in Woche, Tag, Nacht und Analyse).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { LineBadge } from "@/components/ui/Badges";
import { dayKey, dayStart, fmtDay } from "@/lib/stabling";
import { WEEKDAYS, weekdayOf, type Stay } from "@/lib/stablingModel";
import { fmtTime } from "@/lib/time";
import {
  C,
  durationText,
  endText,
  MarkButton,
  RecurBadge,
  RelBadge,
  startText,
  STATUS,
  STATUS_ORDER,
  statusOf,
  Swatch,
  TransferMark,
  Vehicles,
  type StayStatus,
  type ViewProps,
} from "./shared";

type Mode = "liste" | "bahnhof" | "chronik";
const MODES: [Mode, string][] = [
  ["liste", "Liste"],
  ["bahnhof", "Nach Bahnhof"],
  ["chronik", "Chronik"],
];

interface Filters {
  q: string;
  station: string;
  weekday: string;
  date: string;
  status: "" | StayStatus;
  marked: boolean;
  a: boolean;
  b: boolean;
  recur: boolean;
}
const NO_FILTER: Filters = { q: "", station: "", weekday: "", date: "", status: "", marked: false, a: false, b: false, recur: false };

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export function ProtocolView(p: ViewProps) {
  const { stays, days, now, marks, relByStay, selected, select, lineStyle } = p;
  const [mode, setMode] = useState<Mode>("liste");
  const [f, setF] = useState<Filters>(NO_FILTER);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));
  const active = JSON.stringify(f) !== JSON.stringify(NO_FILTER);

  const stations = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const s of stays) m.set(s.station, { name: s.stationName, n: (m.get(s.station)?.n ?? 0) + 1 });
    return [...m].sort((a, b) => a[1].name.localeCompare(b[1].name, "de"));
  }, [stays]);

  const rels = (s: Stay) => relByStay.get(s.key) ?? [];
  const matches = (s: Stay, ignoreDate = false) => {
    if (f.q) {
      const q = norm(f.q);
      const hay = [...s.vehicles, s.entry.train_number, s.entry.dep_train_number ?? "", s.entry.line_id].map(norm);
      if (!hay.some((h) => h.includes(q))) return false;
    }
    if (f.station && s.station !== f.station) return false;
    if (f.weekday && weekdayOf(dayKey(s.start)) !== Number(f.weekday)) return false;
    if (!ignoreDate && f.date && dayKey(s.start) !== f.date) return false;
    if (f.status && statusOf(s) !== f.status) return false;
    if (f.marked && !marks.anyMarked(s.vehicles)) return false;
    if (f.a && !rels(s).some((r) => r.category === "A")) return false;
    if (f.b && !rels(s).some((r) => r.category === "B")) return false;
    if (f.recur && !p.recur.has(s.key)) return false;
    return true;
  };
  const shown = stays.filter((s) => matches(s));
  const sel = selected ? (p.allStays.find((s) => s.key === selected) ?? null) : null;
  const selInWeek = !!sel && stays.some((s) => s.key === sel.key);
  const selHidden = !!sel && selInWeek && !shown.some((s) => s.key === sel.key);

  // Ausgewählten Eintrag sichtbar machen (auch wenn er aus Woche, Tag, Nacht oder Analyse kommt)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected || !box.current) return;
    const els = [...box.current.querySelectorAll<HTMLElement>("[data-stay]")].filter((el) => el.dataset.stay === selected && el.offsetParent !== null);
    els[0]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selected, mode]);

  const input = "h-9 min-w-0 rounded-md border border-line bg-black/30 px-2 text-[13px] text-fg compact:h-11 compact:text-[16px] [color-scheme:dark]";
  const chip = (on: boolean) =>
    `h-8 shrink-0 rounded-md border px-2.5 text-[12.5px] compact:h-10 ${on ? "border-white/30 bg-white/[0.09] text-fg" : "border-line text-muted hover:text-fg"}`;

  return (
    <section ref={box} aria-label="Protokoll">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Darstellung" className="flex rounded-md border border-line p-0.5 max-sm:w-full">
          {MODES.map(([k, label]) => (
            <button
              key={k}
              aria-pressed={mode === k}
              onClick={() => setMode(k)}
              className={`h-8 whitespace-nowrap rounded px-2.5 text-[13px] compact:h-10 max-sm:flex-1 ${mode === k ? "bg-white/[0.09] text-fg" : "text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={f.q}
          onChange={(e) => set("q", e.target.value)}
          placeholder="Fahrzeug oder Zugnummer"
          aria-label="Fahrzeug oder Zugnummer suchen"
          className={`${input} w-52 max-sm:w-full sm:ml-auto`}
        />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <select aria-label="Standort" value={f.station} onChange={(e) => set("station", e.target.value)} className={input}>
          <option value="">Alle Standorte</option>
          {stations.map(([id, s]) => (
            <option key={id} value={id}>
              {s.name} ({s.n})
            </option>
          ))}
        </select>
        <select aria-label="Wochentag" value={f.weekday} onChange={(e) => set("weekday", e.target.value)} className={input}>
          <option value="">Alle Wochentage</option>
          {WEEKDAYS.map((w, i) => (
            <option key={w} value={i + 1}>
              {w}
            </option>
          ))}
        </select>
        <select aria-label="Datum" value={f.date} onChange={(e) => set("date", e.target.value)} className={input}>
          <option value="">Alle Tage</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {fmtDay(dayStart(d))}
            </option>
          ))}
        </select>
        <select aria-label="Status" value={f.status} onChange={(e) => set("status", e.target.value as Filters["status"])} className={input}>
          <option value="">Alle Status</option>
          {STATUS_ORDER.map((k) => (
            <option key={k} value={k}>
              {STATUS[k].label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button aria-pressed={f.marked} onClick={() => set("marked", !f.marked)} className={chip(f.marked)}>
          <span style={{ color: C.marked }}>★</span> nur markierte
        </button>
        <button aria-pressed={f.a} onClick={() => set("a", !f.a)} className={`${chip(f.a)} inline-flex items-center gap-1.5`}>
          <RelBadge category="A" /> tatsächliche Überschneidung
        </button>
        <button aria-pressed={f.b} onClick={() => set("b", !f.b)} className={`${chip(f.b)} inline-flex items-center gap-1.5`}>
          <RelBadge category="B" /> ungefähre (≤ {p.windowMin} min)
        </button>
        <button aria-pressed={f.recur} onClick={() => set("recur", !f.recur)} className={`${chip(f.recur)} inline-flex items-center gap-1.5`}>
          <span className="font-semibold" style={{ color: C.recur }}>↻</span> wiederkehrend
        </button>
        <span className="tnum ml-auto text-[12.5px] text-muted" aria-live="polite">
          {shown.length} von {stays.length}
        </span>
        {active && (
          <button onClick={() => setF(NO_FILTER)} className="h-8 rounded-md px-2 text-[12.5px] text-muted underline decoration-white/30 underline-offset-2 hover:text-fg compact:h-10">
            Filter zurücksetzen
          </button>
        )}
      </div>

      {selHidden && (
        <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-[12.5px] text-muted">
          Die ausgewählte Abstellung ({sel!.vehicles.join(" + ")}, {sel!.stationName}) ist durch die Filter ausgeblendet.
          <button onClick={() => setF(NO_FILTER)} className="text-fg underline decoration-white/30 underline-offset-2">Filter zurücksetzen</button>
        </p>
      )}
      {sel && !selInWeek && (
        <p className="mt-3 text-[12.5px] text-muted">Die ausgewählte Abstellung begann in einer anderen Woche und steht in deren Protokoll.</p>
      )}

      <div className="mt-3">
        {stays.length === 0 ? (
          <Empty text="In dieser Woche wurde keine Abstellung erkannt." />
        ) : shown.length === 0 ? (
          <Empty text="Für diese Auswahl gibt es keine Abstellung." />
        ) : mode === "chronik" ? (
          <Chronicle list={stays.filter((s) => matches(s, true))} date={f.date} days={days} {...{ marks, selected, select, lineStyle, recur: p.recur }} />
        ) : (
          <Groups
            groups={mode === "liste" ? groupByDay(shown) : groupByStation(shown)}
            byStation={mode === "bahnhof"}
            {...{ now, marks, selected, select, lineStyle, rels, recur: p.recur }}
          />
        )}
      </div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-line px-5 py-8 text-center text-[13px] text-muted">{text}</p>;
}

interface Group {
  id: string;
  title: string;
  stays: Stay[];
}

function groupByDay(list: Stay[]): Group[] {
  const m = new Map<string, Stay[]>();
  for (const s of list) m.set(dayKey(s.start), [...(m.get(dayKey(s.start)) ?? []), s]);
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([k, stays]) => ({ id: k, title: `${WEEKDAYS[weekdayOf(k) - 1]}, ${fmtDay(dayStart(k)).slice(3)}`, stays }));
}

function groupByStation(list: Stay[]): Group[] {
  const m = new Map<string, Stay[]>();
  for (const s of list) m.set(s.station, [...(m.get(s.station) ?? []), s]);
  return [...m.values()].map((stays) => ({ id: stays[0].station, title: stays[0].stationName, stays })).sort((a, b) => a.title.localeCompare(b.title, "de"));
}

type RowCtx = {
  now: number;
  marks: ViewProps["marks"];
  selected: string | null;
  select: (k: string | null) => void;
  lineStyle: ViewProps["lineStyle"];
  rels: (s: Stay) => ViewProps["relations"];
  recur: ViewProps["recur"];
};

function RelCell({ s, rels, recur }: { s: Stay; rels: RowCtx["rels"]; recur: RowCtx["recur"] }) {
  const r = rels(s);
  const a = r.filter((x) => x.category === "A").length;
  const b = r.length - a;
  const slot = recur.get(s.key);
  if (!r.length && !slot) return <span className="text-faint">–</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {a > 0 && <RelBadge category="A" count={a} title={`${a} tatsächliche Überschneidung${a > 1 ? "en" : ""} am Standort`} />}
      {b > 0 && <RelBadge category="B" count={b} title={`${b} möglicher zeitlicher Zusammenhang${b > 1 ? "e" : ""} am Standort`} />}
      {slot && <RecurBadge slot={slot} compact />}
    </span>
  );
}

function Groups({ groups, byStation, ...c }: { groups: Group[]; byStation: boolean } & RowCtx) {
  const { now, marks, selected, select, lineStyle } = c;
  return (
    <div className="space-y-5">
      {groups.map((g) => {
        const cars = g.stays.reduce((n, s) => n + s.entry.cars, 0);
        return (
          <section key={g.id} className="overflow-hidden rounded-lg border border-line">
            <div className="flex items-baseline justify-between gap-3 border-b border-line bg-raised px-4 py-2.5">
              <h2 className="tnum truncate text-[15px] font-semibold">{g.title}</h2>
              <span className="tnum shrink-0 text-[12px] text-muted">
                {g.stays.length} {g.stays.length === 1 ? "Abstellung" : "Abstellungen"} · {cars} Waggons
              </span>
            </div>
            <table className="w-full table-fixed text-left text-[13px] max-md:hidden">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-faint">
                <tr>
                  <th className="w-[24%] px-4 py-2 font-medium">Fahrzeuge · Zug</th>
                  <th className="w-[15%] py-2 pr-2 font-medium">{byStation ? "Tag" : "Standort"}</th>
                  <th className="w-[14%] py-2 pr-2 font-medium">Beginn</th>
                  <th className="w-[17%] py-2 pr-2 font-medium">Ende</th>
                  <th className="w-[11%] py-2 pr-2 font-medium">Dauer</th>
                  <th className="w-[11%] py-2 pr-2 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Bezug</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--line)] border-t border-line">
                {g.stays.map((s) => {
                  const on = selected === s.key;
                  const st = statusOf(s);
                  return (
                    <tr
                      key={s.key}
                      data-stay={s.key}
                      aria-selected={on}
                      tabIndex={0}
                      onClick={() => select(on ? null : s.key)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(on ? null : s.key))}
                      className={`cursor-pointer align-top outline-none hover:bg-white/[0.035] focus-visible:bg-white/[0.05] ${on ? "bg-white/[0.07]" : ""}`}
                      style={on ? { boxShadow: `inset 3px 0 0 ${marks.anyMarked(s.vehicles) ? C.marked : "#fff"}` } : marks.anyMarked(s.vehicles) ? { boxShadow: `inset 3px 0 0 ${C.marked}` } : undefined}
                    >
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap items-center gap-x-1">
                          <Vehicles ids={s.vehicles} marks={marks} />
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-faint">
                          <LineBadge id={s.entry.line_id} {...lineStyle(s.entry.line_id)} size="sm" />
                          <span className="tnum">Zug {s.entry.train_number}</span>
                          {s.vehicles.map((v) => (
                            <MarkButton key={v} vehicle={v} marks={marks} size="sm" />
                          ))}
                        </span>
                      </td>
                      <td className="py-2.5 pr-2">
                        {byStation ? (
                          <span className="tnum">{fmtDay(s.start)}</span>
                        ) : (
                          <>
                            <TransferMark s={s} />
                            {s.stationName}
                          </>
                        )}
                      </td>
                      <td className="tnum py-2.5 pr-2">
                        {s.entry.transfer_from ? (
                          <>
                            {!byStation && <TransferMark s={s} />}aus {s.entry.transfer_from}
                            <span className="block text-[12px] text-faint">{startText(s, false)}</span>
                          </>
                        ) : (
                          <>
                            {startText(s, false)}
                            {s.entry.arr_platform && <span className="block text-[12px] text-faint">Gl. {s.entry.arr_platform}</span>}
                          </>
                        )}
                      </td>
                      <td className="tnum py-2.5 pr-2"><EndCell s={s} now={now} /></td>
                      <td className="tnum py-2.5 pr-2">{durationText(s, now)}</td>
                      <td className="py-2.5 pr-2">
                        <span className="inline-flex items-center gap-1.5" title={STATUS[st].hint}>
                          <Swatch status={st} className="h-2.5 w-3" />
                          <span className="text-[12px] leading-tight">{STATUS[st].label}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-4"><RelCell s={s} rels={c.rels} recur={c.recur} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <ul className="divide-y divide-[var(--line)] md:hidden">
              {g.stays.map((s) => {
                const on = selected === s.key;
                const st = statusOf(s);
                return (
                  <li
                    key={s.key}
                    data-stay={s.key}
                    aria-current={on || undefined}
                    tabIndex={0}
                    onClick={() => select(on ? null : s.key)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), select(on ? null : s.key))}
                    className={`cursor-pointer px-4 py-3 outline-none ${on ? "bg-white/[0.07]" : ""}`}
                    style={on || marks.anyMarked(s.vehicles) ? { boxShadow: `inset 3px 0 0 ${on && !marks.anyMarked(s.vehicles) ? "#fff" : C.marked}` } : undefined}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 text-[15px]"><Vehicles ids={s.vehicles} marks={marks} /></span>
                      <span className="flex shrink-0 items-center">
                        {s.vehicles.map((v) => (
                          <MarkButton key={v} vehicle={v} marks={marks} />
                        ))}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12.5px] text-faint">
                      <LineBadge id={s.entry.line_id} {...lineStyle(s.entry.line_id)} size="sm" />
                      <span className="tnum">Zug {s.entry.train_number}</span>
                      <span>· {s.entry.cars} Waggons</span>
                      <RelCell s={s} rels={c.rels} recur={c.recur} />
                    </div>
                    <dl className="mt-1.5 grid grid-cols-[5.5rem_1fr] gap-y-1 text-[13px]">
                      <dt className="text-faint">{byStation ? "Tag" : "Standort"}</dt>
                      <dd>
                        {byStation ? fmtDay(s.start) : (
                          <>
                            <TransferMark s={s} />
                            {s.stationName}
                          </>
                        )}
                      </dd>
                      <dt className="text-faint">Beginn</dt>
                      <dd className="tnum">{s.entry.transfer_from ? `aus ${s.entry.transfer_from}, ${startText(s, false)}` : startText(s, false)}</dd>
                      <dt className="text-faint">Ende</dt>
                      <dd className="tnum"><EndCell s={s} now={now} /></dd>
                      <dt className="text-faint">Dauer</dt>
                      <dd className="tnum">{durationText(s, now)}</dd>
                      <dt className="text-faint">Status</dt>
                      <dd className="flex items-center gap-1.5">
                        <Swatch status={st} className="h-2.5 w-3" /> {STATUS[st].label}
                      </dd>
                    </dl>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/** Ende so genau wie belegt, mit Weiterfahrt bzw. Überführung */
function EndCell({ s, now }: { s: Stay; now: number }) {
  const e = s.entry;
  if (e.transfer_to)
    return (
      <>
        nach {e.transfer_to} überführt
        <span className="block text-[12px] text-faint">Zeitpunkt unbekannt, dort ab {fmtTime(s.end!)}</span>
      </>
    );
  if (s.endKind === "exact")
    return (
      <>
        {endText(s, now)}
        <span className="block text-[12px] text-faint">
          {e.dep_line_id} Zug {e.dep_train_number ?? "–"}
          {e.dep_destination && ` nach ${e.dep_destination}`}
        </span>
      </>
    );
  if (s.endKind === "upper")
    return (
      <>
        <span className="text-muted">nicht beobachtet</span>
        <span className="block text-[12px] text-faint">
          {endText(s, now)}
          {e.seen_again_station && `, wieder gesehen in ${e.seen_again_station}`}
          {e.next_line_id && ` als ${e.next_line_id} Zug ${e.next_train_number ?? "–"}`}
        </span>
      </>
    );
  if (s.endKind === "ongoing") return <span style={{ color: C.standing }}>steht noch</span>;
  return (
    <>
      <span className="text-muted">unbekannt</span>
      <span className="block text-[12px] text-faint">zu wenige Scans seither</span>
    </>
  );
}

// ------------------------------------------------------------------ Chronik (was wann passierte)

interface Item {
  at: number;
  kind: "in" | "out" | "seen";
  s: Stay;
}

const KIND: Record<Item["kind"], string> = { in: "abgestellt", out: "ausgefahren", seen: "wieder gesehen" };

function chronicle(list: Stay[]): Item[] {
  const out: Item[] = [];
  for (const s of list) {
    // Überführt: Zeitpunkt unbekannt, deshalb nur die Abfahrt am neuen Bahnhof
    if (s.startKind === "exact") out.push({ at: s.start, kind: "in", s });
    if (s.entry.transfer_to) continue;
    if (s.endKind === "exact") out.push({ at: s.end!, kind: "out", s });
    else if (s.endKind === "upper") out.push({ at: s.end!, kind: "seen", s });
  }
  return out.sort((a, b) => a.at - b.at || a.s.key.localeCompare(b.s.key));
}

function Chronicle({ list, date, days, marks, selected, select, lineStyle }: { list: Stay[]; date: string; days: string[] } & Omit<RowCtx, "now" | "rels">) {
  const items = chronicle(list).filter((i) => (date ? dayKey(i.at) === date : days.includes(dayKey(i.at))));
  if (!items.length) return <Empty text="Für diese Auswahl gibt es kein Ereignis." />;
  const byDay = new Map<string, Item[]>();
  for (const i of items) byDay.set(dayKey(i.at), [...(byDay.get(dayKey(i.at)) ?? []), i]);
  return (
    <div className="space-y-5">
      {[...byDay].map(([key, dayItems]) => (
        <section key={key} className="overflow-hidden rounded-lg border border-line">
          <h2 className="tnum border-b border-line bg-raised px-4 py-2.5 text-[15px] font-semibold">{fmtDay(dayStart(key))}</h2>
          <ol className="divide-y divide-[var(--line)]">
            {dayItems.map((i) => {
              const e = i.s.entry;
              const on = selected === i.s.key;
              const line = i.kind === "out" && e.dep_line_id ? e.dep_line_id : e.line_id;
              return (
                <li
                  key={`${i.s.key}-${i.kind}`}
                  data-stay={i.s.key}
                  tabIndex={0}
                  onClick={() => select(on ? null : i.s.key)}
                  onKeyDown={(ev) => (ev.key === "Enter" || ev.key === " ") && (ev.preventDefault(), select(on ? null : i.s.key))}
                  className={`flex cursor-pointer gap-3 px-4 py-2.5 text-[13px] outline-none hover:bg-white/[0.035] ${on ? "bg-white/[0.07]" : ""}`}
                  style={marks.anyMarked(i.s.vehicles) ? { boxShadow: `inset 3px 0 0 ${C.marked}` } : undefined}
                >
                  <span className="tnum w-10 shrink-0 font-medium">{fmtTime(i.at)}</span>
                  <span aria-hidden className="w-3 shrink-0 text-center" style={{ color: i.kind === "in" ? C.stay : undefined }}>
                    {i.kind === "in" ? "■" : i.kind === "out" ? "→" : "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <TransferMark s={i.s} />
                    <Vehicles ids={i.s.vehicles} marks={marks} /> <span className="text-muted">{KIND[i.kind]}</span>{" "}
                    <span>{i.kind === "seen" ? `in ${e.seen_again_station ?? "–"}` : i.s.stationName}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
                      {i.kind === "seen" ? (
                        <span>Abfahrt aus {i.s.stationName} nicht beobachtet</span>
                      ) : (
                        <>
                          <LineBadge id={line} {...lineStyle(line)} size="sm" />
                          <span className="tnum">
                            Zug {(i.kind === "out" ? e.dep_train_number : e.train_number) ?? "–"}
                            {i.kind === "out" ? e.dep_destination && ` nach ${e.dep_destination}` : e.origin_name && ` aus ${e.origin_name}`} · {e.cars} Waggons
                          </span>
                          {i.kind === "out" && e.transfer_from && <span>· vorher aus {e.transfer_from} überführt (abgestellt dort {fmtDay(i.s.start)} {fmtTime(i.s.start)})</span>}
                        </>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
