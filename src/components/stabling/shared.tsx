"use client";

/** Gemeinsame Bausteine aller Abstell-Ansichten: Farben mit fester Bedeutung, Fahrzeuge mit Markierung, Texte zu Zeiten. */
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Marks, Notes } from "@/hooks/useStablingUser";
import { fmtDay, fmtStay } from "@/lib/stabling";
import { slotLabel, stayDuration, type RecurSlot, type Relation, type Stay } from "@/lib/stablingModel";
import type { RangeDays, Target } from "@/lib/stablingProfile";
import { fmtTime } from "@/lib/time";

// ------------------------------------------------------------------ Farben (überall dieselbe Bedeutung)

export const C = {
  /** Abstellung mit beobachteter Abfahrt */
  stay: "#c4a7ff",
  /** steht laut Scans noch */
  standing: "#5eead4",
  /** Ende unbekannt */
  unknown: "#8b929c",
  /** markiertes Fahrzeug */
  marked: "#facc15",
  /** Kategorie A: tatsächliche Überschneidung */
  overlap: "#fb7185",
  /** Kategorie B: möglicher zeitlicher Zusammenhang */
  near: "#fdba74",
  /** Standortnotiz (keine Zugbewegung) */
  note: "#7dd3fc",
  /** wiederkehrend: gleicher Ort, gleicher Wochentag, ähnliche Uhrzeit in mehreren Wochen */
  recur: "#a3e635",
} as const;

export type StayStatus = "abgefahren" | "eingegrenzt" | "steht" | "unbekannt";

export const STATUS: Record<StayStatus, { label: string; color: string; hatched: boolean; hint: string }> = {
  abgefahren: { label: "Abfahrt beobachtet", color: C.stay, hatched: false, hint: "Ankunft und Abfahrt bekannt" },
  eingegrenzt: { label: "Zeit eingegrenzt", color: C.stay, hatched: true, hint: "Abfahrt oder (bei Überführung) Ankunft nicht beobachtet, nur eingegrenzt" },
  steht: { label: "Steht noch", color: C.standing, hatched: false, hint: "Laut letzten Scans noch abgestellt" },
  unbekannt: { label: "Ende unbekannt", color: C.unknown, hatched: true, hint: "Zu wenige Scans seither" },
};
export const STATUS_ORDER: StayStatus[] = ["abgefahren", "eingegrenzt", "steht", "unbekannt"];

export function statusOf(s: Stay): StayStatus {
  return s.endKind === "exact" ? (s.startKind === "lower" ? "eingegrenzt" : "abgefahren") : s.endKind === "upper" ? "eingegrenzt" : s.endKind === "ongoing" ? "steht" : "unbekannt";
}

/** Hintergrund eines Abstellblocks nach Status */
export function blockBackground(s: Stay): string {
  const st = STATUS[statusOf(s)];
  return st.hatched ? `repeating-linear-gradient(135deg, ${st.color} 0 4px, ${st.color}59 4px 8px)` : st.color;
}

