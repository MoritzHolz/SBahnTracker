/**
 * Auswertung für Nutzer, die einen Zug oder Standort gezielt besuchen wollen:
 * Suche, Abstellungen der letzten 7/14/30 Tage, typische Uhrzeiten, Dauer, Abweichungen und ein Besuchstipp.
 *
 * Ehrlichkeit: Grundlage sind nur erkannte Abstellungen. Unbekannte Abholzeiten werden nicht geschätzt, sondern
 * bleiben bei Dauer und Anwesenheit außen vor. Ohne Scans entsteht kein Eintrag; „nicht gesehen“ heißt nicht „nicht da“.
 * Ein Besuchstipp ist eine Auswertung der Vergangenheit, keine Vorhersage.
 */
import { addDays, dayKey, dayStart, FIRST_WEEK } from "./stabling";
import { type Stay, weekdayOf, WEEKDAYS } from "./stablingModel";
import { unitNumber } from "./trips";

const MIN = 60_000;
const DAY = 86_400_000;

export type TargetKind = "fahrzeug" | "ort" | "zug";
export interface Target {
  kind: TargetKind;
  /** Fahrzeugnummer, Station-ID oder Zugnummer */
  id: string;
  label: string;
  /** Abstellungen im geladenen Zeitraum (für die Vorschlagsliste) */
  count?: number;
}

export const RANGES = [7, 14, 30] as const;
export type RangeDays = (typeof RANGES)[number];

const digits = (s: string) => s.replace(/\D/g, "");
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

export function stayMatches(s: Stay, t: Target): boolean {
  if (t.kind === "fahrzeug") return s.vehicles.includes(t.id);
  if (t.kind === "ort") return s.station === t.id;
  return s.entry.train_number === t.id || s.entry.dep_train_number === t.id;
}

/** Alles, was man suchen kann, mit Häufigkeit (für Vorschläge und Schnellauswahl) */
export function searchables(stays: Stay[]): Target[] {
  const v = new Map<string, number>();
  const st = new Map<string, { name: string; n: number }>();
  const tr = new Map<string, number>();
  for (const s of stays) {
    for (const x of s.vehicles) v.set(x, (v.get(x) ?? 0) + 1);
    st.set(s.station, { name: s.stationName, n: (st.get(s.station)?.n ?? 0) + 1 });
    if (s.entry.train_number) tr.set(s.entry.train_number, (tr.get(s.entry.train_number) ?? 0) + 1);
  }
  return [
    ...[...v].map(([id, count]) => ({ kind: "fahrzeug" as const, id, label: id, count })),
    ...[...st].map(([id, x]) => ({ kind: "ort" as const, id, label: x.name, count: x.n })),
    ...[...tr].map(([id, count]) => ({ kind: "zug" as const, id, label: `Zug ${id}`, count })),
  ];
}

/**
 * Vorschläge zur Eingabe. Fahrzeug: „430101“, „430 101“, „101“ oder Wagennummer („431 601“ → 430 101).
 * Zugnummer: 4–5 Ziffern („7374“, „S3 7374“). Standort: Teil des Namens („herren“).
 */
export function suggest(all: Target[], q: string, limit = 8): Target[] {
  const raw = q.trim();
  if (!raw) return [];
  const d = digits(raw);
  const unit = d.length >= 6 ? unitNumber(raw) : null;
  const text = fold(raw.replace(/^zug\s*/i, ""));
  const scored: [number, Target][] = [];
  for (const t of all) {
    let score = 0;
    if (t.kind === "fahrzeug") {
      const td = digits(t.id);
      if (unit && unit === t.id) score = 100;
      else if (d.length >= 3 && td === d) score = 100;
      else if (d.length >= 3 && (td.endsWith(d) || td.startsWith(d))) score = 60;
      else if (d.length >= 2 && td.includes(d)) score = 30;
    } else if (t.kind === "zug") {
      const m = raw.match(/(\d{4,5})\s*$/);
      if (m && t.id === m[1]) score = 90;
      else if (d.length >= 3 && d.length <= 5 && t.id.startsWith(d)) score = 40;
    } else if (text.length >= 2) {
      const name = fold(t.label);
      if (name === text) score = 95;
      else if (name.startsWith(text)) score = 80;
      else if (name.includes(text)) score = 50;
    }
    if (score) scored.push([score + Math.min(t.count ?? 0, 30) / 10, t]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].label.localeCompare(b[1].label)).slice(0, limit).map(([, t]) => t);
}

