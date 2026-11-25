"use client";

import Link from "next/link";
import { DataBadge, LineBadge } from "@/components/ui/Badges";
import { PARKING_LEVEL_LABEL, parkingLevel, SITE_KIND_LABEL, type ParkedVehicle, type ParkingSite } from "@/lib/parking";
import { fmtDateTime, fmtRelative } from "@/lib/time";

type LineStyleFn = (id: string) => { color: string; textColor: string };

interface Props {
  site: ParkingSite;
  lineStyle: LineStyleFn;
  now: number;
  onClose: () => void;
  /** Handy: macht den Kopf zum Ziehgriff des Blatts */
  handleProps?: React.HTMLAttributes<HTMLDivElement>;
  onHandleTap?: () => void;
}

export function ParkedPanel({ site, lineStyle, now, onClose, handleProps, onHandleTap }: Props) {
  const count = [
    site.parked.length > 0 && `${site.parked.length} vermutlich abgestellt`,
    site.absent.length > 0 && `${site.absent.length} unsicher`,
    site.moved.length > 0 && `${site.moved.length} verschoben`,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div {...handleProps} className="shrink-0 touch-none select-none border-b border-line px-5 pb-3 pt-4 compact:pb-2.5 compact:pl-4 compact:pr-3 compact:pt-0 md:touch-auto md:select-auto">
        <button
          type="button"
          className="hidden h-5 w-full items-center justify-center max-md:flex"
          onClick={onHandleTap}
          aria-label="Größe der Details ändern"
        >
          <span className="h-1 w-9 rounded-full bg-white/25" />
        </button>
        <div className="flex items-center gap-3 md:compact:pt-2">
          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-[5px] bg-[#c4a7ff] text-[15px] font-bold text-[#17131f]">
            A
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[16px] font-semibold leading-snug">Abstellung {site.name}</div>
            <div className="truncate text-[12.5px] leading-snug text-muted">{count}</div>
          </div>
          <button
            onClick={onClose}
            className="-mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted hover:bg-white/5 hover:text-fg compact:h-11 compact:w-11"
            aria-label="Details schließen"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="scroll-thin sheet-b min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="border-b border-line px-5 py-3">
          <DataBadge state="vermutung" label="Geschätzt" />
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            {SITE_KIND_LABEL[site.kind]}.{" "}
            {site.parked.length + site.absent.length > 0 &&
              "Diese Fahrzeuge sind hier angekommen und in keiner gelesenen Fahrt danach wieder aufgetaucht. "}
            Leerfahrten und nicht gelesene Züge sind nicht sichtbar, der genaue Standort ist nicht bestätigt.
          </p>
        </div>
        {site.parked.length > 0 && <Group title="Vermutlich hier abgestellt" list={site.parked} lineStyle={lineStyle} now={now} />}
        {site.absent.length > 0 && (
          <Group
            title="Nicht im Einsatz, Ort unsicher"
            hint="Zuletzt hier gesehen. Das Fahrzeug fährt gerade nicht, kann aber inzwischen woanders stehen."
            list={site.absent}
            lineStyle={lineStyle}
            now={now}
          />
        )}
        {site.moved.length > 0 && (
          <Group
            title="Automatisch hierher verschoben (Annahme)"
            hint="Länger als 48 h an einer Endstation oder länger als 60 min an der Schwabstraße. Die Regel nimmt an, dass das Fahrzeug nach Plochingen gebracht wurde. Eine Fahrt dorthin wurde nicht beobachtet. Fährt es wieder, erscheint es normal auf der Karte."
            list={site.moved}
            lineStyle={lineStyle}
            now={now}
          />
        )}
      </div>
    </div>
  );
}

function Group({ title, hint, list, lineStyle, now }: { title: string; hint?: string; list: ParkedVehicle[]; lineStyle: LineStyleFn; now: number }) {
  return (
    <section className="px-5 py-3">
      <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
        {title} <span className="tnum">({list.length})</span>
      </h3>
      {hint && <p className="mt-1 text-[12px] leading-relaxed text-muted">{hint}</p>}
      <ul className="mt-1.5 divide-y divide-[var(--line)]">
        {list.map((v) => {
          const level = parkingLevel(v);
          return (
            <li key={v.vehicle_id} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <Link href={`/fahrzeuge?q=${encodeURIComponent(v.vehicle_id)}`} className="tnum text-[16px] font-semibold hover:underline compact:py-1">
                  {v.vehicle_id}
                </Link>
                <span className={`text-right text-[12px] ${level === "unsicher" || level === "verschoben" ? "text-faint" : "text-[#c4a7ff]"}`}>
                  {PARKING_LEVEL_LABEL[level]}
                  {/* Bei „unsicher“ gilt der Wert nur für „fährt nicht“, nicht für den Ort */}
                  {level !== "unsicher" && level !== "verschoben" && v.confidence != null && <span className="tnum"> · {Math.round(v.confidence * 100)} %</span>}
                </span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px] text-muted">
                <span>Angekommen</span>
                {v.line_id && <LineBadge id={v.line_id} {...lineStyle(v.line_id)} size="sm" />}
                <span className="tnum text-fg">Zug {v.train_number ?? "–"}</span>
                {v.origin_name && <span>aus {v.origin_name}</span>}
                {v.moved_from_name && <span>an {v.moved_from_name}</span>}
              </div>
              <div className="tnum mt-0.5 text-[12px] text-faint">
                {fmtDateTime(v.arrived_at)} · {fmtRelative(v.arrived_at, now)}
                {v.moved_at && ` · verschoben ${fmtDateTime(v.moved_at)}`}
              </div>
              {v.reason && <p className="mt-0.5 text-[12px] leading-snug text-faint">{v.reason}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
