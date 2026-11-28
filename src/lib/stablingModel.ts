/**
 * Gemeinsame Datenbasis aller Abstell-Ansichten (Woche, Tag, Nacht, Protokoll, Analyse, Notizen, Markierungen).
 *
 * Grundsätze:
 * - Eine Abstellung ist genau ein Eintrag aus get_stabling_log (Schlüssel entryKey). Ansichten schneiden nur Zeitfenster
 *   heraus (Tag, Nacht, Woche); es entstehen nie zusätzliche Abstellungen oder Datensätze.
 * - Unbekannte Enden werden nicht erfunden: Jede Abstellung weiß, wie sicher Beginn und Ende sind. Zum Zeichnen reicht
 *   ein offenes Ende bis „jetzt“ (höchstens 48 h), ist dann aber als offen gekennzeichnet.
 * - Zusammenhänge stützen sich nur auf Abstellzeiträume, nie auf normale Fahrten. Kategorie A = Zeiträume überschneiden
 *   sich nachweislich, Kategorie B = nur zeitlich nahe oder Überschneidung wegen unbekannter Zeiten nur möglich.
 */
import { addDays, dayKey, dayStart, entryKey, weekDays, weekOf, type StablingEntry } from "./stabling";

const H = 3_600_000;
const MIN = 60_000;
/** offene Enden höchstens so weit zeichnen (danach greift ohnehin die Plochingen-Regel) */
export const OPEN_DRAW_MAX = 48 * H;

/** exact: Abfahrt beobachtet · upper: nur „spätestens“ (anderswo wieder gesehen) · ongoing: steht laut Scans noch · unknown: unbekannt */
export type EndKind = "exact" | "upper" | "ongoing" | "unknown";
/** exact: Ankunft aus Fahrplan/Echtzeit · lower: nur „frühestens“ (überführt, Ankunft am neuen Bahnhof unbekannt) */
export type StartKind = "exact" | "lower";

export interface Stay {
  /** = entryKey(entry); eine Abstellung, egal in wie vielen Ansichten sie erscheint */
  key: string;
  entry: StablingEntry;
  station: string;
  stationName: string;
  vehicles: string[];
  start: number;
  startKind: StartKind;
  /** bekannte Endzeit (beobachtet oder Obergrenze), sonst null */
  end: number | null;
  endKind: EndKind;
}

export function endKindOf(e: StablingEntry): EndKind {
  if (e.departed_at) return "exact";
  if (e.seen_again_at) return "upper";
  if (e.state === "open") return "ongoing";
  return "unknown";
}

/** Einträge → Abstellungen; doppelte Einträge (z. B. Vorwoche und Woche überlappend geladen) nur einmal */
export function toStays(list: StablingEntry[]): Stay[] {
  const m = new Map<string, Stay>();
  for (const e of list) {
    const key = entryKey(e);
    if (m.has(key)) continue;
    const endKind = endKindOf(e);
    m.set(key, {
      key,
      entry: e,
      station: e.station_id,
      stationName: e.station_name,
      vehicles: e.vehicles,
      start: Date.parse(e.arrived_at),
      startKind: e.transfer_from ? "lower" : "exact",
      end: e.departed_at ? Date.parse(e.departed_at) : e.seen_again_at ? Date.parse(e.seen_again_at) : null,
      endKind,
    });
  }
  return [...m.values()].sort(byStart);
}

export const byStart = (a: Stay, b: Stay) =>
  a.start - b.start || a.stationName.localeCompare(b.stationName, "de") || a.key.localeCompare(b.key, "de");

/** Ende zum Zeichnen. Offene Enden: bis jetzt, höchstens 48 h nach Beginn; als offen gekennzeichnet (openEnd). */
export function drawEnd(s: Stay, now: number): number {
  if (s.end != null) return Math.max(s.start, s.end);
  if (s.endKind === "ongoing") return Math.max(s.start, now);
  return Math.max(s.start, Math.min(now, s.start + OPEN_DRAW_MAX));
}

/** Ende ist nicht beobachtet (Balken offen/schraffiert zeichnen) */
export const isOpenEnd = (s: Stay) => s.endKind !== "exact";

