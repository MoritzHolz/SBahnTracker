// Reine Auswertung der abgelesenen Rohdaten. Keine Annahmen: Was nicht auf der Seite steht, bleibt null.

export interface RawBoardRow {
  train: string | null;
  line: string | null;
  no: string | null;
  linetype: string | null;
  from: string | null;
  to: string | null;
  platform: string | null;
  arrival: string | null;
  departure: string | null;
  routePrev: string | null;
  routeNext: string | null;
  timeClass: string | null;
  timeText: string | null;
  info: string | null;
  cancelled: boolean;
}

export interface BoardRecord {
  train_number: string;
  line: string | null;
  origin: string | null;
  destination: string | null;
  arr_planned: string | null;
  dep_planned: string | null;
  delay_min: number | null;
  platform: string | null;
  cancelled: boolean;
  message: string | null;
  route: string[];
}

const clean = (v: string | null | undefined): string | null => {
  const s = (v ?? "").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
};

const berlin = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});

function berlinOffsetMs(utc: number): number {
  const p = Object.fromEntries(berlin.formatToParts(new Date(utc)).map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utc / 1000) * 1000;
}

/** „18:55“ (Ortszeit) → Zeitpunkt, der „jetzt“ am nächsten liegt. */
export function resolveTime(hhmm: string | null, now: number): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const local = new Date(now + berlinOffsetMs(now));
  let best: number | null = null;
  for (const day of [-1, 0, 1]) {
    const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, Number(m[1]), Number(m[2]));
    const guess = wall - berlinOffsetMs(wall);
    const utc = wall - berlinOffsetMs(guess);
    if (best === null || Math.abs(utc - now) < Math.abs(best - now)) best = utc;
  }
  return new Date(best!);
}

/** Verspätung aus der sichtbaren Zeitangabe. null, wenn die Seite keine Echtzeit ausweist. */
export function parseDelay(timeClass: string | null, timeText: string | null): number | null {
  const classes = (timeClass ?? "").split(/\s+/);
  const times = (timeText ?? "").match(/\d{1,2}:\d{2}/g) ?? [];
  if (times.length >= 2) {
    const [a, b] = times.map((t) => Number(t.split(":")[0]) * 60 + Number(t.split(":")[1]));
    let d = b - a;
    if (d < -720) d += 1440;
    if (d > 720) d -= 1440;
    return d;
  }
  return times.length === 1 && classes.includes("on-time") ? 0 : null;
}

export function toBoardRecord(r: RawBoardRow, stationName: string, now: number): BoardRecord | null {
  if (r.linetype !== "sbahn") return null;
  const no = clean(r.no);
  if (!no || !/^\d{1,6}$/.test(no)) return null;
  const line = /\b(S\d{1,2})$/.exec(clean(r.line) ?? "")?.[1] ?? null;
  const arr = resolveTime(r.arrival, now);
  const dep = resolveTime(r.departure, now);
  if (!arr && !dep) return null;
  const split = (v: string | null) => (v ?? "").split("|").map((x) => x.trim()).filter(Boolean);
  return {
    train_number: no,
    line,
    origin: clean(r.from),
    destination: clean(r.to),
    arr_planned: arr?.toISOString() ?? null,
    dep_planned: dep?.toISOString() ?? null,
    delay_min: r.cancelled ? null : parseDelay(r.timeClass, r.timeText),
    platform: clean(r.platform),
    cancelled: r.cancelled,
    message: clean(r.info),
    route: r.cancelled ? [] : [...split(r.routePrev), stationName, ...split(r.routeNext)],
  };
}

/** Nur Züge im Zeitfenster um „jetzt“. */
export function inWindow(r: BoardRecord, now: number, backMin = 75, aheadMin = 90): boolean {
  const t = Date.parse(r.dep_planned ?? r.arr_planned ?? "") + (r.delay_min ?? 0) * 60_000;
  return t >= now - backMin * 60_000 && t <= now + aheadMin * 60_000;
}

export interface Unit {
  unit: string;
  name: string | null;
  type: string | null;
  cars: string[];
}

/** „T0423309“ → „423 309“ */
function unitFromGroupName(name: string): string | null {
  const m = /^T?0?(\d{3})(\d{3})$/.exec(name);
  return m ? `${m[1]} ${m[2]}` : null;
}

/**
 * Wagenreihung aus den sichtbaren Texten (Dokumentreihenfolge): Wagen „0423 309“, danach Baureihe „BR423“
 * und Einheit „T0423309“. Ohne ausgewiesene Einheitsnummer wird keine Einheit gebildet.
 */
export function parseFormation(texts: string[]): Unit[] {
  const units: Unit[] = [];
  let cars: string[] = [];
  let type: string | null = null;
  for (const raw of texts) {
    const t = raw.replace(/\s+/g, " ").trim();
    const car = /^0?(\d{3}) (\d{3})$/.exec(t);
    if (car) {
      cars.push(`${car[1]} ${car[2]}`);
    } else if (/^BR ?\d{3}/.test(t)) {
      type = t.replace(" ", "");
    } else if (/^T\d{7}$/.test(t)) {
      const unit = unitFromGroupName(t);
      // Gegenprobe: Einheitsnummer muss zu mindestens einem der gezeigten Wagen passen
      const num = unit?.slice(4);
      if (unit && cars.some((c) => Number(c.slice(4)) % 500 === Number(num) % 500)) {
        units.push({ unit, name: t, type, cars });
      }
      cars = [];
      type = null;
    }
  }
  return units;
}