// ------------------------------------------------------------------ Uhrzeiten über Mitternacht

export const minuteOfDay = (t: number) => Math.round((t - dayStart(dayKey(t))) / MIN);

/** Abstand zweier Uhrzeiten im Kreis (23:50 und 00:10 liegen 20 min auseinander) */
export const clockDist = (a: number, b: number) => {
  const x = Math.abs(a - b) % 1440;
  return Math.min(x, 1440 - x);
};

export interface ClockSpread {
  /** typische Uhrzeit (Median), Minute des Tages */
  median: number;
  /** mittlere Hälfte der Werte (25–75 %) */
  lo: number;
  hi: number;
  n: number;
}

/** Median und mittlere Hälfte von Uhrzeiten; der Schnitt liegt in der größten Lücke, damit Nachtzeiten zusammenbleiben. */
export function clockSpread(mins: number[]): ClockSpread | null {
  if (!mins.length) return null;
  const s = [...mins].map((m) => ((m % 1440) + 1440) % 1440).sort((a, b) => a - b);
  let cut = 0;
  let gap = s[0] + 1440 - s[s.length - 1];
  for (let i = 1; i < s.length; i++) if (s[i] - s[i - 1] > gap) [gap, cut] = [s[i] - s[i - 1], i];
  const r = [...s.slice(cut), ...s.slice(0, cut).map((m) => m + 1440)];
  const q = (p: number) => {
    const x = (r.length - 1) * p;
    const lo = Math.floor(x);
    return Math.round(r[lo] + (r[Math.ceil(x)] - r[lo]) * (x - lo)) % 1440;
  };
  return { median: q(0.5), lo: q(0.25), hi: q(0.75), n: s.length };
}

