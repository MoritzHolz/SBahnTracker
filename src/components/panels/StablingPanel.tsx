"use client";

/**
 * Abstellprotokoll: Seitengerüst. Lädt die Woche einmal, leitet daraus alle Ansichten ab (gleiche Datenbasis)
 * und hält Auswahl, Markierungen, Notizen und Ansichtswechsel zusammen.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnalysisView } from "@/components/stabling/AnalysisView";
import { DetailPanel } from "@/components/stabling/DetailPanel";
import { MarkedView } from "@/components/stabling/MarkedView";
import { NotesView } from "@/components/stabling/NotesView";
import { ProtocolView } from "@/components/stabling/ProtocolView";
import { C, type LineStyleFn, type NavTarget, type View, type ViewProps } from "@/components/stabling/shared";
import { TimeWindowView } from "@/components/stabling/TimeWindowView";
import { WeekView } from "@/components/stabling/WeekView";
import { DataBadge } from "@/components/ui/Badges";
import { useNow } from "@/hooks/useLiveData";
import { useMarks, useStationNotes } from "@/hooks/useStablingUser";
import { fetchLines, lineColor, lineTextColor, type Line } from "@/lib/api";
import { addDays, dayKey, fetchStablingWeek, FIRST_WEEK, weekDays, weekLabel, weekOf, type StablingWeek } from "@/lib/stabling";
import { findRelations, relationsByStay, toStays, weekRange } from "@/lib/stablingModel";
import { AppNav } from "./StatusBar";

const REFRESH_MS = 60_000;

const VIEWS: [View, string][] = [
  ["woche", "Woche"],
  ["tag", "Tag"],
  ["nacht", "Nacht"],
  ["protokoll", "Protokoll"],
  ["analyse", "Analyse"],
  ["markiert", "Markiert"],
  ["notizen", "Notizen"],
];
const isView = (v: string | null): v is View => VIEWS.some(([k]) => k === v);

/** Ansicht, Tag, Nacht und Auswahl in der Adresse (Neuladen, Teilen, Zurück-Taste) */
function readUrl() {
  if (typeof window === "undefined") return {};
  const q = new URLSearchParams(window.location.search);
  const v = q.get("ansicht");
  const d = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(q.get(k) ?? "") ? q.get(k)! : undefined);
  return { view: isView(v) ? v : undefined, week: d("woche"), day: d("tag"), night: d("nacht"), key: q.get("auswahl") ?? undefined };
}