/** Rahmen für markierte bzw. ausgewählte Blöcke */
export function blockRing(marked: boolean, selected: boolean): CSSProperties {
  if (selected) return { boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${marked ? C.marked : "transparent"}` };
  if (marked) return { boxShadow: `0 0 0 2px ${C.marked}` };
  return {};
}

// ------------------------------------------------------------------ Texte

const other = (t: number, ref: number) => (fmtDay(t) === fmtDay(ref) ? "" : `${fmtDay(t)} `);

/** „Mi 25.11. 22:30“ bzw. „frühestens …“ bei überführten Zügen */
export function startText(s: Stay, withDay = true): string {
  const t = `${withDay ? `${fmtDay(s.start)} ` : ""}${fmtTime(s.start)}`;
  return s.startKind === "lower" ? `frühestens ${t}` : t;
}

/** Ende so genau wie belegt */
export function endText(s: Stay, now: number, withDay = true): string {
  const d = (t: number) => `${withDay ? other(t, s.start) : ""}${fmtTime(t)}`;
  if (s.endKind === "exact") return d(s.end!);
  if (s.endKind === "upper") return `spätestens ${d(s.end!)}`;
  if (s.endKind === "ongoing") return `steht noch (seit ${fmtTime(s.start)}, Stand ${fmtTime(now)})`;
  return "unbekannt";
}

export function durationText(s: Stay, now: number): string {
  const d = stayDuration(s, now);
  if (d.ms == null) return "unbekannt";
  return d.kind === "max" ? `höchstens ${fmtStay(d.ms)}` : d.kind === "sofar" ? `bisher ${fmtStay(d.ms)}` : fmtStay(d.ms);
}

export const fmtGap = (min: number) => (min < 60 ? `${min} min` : fmtStay(min * 60_000));

// ------------------------------------------------------------------ Bausteine

export function Swatch({ status, className = "h-2.5 w-5" }: { status: StayStatus; className?: string }) {
  const st = STATUS[status];
  return <span aria-hidden className={`inline-block shrink-0 rounded-[3px] ${className}`} style={{ background: st.hatched ? `repeating-linear-gradient(135deg, ${st.color} 0 4px, ${st.color}59 4px 8px)` : st.color }} />;
}

/** Stern zum Markieren eines Fahrzeugs (ein Klick) */
export function MarkButton({ vehicle, marks, size = "md" }: { vehicle: string; marks: Marks; size?: "sm" | "md" }) {
  const on = marks.isMarked(vehicle);
  const label = on ? `Markierung von ${vehicle} entfernen` : `${vehicle} markieren`;
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={(ev) => {
        ev.stopPropagation();
        void marks.toggle(vehicle);
      }}
      className={`inline-grid shrink-0 place-items-center rounded-md leading-none hover:bg-white/[0.08] ${size === "sm" ? "h-6 w-6 text-[13px]" : "h-8 w-8 text-[16px] compact:h-10 compact:w-10"}`}
      style={{ color: on ? C.marked : "var(--faint)" }}
    >
      {on ? "★" : "☆"}
    </button>
  );
}

/** Fahrzeugnummern; markierte mit Stern. link=false in anklickbaren Blöcken (kein Link im Button). */
export function Vehicles({ ids, marks, link = true }: { ids: string[]; marks: Marks; link?: boolean }) {
  return (
    <>
      {ids.map((id, i) => {
        const on = marks.isMarked(id);
        const inner = (
          <>
            {on && <span aria-label="markiert" style={{ color: C.marked }}>★</span>}
            {id}
          </>
        );
        return (
          <span key={id}>
            {i > 0 && <span className="text-faint"> + </span>}
            {link ? (
              <Link href={`/fahrzeuge?q=${encodeURIComponent(id)}`} onClick={(e) => e.stopPropagation()} className="tnum whitespace-nowrap font-medium hover:underline" style={on ? { color: C.marked } : undefined}>
                {inner}
              </Link>
            ) : (
              <span className="tnum whitespace-nowrap font-medium" style={on ? { color: C.marked } : undefined}>
                {inner}
              </span>
            )}
          </span>
        );
      })}
    </>
  );
}

/** Kleines Symbol: kam von woanders, war dort abgestellt (überführt) */
export function TransferMark({ s }: { s: Stay }) {
  if (!s.entry.transfer_from) return null;
  const t = `Von woanders gekommen: abgestellt in ${s.entry.transfer_from} seit ${fmtDay(s.start)} ${fmtTime(s.start)}`;
  return (
    <span title={t} aria-label={t} role="img" className="mr-1 inline-grid h-4 w-4 shrink-0 translate-y-[-1px] place-items-center rounded-[4px] align-middle text-[11px] leading-none" style={{ background: `${C.stay}26`, color: C.stay }}>
      ↪
    </span>
  );
}

/** Kennzeichen für Zusammenhänge: A = tatsächliche Überschneidung, B = möglicher Zusammenhang */
export function RelBadge({ category, count, title }: { category: Relation["category"]; count?: number; title?: string }) {
  const a = category === "A";
  const t = title ?? (a ? "Tatsächliche Überschneidung (gleichzeitig abgestellt)" : "Möglicher zeitlicher Zusammenhang");
  return (
    <span title={t} aria-label={t} className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[4px] px-1.5 text-[11px] font-medium leading-none" style={a ? { background: `${C.overlap}26`, color: C.overlap } : { border: `1px dashed ${C.near}`, color: C.near }}>
      {a ? "A ⧉" : "B ≈"}
      {count != null && count > 1 && <span className="tnum">{count}</span>}
    </span>
  );
}

/** Kennzeichen „wiederkehrend“: am selben Ort, Wochentag und ähnlicher Uhrzeit in mehreren Wochen */
export function RecurBadge({ slot, compact = false }: { slot: RecurSlot; compact?: boolean }) {
  const t = `Wiederkehrend: ${slot.stationName}, ${slotLabel(slot)} – in ${slot.weeks.length} Wochen abgestellt`;
  return (
    <span title={t} aria-label={t} role="img" className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded-[4px] px-1.5 text-[11px] font-semibold leading-none" style={{ background: `${C.recur}24`, color: C.recur }}>
      ↻<span className="tnum">{slot.weeks.length}{compact ? "" : " Wo."}</span>
    </span>
  );
}

/** Notiz-Kennzeichen (keine Zugbewegung) */
export function NoteMark({ title }: { title: string }) {
  return (
    <span title={title} aria-label={`Notiz: ${title}`} role="img" className="inline-grid h-4 w-4 shrink-0 place-items-center rounded-[4px] text-[11px] leading-none" style={{ border: `1px dashed ${C.note}`, color: C.note }}>
      ✎
    </span>
  );
}

/** Legende mit allen Farben; nur die genannten Teile */
export function Legend({ parts = ["status", "marked", "rel", "recur", "note"] }: { parts?: ("status" | "marked" | "rel" | "recur" | "note" | "transfer")[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12px] text-muted">
      {parts.includes("status") &&
        STATUS_ORDER.map((k) => (
          <span key={k} className="flex items-center gap-1.5" title={STATUS[k].hint}>
            <Swatch status={k} /> {STATUS[k].label}
          </span>
        ))}
      {parts.includes("marked") && (
        <span className="flex items-center gap-1.5">
          <span style={{ color: C.marked }}>★</span> markiert
        </span>
      )}
      {parts.includes("rel") && (
        <>
          <span className="flex items-center gap-1.5">
            <RelBadge category="A" /> gleichzeitig abgestellt
          </span>
          <span className="flex items-center gap-1.5">
            <RelBadge category="B" /> zeitlich nahe / möglich
          </span>
        </>
      )}
      {parts.includes("recur") && (
        <span className="flex items-center gap-1.5">
          <span className="inline-flex h-5 items-center rounded-[4px] px-1.5 text-[11px] font-semibold" style={{ background: `${C.recur}24`, color: C.recur }}>↻3</span> wiederkehrend (Woche für Woche)
        </span>
      )}
      {parts.includes("note") && (
        <span className="flex items-center gap-1.5">
          <NoteMark title="Standortnotiz" /> Notiz (keine Zugbewegung)
        </span>
      )}
      {parts.includes("transfer") && (
        <span className="flex items-center gap-1.5">
          <span className="inline-grid h-4 w-4 place-items-center rounded-[4px] text-[11px]" style={{ background: `${C.stay}26`, color: C.stay }}>↪</span> von woanders gekommen
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Gemeinsame Props aller Ansichten

export type View = "suche" | "woche" | "tag" | "nacht" | "protokoll" | "analyse" | "markiert" | "notizen";

export type LineStyleFn = (id: string) => { color: string; textColor: string };

export interface NavTarget {
  day?: string;
  /** Abend der Nacht, z. B. Mittwoch für „Mi → Do“ */
  night?: string;
  /** Abstellung auswählen */
  key?: string | null;
}

export interface ViewProps {
  week: string;
  /** Montag … Sonntag */
  days: string[];
  today: string;
  now: number;
  /** in dieser Woche begonnene Abstellungen */
  stays: Stay[];
  /** zusätzlich Vorwoche und Montag danach (für Zeiträume über die Wochengrenze) */
  allStays: Stay[];
  /** Zusammenhänge über allStays, Zeitfenster windowMin */
  relations: Relation[];
  relByStay: Map<string, Relation[]>;
  windowMin: number;
  setWindowMin: (m: number) => void;
  marks: Marks;
  notes: Notes;
  /** ausgewählte Abstellung (Schlüssel), null = keine */
  selected: string | null;
  select: (key: string | null) => void;
  lineStyle: LineStyleFn;
  /** Ansicht wechseln, optional Tag/Nacht/Auswahl setzen */
  goTo: (view: View, t?: NavTarget) => void;
  /** Tag der Tagesansicht */
  day: string;
  /** Abend der Nachtansicht */
  night: string;
  /** Nachtfenster in Stunden relativ zu Mitternacht (Standard 0 bis 6) */
  nightHours: [number, number];
  setNightHours: (h: [number, number]) => void;
  /** Wiederkehrende Abstellungen (gleicher Ort, Wochentag, ähnliche Uhrzeit) aus den umliegenden Wochen */
  recur: Map<string, RecurSlot>;
  recurSlots: RecurSlot[];
  /** Toleranz der Uhrzeit in Minuten und Mindestzahl Wochen */
  recurTol: number;
  setRecurTol: (m: number) => void;
  recurMinWeeks: number;
  setRecurMinWeeks: (n: number) => void;
  /** geladene Wochen für den Vergleich (Montage), null solange geladen wird */
  historyRange: { from: string; to: string } | null;
  /** Abstellungen der letzten 30 Tage bis jetzt (Suche und Profil, unabhängig von der gewählten Woche) */
  recentStays: Stay[];
  recentLoaded: boolean;
  /** gesuchtes Fahrzeug, Standort oder Zug; null = Startseite der Suche */
  searchTarget: Target | null;
  /** Profil öffnen (wechselt in die Suche), null = Suche zurücksetzen */
  openTarget: (t: Target | null) => void;
  rangeDays: RangeDays;
  setRangeDays: (d: RangeDays) => void;
}