/** Dauer, soweit belegt: exakte Dauer, Obergrenze („höchstens“), bisherige Dauer oder unbekannt */
export function stayDuration(s: Stay, now: number): { ms: number | null; kind: "exact" | "max" | "sofar" | "unknown" } {
  if (s.endKind === "exact") return { ms: s.end! - s.start, kind: s.startKind === "lower" ? "max" : "exact" };
  if (s.endKind === "upper") return { ms: s.end! - s.start, kind: "max" };
  if (s.endKind === "ongoing") return { ms: now - s.start, kind: "sofar" };
  return { ms: null, kind: "unknown" };
}

/** sicher anwesend ab/bis (für nachweisbare Überschneidungen) */
function presentFrom(s: Stay): number {
  return s.startKind === "exact" ? s.start : (s.end ?? s.start);
}
function presentUntil(s: Stay, now: number): number {
  if (s.endKind === "exact") return s.end!;
  if (s.endKind === "ongoing") return Math.max(s.start, now);
  return s.start;
}
/** höchstens anwesend bis (für mögliche Überschneidungen) */
function maxUntil(s: Stay): number {
  if (s.endKind === "exact" || s.endKind === "upper") return s.end!;
  return Infinity;
}

// ------------------------------------------------------------------ Zeitfenster: Tag, Nacht, Woche

export type Range = [number, number];

/** Kalendertag in Deutschland, 00:00 bis 24:00 (23 bzw. 25 h bei Zeitumstellung) */
export const dayRange = (key: string): Range => [dayStart(key), dayStart(addDays(key, 1))];

/** Ganze Woche Montag 00:00 bis Montag 00:00 */
export const weekRange = (week: string): Range => [dayStart(week), dayStart(addDays(week, 7))];

export interface NightSpan {
  /** Abend, zu dem die Nacht gehört (z. B. Mittwoch für „Mi → Do“) */
  evening: string;
  /** Folgetag */
  morning: string;
  from: number;
  to: number;
}

/**
 * Nacht vom Abend `evening` auf den Folgetag. Stunden relativ zu Mitternacht des Folgetags in deutscher Zeit:
 * fromHour 0 = 00:00, -2 = 22:00 am Vorabend; toHour 6 = 06:00. Standard 00:00–06:00.
 */
export function nightSpan(evening: string, fromHour = 0, toHour = 6): NightSpan {
  const morning = addDays(evening, 1);
  const at = (h: number) => (h < 0 ? dayStart(evening) + (24 + h) * H : dayStart(morning) + h * H);
  const from = at(fromHour);
  return { evening, morning, from, to: Math.max(from + H, at(toHour)) };
}

/** Die sieben Nächte einer Woche: Mo → Di … So → Mo */
export const weekNights = (week: string, fromHour = 0, toHour = 6) => weekDays(week).map((d) => nightSpan(d, fromHour, toHour));

export interface Seg {
  stay: Stay;
  from: number;
  to: number;
  /** begann vor dem Fenster bzw. geht danach weiter */
  clipStart: boolean;
  clipEnd: boolean;
  /** Ende nicht beobachtet */
  openEnd: boolean;
}

/** Ausschnitt aller Abstellungen, die das Fenster berühren. Dieselben Stay-Objekte, keine Kopien. */
export function segmentsIn(stays: Stay[], [a, b]: Range, now: number): Seg[] {
  const out: Seg[] = [];
  for (const stay of stays) {
    const e = drawEnd(stay, now);
    // Punktförmige Abstellungen (Beginn = Ende) zählen im Fenster, in dem sie beginnen
    if (stay.start >= b || (e <= a && !(e === stay.start && stay.start >= a))) continue;
    out.push({ stay, from: Math.max(stay.start, a), to: Math.min(Math.max(e, stay.start), b), clipStart: stay.start < a, clipEnd: e > b, openEnd: isOpenEnd(stay) });
  }
  return out.sort((x, y) => byStart(x.stay, y.stay));
}

