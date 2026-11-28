"use client";

/**
 * Abstellanalyse: Überschneidungen (A), mögliche Zusammenhänge (B), Abstellfolgen je Standort, Fahrzeug-Umläufe und
 * wiederkehrende Muster. Grundlage sind ausschließlich die Abstellzeiträume (keine Fahrten).
 */
import { useMemo, useState } from "react";
import { LineBadge } from "@/components/ui/Badges";
import { dayKey, fmtDay } from "@/lib/stabling";
import {
  drawEnd,
  patterns,
  stationChains,
  vehicleRuns,
  weekRange,
  WINDOW_CHOICES,
  type Chain,
  type Relation,
  type Stay,
} from "@/lib/stablingModel";
import { fmtTime } from "@/lib/time";
import {
  blockBackground,
  blockRing,
  C,
  durationText,
  endText,
  fmtGap,
  Legend,
  RelBadge,
  startText,
  TransferMark,
  Vehicles,
  type ViewProps,
} from "./shared";

type CatFilter = "alle" | "A" | "B";

const KIND_TEXT: Record<Relation["kind"], string> = {
  overlap: "gleichzeitig abgestellt",
  possible_overlap: "Überschneidung möglich",
  follow: "kurz nacheinander",
};

/** „Mo 23.11. 10:30–11:00“, Tag beim Ende nur bei Tageswechsel */
function spanText(from: number, to: number): string {
  const end = dayKey(from) === dayKey(to) ? fmtTime(to) : `${fmtDay(to)} ${fmtTime(to)}`;
  return `${fmtDay(from)} ${fmtTime(from)}–${end}`;
}

