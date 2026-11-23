import type { ReactNode } from "react";
import { delayTone, fmtDelay, type DelayTone } from "@/lib/time";

/** Einheitliche Datenstands-Kennzeichnung. */
export type DataState = "live" | "zuletzt" | "geschaetzt" | "vermutung" | "na";

const DATA_STATE: Record<DataState, { label: string; cls: string; dot: string }> = {
  live: { label: "Live erfasst", cls: "text-ok border-ok/30", dot: "bg-ok pulse-dot" },
  zuletzt: { label: "Zuletzt erfasst", cls: "text-warn border-warn/30", dot: "bg-warn" },
  geschaetzt: { label: "Geschätzt", cls: "text-accent border-accent/30", dot: "bg-accent" },
  vermutung: { label: "Vermutung", cls: "text-[#c4a7ff] border-[#c4a7ff]/30", dot: "bg-[#c4a7ff]" },
  na: { label: "Nicht verfügbar", cls: "text-faint border-line", dot: "bg-faint" },
};

export function DataBadge({ state, label, title }: { state: DataState; label?: string; title?: string }) {
  const s = DATA_STATE[state];
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.06em] ${s.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {label ?? s.label}
    </span>
  );
}

export const TONE_TEXT: Record<DelayTone, string> = {
  unknown: "text-faint",
  ontime: "text-ok",
  slight: "text-warn",
  late: "text-late",
  severe: "text-bad",
};

export function Delay({ minutes, compact = false }: { minutes: number | null; compact?: boolean }) {
  const tone = delayTone(minutes);
  const text = minutes == null ? "–" : compact && minutes === 0 ? "±0" : fmtDelay(minutes);
  return (
    <span className={`tnum font-medium ${TONE_TEXT[tone]}`} title={minutes == null ? "Keine Echtzeitdaten" : undefined}>
      {text}
    </span>
  );
}

export function LineBadge({ id, color, textColor, size = "md" }: { id: string; color: string; textColor: string; size?: "sm" | "md" | "lg" }) {
  const sz =
    size === "lg" ? "h-7 min-w-11 px-2 text-sm" : size === "sm" ? "h-[18px] min-w-8 px-1 text-[10px]" : "h-5 min-w-9 px-1.5 text-[11px]";
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[4px] font-semibold tracking-tight ${sz}`}
      style={{ background: color, color: textColor }}
    >
      {id}
    </span>
  );
}

export function Platform({
  current,
  planned,
  changed,
  planOnly = false,
}: {
  current: string | null;
  planned: string | null;
  changed: boolean;
  planOnly?: boolean;
}) {
  if (!current) return <span className="text-faint" title="Gleis nicht verfügbar">Gl. –</span>;
  if (planOnly)
    return (
      <span className="tnum" title="Nur Plangleis bekannt">
        Gl. {current} <span className="text-faint">(Plan)</span>
      </span>
    );
  return (
    <span className="tnum inline-flex items-center gap-1" title={changed ? `Gleisänderung (geplant: ${planned})` : undefined}>
      <span className={changed ? "rounded-sm bg-warn/15 px-1 font-medium text-warn" : ""}>Gl. {current}</span>
      {changed && <span className="text-[0.9em] text-faint">statt {planned}</span>}
    </span>
  );
}

export function Kv({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] items-baseline gap-3 py-1.5">
      <dt className="text-[11px] uppercase tracking-[0.06em] text-faint">{k}</dt>
      <dd className="min-w-0 text-[13px] text-fg">{children}</dd>
    </div>
  );
}