/** Nebeneinander-Spuren für gleichzeitige Blöcke (Intervall-Färbung). lanes = Spuren des zusammenhängenden Pulks. */
export function assignLanes(segs: Seg[], minMs = 0): Map<string, { lane: number; lanes: number }> {
  const sorted = [...segs].sort((x, y) => x.from - y.from || x.stay.key.localeCompare(y.stay.key));
  const res = new Map<string, { lane: number; lanes: number }>();
  let cluster: string[] = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];
  const close = () => {
    for (const k of cluster) res.get(k)!.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const s of sorted) {
    const end = Math.max(s.to, s.from + minMs);
    if (s.from >= clusterEnd) close();
    let lane = laneEnds.findIndex((t) => t <= s.from);
    if (lane < 0) lane = laneEnds.push(end) - 1;
    else laneEnds[lane] = end;
    res.set(s.stay.key, { lane, lanes: 0 });
    cluster.push(s.stay.key);
    clusterEnd = Math.max(clusterEnd, end);
  }
  close();
  return res;
}

// ------------------------------------------------------------------ Zusammenhänge (nur Abstellungen, nur derselbe Standort)

/** A = nachweisliche Überschneidung, B = möglicher zeitlicher Zusammenhang */
export type Category = "A" | "B";
export type RelKind = "overlap" | "possible_overlap" | "follow";
export type Certainty = "sicher" | "wahrscheinlich" | "möglich";

export interface Relation {
  id: string;
  /** a beginnt zuerst */
  a: Stay;
  b: Stay;
  station: string;
  stationName: string;
  category: Category;
  kind: RelKind;
  certainty: Certainty;
  /** Überschneidung: gemeinsamer Zeitraum. Folge: Ende von a bis Beginn von b */
  from: number;
  to: number;
  /** Abstand in Minuten (0 bei Überschneidung) */
  gapMin: number;
  reason: string;
}

export const WINDOW_CHOICES = [15, 30, 60] as const;

const shares = (a: Stay, b: Stay) => a.vehicles.some((v) => b.vehicles.includes(v));
/** gleicher Betriebstag und gleiche Zugnummer: Teile desselben Zuges (z. B. Doppeltraktion, getrennt erfasst) */
export const sameTrain = (a: Stay, b: Stay) =>
  !!a.entry.train_number && a.entry.train_number === b.entry.train_number && a.entry.service_date === b.entry.service_date;
const hm = (t: number) => new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" }).format(t);

/**
 * Überschneidungen und zeitliche Nähe von Abstellungen am selben Standort. Normale Fahrten fließen nicht ein.
 * Paare mit gemeinsamem Fahrzeug oder gleicher Zugnummer am selben Tag sind keine zwei Züge und werden übersprungen.
 */
export function findRelations(stays: Stay[], windowMin: number, now: number): Relation[] {
  const byStation = new Map<string, Stay[]>();
  for (const s of stays) byStation.set(s.station, [...(byStation.get(s.station) ?? []), s]);
  const out: Relation[] = [];
  const win = windowMin * MIN;
  for (const list of byStation.values()) {
    list.sort(byStart);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (shares(a, b) || sameTrain(a, b)) continue;
        const base = { id: `${a.key}~${b.key}`, a, b, station: a.station, stationName: a.stationName };
        // A: beide nachweislich gleichzeitig da
        const lo = Math.max(presentFrom(a), presentFrom(b));
        const hi = Math.min(presentUntil(a, now), presentUntil(b, now));
        if (hi > lo) {
          const exact = a.endKind === "exact" && b.endKind === "exact" && a.startKind === "exact" && b.startKind === "exact";
          out.push({ ...base, category: "A", kind: "overlap", certainty: exact ? "sicher" : "wahrscheinlich", from: lo, to: hi, gapMin: 0,
            reason: exact ? `Beide standen von ${hm(lo)} bis ${hm(hi)} gleichzeitig dort` : `Gleichzeitig dort von ${hm(lo)} bis mindestens ${hm(hi)} (laut Scans)` });
          continue;
        }
        // B: Überschneidung nur möglich, weil eine Zeit nicht beobachtet ist
        const lo2 = Math.max(a.start, b.start);
        const hi2 = Math.min(maxUntil(a), maxUntil(b));
        if (hi2 > lo2) {
          const unsure = [a, b].filter((s) => s.endKind !== "exact" || s.startKind !== "exact").map((s) => s.vehicles[0]);
          out.push({ ...base, category: "B", kind: "possible_overlap", certainty: "möglich", from: lo2, to: Math.min(hi2, Math.max(drawEnd(a, now), drawEnd(b, now))), gapMin: 0,
            reason: `Überschneidung möglich: Zeiten von ${unsure.join(", ")} nicht genau bekannt` });
          continue;
        }
        // B: kurz nacheinander (a war weg, bevor b kam)
        const first = maxUntil(a) <= b.start ? a : b;
        const second = first === a ? b : a;
        if (first.end == null) continue;
        const gap = second.start - first.end;
        if (gap < 0 || gap > win) continue;
        const exact = first.endKind === "exact" && second.startKind === "exact";
        out.push({ ...base, a: first, b: second, id: `${first.key}~${second.key}`, category: "B", kind: "follow", certainty: exact ? "wahrscheinlich" : "möglich",
          from: first.end, to: second.start, gapMin: Math.round(gap / MIN),
          reason: exact
            ? `${second.vehicles[0]} kam ${Math.round(gap / MIN)} min nach der Abfahrt von ${first.vehicles[0]}`
            : `Abstand höchstens geschätzt: ${first.endKind === "upper" ? "Abfahrt" : "Ankunft"} nicht beobachtet` });
      }
    }
  }
  return out.sort((x, y) => x.from - y.from || x.id.localeCompare(y.id));
}