export function AnalysisView(p: ViewProps) {
  const { week, now, relations, allStays, marks, windowMin, setWindowMin } = p;
  const [cat, setCat] = useState<CatFilter>("alle");
  const [station, setStation] = useState("");
  const [onlyMarked, setOnlyMarked] = useState(false);
  const [allRuns, setAllRuns] = useState(false);

  const [wa, wb] = weekRange(week);
  /** beginnt in der Woche oder läuft in sie hinein */
  const touches = (s: Stay) => s.start < wb && drawEnd(s, now) > wa;
  const weekStays = allStays.filter(touches);
  const markedStay = (s: Stay) => marks.anyMarked(s.vehicles);

  const weekRels = relations.filter((r) => touches(r.a) || touches(r.b));
  const rels = weekRels.filter(
    (r) => (cat === "alle" || r.category === cat) && (!station || r.station === station) && (!onlyMarked || markedStay(r.a) || markedStay(r.b)),
  );
  const chains = useMemo(() => stationChains(rels), [rels]);

  const stationOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of weekStays) m.set(s.station, s.stationName);
    return [...m].sort((a, b) => a[1].localeCompare(b[1], "de"));
  }, [weekStays]);

  const runs = vehicleRuns(weekStays)
    .filter((r) => (!station || r.stays.some((s) => s.station === station)) && (!onlyMarked || marks.isMarked(r.vehicle)))
    .sort((a, b) => Number(marks.isMarked(b.vehicle)) - Number(marks.isMarked(a.vehicle)));
  const RUN_LIMIT = 12;
  const shownRuns = allRuns ? runs : runs.slice(0, RUN_LIMIT);

  const pats = patterns(allStays).filter(
    (pt) => pt.stays.some((s) => s.start >= wa && s.start < wb) && (!station || pt.station === station) && (!onlyMarked || pt.stays.some(markedStay)),
  );

  const nA = weekRels.filter((r) => r.category === "A").length;
  const nB = weekRels.length - nA;
  const select = "h-9 min-w-0 rounded-md border border-line bg-black/30 px-2 text-[13px] text-fg compact:h-11 compact:text-[16px] [color-scheme:dark]";
  const seg = (on: boolean) => `h-8 rounded px-2.5 text-[13px] compact:h-10 ${on ? "bg-white/[0.09] text-fg" : "text-muted hover:text-fg"}`;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Zeitfenster für zeitliche Nähe" className="flex items-center rounded-md border border-line p-0.5">
            <span className="px-2 text-[12px] text-faint">Nähe</span>
            {WINDOW_CHOICES.map((m) => (
              <button key={m} aria-pressed={windowMin === m} onClick={() => setWindowMin(m)} className={seg(windowMin === m)}>
                {m} min
              </button>
            ))}
          </div>
          <div role="group" aria-label="Kategorie" className="flex rounded-md border border-line p-0.5">
            {(["alle", "A", "B"] as CatFilter[]).map((c) => (
              <button key={c} aria-pressed={cat === c} onClick={() => setCat(c)} className={seg(cat === c)}>
                {c === "alle" ? "Beide" : c === "A" ? "A gleichzeitig" : "B möglich"}
              </button>
            ))}
          </div>
          <select aria-label="Standort" value={station} onChange={(e) => setStation(e.target.value)} className={`${select} max-sm:flex-1`}>
            <option value="">Alle Standorte</option>
            {stationOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line px-2.5 text-[13px] text-muted compact:h-11">
            <input type="checkbox" checked={onlyMarked} onChange={(e) => setOnlyMarked(e.target.checked)} className="accent-[#facc15]" />
            <span style={{ color: onlyMarked ? C.marked : undefined }}>★</span> nur markierte
          </label>
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
          <div className="flex items-baseline gap-1.5">
            <dd className="tnum text-[15px] font-semibold" style={{ color: nA ? C.overlap : undefined }}>{nA}</dd>
            <dt>tatsächlich gleichzeitig (A)</dt>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dd className="tnum text-[15px] font-semibold" style={{ color: nB ? C.near : undefined }}>{nB}</dd>
            <dt>möglich / zeitlich nahe (B)</dt>
          </div>
          <div className="flex items-baseline gap-1.5">
            <dd className="tnum text-[15px] font-semibold text-fg">{chains.length}</dd>
            <dt>Abstellfolgen{rels.length !== weekRels.length && " (gefiltert)"}</dt>
          </div>
        </dl>
        <p className="mt-2 text-[12px] leading-relaxed text-faint">
          Nur Abstellzeiten am selben Standort werden verglichen, keine Fahrten. A: Beide standen nachweislich gleichzeitig dort. B: Abstand bis {windowMin} min oder Überschneidung nur möglich, weil eine Zeit nicht beobachtet ist. Ein Zugwechsel oder eine Ablösung lässt sich daraus nur vermuten.
        </p>
      </section>

      <section aria-labelledby="ana-folgen">
        <h2 id="ana-folgen" className="text-[15px] font-semibold">Abstellfolgen</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Abstellungen am selben Standort, die sich überschneiden oder kurz aufeinander folgen. Getrennte Gruppen sind getrennte Folgen.</p>
        {chains.length === 0 ? (
          <Empty>
            {weekRels.length === 0
              ? `In dieser Woche standen laut Abstellzeiten nie zwei Züge gleichzeitig oder innerhalb von ${windowMin} min nacheinander am selben Standort.`
              : "Für diese Auswahl gibt es keinen Zusammenhang."}
          </Empty>
        ) : (
          <div className="mt-3 space-y-4">
            {chains.map((ch) => (
              <ChainCard key={ch.links.map((l) => l.id).join("|")} chain={ch} {...p} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="ana-umlauf">
        <h2 id="ana-umlauf" className="text-[15px] font-semibold">Fahrzeug-Umläufe</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">
          Dasselbe Fahrzeug nacheinander an mehreren Abstellorten. Nur über die Fahrzeugnummer verknüpft, Fahrten dazwischen unbekannt.
        </p>
        {runs.length === 0 ? (
          <Empty>Kein Fahrzeug wurde in dieser Auswahl mehrmals abgestellt.</Empty>
        ) : (
          <>
            <ul className="mt-3 divide-y divide-[var(--line)] overflow-hidden rounded-lg border border-line">
              {shownRuns.map((r) => (
                <li key={r.vehicle} className="px-4 py-3" style={marks.isMarked(r.vehicle) ? { boxShadow: `inset 3px 0 0 ${C.marked}` } : undefined}>
                  <div className="text-[14px]">
                    <Vehicles ids={[r.vehicle]} marks={marks} />
                    <span className="ml-2 text-[12px] text-faint">{r.stays.length} Abstellungen</span>
                  </div>
                  <ol className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px]">
                    {r.stays.map((s, i) => {
                      const hop = i > 0 ? r.hops[i - 1] : null;
                      return (
                        <li key={s.key} className="flex items-center gap-1.5">
                          {hop && (
                            <span className="tnum text-faint" title={hop.transfer ? "Laut Daten überführt (Annahme)" : "Was dazwischen geschah, ist unbekannt"}>
                              {hop.transfer ? <span style={{ color: C.stay }}>↪ überführt</span> : hop.gapMin != null ? `→ ${fmtGap(Math.max(0, hop.gapMin))}` : "→ ?"}
                            </span>
                          )}
                          <StayChip s={s} {...p} />
                        </li>
                      );
                    })}
                  </ol>
                </li>
              ))}
            </ul>
            {runs.length > RUN_LIMIT && (
              <button onClick={() => setAllRuns(!allRuns)} className="mt-2 h-8 rounded-md border border-line px-3 text-[12.5px] text-muted hover:text-fg compact:h-10">
                {allRuns ? "Weniger anzeigen" : `Alle ${runs.length} Fahrzeuge anzeigen`}
              </button>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="ana-muster">
        <h2 id="ana-muster" className="text-[15px] font-semibold">Wiederkehrende Muster</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Derselbe Zug (Linie und Zugnummer der Ankunft) an mehreren Tagen am selben Standort abgestellt, auch mit Vorwoche.</p>
        {pats.length === 0 ? (
          <Empty>Kein Zug wurde in dieser Auswahl an mehreren Tagen am selben Standort abgestellt.</Empty>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {pats.map((pt) => {
              const tod = pt.stays.map((s) => fmtTime(s.start));
              return (
                <li key={`${pt.station}|${pt.line}|${pt.train}`} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                    <span className="font-semibold">{pt.stationName}</span>
                    <LineBadge id={pt.line} {...p.lineStyle(pt.line)} size="sm" />
                    <span className="tnum text-muted">Zug {pt.train}</span>
                    <span className="ml-auto text-[12px] text-muted">an {pt.days.length} Tagen</span>
                  </div>
                  <p className="mt-1 text-[12px]" style={{ color: pt.sameTime ? C.near : "var(--faint)" }}>
                    {pt.sameTime ? `Ankunft jeweils um dieselbe Zeit (${tod[0]}${tod.length > 1 ? ` bis ${[...tod].sort().at(-1)}` : ""})` : "Ankunft zu unterschiedlichen Zeiten"}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5 text-[12px]">
                    {pt.stays.map((s) => (
                      <li key={s.key}>
                        <StayChip s={s} {...p} hideStation />
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Legend parts={["status", "marked", "rel", "transfer"]} />
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 rounded-lg border border-line px-5 py-6 text-center text-[13px] leading-relaxed text-muted">{children}</p>;
}

/** Kleine anklickbare Abstellung: Standort, Beginn, Dauer */
function StayChip({ s, marks, select, selected, now, hideStation }: ViewProps & { s: Stay; hideStation?: boolean }) {
  const on = marks.anyMarked(s.vehicles);
  return (
    <button
      onClick={() => select(s.key)}
      title={`${s.vehicles.join(" + ")}: ${startText(s)} bis ${endText(s, now)}`}
      className="tnum inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-left hover:bg-white/[0.06]"
      style={blockRing(on, selected === s.key)}
    >
      <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: blockBackground(s) }} />
      <TransferMark s={s} />
      {!hideStation && <span className="font-medium">{s.stationName}</span>}
      <span className="text-muted">{startText(s)}</span>
      <span className="text-faint">· {durationText(s, now)}</span>
    </button>
  );
}

const ROW = 26;
const BAR = 14;

const LINK_LIMIT = 5;

/** zusammenhängende Zeiträume (überlappende Intervalle verschmelzen) */
function union(list: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [f, t] of [...list].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && f <= last[1]) last[1] = Math.max(last[1], t);
    else out.push([f, t]);
  }
  return out;
}

/** höchste Zahl gleichzeitig nachweislich abgestellter Züge in der Folge */
function maxTogether(chain: Chain): number {
  const ev: [number, number][] = [];
  for (const r of chain.links) if (r.kind === "overlap") ev.push([r.from, 0]);
  let best = 1;
  for (const [t] of ev) {
    const here = new Set<string>();
    for (const r of chain.links) if (r.kind === "overlap" && r.from <= t && r.to > t) here.add(r.a.key).add(r.b.key);
    best = Math.max(best, here.size);
  }
  return best;
}

function ChainCard(p: ViewProps & { chain: Chain }) {
  const { chain, now, marks, select, selected } = p;
  const [open, setOpen] = useState(false);
  const together = maxTogether(chain);
  const rows = chain.stays;
  const idx = new Map(rows.map((s, i) => [s.key, i]));
  const lo = Math.min(...rows.map((s) => s.start));
  const hi = Math.max(...rows.map((s) => drawEnd(s, now)), lo + 60_000);
  const pad = (hi - lo) * 0.04;
  const a = lo - pad;
  const b = hi + pad;
  const x = (t: number) => ((t - a) / (b - a)) * 100;
  const mid = (i: number) => i * ROW + ROW / 2;
  const height = rows.length * ROW;
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  const nA = chain.links.filter((l) => l.category === "A").length;

  return (
    <article className="overflow-hidden rounded-lg border border-line">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line bg-raised px-4 py-2.5">
        <h3 className="text-[14px] font-semibold">{chain.stationName}</h3>
        <span className="flex items-center gap-1.5 text-[12px] text-muted">
          {rows.length} Abstellungen · {spanText(lo, hi)}
          {together > 2 && <span style={{ color: C.overlap }}>· bis zu {together} gleichzeitig</span>}
          {nA > 0 && <RelBadge category="A" count={nA} />}
          {chain.links.length - nA > 0 && <RelBadge category="B" count={chain.links.length - nA} />}
        </span>
      </header>

      <div className="grid grid-cols-[minmax(6.5rem,9rem)_1fr] gap-x-2 px-4 pt-3 max-sm:grid-cols-[6rem_1fr]">
        <ul aria-hidden className="text-[12px]">
          {rows.map((s) => (
            <li key={s.key} className="flex items-center truncate" style={{ height: ROW }}>
              <TransferMark s={s} />
              <span className="truncate"><Vehicles ids={s.vehicles} marks={marks} link={false} /></span>
            </li>
          ))}
        </ul>
        <div className="relative" style={{ height }}>
          {/* B „kurz nacheinander“: gestrichelte Brücke von der Abfahrt zur nächsten Ankunft */}
          {chain.links.map((r) => {
            if (r.kind !== "follow") return null;
            const ia = idx.get(r.a.key)!;
            const ib = idx.get(r.b.key)!;
            const left = x(r.from);
            const w = Math.max(x(r.to) - left, 0.6);
            const title = `${KIND_TEXT[r.kind]}: ${r.reason}`;
            const [y1, y2] = [mid(ia), mid(ib)];
            return (
              <span key={r.id} title={title} className="absolute" style={{ left: `${left}%`, width: `${w}%`, top: Math.min(y1, y2), height: Math.max(Math.abs(y2 - y1), 1) }}>
                <span className="absolute inset-y-0 left-0 border-l border-dashed" style={{ borderColor: C.near }} />
                <span className="absolute inset-x-0 border-t border-dashed" style={{ borderColor: C.near, top: y2 > y1 ? "100%" : 0 }} />
                <span className="tnum absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-[var(--bg)] px-1 text-[10.5px] leading-none" style={{ color: C.near, top: y2 > y1 ? "calc(100% - 15px)" : 2 }}>
                  {fmtGap(r.gapMin)}
                </span>
              </span>
            );
          })}
          {rows.map((s, i) => {
            const l = x(s.start);
            const w = Math.max(x(drawEnd(s, now)) - l, 0.8);
            const on = marks.anyMarked(s.vehicles);
            return (
              <button
                key={s.key}
                onClick={() => select(s.key)}
                aria-label={`${s.vehicles.join(" + ")}, ${startText(s)} bis ${endText(s, now)}`}
                title={`${s.vehicles.join(" + ")}: ${startText(s)} bis ${endText(s, now)} · ${durationText(s, now)}`}
                className={`absolute min-w-[4px] ${s.endKind === "exact" ? "rounded-[3px]" : "rounded-l-[3px]"}`}
                style={{ left: `${l}%`, width: `${w}%`, top: mid(i) - BAR / 2, height: BAR, background: blockBackground(s), ...blockRing(on, selected === s.key) }}
              />
            );
          })}
          {/* A: Zeitraum, in dem dieser Zug nachweislich mit einem anderen dort stand (rot); B möglich: gestrichelt orange */}
          {rows.flatMap((s, i) =>
            (["overlap", "possible_overlap"] as const).flatMap((kind) =>
              union(chain.links.filter((r) => r.kind === kind && (r.a.key === s.key || r.b.key === s.key)).map((r) => [r.from, r.to] as [number, number])).map(([f, t]) => {
                const a = kind === "overlap";
                return (
                  <span
                    key={`${kind}-${s.key}-${f}`}
                    title={a ? `gleichzeitig mit anderen abgestellt ${fmtTime(f)}–${fmtTime(t)}` : `Überschneidung möglich ${fmtTime(f)}–${fmtTime(t)}`}
                    className="pointer-events-none absolute"
                    style={{ left: `${x(f)}%`, width: `${Math.max(x(t) - x(f), 0.6)}%`, top: mid(i) - BAR / 2 - 2, height: BAR + 4, borderRadius: 4,
                      ...(a ? { background: `${C.overlap}55`, border: `1px solid ${C.overlap}` } : { border: `1px dashed ${C.near}` }) }}
                  />
                );
              }),
            ),
          )}
        </div>
        <span />
        <div className="tnum relative mb-2 mt-1 h-4 text-[10.5px] text-faint" aria-hidden>
          {ticks.map((t, i) => (
            <span key={i} className={`absolute whitespace-nowrap ${i === 0 ? "" : i === 2 ? "-translate-x-full" : "-translate-x-1/2 max-sm:hidden"}`} style={{ left: `${x(t)}%` }}>
              {dayKey(t) === dayKey(lo) || i === 0 ? fmtTime(t) : `${fmtDay(t).slice(0, 2)} ${fmtTime(t)}`}
            </span>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-[var(--line)] border-t border-line">
        {(open ? chain.links : chain.links.slice(0, LINK_LIMIT)).map((r) => (
          <RelationRow key={r.id} r={r} {...p} />
        ))}
      </ul>
      {chain.links.length > LINK_LIMIT && (
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="h-9 w-full border-t border-line text-[12.5px] text-muted hover:bg-white/[0.04] hover:text-fg compact:h-11">
          {open ? "Weniger anzeigen" : `Alle ${chain.links.length} Zusammenhänge anzeigen`}
        </button>
      )}
    </article>
  );
}

function RelationRow(p: ViewProps & { r: Relation }) {
  const { r, now, marks, select, lineStyle, selected } = p;
  const side = (s: Stay) => (
    <button
      onClick={() => select(s.key)}
      className="min-w-0 rounded-md px-2 py-1.5 text-left hover:bg-white/[0.05]"
      style={blockRing(marks.anyMarked(s.vehicles), selected === s.key)}
    >
      <span className="flex flex-wrap items-center gap-1.5">
        <TransferMark s={s} />
        <Vehicles ids={s.vehicles} marks={marks} link={false} />
        <LineBadge id={s.entry.line_id} {...lineStyle(s.entry.line_id)} size="sm" />
        <span className="tnum text-[12px] text-faint">Zug {s.entry.train_number}</span>
      </span>
      <span className="tnum mt-0.5 block text-[12px] text-muted">
        {startText(s)} – {endText(s, now)} · {durationText(s, now)}
      </span>
    </button>
  );
  return (
    <li className="px-4 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <RelBadge category={r.category} />
        <span className="font-medium" style={{ color: r.category === "A" ? C.overlap : C.near }}>{KIND_TEXT[r.kind]}</span>
        <span className="tnum text-muted">{r.kind === "follow" ? `Abstand ${fmtGap(r.gapMin)} (${fmtTime(r.from)} → ${fmtTime(r.to)})` : spanText(r.from, r.to)}</span>
        <span className="text-[12px] text-faint">· {r.stationName} · Sicherheit: {r.certainty}</span>
      </div>
      <div className="mt-1 grid gap-1 sm:grid-cols-2">
        {side(r.a)}
        {side(r.b)}
      </div>
      <p className="mt-0.5 px-2 text-[12px] text-faint">{r.reason}</p>
    </li>
  );
}
