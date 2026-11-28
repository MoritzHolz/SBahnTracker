"use client";

/**
 * Suche und Profil: Wo und wann wurde ein Fahrzeug, ein Zug oder an einem Standort abgestellt, wie lange,
 * gibt es ein Muster, und wann lohnt sich ein Besuch? Grundlage sind die letzten 30 Tage.
 */
import Link from "next/link";
import { useId, useMemo, useRef, useState } from "react";
import { addDays, dayKey, dayStart, fmtDay, fmtStay } from "@/lib/stabling";
import { dayRange, segmentsIn, weekdayOf, WEEKDAYS, WEEKDAYS_SHORT, type Stay } from "@/lib/stablingModel";
import {
  buildProfile,
  hhmm,
  RANGES,
  searchables,
  spreadText,
  suggest,
  groupTips,
  groupWindowText,
  visitTips,
  type Profile,
  type Reliability,
  type Target,
  type TipGroup,
} from "@/lib/stablingProfile";
import { fmtTime } from "@/lib/time";
import { blockBackground, blockRing, C, durationText, endText, Legend, MarkButton, startText, TransferMark, Vehicles, type ViewProps } from "./shared";

const KIND_LABEL: Record<Target["kind"], string> = { fahrzeug: "Fahrzeug", ort: "Standort", zug: "Zugnummer" };

// ------------------------------------------------------------------ Suchfeld

