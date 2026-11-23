export const TZ = "Europe/Berlin";

const hm = new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const hms = new Intl.DateTimeFormat("de-DE", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const dateTime = new Intl.DateTimeFormat("de-DE", {
  timeZone: TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

export function fmtTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? hm.format(d) : "–";
}

export function fmtTimeSec(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? hms.format(d) : "–";
}

export function fmtDateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  return d ? dateTime.format(d) : "–";
}

/** „vor 2 min“, „vor 1 h“ … relativ zu now. */
export function fmtRelative(v: string | number | Date | null | undefined, now: number): string {
  const d = toDate(v);
  if (!d) return "unbekannt";
  const diff = Math.round((now - d.getTime()) / 1000);
  if (diff < -30) return `in ${fmtDuration(-diff)}`;
  if (diff < 30) return "gerade eben";
  return `vor ${fmtDuration(diff)}`;
}

function fmtDuration(sec: number): string {
  if (sec < 90) return `${Math.max(1, Math.round(sec / 60))} min`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} Tagen`;
}

/**
 * Verspätung in ganzen Minuten (est − planned). Null, wenn eine der Zeiten
 * fehlt. Gerundet auf die nächste Minute, -0 wird zu 0.
 */
export function delayMinutes(
  planned: string | null | undefined,
  est: string | null | undefined,
): number | null {
  if (!planned || !est) return null;
  const p = Date.parse(planned);
  const e = Date.parse(est);
  if (!Number.isFinite(p) || !Number.isFinite(e)) return null;
  const m = Math.round((e - p) / 60_000);
  return m === 0 ? 0 : m;
}

export type DelayTone = "unknown" | "ontime" | "slight" | "late" | "severe";

/** Einstufung für die Farbgebung. */
export function delayTone(min: number | null): DelayTone {
  if (min == null) return "unknown";
  if (min <= 0) return "ontime";
  if (min <= 3) return "slight";
  if (min <= 9) return "late";
  return "severe";
}

export function fmtDelay(min: number | null): string {
  if (min == null) return "–";
  if (min === 0) return "pünktlich";
  return min > 0 ? `+${min}` : `${min}`;
}