export function StablingPanel() {
  const now = useNow(30_000);
  const today = dayKey(now);
  const thisWeek = weekOf(today);
  const [init] = useState(readUrl);
  /** null = laufende Woche, springt am Montag von selbst weiter */
  const [picked, setPicked] = useState<string | null>(init.week && init.week < thisWeek ? weekOf(init.week) : null);
  const week = picked ?? thisWeek;
  const days = useMemo(() => weekDays(week), [week]);
  const [data, setData] = useState<StablingWeek | null>(null);
  const log = data?.week === week ? data : null;
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Map<string, Line>>(() => new Map());
  const [view, setView] = useState<View>(init.view ?? "woche");
  const [selected, setSelected] = useState<string | null>(init.key ?? null);
  const [windowMin, setWindowMin] = useState(30);
  const [nightHours, setNightHours] = useState<[number, number]>([0, 6]);
  const inWeek = (d: string | undefined) => (d && days.includes(d) ? d : undefined);
  const [dayPick, setDayPick] = useState<string | undefined>(init.day);
  const [nightPick, setNightPick] = useState<string | undefined>(init.night);
  const day = inWeek(dayPick) ?? (days.includes(today) ? today : days[0]);
  // Standardnacht: die letzte (gestern → heute), sonst die erste der Woche
  const night = inWeek(nightPick) ?? (days.includes(addDays(today, -1)) ? addDays(today, -1) : days[0]);

  const marks = useMarks();
  const notes = useStationNotes();

  useEffect(() => {
    let alive = true;
    setError(null);
    const load = () =>
      fetchStablingWeek(week).then(
        (l) => {
          if (!alive) return;
          setData(l);
          setError(null);
        },
        (e: Error) => alive && setError(e.message),
      );
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void load();
      void notes.reload();
    };
    void load();
    const id = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
    // notes.reload ist stabil
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);
  useEffect(() => {
    fetchLines().then((l) => setLines(new Map(l.map((x) => [x.id, x]))), () => {});
  }, []);

  useEffect(() => {
    const q = new URLSearchParams();
    q.set("ansicht", view);
    if (picked) q.set("woche", week);
    if (view === "tag") q.set("tag", day);
    if (view === "nacht") q.set("nacht", night);
    if (selected) q.set("auswahl", selected);
    window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
  }, [view, picked, week, day, night, selected]);

  const stays = useMemo(() => toStays(log?.entries ?? []), [log]);
  const allStays = useMemo(() => toStays([...(log?.earlier ?? []), ...(log?.entries ?? []), ...(log?.later ?? [])]), [log]);
  // „jetzt“ nur minütlich in die Analyse geben, sonst rechnet sie alle 30 s neu
  const nowMin = Math.floor(now / 60_000) * 60_000;
  const relations = useMemo(() => findRelations(allStays, windowMin, nowMin), [allStays, windowMin, nowMin]);
  const relByStay = useMemo(() => relationsByStay(relations), [relations]);
  const lineStyle: LineStyleFn = useCallback((id) => ({ color: lineColor(lines, id), textColor: lineTextColor(lines, id) }), [lines]);

  const goWeek = (w: string) => {
    setPicked(w >= thisWeek ? null : w);
    setDayPick(undefined);
    setNightPick(undefined);
  };
  const goTo = useCallback((v: View, t: NavTarget = {}) => {
    if (t.day) {
      const w = weekOf(t.day);
      setPicked(w >= thisWeek ? null : w);
      setDayPick(t.day);
    }
    if (t.night) {
      const w = weekOf(t.night);
      setPicked(w >= thisWeek ? null : w);
      setNightPick(t.night);
    }
    if (t.key !== undefined) setSelected(t.key);
    setView(v);
  }, [thisWeek]);

  const selectedStay = selected ? allStays.find((s) => s.key === selected) ?? null : null;
  const props: ViewProps = {
    week, days, today, now, stays, allStays, relations, relByStay, windowMin, setWindowMin, marks, notes,
    selected, select: setSelected, lineStyle, goTo, day, night, nightHours, setNightHours,
  };
  const [wa, wb] = weekRange(week);
  const inW = (t: number) => t >= wa && t < wb;
  const weekRel = relations.filter((r) => inW(r.a.start) || inW(r.b.start));
  const standing = stays.filter((s) => s.endKind === "ongoing").length;
  const markedStanding = allStays.filter((s) => s.endKind === "ongoing" && marks.anyMarked(s.vehicles)).length;

  const weekBtn =
    "grid h-9 min-w-9 shrink-0 place-items-center rounded-md border border-line text-[18px] leading-none text-fg hover:bg-white/[0.06] disabled:opacity-30 compact:h-11 compact:min-w-11";

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-line bg-[var(--panel)] backdrop-blur-md">
        <div className="page-x mx-auto max-w-6xl py-3 compact:py-1.5 compact:pt-[calc(0.375rem+env(safe-area-inset-top))]">
          <AppNav active="abstellungen" />
        </div>
      </header>

      <div className={`page-x page-b mx-auto max-w-6xl pt-6 compact:pt-4 ${selectedStay ? "lg:pr-[400px]" : ""}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Abstellprotokoll</h1>
          <DataBadge state="vermutung" label="Aus Scans erkannt" />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
          <nav aria-label="Woche" className="flex items-center gap-2 max-sm:w-full">
            <button className={weekBtn} onClick={() => goWeek(addDays(week, -7))} disabled={week <= FIRST_WEEK} aria-label="Vorherige Woche">
              ‹
            </button>
            <h2 aria-live="polite" className="tnum min-w-0 whitespace-nowrap text-center text-[15px] font-semibold max-[374px]:text-[13px] max-sm:flex-1 sm:min-w-[15rem]">
              {weekLabel(week)}
              {week === thisWeek && <span className="block text-[12px] font-normal text-muted">diese Woche</span>}
            </h2>
            <button className={weekBtn} onClick={() => goWeek(addDays(week, 7))} disabled={week >= thisWeek} aria-label="Nächste Woche">
              ›
            </button>
            {week !== thisWeek && (
              <button className={`${weekBtn} px-3 text-[13px] font-medium max-sm:hidden`} onClick={() => goWeek(thisWeek)}>
                Diese Woche
              </button>
            )}
          </nav>
          {log && (
            <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted sm:ml-auto">
              <Stat k="Abstellungen" v={stays.length} />
              <Stat k="steht noch" v={standing} color={C.standing} />
              <Stat k="gleichzeitig (A)" v={weekRel.filter((r) => r.category === "A").length} color={C.overlap} />
              <Stat k="markiert stehend" v={markedStanding} color={C.marked} />
              <Stat k="nach Plochingen verschoben" v={log.moved} title="Fahrzeuge, nicht im Protokoll" />
            </dl>
          )}
        </div>
        {week === FIRST_WEEK && (
          <p className="mt-2 text-[12px] leading-relaxed text-faint">
            Vor Mi 25.11., 14:35 Uhr nachträglich aus den damaligen Scans ergänzt. Gescannt wurde nur zeitweise, deshalb fehlen viele Züge und Abfahrten.
          </p>
        )}

        <div role="tablist" aria-label="Ansicht" className="scroll-thin mt-4 flex gap-0.5 overflow-x-auto rounded-md border border-line p-0.5">
          {VIEWS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`h-8 shrink-0 whitespace-nowrap rounded px-3 text-[13px] compact:h-10 max-sm:flex-1 max-sm:px-2.5 ${view === key ? "bg-white/[0.09] font-medium text-fg" : "text-muted hover:text-fg"}`}
            >
              {label}
              {key === "markiert" && marks.ids.size > 0 && <span className="tnum ml-1 text-[11px]" style={{ color: C.marked }}>★{marks.ids.size}</span>}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="mt-4 text-[13px] text-bad">Protokoll nicht abrufbar: {error}</p>}
        {marks.error && <p role="alert" className="mt-4 text-[13px] text-bad">{marks.error}</p>}
        {!log && !error && <p className="mt-6 text-[13px] text-faint">Protokoll wird geladen …</p>}

        {log && (
          <div className="mt-4" role="tabpanel">
            {view === "woche" ? (
              <WeekView {...props} />
            ) : view === "tag" || view === "nacht" ? (
              <TimeWindowView {...props} mode={view} />
            ) : view === "protokoll" ? (
              <ProtocolView {...props} />
            ) : view === "analyse" ? (
              <AnalysisView {...props} />
            ) : view === "markiert" ? (
              <MarkedView {...props} />
            ) : (
              <NotesView {...props} />
            )}
          </div>
        )}

        <section className="mt-6 rounded-lg border border-line bg-raised p-5 text-[12px] leading-relaxed text-muted max-sm:p-4">
          <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">So entsteht das Protokoll</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Ein Eintrag entsteht, wenn ein gelesener Zug 45 min nach der Ankunft in keiner gelesenen Abfahrt auftaucht. An der Schwabstraße gilt das nach 15 min und nur für Abfahrten vom Gegengleis.</li>
            <li>Zeiten stammen aus Fahrplan und Echtzeit. Ankunft heißt: Ende der letzten Fahrt. Wurde die nächste Fahrt an einem anderen Bahnhof gelesen, bleibt die Abfahrt am ersten Bahnhof unbekannt.</li>
            <li>Fährt ein abgestellter Zug als Nächstes an einem anderen Bahnhof los, gilt er als dorthin überführt und dort abgestellt (Symbol ↪). Wann und wie er dorthin kam, ist nicht bekannt (Annahme).</li>
            <li>Jede Abstellung ist nur einmal gespeichert. Woche, Tag, Nacht, Protokoll und Analyse zeigen Ausschnitte derselben Einträge. Unbekannte Enden werden nicht erfunden: Offene Balken reichen bis jetzt (höchstens 48 h) und sind schraffiert.</li>
            <li>Zusammenhänge beruhen nur auf Abstellzeiten am selben Standort, nicht auf Fahrten. A = nachweislich gleichzeitig abgestellt, B = zeitlich nahe oder wegen unbekannter Zeiten nur möglich. Standortübergreifend wird nur dasselbe Fahrzeug verknüpft.</li>
            <li>Notizen sind eigene Angaben und werden nie als Zugbewegung gewertet.</li>
            <li>Nicht im Protokoll: Züge, die nach 48 h (Schwabstraße 60 min) automatisch nach Plochingen verschoben wurden. Ohne Scans entsteht kein Eintrag. Lücken in der Nacht schließt der Zeitplan im <Link href="/scanner" className="text-fg underline decoration-white/30 underline-offset-2">Scanner</Link>.</li>
          </ul>
        </section>
      </div>

      {selectedStay && <DetailPanel {...props} stay={selectedStay} onClose={() => setSelected(null)} />}
    </main>
  );
}

function Stat({ k, v, color, title }: { k: string; v: number; color?: string; title?: string }) {
  return (
    <div className="flex items-baseline gap-1.5" title={title}>
      <dd className="tnum text-[15px] font-semibold text-fg" style={color && v > 0 ? { color } : undefined}>{v}</dd>
      <dt>{k}</dt>
    </div>
  );
}
