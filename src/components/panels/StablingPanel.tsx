"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DataBadge, LineBadge } from "@/components/ui/Badges";
import { useNow } from "@/hooks/useLiveData";
import { fetchLines, lineColor, lineTextColor, type Line } from "@/lib/api";
import {
  chronicle,
  dayKey,
  daySegments,
  dayStart,
  entryKey,
  fetchStablingLog,
  fmtDay,
  groupByStation,
  periodDays,
  stayText,
  type ChronicleItem,
  type StablingEntry,
  type StablingLog,
} from "@/lib/stabling";
import { fmtTime } from "@/lib/time";
import { AppNav } from "./StatusBar";

const REFRESH_MS = 60_000;
const DAYS = periodDays();
const VIOLET = "#c4a7ff";

type View = "bahnhof" | "verlauf" | "chronik";
const VIEWS: [View, string][] = [
  ["bahnhof", "Nach Bahnhof"],
  ["verlauf", "Zeitverlauf"],
  ["chronik", "Chronik"],
];

type LineStyleFn = (id: string) => { color: string; textColor: string };

export function StablingPanel() {
  const now = useNow(30_000);
  const [log, setLog] = useState<StablingLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Map<string, Line>>(() => new Map());
  const [view, setView] = useState<View>("bahnhof");
  const [station, setStation] = useState("");
  const [day, setDay] = useState("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchStablingLog().then(
        (l) => {
          if (!alive) return;
          setLog(l);
          setError(null);
        },
        (e: Error) => alive && setError(e.message),
      );
    const refresh = () => document.visibilityState !== "hidden" && void load();
    void load();
    const id = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    fetchLines().then((l) => setLines(new Map(l.map((x) => [x.id, x]))), () => {});
  }, []);

  const lineStyle: LineStyleFn = (id) => ({ color: lineColor(lines, id), textColor: lineTextColor(lines, id) });
  const all = useMemo(() => log?.entries ?? [], [log]);
  const stations = useMemo(() => groupByStation(all), [all]);
  const atStation = useMemo(() => (station ? all.filter((e) => e.station_id === station) : all), [all, station]);
  // Tabelle: Tag der Abstellung. Zeitverlauf: alles, was an dem Tag dort stand.
  const shown = useMemo(() => (day ? atStation.filter((e) => dayKey(e.arrived_at) === day) : atStation), [atStation, day]);
  // Chronik: Tag des Ereignisses, damit Ausfahrten am Folgetag erscheinen
  const events = useMemo(() => chronicle(atStation).filter((i) => !day || dayKey(i.at) === day), [atStation, day]);
  const open = shown.filter((e) => e.state === "open").length;
  const today = now ? dayKey(now) : "";
  const timelineDay = day || (DAYS.includes(today) ? today : DAYS.filter((d) => d < today).at(-1) ?? DAYS[0]);

  const select =
    "h-9 min-w-0 rounded-md border border-line bg-black/30 px-2 text-[13px] text-fg compact:h-11 compact:text-[16px] [color-scheme:dark]";

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-[var(--panel)] backdrop-blur-md">
        <div className="page-x mx-auto max-w-4xl py-3 compact:py-1.5 compact:pt-[calc(0.375rem+env(safe-area-inset-top))]">
          <AppNav active="abstellungen" />
        </div>
      </header>

      <div className="page-x page-b mx-auto max-w-4xl pt-8 compact:pt-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Abstellprotokoll</h1>
          <DataBadge state="vermutung" label="Aus Scans erkannt" />
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Mi 25.11.2026, 14:35 Uhr bis Mi 02.12.2026. Ausgewertet werden Abstellungen von Montag bis Freitag.
        </p>

        {error && <p role="alert" className="mt-4 text-[13px] text-bad">Protokoll nicht abrufbar: {error}</p>}
        {!log && !error && <p className="mt-6 text-[13px] text-faint">Protokoll wird geladen …</p>}

        {log && (
          <>
            <dl className="mt-5 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-line bg-[var(--line)] max-sm:grid-cols-2">
              <Stat k="Abstellungen" v={shown.length} />
              <Stat k="Waggons" v={shown.reduce((n, e) => n + e.cars, 0)} />
              <Stat k="Steht noch" v={open} />
              <Stat k="Nach Plochingen verschoben" v={log.moved} hint="Fahrzeuge, nicht im Protokoll" />
            </dl>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Ansicht" className="flex rounded-md border border-line p-0.5 max-sm:w-full">
                {VIEWS.map(([key, label]) => (
                  <button
                    key={key}
                    aria-pressed={view === key}
                    onClick={() => setView(key)}
                    className={`h-8 whitespace-nowrap rounded px-2.5 text-[13px] compact:h-10 max-sm:flex-1 ${view === key ? "bg-white/[0.09] text-fg" : "text-muted hover:text-fg"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <select aria-label="Bahnhof" value={station} onChange={(e) => setStation(e.target.value)} className={`${select} max-sm:flex-1 sm:ml-auto`}>
                <option value="">Alle Bahnhöfe</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.entries.length})
                  </option>
                ))}
              </select>
              <select aria-label="Tag" value={day} onChange={(e) => setDay(e.target.value)} className={`${select} max-sm:flex-1`}>
                <option value="">Alle Tage</option>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {fmtDay(dayStart(d))}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-4">
              {view === "verlauf" ? (
                <Timeline list={atStation} day={timelineDay} setDay={setDay} now={now} today={today} />
              ) : view === "chronik" && events.length > 0 ? (
                <Chronicle items={events} lineStyle={lineStyle} />
              ) : view === "bahnhof" && shown.length > 0 ? (
                <StationTables list={shown} now={now} lineStyle={lineStyle} />
              ) : (
                <Empty filtered={all.length > 0} />
              )}
            </div>

            <section className="mt-6 rounded-lg border border-line bg-raised p-5 text-[12px] leading-relaxed text-muted max-sm:p-4">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">So entsteht das Protokoll</h2>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Ein Eintrag entsteht, wenn ein gelesener Zug 45 min nach der Ankunft in keiner gelesenen Abfahrt auftaucht. An der Schwabstraße gilt das nach 15 min und nur für Abfahrten vom Gegengleis.</li>
                <li>Zeiten stammen aus Fahrplan und Echtzeit. Ankunft heißt: Ende der letzten Fahrt. Wurde die nächste Fahrt an einem anderen Bahnhof gelesen, bleibt die Abfahrt unbekannt.</li>
                <li>Nicht im Protokoll: Züge, die nach 48 h (Schwabstraße 60 min) automatisch nach Plochingen verschoben wurden. Dazu zählen auch lange Standzeiten übers Wochenende. Für Plochingen selbst gilt die Regel nicht.</li>
                <li>Ohne Scans entsteht kein Eintrag. Lücken in der Nacht schließt der Zeitplan im <Link href="/scanner" className="text-fg underline decoration-white/30 underline-offset-2">Scanner</Link>.</li>
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Stat({ k, v, hint }: { k: string; v: number; hint?: string }) {
  return (
    <div className="bg-raised px-4 py-3">
      <dt className="text-[11px] leading-snug text-muted">{k}</dt>
      <dd className="mt-0.5 text-[22px] font-semibold leading-tight">{v}</dd>
      {hint && <div className="text-[11px] leading-snug text-faint">{hint}</div>}
    </div>
  );
}

function Empty({ filtered }: { filtered: boolean }) {
  return (
    <p className="rounded-lg border border-line px-5 py-8 text-center text-[13px] leading-relaxed text-muted">
      {filtered
        ? "Für diese Auswahl gibt es keine Abstellung."
        : "Noch keine Abstellung erkannt. Die ersten Einträge erscheinen frühestens 45 min nach der Ankunft eines gelesenen Zuges."}
    </p>
  );
}

function Vehicles({ ids }: { ids: string[] }) {
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && <span className="text-faint"> + </span>}
          <Link href={`/fahrzeuge?q=${encodeURIComponent(id)}`} className="tnum whitespace-nowrap font-medium hover:underline">
            {id}
          </Link>
        </span>
      ))}
    </>
  );
}

function DepartureText({ e }: { e: StablingEntry }) {
  const other = (t: string) => (dayKey(t) === dayKey(e.arrived_at) ? "" : `${fmtDay(t)} `);
  if (e.departed_at)
    return (
      <>
        <span className="tnum whitespace-nowrap">
          {other(e.departed_at)}
          {fmtTime(e.departed_at)}
        </span>
        <span className="block text-[12px] text-faint">
          {e.dep_line_id} Zug {e.dep_train_number ?? "–"}
          {e.dep_destination && ` nach ${e.dep_destination}`}
        </span>
      </>
    );
  if (e.seen_again_at)
    return (
      <>
        <span className="text-muted">nicht beobachtet</span>
        <span className="tnum block text-[12px] text-faint">
          wieder gesehen {other(e.seen_again_at)}
          {fmtTime(e.seen_again_at)}
          {e.seen_again_station && ` in ${e.seen_again_station}`}
        </span>
      </>
    );
  return e.state === "open" ? (
    <span style={{ color: VIOLET }}>steht noch</span>
  ) : (
    <>
      <span className="text-muted">noch nicht erkannt</span>
      <span className="block text-[12px] text-faint">zu wenige Scans seither</span>
    </>
  );
}

function StationTables({ list, now, lineStyle }: { list: StablingEntry[]; now: number; lineStyle: LineStyleFn }) {
  return (
    <div className="space-y-5">
      {groupByStation(list).map((g) => (
        <section key={g.id} className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-baseline justify-between gap-3 border-b border-line bg-raised px-4 py-2.5">
            <h2 className="truncate text-[15px] font-semibold">{g.name}</h2>
            <span className="tnum shrink-0 text-[12px] text-muted">
              {g.entries.length} {g.entries.length === 1 ? "Abstellung" : "Abstellungen"} · {g.cars} Waggons
            </span>
          </div>
          <table className="w-full table-fixed text-left text-[13px] max-sm:hidden">
            <thead className="text-[10px] uppercase tracking-[0.08em] text-faint">
              <tr>
                <th className="w-[15%] px-4 py-2 font-medium">Datum</th>
                <th className="w-[13%] py-2 pr-2 font-medium">Abgestellt</th>
                <th className="py-2 pr-2 font-medium">Zugkennung</th>
                <th className="w-[10%] py-2 pr-2 font-medium">Waggons</th>
                <th className="w-[24%] py-2 pr-2 font-medium">Abfahrt</th>
                <th className="w-[16%] py-2 pr-4 text-right font-medium">Standzeit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)] border-t border-line">
              {g.entries.map((e) => (
                <tr key={entryKey(e)} className="align-top">
                  <td className="tnum whitespace-nowrap px-4 py-2.5">{fmtDay(e.arrived_at)}</td>
                  <td className="tnum py-2.5 pr-2">
                    {fmtTime(e.arrived_at)}
                    {e.arr_platform && <span className="block text-[12px] text-faint">Gl. {e.arr_platform}</span>}
                  </td>
                  <td className="py-2.5 pr-2">
                    <Vehicles ids={e.vehicles} />
                    <span className="mt-0.5 flex items-center gap-1.5 text-[12px] text-faint">
                      <LineBadge id={e.line_id} {...lineStyle(e.line_id)} size="sm" />
                      <span className="tnum">Zug {e.train_number}</span>
                    </span>
                  </td>
                  <td className="tnum py-2.5 pr-2">{e.cars}</td>
                  <td className="py-2.5 pr-2"><DepartureText e={e} /></td>
                  <td className="tnum py-2.5 pr-4 text-right">{stayText(e, now)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="divide-y divide-[var(--line)] sm:hidden">
            {g.entries.map((e) => (
              <li key={entryKey(e)} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[15px]"><Vehicles ids={e.vehicles} /></span>
                  <span className="tnum shrink-0 text-[12.5px] text-muted">{e.cars} Waggons</span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-faint">
                  <LineBadge id={e.line_id} {...lineStyle(e.line_id)} size="sm" />
                  <span className="tnum">Zug {e.train_number}</span>
                  {e.arr_platform && <span>· Gl. {e.arr_platform}</span>}
                </div>
                <dl className="mt-1.5 grid grid-cols-[5.5rem_1fr] gap-y-1 text-[13px]">
                  <dt className="text-faint">Abgestellt</dt>
                  <dd className="tnum">{fmtDay(e.arrived_at)} {fmtTime(e.arrived_at)}</dd>
                  <dt className="text-faint">Abfahrt</dt>
                  <dd><DepartureText e={e} /></dd>
                  <dt className="text-faint">Standzeit</dt>
                  <dd className="tnum">{stayText(e, now)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

function Timeline({ list, day, setDay, now, today }: { list: StablingEntry[]; day: string; setDay: (d: string) => void; now: number; today: string }) {
  const segs = daySegments(list, day, now);
  const groups = groupByStation(segs.map((s) => s.entry));
  const byKey = new Map(segs.map((s) => [entryKey(s.entry), s]));
  const nowAt = day === today ? (now - dayStart(day)) / 86_400_000 : null;
  return (
    <section className="rounded-lg border border-line p-4">
      <div role="group" aria-label="Tag wählen" className="flex flex-wrap gap-1.5">
        {DAYS.map((d) => (
          <button
            key={d}
            aria-pressed={d === day}
            onClick={() => setDay(d)}
            className={`tnum h-8 rounded-md border px-2.5 text-[12.5px] compact:h-11 compact:px-3 ${
              d === day ? "border-[#c4a7ff]/60 bg-[#c4a7ff]/10 text-fg" : "border-line text-muted hover:text-fg"
            }`}
          >
            {fmtDay(dayStart(d))}
            {d === today && <span className="text-faint"> heute</span>}
          </button>
        ))}
      </div>
      {segs.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-muted">An diesem Tag stand nach den Scans kein Zug.</p>
      ) : (
        <>
          <div className="tnum relative mt-4 h-4 text-[10px] text-faint" aria-hidden>
            {TICKS.map((h) => (
              <span
                key={h}
                className={`absolute ${h % 6 ? "max-sm:hidden" : ""} ${h === 0 ? "" : h === 24 ? "-translate-x-full" : "-translate-x-1/2"}`}
                style={{ left: `${(h / 24) * 100}%` }}
              >
                {String(h).padStart(2, "0")}
                {h % 6 === 0 && <span className="max-sm:hidden">:00</span>}
              </span>
            ))}
          </div>
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.id}>
                <h3 className="text-[13px] font-semibold">{g.name}</h3>
                <ul className="mt-1 space-y-2">
                  {g.entries.map((e) => {
                    const s = byKey.get(entryKey(e))!;
                    const known = e.state === "departed";
                    const start = `${s.before ? `${fmtDay(e.arrived_at)} ` : ""}${fmtTime(e.arrived_at)}`;
                    const end = e.departed_at
                      ? `${s.after ? `${fmtDay(e.departed_at)} ` : ""}${fmtTime(e.departed_at)}`
                      : e.seen_again_at
                        ? "Abfahrt unbekannt"
                        : e.state === "open"
                          ? "steht noch"
                          : "Abfahrt noch nicht erkannt";
                    const label = `${e.vehicles.join(" + ")}, ${e.cars} Waggons, ${start} bis ${end}, Standzeit ${stayText(e, now)}`;
                    return (
                      <li key={entryKey(e)} title={label}>
                        <div className="flex items-baseline justify-between gap-3 text-[12px]">
                          <span className="min-w-0 truncate"><Vehicles ids={e.vehicles} /></span>
                          <span className="tnum shrink-0 text-muted">
                            {start} – {end}
                          </span>
                        </div>
                        <div className="relative mt-1 h-3 rounded-[4px] bg-white/[0.04]" role="img" aria-label={label}>
                          {TICKS.slice(1, -1).map((h) => (
                            <span key={h} className="absolute inset-y-0 w-px bg-white/[0.06]" style={{ left: `${(h / 24) * 100}%` }} />
                          ))}
                          <span
                            className={`absolute inset-y-0 min-w-[3px] ${s.before ? "" : "rounded-l-[4px]"} ${s.after || !known ? "" : "rounded-r-[4px]"}`}
                            style={{
                              left: `${s.from * 100}%`,
                              width: `${(s.to - s.from) * 100}%`,
                              background: known ? VIOLET : `repeating-linear-gradient(135deg, ${VIOLET} 0 4px, ${VIOLET}59 4px 8px)`,
                            }}
                          />
                          {nowAt != null && <span className="absolute -inset-y-0.5 w-px bg-white/50" style={{ left: `${nowAt * 100}%` }} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[12px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-5 rounded-[3px]" style={{ background: VIOLET }} /> Ankunft und Abfahrt bekannt
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-5" style={{ background: `repeating-linear-gradient(135deg, ${VIOLET} 0 4px, ${VIOLET}59 4px 8px)` }} /> Ende offen oder nicht beobachtet
            </span>
            {nowAt != null && (
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-px bg-white/50" /> jetzt
              </span>
            )}
          </div>
        </>
      )}
    </section>
  );
}

const KIND: Record<ChronicleItem["kind"], string> = { in: "abgestellt", out: "ausgefahren", seen: "wieder gesehen" };

function Chronicle({ items, lineStyle }: { items: ChronicleItem[]; lineStyle: LineStyleFn }) {
  const days = new Map<string, ChronicleItem[]>();
  for (const i of items) {
    const k = dayKey(i.at);
    days.set(k, [...(days.get(k) ?? []), i]);
  }
  return (
    <div className="space-y-5">
      {[...days].map(([key, dayItems]) => (
        <section key={key} className="overflow-hidden rounded-lg border border-line">
          <h2 className="tnum border-b border-line bg-raised px-4 py-2.5 text-[15px] font-semibold">{fmtDay(dayStart(key))}</h2>
          <ol className="divide-y divide-[var(--line)]">
            {dayItems.map((i) => {
              const e = i.entry;
              const line = i.kind === "out" && e.dep_line_id ? e.dep_line_id : e.line_id;
              return (
                <li key={`${entryKey(e)}-${i.kind}`} className="flex gap-3 px-4 py-2.5 text-[13px]">
                  <span className="tnum w-10 shrink-0 font-medium">{fmtTime(i.at)}</span>
                  <span aria-hidden className="w-3 shrink-0 text-center" style={{ color: i.kind === "in" ? VIOLET : undefined }}>
                    {i.kind === "in" ? "■" : i.kind === "out" ? "→" : "?"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Vehicles ids={e.vehicles} /> <span className="text-muted">{KIND[i.kind]}</span>{" "}
                    <span>{i.kind === "seen" ? `in ${e.seen_again_station ?? "–"}` : e.station_name}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-faint">
                      {i.kind === "seen" ? (
                        <span>Abfahrt aus {e.station_name} nicht beobachtet</span>
                      ) : (
                        <>
                          <LineBadge id={line} {...lineStyle(line)} size="sm" />
                          <span className="tnum">
                            Zug {(i.kind === "out" ? e.dep_train_number : e.train_number) ?? "–"}
                            {i.kind === "out" ? e.dep_destination && ` nach ${e.dep_destination}` : e.origin_name && ` aus ${e.origin_name}`} · {e.cars} Waggons
                          </span>
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
