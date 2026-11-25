"use client";

import Link from "next/link";
import { signOut } from "@/components/LoginGate";
import type { SourceStatus } from "@/lib/api";
import type { ScannerStatus } from "@/lib/scanner";
import { fmtRelative, fmtTime, fmtTimeSec } from "@/lib/time";

export const STALE_AFTER_MS = 10 * 60_000;

export function isStale(status: SourceStatus | null, now: number): boolean {
  if (!status) return false; // noch nicht geladen
  const t = status.last_ok ? Date.parse(status.last_ok) : NaN;
  return !Number.isFinite(t) || now - t > STALE_AFTER_MS;
}

/** Kurzstatus des Webscanners auf der Karte (Steuerung unter /scanner). */
export function ScannerBadge({ status, now }: { status: ScannerStatus | null; now: number }) {
  if (!status) return null;
  const tone = { running: "bg-accent pulse-dot", waiting: "bg-ok", error: "bg-bad", off: "bg-faint" }[status.scan_state];
  const text =
    status.scan_state === "running"
      ? "Scan läuft"
      : !status.enabled
        ? status.schedule.enabled && status.schedule.next_start
          ? `AUS · Zeitplan ab ${fmtTime(status.schedule.next_start)}`
          : "AUS"
        : status.scan_state === "error"
          ? status.worker_online ? "Fehler" : "Worker offline"
          : `EIN · Scan ${status.last_success_at ? fmtRelative(status.last_success_at, now) : "steht aus"}`;
  return (
    <Link
      href="/scanner"
      className="flex items-center gap-2 rounded-md border border-line bg-[var(--panel)] px-2.5 py-1.5 text-[11px] text-muted backdrop-blur-md hover:text-fg"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
      Webscanner <span className="tnum text-fg">{text}</span>
    </Link>
  );
}

/** Kompakte Anzeige des Datenquellenstatus. */
export function SourceStatusBadge({
  status,
  tripCount,
  fetchedAt,
  error,
  now,
}: {
  status: SourceStatus | null;
  tripCount: number;
  fetchedAt: number | null;
  error: string | null;
  now: number;
}) {
  const stale = isStale(status, now);
  const failing = status?.live?.ok === false;
  const tone = error ? "bg-bad" : stale ? "bg-warn" : failing ? "bg-late" : status ? "bg-ok pulse-dot" : "bg-faint";
  const source = status?.live?.source ?? "NVBW EFA";
  return (
    <div
      className="flex items-center gap-2.5 rounded-md border border-line bg-[var(--panel)] px-2.5 py-1.5 text-[11px] text-muted backdrop-blur-md"
      title={
        [
          status?.live?.finished_at ? `Letzter Lauf: ${fmtTimeSec(status.live.finished_at)}` : null,
          status?.live?.ok === false
            ? `Fehler beim letzten Abruf${status.live.finished_at ? ` (${fmtTimeSec(status.live.finished_at)})` : ""}`
            : null,
          fetchedAt ? `Im Browser abgerufen: ${fmtTimeSec(fetchedAt)}` : null,
          error ? "Abruf im Browser fehlgeschlagen" : null,
        ]
          .filter(Boolean)
          .join("\n") || undefined
      }
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} />
      <span className="hidden sm:inline">{source}</span>
      <span className="hidden text-faint sm:inline">·</span>
      <span className="tnum">{status?.last_ok ? `Abruf ${fmtRelative(status.last_ok, now)}` : status ? "kein erfolgreicher Abruf" : "Status lädt …"}</span>
      <span className="text-faint">·</span>
      <span className="tnum">{tripCount} Züge</span>
    </div>
  );
}

export function Banner({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  return (
    <div
      role="status"
      className={`anim-in flex items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] backdrop-blur-md ${
        tone === "bad" ? "border-bad/40 bg-bad/10 text-[#ffb4b4]" : "border-warn/40 bg-warn/10 text-[#ffe2a3]"
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === "bad" ? "bg-bad" : "bg-warn"}`} />
      {children}
    </div>
  );
}

type NavKey = "karte" | "fahrzeuge" | "abstellungen" | "scanner";

export function AppNav({ active }: { active: NavKey }) {
  const item = (key: NavKey, href: string, label: string) => (
    <Link
      href={href}
      aria-current={active === key ? "page" : undefined}
      className={`rounded px-1.5 py-1 text-[12px] transition-colors compact:flex compact:h-11 compact:items-center compact:rounded-md compact:px-2 compact:text-[13px] max-[374px]:px-1 max-[374px]:text-[12px] ${
        active === key ? "bg-white/[0.07] text-fg" : "text-muted hover:text-fg"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex items-center justify-between gap-3">
      <Link href="/" className="flex items-center gap-2 max-sm:hidden">
        <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="var(--ok)" strokeWidth="1.5" />
          <path d="M7 6.5h4.2a2.3 2.3 0 0 1 0 4.6H8.8a2.3 2.3 0 0 0 0 4.6H13" fill="none" stroke="var(--fg)" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span className={`whitespace-nowrap text-[13px] font-semibold tracking-tight ${active === "karte" ? "md:hidden" : ""}`}>
          S-Bahn Stuttgart{active !== "karte" && <span className="font-normal text-muted"> Live</span>}
        </span>
      </Link>
      <nav className="flex items-center gap-0.5 max-[374px]:gap-0 max-sm:flex-1">
        {item("karte", "/", "Karte")}
        {item("fahrzeuge", "/fahrzeuge", "Fahrzeuge")}
        {item("abstellungen", "/abstellungen", "Protokoll")}
        {item("scanner", "/scanner", "Scanner")}
        <button onClick={() => void signOut()} title="Abmelden" aria-label="Abmelden" className="rounded px-1.5 py-1 text-[12px] text-muted hover:text-fg compact:grid compact:h-11 compact:w-11 compact:place-items-center max-[374px]:w-9! max-sm:ml-auto">
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 compact:h-4.5 compact:w-4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M6.5 2.5h-3v11h3M7 8h6.5M11 5.5 13.5 8 11 10.5" />
          </svg>
        </button>
      </nav>
    </div>
  );
}