/** Ein Zug = gleicher Betriebstag und gleiche Zugnummer (Doppelzüge stehen als mehrere Abstellungen im Protokoll) */
export const trainKey = (s: Stay) => (s.entry.train_number ? `${s.entry.service_date}|${s.entry.train_number}|${s.station}` : s.key);

const stronger = (x: Relation, y: Relation) => (x.category === "A" && y.category !== "A" ? x : y.category === "A" && x.category !== "A" ? y : x.from <= y.from ? x : y);

/**
 * Zusammenhänge je Abstellung (für Protokoll, Details, Filter). Je anderem Zug nur einer: Bei einem Doppelzug
 * erscheint der Partner einmal, nicht einmal je Fahrzeug. A (nachweislich gleichzeitig) geht vor B.
 */
export function relationsByStay(rels: Relation[]): Map<string, Relation[]> {
  const m = new Map<string, Map<string, Relation>>();
  for (const r of rels) {
    for (const [self, other] of [[r.a, r.b], [r.b, r.a]] as const) {
      const per = m.get(self.key) ?? new Map<string, Relation>();
      m.set(self.key, per);
      const k = trainKey(other);
      const old = per.get(k);
      per.set(k, old ? stronger(old, r) : r);
    }
  }
  return new Map([...m].map(([k, per]) => [k, [...per.values()].sort((x, y) => x.from - y.from)]));
}

/** Zusammenhänge zwischen Zügen statt zwischen Fahrzeugen (für Zahlen in Übersichten) */
export function trainRelations(rels: Relation[]): Relation[] {
  const per = new Map<string, Relation>();
  for (const r of rels) {
    const k = [trainKey(r.a), trainKey(r.b)].sort().join("~");
    const old = per.get(k);
    per.set(k, old ? stronger(old, r) : r);
  }
  return [...per.values()].sort((x, y) => x.from - y.from);
}

export interface Chain {
  station: string;
  stationName: string;
  stays: Stay[];
  links: Relation[];
}

/** Abstellfolgen: zusammenhängende Gruppen von Abstellungen am selben Standort (über A- und B-Zusammenhänge). Getrennte Gruppen = getrennte Folgen. */
export function stationChains(rels: Relation[]): Chain[] {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    const p = parent.get(k) ?? k;
    if (p === k) return k;
    const r = find(p);
    parent.set(k, r);
    return r;
  };
  const stayOf = new Map<string, Stay>();
  for (const r of rels) {
    stayOf.set(r.a.key, r.a);
    stayOf.set(r.b.key, r.b);
    parent.set(find(r.a.key), find(r.b.key));
  }
  const groups = new Map<string, Chain>();
  for (const [k, s] of stayOf) {
    const root = find(k);
    const g = groups.get(root) ?? { station: s.station, stationName: s.stationName, stays: [], links: [] };
    g.stays.push(s);
    groups.set(root, g);
  }
  for (const r of rels) groups.get(find(r.a.key))!.links.push(r);
  return [...groups.values()]
    .map((g) => ({ ...g, stays: g.stays.sort(byStart) }))
    .sort((x, y) => x.stays[0].start - y.stays[0].start || x.stationName.localeCompare(y.stationName, "de"));
}