export const hhmm = (m: number) => `${String(Math.floor((((m % 1440) + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;

/** „22:10–22:40 Uhr“ bzw. „gegen 22:10 Uhr“, wenn die Spanne klein ist */
export function spreadText(c: ClockSpread): string {
  return clockDist(c.lo, c.hi) < 10 ? `gegen ${hhmm(c.median)} Uhr` : `zwischen ${hhmm(c.lo)} und ${hhmm(c.hi)} Uhr`;
}

// ------------------------------------------------------------------ Profil

/** sichere Dauer: nur mit beobachteter Abholung und bekannter Ankunft */
const knownDuration = (s: Stay) => (s.endKind === "exact" && s.startKind === "exact" ? s.end! - s.start : null);
/** nachweislich anwesend bis (unbekannte Abholung: nur der Ankunftszeitpunkt) */
const certainUntil = (s: Stay, now: number) =>
  s.endKind === "exact" ? s.end! : s.endKind === "ongoing" ? Math.max(s.start, now) : s.start;

export interface WeekdayStat {
  /** 1 = Montag */
  wd: number;
  count: number;
  start: ClockSpread | null;
  avgMs: number | null;
}

export interface Profile {
  target: Target;
  days: RangeDays;
  /** Beginn des ausgewerteten Zeitraums (nie vor Aufzeichnungsbeginn) */
  from: number;
  to: number;
  /** ausgewerteter Zeitraum ist wegen des Aufzeichnungsbeginns kürzer als gewählt */
  clipped: boolean;
  /** Abstellungen im Zeitraum, neueste zuerst */
  stays: Stay[];
  counts: Record<RangeDays, number>;
  start: ClockSpread | null;
  avgMs: number | null;
  medianMs: number | null;
  /** Abstellungen mit beobachteter Abholung (Grundlage der Dauer) */
  durationBasis: number;
  weekdays: WeekdayStat[];
  places: { id: string; name: string; count: number }[];
  vehicles: { id: string; count: number }[];
  /** Abstellungen, die deutlich vom Üblichen abweichen, mit Grund */
  deviations: Map<string, string>;
  /** je Stunde: an wie vielen Tagen stand hier nachweislich ein Zug (nur Standort) */
  hours: number[];
  /** Kalendertage im Zeitraum */
  dayCount: number;
  steht: Stay | null;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function periodStart(now: number, days: number): number {
  return Math.max(dayStart(addDays(dayKey(now), -(days - 1))), dayStart(FIRST_WEEK));
}

export function buildProfile(all: Stay[], target: Target, now: number, days: RangeDays): Profile {
  const mine = all.filter((s) => stayMatches(s, target) && s.start <= now);
  const from = periodStart(now, days);
  const stays = mine.filter((s) => s.start >= from).sort((a, b) => b.start - a.start);
  const counts = Object.fromEntries(RANGES.map((d) => [d, mine.filter((s) => s.start >= periodStart(now, d)).length])) as Record<RangeDays, number>;
  const exactStart = stays.filter((s) => s.startKind === "exact");
  const durs = stays.map(knownDuration).filter((x): x is number => x != null);
  const med = median(durs);

  const weekdays: WeekdayStat[] = WEEKDAYS.map((_, i) => {
    const list = exactStart.filter((s) => weekdayOf(dayKey(s.start)) === i + 1);
    return {
      wd: i + 1,
      count: stays.filter((s) => weekdayOf(dayKey(s.start)) === i + 1).length,
      start: clockSpread(list.map((s) => minuteOfDay(s.start))),
      avgMs: avg(list.map(knownDuration).filter((x): x is number => x != null)),
    };
  });

  const placeMap = new Map<string, { id: string; name: string; count: number }>();
  for (const s of stays) placeMap.set(s.station, { id: s.station, name: s.stationName, count: (placeMap.get(s.station)?.count ?? 0) + 1 });
  const vehMap = new Map<string, number>();
  for (const s of stays) for (const v of s.vehicles) vehMap.set(v, (vehMap.get(v) ?? 0) + 1);

  // Abweichungen: Uhrzeit ≥ 2 h neben dem Üblichen am selben Ort, oder Dauer weniger als halb / mehr als doppelt so lang
  const deviations = new Map<string, string>();
  for (const [station] of placeMap) {
    const here = exactStart.filter((s) => s.station === station);
    const c = clockSpread(here.map((s) => minuteOfDay(s.start)));
    if (!c || here.length < 3) continue;
    for (const s of here) if (clockDist(minuteOfDay(s.start), c.median) >= 120) deviations.set(s.key, `ungewöhnliche Uhrzeit (sonst gegen ${hhmm(c.median)})`);
  }
  if (med != null && durs.length >= 3) {
    for (const s of stays) {
      const d = knownDuration(s);
      if (d == null || deviations.has(s.key)) continue;
      if (d < med * 0.5) deviations.set(s.key, "deutlich kürzer als sonst");
      else if (d > med * 2) deviations.set(s.key, "deutlich länger als sonst");
    }
  }

  const hours = Array.from({ length: 24 }, () => 0);
  if (target.kind === "ort") {
    for (let k = dayKey(from); dayStart(k) <= now; k = addDays(k, 1)) {
      const a = dayStart(k);
      for (let h = 0; h < 24; h++) {
        const [x, y] = [a + h * 3_600_000, a + (h + 1) * 3_600_000];
        if (mine.some((s) => s.start < y && (s.start >= x || certainUntil(s, now) > x))) hours[h]++;
      }
    }
  }

  return {
    target,
    days,
    from,
    to: now,
    clipped: from > dayStart(addDays(dayKey(now), -(days - 1))),
    stays,
    counts,
    start: clockSpread(exactStart.map((s) => minuteOfDay(s.start))),
    avgMs: avg(durs),
    medianMs: med,
    durationBasis: durs.length,
    weekdays,
    places: [...placeMap.values()].sort((a, b) => b.count - a.count),
    vehicles: [...vehMap].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)),
    deviations,
    hours,
    dayCount: Math.max(1, Math.round((dayStart(addDays(dayKey(now), 1)) - from) / DAY)),
    steht: mine.find((s) => s.endKind === "ongoing") ?? null,
  };
}

// ------------------------------------------------------------------ Besuchstipp

export type Reliability = "zu wenig Daten" | "schwach" | "mittel" | "gut";

export interface VisitTip {
  wd: number;
  stationId: string;
  stationName: string;
  /** Zeitfenster als Minuten ab Mitternacht des Ankunftstags (kann über 24 h hinausgehen) */
  from: number;
  to: number;
  /** an so vielen dieser Wochentage stand er im Fenster nachweislich dort … */
  seen: number;
  /** … von so vielen dieser Wochentage im Zeitraum */
  of: number;
  level: Reliability;
}

const SLOT = 15;

/** Zeitfenster, in dem er am häufigsten nachweislich dort stand, je Wochentag und Ort; der beste Treffer zuerst. */
export function visitTips(p: Profile, now: number): VisitTip[] {
  const groups = new Map<string, Stay[]>();
  for (const s of p.stays) {
    if (s.startKind !== "exact") continue;
    const k = `${weekdayOf(dayKey(s.start))}|${s.station}`;
    groups.set(k, [...(groups.get(k) ?? []), s]);
  }
  const tips: VisitTip[] = [];
  for (const [k, list] of groups) {
    const wd = Number(k.split("|")[0]);
    // 36 h ab Mitternacht des Ankunftstags, damit Nachtabstellungen bis zum Morgen zählen
    const slots = Array.from({ length: (36 * 60) / SLOT }, () => new Set<string>());
    for (const s of list) {
      const day = dayKey(s.start);
      const base = dayStart(day);
      const until = certainUntil(s, now);
      for (let i = 0; i < slots.length; i++) {
        const [a, b] = [base + i * SLOT * MIN, base + (i + 1) * SLOT * MIN];
        if (s.start < b && (until > a || (s.start >= a && s.start < b))) slots[i].add(day);
      }
    }
    const best = Math.max(...slots.map((x) => x.size));
    if (!best) continue;
    const i0 = slots.findIndex((x) => x.size === best);
    let i1 = i0;
    while (i1 + 1 < slots.length && slots[i1 + 1].size === best) i1++;
    // genaue Grenzen statt Viertelstunden: späteste Ankunft und früheste Abholung der beteiligten Tage
    const off = (t: number, day: string) => Math.round((t - dayStart(day)) / MIN);
    const inv = list.filter((s) => slots[i0].has(dayKey(s.start)));
    const from = Math.max(i0 * SLOT, ...inv.map((s) => off(s.start, dayKey(s.start))));
    const to = Math.max(from, Math.min((i1 + 1) * SLOT, ...inv.map((s) => off(certainUntil(s, now), dayKey(s.start)))));
    let of = 0;
    for (let d = dayKey(p.from); dayStart(d) <= now; d = addDays(d, 1)) if (weekdayOf(d) === wd) of++;
    of = Math.max(of, best);
    const ratio = best / of;
    const level: Reliability = best < 2 ? "zu wenig Daten" : best >= 4 && ratio >= 0.6 ? "gut" : best >= 3 && ratio >= 0.5 ? "mittel" : "schwach";
    tips.push({ wd, stationId: list[0].station, stationName: list[0].stationName, from, to, seen: best, of, level });
  }
  const rank = { gut: 3, mittel: 2, schwach: 1, "zu wenig Daten": 0 };
  return tips.sort((a, b) => rank[b.level] - rank[a.level] || b.seen / b.of - a.seen / a.of || b.seen - a.seen || b.to - b.from - (a.to - a.from));
}

/** „Mittwoch 22:15–05:30 Uhr (bis Donnerstag früh)“ */
export function tipWindowText(t: VisitTip): string {
  const next = WEEKDAYS[t.wd % 7];
  if (t.to - t.from < SLOT) return `${WEEKDAYS[t.wd - 1]} gegen ${hhmm(t.from)} Uhr`;
  if (t.from >= 1440) return `Nacht ${WEEKDAYS[t.wd - 1]} → ${next}, ${hhmm(t.from)}–${hhmm(t.to)} Uhr`;
  return `${WEEKDAYS[t.wd - 1]} ${hhmm(t.from)}–${hhmm(t.to)} Uhr${t.to > 1440 ? ` (bis ${next} früh)` : ""}`;
}

export interface TipGroup {
  /** Wochentage (1 = Montag), aufsteigend */
  wds: number[];
  stationId: string;
  stationName: string;
  /** gemeinsames Fenster aller Wochentage (Minuten ab Mitternacht des Ankunftstags) */
  from: number;
  to: number;
  seen: number;
  of: number;
  level: Reliability;
  tips: VisitTip[];
}

const RANK: Record<Reliability, number> = { "zu wenig Daten": 0, schwach: 1, mittel: 2, gut: 3 };

/** Tipps am selben Ort mit sich überschneidenden Fenstern zusammenfassen („Mo–Do 08:15–12:30“) */
export function groupTips(tips: VisitTip[]): TipGroup[] {
  const out: TipGroup[] = [];
  for (const t of tips.filter((x) => x.level !== "zu wenig Daten").sort((a, b) => a.wd - b.wd)) {
    const g = out.find((x) => x.stationId === t.stationId && Math.min(x.to, t.to) - Math.max(x.from, t.from) >= 30);
    if (!g) {
      out.push({ wds: [t.wd], stationId: t.stationId, stationName: t.stationName, from: t.from, to: t.to, seen: t.seen, of: t.of, level: t.level, tips: [t] });
      continue;
    }
    g.wds.push(t.wd);
    g.tips.push(t);
    g.from = Math.max(g.from, t.from);
    g.to = Math.min(g.to, t.to);
    g.seen += t.seen;
    g.of += t.of;
    // die Gruppe ist so verlässlich wie ihr schwächster Tag
    if (RANK[t.level] < RANK[g.level]) g.level = t.level;
  }
  return out.sort((a, b) => RANK[b.level] - RANK[a.level] || b.seen / b.of - a.seen / a.of || b.seen - a.seen);
}

/** „Mo–Do“, „Mo, Mi, Fr“ */
export function weekdayList(wds: number[]): string {
  const S = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
  if (wds.length === 1) return WEEKDAYS[wds[0] - 1];
  const run = wds.every((w, i) => !i || w === wds[i - 1] + 1);
  return run && wds.length >= 3 ? `${S[wds[0] - 1]}–${S[wds[wds.length - 1] - 1]}` : wds.map((w) => S[w - 1]).join(", ");
}

export function groupWindowText(g: TipGroup): string {
  const days = weekdayList(g.wds);
  if (g.to - g.from < SLOT) return `${days} gegen ${hhmm(g.from)} Uhr`;
  if (g.from >= 1440) return `${days}, in der Nacht danach ${hhmm(g.from)}–${hhmm(g.to)} Uhr`;
  return `${days} ${hhmm(g.from)}–${hhmm(g.to)} Uhr${g.to > 1440 ? " (bis zum nächsten Morgen)" : ""}`;
}