export function SearchBox({ targets, onPick, current }: { targets: Target[]; onPick: (t: Target) => void; current: Target | null }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => suggest(targets, q), [targets, q]);
  const pick = (t: Target) => {
    onPick(t);
    setQ("");
    setOpen(false);
    input.current?.blur();
  };
  return (
    <div className="relative">
      <label htmlFor={`${id}-q`} className="sr-only">Fahrzeug, Zugnummer oder Standort suchen</label>
      <div className="flex items-center gap-2 rounded-lg border border-line bg-raised px-3 focus-within:border-white/40">
        <span aria-hidden className="text-[17px] text-faint">⌕</span>
        <input
          ref={input}
          id={`${id}-q`}
          role="combobox"
          aria-expanded={open && hits.length > 0}
          aria-controls={`${id}-list`}
          aria-activedescendant={open && hits[active] ? `${id}-${active}` : undefined}
          autoComplete="off"
          inputMode="search"
          enterKeyHint="search"
          value={q}
          placeholder={current ? `${KIND_LABEL[current.kind]} ${current.label} · andere suchen …` : "Fahrzeug (z. B. 430 101), Zugnummer oder Bahnhof"}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, hits.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && hits[active]) pick(hits[active]);
            else if (e.key === "Escape") setOpen(false);
            else return;
            e.preventDefault();
          }}
          className="h-12 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
        />
      </div>
      {open && q.trim() && (
        <ul id={`${id}-list`} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-lg border border-line bg-[var(--panel-solid)] shadow-2xl">
          {hits.length === 0 ? (
            <li className="px-3 py-3 text-[13px] text-muted">In den letzten 30 Tagen nichts gefunden. Nur erkannte Abstellungen sind durchsuchbar.</li>
          ) : (
            hits.map((t, i) => (
              <li
                key={`${t.kind}-${t.id}`}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(t)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-baseline gap-3 px-3 py-2.5 text-[14px] ${i === active ? "bg-white/[0.08]" : ""}`}
              >
                <span className="w-20 shrink-0 text-[11px] uppercase tracking-[0.08em] text-faint">{KIND_LABEL[t.kind]}</span>
                <span className="tnum min-w-0 flex-1 truncate font-medium">{t.label}</span>
                <span className="tnum shrink-0 text-[12px] text-muted">{t.count}× abgestellt</span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Ansicht

export function ProfileView(p: ViewProps) {
  const { recentStays, searchTarget: target, now, openTarget } = p;
  const all = useMemo(() => searchables(recentStays), [recentStays]);
  const prof = useMemo(() => (target ? buildProfile(recentStays, target, now, p.rangeDays) : null), [recentStays, target, now, p.rangeDays]);
  // Muster je Wochentag brauchen mehrere Wochen: der Tipp wertet immer die ganzen 30 Tage aus
  const tipProf = useMemo(() => (target ? buildProfile(recentStays, target, now, 30) : null), [recentStays, target, now]);
  const tips = useMemo(() => (tipProf ? groupTips(visitTips(tipProf, now)) : []), [tipProf, now]);

  if (!p.recentLoaded) return <p className="text-[13px] text-faint">Die letzten 30 Tage werden geladen …</p>;
  if (!target || !prof) return <QuickPicks all={all} {...p} />;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.1em] text-faint">{KIND_LABEL[target.kind]}</div>
          <h2 className="tnum flex items-center gap-2 text-[22px] font-semibold leading-tight">
            {target.kind === "fahrzeug" && <MarkButton vehicle={target.id} marks={p.marks} />}
            {target.label}
          </h2>
        </div>
        {prof.steht && (
          <button onClick={() => p.select(prof.steht!.key)} className="rounded-full px-3 py-1 text-[13px] font-medium text-black" style={{ background: C.standing }}>
            steht gerade {target.kind === "ort" ? "ein Zug" : `in ${prof.steht.stationName}`} · seit {fmtTime(prof.steht.start)}
          </button>
        )}
        <div className="flex gap-2 sm:ml-auto">
          {target.kind === "fahrzeug" && (
            <Link href={`/fahrzeuge?q=${encodeURIComponent(target.id)}`} className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted hover:bg-white/[0.06] hover:text-fg">
              Wo ist er jetzt?
            </Link>
          )}
          <button onClick={() => openTarget(null)} className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-muted hover:bg-white/[0.06] hover:text-fg">
            Neue Suche
          </button>
        </div>
      </header>

      <div role="group" aria-label="Zeitraum" className="grid grid-cols-3 gap-1 rounded-lg border border-line p-1 sm:inline-grid">
        {RANGES.map((d) => (
          <button
            key={d}
            aria-pressed={p.rangeDays === d}
            onClick={() => p.setRangeDays(d)}
            className={`rounded-md px-4 py-2 text-[13px] compact:py-2.5 ${p.rangeDays === d ? "bg-white/[0.1] font-medium text-fg" : "text-muted hover:text-fg"}`}
          >
            {d} Tage <span className="tnum text-faint">· {prof.counts[d]}×</span>
          </button>
        ))}
      </div>

      <Summary prof={prof} {...p} />
      {tipProf && <TipCard tips={tips} prof={tipProf} />}
      <DayStrips prof={prof} {...p} />
      <WeekdayRow prof={prof} />
      {target.kind === "ort" ? <StationExtras prof={prof} {...p} /> : <Places prof={prof} {...p} />}
      <StayTable prof={prof} {...p} />
    </div>
  );
}

function QuickPicks({ all, openTarget, marks }: ViewProps & { all: Target[] }) {
  const top = (k: Target["kind"], n: number) => all.filter((t) => t.kind === k).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, n);
  const marked = all.filter((t) => t.kind === "fahrzeug" && marks.isMarked(t.id));
  const chip = (t: Target) => (
    <li key={`${t.kind}-${t.id}`}>
      <button onClick={() => openTarget(t)} className="tnum flex items-baseline gap-2 rounded-md border border-line px-3 py-2 text-[14px] hover:bg-white/[0.06]">
        {marks.isMarked(t.id) && <span style={{ color: C.marked }}>★</span>}
        <span className="font-medium">{t.label}</span>
        <span className="text-[12px] text-faint">{t.count}×</span>
      </button>
    </li>
  );
  if (!all.length) return <Empty>In den letzten 30 Tagen wurde keine Abstellung erkannt. Ohne Scans entstehen keine Einträge.</Empty>;
  return (
    <div className="space-y-5">
      <p className="text-[14px] text-muted">Oben einen Zug oder Bahnhof eintippen, oder hier antippen. Gezeigt wird, wo und wann er in den letzten 7, 14 oder 30 Tagen abgestellt war.</p>
      {marked.length > 0 && (
        <section>
          <h2 className="text-[12px] font-medium uppercase tracking-[0.1em] text-faint">Deine markierten Fahrzeuge</h2>
          <ul className="mt-2 flex flex-wrap gap-2">{marked.map(chip)}</ul>
        </section>
      )}
      <section>
        <h2 className="text-[12px] font-medium uppercase tracking-[0.1em] text-faint">Standorte</h2>
        <ul className="mt-2 flex flex-wrap gap-2">{top("ort", 30).map(chip)}</ul>
      </section>
      <section>
        <h2 className="text-[12px] font-medium uppercase tracking-[0.1em] text-faint">Am häufigsten abgestellte Fahrzeuge (30 Tage)</h2>
        <ul className="mt-2 flex flex-wrap gap-2">{top("fahrzeug", 12).map(chip)}</ul>
      </section>
    </div>
  );
}

const rangeText = (prof: Profile) =>
  prof.clipped ? `seit Aufzeichnungsbeginn am ${fmtDay(prof.from)} (${prof.dayCount} Tage)` : `in den letzten ${prof.days} Tagen`;

function Summary({ prof }: ViewProps & { prof: Profile }) {
  const t = prof.target;
  const n = prof.stays.length;
  const who = t.kind === "fahrzeug" ? t.label : t.kind === "zug" ? `${t.label}` : `In ${t.label}`;
  const top = prof.places[0];
  if (n === 0)
    return (
      <Box>
        <p className="text-[15px]">
          {t.kind === "ort" ? `In ${t.label} wurde` : `${who} wurde`} {rangeText(prof)} keine Abstellung erkannt.
        </p>
        <p className="mt-1 text-[12.5px] text-muted">Das heißt nicht sicher, dass nichts abgestellt war: Ohne Scans entsteht kein Eintrag. Ein längerer Zeitraum hilft.</p>
      </Box>
    );
  return (
    <Box>
      <p className="text-[15px] leading-relaxed">
        {t.kind === "ort" ? (
          <>
            In <b>{t.label}</b> wurden {rangeText(prof)} <b>{n}× Züge</b> abgestellt ({prof.vehicles.length} verschiedene Fahrzeuge)
          </>
        ) : (
          <>
            <b className="tnum">{who}</b> wurde {rangeText(prof)} <b>{n}× abgestellt</b>
            {top && (
              <>
                , {top.count === n ? "jedes Mal" : `${top.count}× davon`} in <b>{top.name}</b>
              </>
            )}
          </>
        )}
        {prof.start && prof.start.n >= 2 && (
          <>
            , meist <b className="tnum">{spreadText(prof.start)}</b>
          </>
        )}
        .{" "}
        {prof.avgMs != null ? (
          <>
            {t.kind === "ort" ? "Die Züge blieben" : "Er blieb"} im Schnitt <b className="tnum">{fmtStay(prof.avgMs)}</b>.
          </>
        ) : (
          <>Wie lange, ist unbekannt: Die Abholung wurde nie beobachtet.</>
        )}
      </p>
      <p className="mt-1.5 text-[12px] text-muted">
        Grundlage: {n} erkannte Abstellung{n === 1 ? "" : "en"}
        {prof.avgMs != null && `, Dauer aus ${prof.durationBasis} mit beobachteter Abholung`}. Typische Uhrzeit = mittlere Hälfte der Ankunftszeiten.
      </p>
      {n < 3 && (
        <p className="mt-2 rounded-md px-2.5 py-1.5 text-[12.5px]" style={{ background: `${C.near}1f`, color: C.near }}>
          Nur {n} Beobachtung{n === 1 ? "" : "en"}: zu wenig für ein verlässliches Muster.
        </p>
      )}
    </Box>
  );
}

const LEVELS: Reliability[] = ["zu wenig Daten", "schwach", "mittel", "gut"];
function Meter({ level }: { level: Reliability }) {
  const i = LEVELS.indexOf(level);
  const color = i >= 3 ? C.recur : i === 2 ? "#facc15" : C.near;
  return (
    <span className="inline-flex items-center gap-1.5" title="Wie oft das Muster im Zeitraum zutraf">
      <span aria-hidden className="flex gap-0.5">
        {[1, 2, 3].map((k) => (
          <span key={k} className="h-2.5 w-4 rounded-sm" style={{ background: k <= i ? color : "var(--line)" }} />
        ))}
      </span>
      <span className="text-[12px]" style={{ color: i ? color : undefined }}>
        Zuverlässigkeit: {level}
      </span>
    </span>
  );
}

function TipCard({ tips: good, prof }: { tips: TipGroup[]; prof: Profile }) {
  const isOrt = prof.target.kind === "ort";
  const daysText = (g: TipGroup) => (g.wds.length === 1 ? `${WEEKDAYS[g.wds[0] - 1]}en` : "dieser Wochentage");
  return (
    <section aria-labelledby="tip-h" className="rounded-lg border p-4" style={{ borderColor: `${C.recur}55` }}>
      <h2 id="tip-h" className="text-[15px] font-semibold">Wann lohnt sich ein Besuch?</h2>
      {good.length === 0 ? (
        <p className="mt-1 text-[13.5px] text-muted">
          Noch kein wiederkehrendes Muster {rangeText(prof)}: {prof.stays.length === 0 ? "keine Abstellung." : "kein Wochentag, an dem er mindestens zweimal zur ähnlichen Zeit dort stand."} Mit ein paar Wochen mehr Daten wird das genauer.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {good.slice(0, 3).map((t, i) => (
            <li key={`${t.wds.join()}-${t.stationId}`} className={i ? "border-t border-line pt-3" : ""}>
              <p className={i ? "text-[14px]" : "text-[17px] font-semibold"}>
                <span className="tnum">{groupWindowText(t)}</span>
                {!isOrt && <> · {t.stationName}</>}
              </p>
              <p className="mt-0.5 text-[13px] text-muted">
                {isOrt ? "Hier stand ein Zug" : "Er stand"} in diesem Zeitfenster an <b className="text-fg">{t.seen} von {t.of} {daysText(t)}</b> {rangeText(prof)} nachweislich dort
                {t.wds.length > 1 && <> ({t.tips.map((x) => `${WEEKDAYS_SHORT[x.wd - 1]} ${x.seen}/${x.of}`).join(", ")})</>}.
              </p>
              <div className="mt-1">
                <Meter level={t.level} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12px] leading-relaxed text-faint">
        Grundlage sind immer die letzten 30 Tage. Auswertung vergangener Abstellungen, keine Vorhersage: Umläufe ändern sich, und ohne Scans fehlen Einträge. Fenster zählen nur Zeiten, in denen der Zug nachweislich dort stand
        (unbekannte Abholung: nur die Ankunft). Bitte nur von Bahnsteigen und öffentlichen Wegen fotografieren, Gleise und Abstellanlagen nicht betreten.
      </p>
    </section>
  );
}

/** je Tag eine Zeile mit 24-h-Achse: gleiche Uhrzeiten liegen untereinander */
function DayStrips({ prof, now, select, selected, marks }: ViewProps & { prof: Profile }) {
  const keys: string[] = [];
  for (let k = dayKey(now); dayStart(k) >= prof.from; k = addDays(k, -1)) keys.push(k);
  const median = prof.start && prof.start.n >= 2 ? prof.start : null;
  const pct = (m: number) => `${(m / 1440) * 100}%`;
  return (
    <section aria-labelledby="days-h">
      <h2 id="days-h" className="text-[15px] font-semibold">Tag für Tag</h2>
      <p className="mt-0.5 text-[12.5px] text-muted">Gleiche Uhrzeiten liegen untereinander. {median && <>Grüne Fläche: typische Ankunft {spreadText(median)}.</>}</p>
      <div className="mt-2 rounded-lg border border-line px-3 py-2">
        <div className="grid grid-cols-[4.5rem_1fr] gap-x-2">
          <span />
          <div className="tnum relative h-4 text-[10.5px] text-faint" aria-hidden>
            {[0, 6, 12, 18, 24].map((h) => (
              <span key={h} className={`absolute ${h === 24 ? "-translate-x-full" : h ? "-translate-x-1/2" : ""}`} style={{ left: pct(h * 60) }}>
                {String(h % 24).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {keys.map((k) => {
            const segs = segmentsIn(prof.stays, dayRange(k), now);
            const wd = weekdayOf(k);
            return (
              <div key={k} className="contents">
                <span className={`tnum flex h-7 items-center text-[12px] ${wd >= 6 ? "text-muted" : ""}`}>
                  {WEEKDAYS_SHORT[wd - 1]} {fmtDay(`${k}T12:00:00Z`).slice(3)}
                </span>
                <div className="relative h-7 border-t border-line/60">
                  {[6, 12, 18].map((h) => (
                    <span key={h} aria-hidden className="absolute inset-y-0 border-l border-line/60" style={{ left: pct(h * 60) }} />
                  ))}
                  {median &&
                    (median.lo <= median.hi ? [[median.lo, median.hi]] : [[median.lo, 1440], [0, median.hi]]).map(([x, y]) => (
                      <span key={x} aria-hidden className="absolute inset-y-0" style={{ left: pct(x), width: `max(3px, ${pct(y - x)})`, background: `${C.recur}26` }} />
                    ))}
                  {segs.map((s) => {
                    const a = dayStart(k);
                    const l = (s.from - a) / 60_000;
                    const w = Math.max((s.to - s.from) / 60_000, 8);
                    return (
                      <button
                        key={s.stay.key}
                        onClick={() => select(s.stay.key)}
                        aria-label={`${s.stay.vehicles.join(" + ")} in ${s.stay.stationName}: ${startText(s.stay)} bis ${endText(s.stay, now)}`}
                        title={`${s.stay.vehicles.join(" + ")} · ${s.stay.stationName} · ${startText(s.stay)} – ${endText(s.stay, now)} · ${durationText(s.stay, now)}${prof.deviations.has(s.stay.key) ? ` · ${prof.deviations.get(s.stay.key)}` : ""}`}
                        className={`absolute top-1 h-5 ${s.clipStart ? "" : "rounded-l-[3px]"} ${s.clipEnd || s.openEnd ? "" : "rounded-r-[3px]"}`}
                        style={{
                          left: pct(l),
                          width: pct(w),
                          background: blockBackground(s.stay),
                          opacity: prof.target.kind === "ort" ? 0.75 : 1,
                          ...blockRing(prof.target.kind !== "fahrzeug" && marks.anyMarked(s.stay.vehicles), selected === s.stay.key),
                          ...(prof.deviations.has(s.stay.key) ? { outline: `2px dashed ${C.near}`, outlineOffset: 1 } : {}),
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Legend parts={["status"]} />
        {prof.deviations.size > 0 && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted">
            <span className="h-2.5 w-5 rounded-[3px]" style={{ outline: `2px dashed ${C.near}` }} /> weicht vom Üblichen ab
          </span>
        )}
      </div>
    </section>
  );
}

function WeekdayRow({ prof }: { prof: Profile }) {
  const max = Math.max(...prof.weekdays.map((w) => w.count));
  return (
    <section aria-labelledby="wd-h">
      <h2 id="wd-h" className="text-[15px] font-semibold">Nach Wochentag</h2>
      <ul className="mt-2 grid grid-cols-7 gap-1">
        {prof.weekdays.map((w) => {
          const top = w.count > 0 && w.count === max;
          return (
            <li key={w.wd} className="rounded-md border px-1 py-2 text-center" style={{ borderColor: top ? `${C.recur}88` : "var(--line)", background: top ? `${C.recur}14` : undefined }}>
              <div className="text-[12px] text-muted">{WEEKDAYS_SHORT[w.wd - 1]}</div>
              <div className="tnum text-[20px] font-semibold leading-tight" style={{ color: w.count ? undefined : "var(--faint)" }}>{w.count}×</div>
              <div className="tnum text-[11px] text-muted">{w.start ? (w.start.n >= 2 ? `~${hhmm(w.start.median)}` : hhmm(w.start.median)) : "–"}</div>
              <div className="tnum text-[11px] text-faint">{w.avgMs != null ? fmtStay(w.avgMs) : ""}</div>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[12px] text-faint">Anzahl Abstellungen, typische Ankunft und durchschnittliche Dauer (wo die Abholung beobachtet wurde).</p>
    </section>
  );
}

function Places({ prof, openTarget }: ViewProps & { prof: Profile }) {
  if (!prof.places.length) return null;
  return (
    <section aria-labelledby="pl-h">
      <h2 id="pl-h" className="text-[15px] font-semibold">Häufigste Standorte</h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {prof.places.map((x) => (
          <li key={x.id}>
            <button onClick={() => openTarget({ kind: "ort", id: x.id, label: x.name })} className="rounded-md border border-line px-3 py-2 text-[14px] hover:bg-white/[0.06]" title={`Standort ${x.name} auswerten`}>
              {x.name} <span className="tnum text-[12px] text-faint">{x.count}×</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StationExtras({ prof, openTarget, marks }: ViewProps & { prof: Profile }) {
  const max = Math.max(1, ...prof.hours);
  return (
    <>
      <section aria-labelledby="hr-h">
        <h2 id="hr-h" className="text-[15px] font-semibold">Zu welcher Uhrzeit stehen hier Züge?</h2>
        <p className="mt-0.5 text-[12.5px] text-muted">An wie vielen der {prof.dayCount} Tage um diese Uhrzeit nachweislich mindestens ein Zug dort stand.</p>
        <div className="mt-2 flex h-24 items-end gap-[2px] rounded-lg border border-line px-2 pb-1 pt-2" role="img" aria-label={`Belegung nach Uhrzeit: ${prof.hours.map((n, h) => `${h} Uhr ${n} Tage`).join(", ")}`}>
          {prof.hours.map((n, h) => (
            <div key={h} className="flex h-full flex-1 flex-col justify-end" title={`${String(h).padStart(2, "0")}–${String(h + 1).padStart(2, "0")} Uhr: an ${n} von ${prof.dayCount} Tagen`}>
              <div className="rounded-t-[2px]" style={{ height: `${(n / max) * 100}%`, minHeight: n ? 2 : 0, background: C.stay }} />
            </div>
          ))}
        </div>
        <div className="tnum mt-0.5 flex justify-between px-2 text-[10.5px] text-faint" aria-hidden>
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
      </section>
      {prof.vehicles.length > 0 && (
        <section aria-labelledby="veh-h">
          <h2 id="veh-h" className="text-[15px] font-semibold">Häufigste Fahrzeuge hier</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {prof.vehicles.slice(0, 16).map((v) => (
              <li key={v.id}>
                <button onClick={() => openTarget({ kind: "fahrzeug", id: v.id, label: v.id })} className="tnum rounded-md border border-line px-3 py-2 text-[14px] hover:bg-white/[0.06]">
                  {marks.isMarked(v.id) && <span style={{ color: C.marked }}>★ </span>}
                  {v.id} <span className="text-[12px] text-faint">{v.count}×</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function StayTable({ prof, now, select, selected, marks }: ViewProps & { prof: Profile }) {
  if (!prof.stays.length) return null;
  const showPlace = prof.target.kind !== "ort";
  const cell = (s: Stay) => ({
    day: `${WEEKDAYS_SHORT[weekdayOf(dayKey(s.start)) - 1]} ${fmtDay(s.start).slice(3)}`,
    dev: prof.deviations.get(s.key),
  });
  return (
    <section aria-labelledby="tab-h">
      <h2 id="tab-h" className="text-[15px] font-semibold">Alle Abstellungen ({prof.stays.length})</h2>
      {/* Handy: Karten */}
      <ul className="mt-2 space-y-1.5 sm:hidden">
        {prof.stays.map((s) => {
          const c = cell(s);
          return (
            <li key={s.key}>
              <button onClick={() => select(s.key)} className="w-full rounded-lg border border-line px-3 py-2 text-left" style={blockRing(!showPlace && marks.anyMarked(s.vehicles), selected === s.key)}>
                <span className="flex items-baseline justify-between gap-2 text-[14px]">
                  <span className="tnum font-medium">{c.day}</span>
                  <span className="tnum font-semibold">{durationText(s, now)}</span>
                </span>
                <span className="tnum mt-0.5 block text-[13px] text-muted">
                  {fmtTime(s.start)} → {endText(s, now, true)}
                  {showPlace ? ` · ${s.stationName}` : ""}
                </span>
                {!showPlace && <span className="mt-0.5 block text-[12.5px]"><Vehicles ids={s.vehicles} marks={marks} link={false} /></span>}
                {c.dev && <span className="mt-0.5 block text-[12px]" style={{ color: C.near }}>{c.dev}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {/* Breiter: Tabelle */}
      <div className="mt-2 overflow-x-auto rounded-lg border border-line max-sm:hidden">
        <table className="w-full text-left text-[13.5px]">
          <thead className="bg-raised text-[11px] uppercase tracking-[0.08em] text-faint">
            <tr>
              <th className="px-3 py-2 font-medium">Tag</th>
              <th className="px-3 py-2 font-medium">{showPlace ? "Ort" : "Fahrzeug"}</th>
              <th className="px-3 py-2 font-medium">Abgestellt</th>
              <th className="px-3 py-2 font-medium">Abgeholt</th>
              <th className="px-3 py-2 font-medium">Dauer</th>
              <th className="px-3 py-2 font-medium">Hinweis</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {prof.stays.map((s) => {
              const c = cell(s);
              return (
                <tr key={s.key} onClick={() => select(s.key)} className={`cursor-pointer hover:bg-white/[0.04] ${selected === s.key ? "bg-white/[0.07]" : ""}`}>
                  <td className="tnum whitespace-nowrap px-3 py-2">{c.day}</td>
                  <td className="px-3 py-2">
                    <TransferMark s={s} />
                    {showPlace ? s.stationName : <Vehicles ids={s.vehicles} marks={marks} link={false} />}
                  </td>
                  <td className="tnum whitespace-nowrap px-3 py-2 font-medium">{startText(s, false)}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2">{endText(s, now, true)}</td>
                  <td className="tnum whitespace-nowrap px-3 py-2 font-medium">{durationText(s, now)}</td>
                  <td className="px-3 py-2 text-[12.5px]" style={{ color: c.dev ? C.near : undefined }}>{c.dev ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <section className="rounded-lg border border-line bg-raised p-4">{children}</section>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">{children}</p>;
}