export interface Hop {
  from: Stay;
  to: Stay;
  /** laut Daten überführt (nächste Fahrt begann am anderen Bahnhof) */
  transfer: boolean;
  /** Zeit zwischen Ende der einen und Beginn der nächsten Abstellung, falls bekannt */
  gapMin: number | null;
}

export interface VehicleRun {
  vehicle: string;
  stays: Stay[];
  hops: Hop[];
}

/**
 * Abstellungen desselben Fahrzeugs der Reihe nach – standortübergreifend, aber nur über die identische Fahrzeugnummer
 * belegt. Was dazwischen gefahren wurde, wird nicht behauptet.
 */
export function vehicleRuns(stays: Stay[]): VehicleRun[] {
  const m = new Map<string, Stay[]>();
  for (const s of stays) {
    // die Zeile am neuen Bahnhof und die Überführungszeile sind dieselbe Abstellkette: beide behalten
    for (const v of s.vehicles) m.set(v, [...(m.get(v) ?? []), s]);
  }
  const out: VehicleRun[] = [];
  for (const [vehicle, list] of m) {
    if (list.length < 2) continue;
    // gleicher Beginn: die Zeile am neuen Bahnhof (überführt) kommt nach der ursprünglichen Abstellung
    list.sort((x, y) => x.start - y.start || Number(!!x.entry.transfer_from) - Number(!!y.entry.transfer_from) || byStart(x, y));
    const hops: Hop[] = [];
    for (let i = 1; i < list.length; i++) {
      const from = list[i - 1];
      const to = list[i];
      const transfer = !!to.entry.transfer_from && from.entry.transfer_to === to.stationName && from.start === to.start;
      hops.push({ from, to, transfer, gapMin: from.endKind === "exact" && to.startKind === "exact" ? Math.round((to.start - from.end!) / MIN) : null });
    }
    out.push({ vehicle, stays: list, hops });
  }
  return out.sort((a, b) => b.stays.length - a.stays.length || a.vehicle.localeCompare(b.vehicle, "de"));
}

// ------------------------------------------------------------------ Wiederkehrende Abstellungen über mehrere Wochen

/** Minute der Woche in deutscher Zeit (Montag 00:00 = 0) */
export function minuteOfWeek(t: number): number {
  const k = dayKey(t);
  return (weekdayOf(k) - 1) * 1440 + Math.round((t - dayStart(k)) / MIN);
}

export interface RecurSlot {
  id: string;
  station: string;
  stationName: string;
  /** Abstellungen dieses Zeitfensters aus allen geladenen Wochen, zeitlich sortiert */
  stays: Stay[];
  /** Montage der Wochen, in denen es vorkam */
  weeks: string[];
  /** typische Ankunft (Median) und Spanne, als Minute der Woche */
  typical: number;
  earliest: number;
  latest: number;
}

export const RECUR_TOLERANCE = [30, 60, 120] as const;

/**
 * Wiederkehrend = am selben Abstellort, am selben Wochentag, zu einer ähnlichen Ankunftszeit in mehreren Wochen.
 * Zug- und Fahrzeugnummer spielen keine Rolle. Ein Zeitfenster ist höchstens 2 × Toleranz breit (sonst würde eine
 * Kette von Abstellungen im Abstand der Toleranz den ganzen Tag zusammenziehen). Überführte Zeilen (Ankunft unbekannt)
 * zählen nicht mit.
 */
export function recurringSlots(history: Stay[], toleranceMin: number, minWeeks = 2): { slots: RecurSlot[]; byStay: Map<string, RecurSlot> } {
  const byStation = new Map<string, { s: Stay; m: number }[]>();
  for (const s of history) {
    if (s.startKind !== "exact") continue;
    byStation.set(s.station, [...(byStation.get(s.station) ?? []), { s, m: minuteOfWeek(s.start) }]);
  }
  const slots: RecurSlot[] = [];
  for (const list of byStation.values()) {
    list.sort((a, b) => a.m - b.m || a.s.start - b.s.start);
    let cur: { s: Stay; m: number }[] = [];
    const flush = () => {
      const weeks = [...new Set(cur.map((x) => weekOf(dayKey(x.s.start))))].sort();
      if (cur.length && weeks.length >= minWeeks) {
        const ms = cur.map((x) => x.m).sort((a, b) => a - b);
        const first = cur[0].s;
        slots.push({
          id: `${first.station}@${ms[0]}`,
          station: first.station,
          stationName: first.stationName,
          stays: cur.map((x) => x.s).sort(byStart),
          weeks,
          typical: ms[Math.floor((ms.length - 1) / 2)],
          earliest: ms[0],
          latest: ms[ms.length - 1],
        });
      }
      cur = [];
    };
    for (const x of list) {
      if (cur.length && x.m - cur[0].m > 2 * toleranceMin) flush();
      cur.push(x);
    }
    flush();
  }
  slots.sort((a, b) => b.weeks.length - a.weeks.length || a.typical - b.typical || a.stationName.localeCompare(b.stationName, "de"));
  const byStay = new Map<string, RecurSlot>();
  for (const sl of slots) for (const s of sl.stays) byStay.set(s.key, sl);
  return { slots, byStay };
}

const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** „Mo ca. 23:40“ bzw. für 00–06 Uhr „Nacht So → Mo, ca. 01:10“ */
export function slotLabel(sl: RecurSlot): string {
  const d = Math.floor(sl.typical / 1440);
  const t = sl.typical % 1440;
  const span = sl.latest - sl.earliest >= 5 ? ` (${hhmm(sl.earliest)}–${hhmm(sl.latest)})` : "";
  if (t < 6 * 60) return `Nacht ${WEEKDAYS_SHORT[(d + 6) % 7]} → ${WEEKDAYS_SHORT[d]}, ca. ${hhmm(t)}${span}`;
  return `${WEEKDAYS_SHORT[d]} ca. ${hhmm(t)}${span}`;
}

// ------------------------------------------------------------------ Standortnotizen

export interface StationNote {
  id: number;
  station_id: string;
  station_name: string;
  /** ISO: 1 = Montag … 7 = Sonntag */
  weekday: number;
  /** "08:00" oder null (ganzer Tag) */
  time_from: string | null;
  time_to: string | null;
  text: string;
  updated_at: string;
}

export const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] as const;
export const WEEKDAYS_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"] as const;

/** ISO-Wochentag eines Kalendertags (1 = Montag) */
export const weekdayOf = (key: string) => ((new Date(`${key}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

const clock = (key: string, hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return dayStart(key) + (h * 60 + m) * MIN;
};

export interface NoteAt {
  note: StationNote;
  day: string;
  /** null = ganzer Tag */
  at: number | null;
  until: number | null;
}

/** Notizen eines Kalendertags, mit konkreten Zeitpunkten (Ende über Mitternacht → Folgetag) */
export function notesOn(notes: StationNote[], key: string): NoteAt[] {
  const wd = weekdayOf(key);
  return notes
    .filter((n) => n.weekday === wd)
    .map((note) => {
      if (!note.time_from) return { note, day: key, at: null, until: null };
      const at = clock(key, note.time_from);
      let until = note.time_to ? clock(key, note.time_to) : null;
      if (until != null && until <= at) until = clock(addDays(key, 1), note.time_to!);
      return { note, day: key, at, until };
    })
    .sort((a, b) => (a.at ?? -1) - (b.at ?? -1) || a.note.station_name.localeCompare(b.note.station_name, "de"));
}

/** Notizen mit Uhrzeit, die in ein Zeitfenster fallen (z. B. Nachtübersicht), über alle berührten Tage */
export function notesInRange(notes: StationNote[], [a, b]: Range): NoteAt[] {
  const out: NoteAt[] = [];
  for (let k = addDays(dayKey(a), -1); dayStart(k) < b; k = addDays(k, 1)) {
    for (const n of notesOn(notes, k)) {
      if (n.at == null) continue;
      if (n.at < b && (n.until ?? n.at) >= a) out.push(n);
    }
  }
  return out.sort((x, y) => x.at! - y.at!);
}

/** Abstellungen, die zur Notizzeit am Standort der Notiz stehen (nur Anzeige, keine Ableitung von Bewegungen) */
export function staysAtNote(stays: Stay[], n: NoteAt, now: number): Stay[] {
  const [a, b] = n.at == null ? dayRange(n.day) : [n.at, Math.max(n.until ?? n.at, n.at + 1)];
  return stays.filter((s) => s.station === n.note.station_id && s.start < b && drawEnd(s, now) >= a);
}
