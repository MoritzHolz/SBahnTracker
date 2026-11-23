"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { DataBadge } from "@/components/ui/Badges";
import { useNow } from "@/hooks/useLiveData";
import { fetchSourceStatus, searchVehicle, type SourceStatus, type VehicleSearchResult } from "@/lib/api";
import { fmtDateTime, fmtRelative } from "@/lib/time";
import { AppNav } from "./StatusBar";

function fmtConfidence(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return "unbekannt";
  const pct = c <= 1 ? c * 100 : c;
  return `${Math.round(pct)} %`;
}

type State =
  | { kind: "idle" }
  | { kind: "loading"; q: string }
  | { kind: "done"; q: string; results: VehicleSearchResult[] }
  | { kind: "error"; q: string; message: string };

export function VehicleSearch() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("q") ?? "";
  const [input, setInput] = useState(initial);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [status, setStatus] = useState<SourceStatus | null>(null);
  const now = useNow(30_000);

  useEffect(() => {
    fetchSourceStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    const q = initial.trim();
    if (!q) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading", q });
    searchVehicle(q)
      .then((results) => !cancelled && setState({ kind: "done", q, results }))
      .catch((e: Error) => !cancelled && setState({ kind: "error", q, message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    router.replace(q ? `/fahrzeuge?q=${encodeURIComponent(q)}` : "/fahrzeuge");
  };

  const formationAvailable = status?.formation_source?.available ?? false;

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-[var(--panel)] backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-5 py-3">
          <AppNav active="fahrzeuge" />
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="text-xl font-semibold tracking-tight">Fahrzeugsuche</h1>
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted">
          Suche nach einer Fahrzeugnummer (z. B. „423 502“). Gezeigt werden Sichtungen in Wagenreihungen, ein
          vermuteter Abstellort und mögliche Zugtrennungen.
        </p>

        {!formationAvailable && (
          <div className="mt-4 rounded-md border border-line px-3 py-2.5 text-[12px] leading-relaxed text-muted">
            <div className="mb-1 flex items-center gap-2">
              <DataBadge state="na" label="Quelle nicht angebunden" />
            </div>
            Aktuell ist keine Datenquelle für Fahrzeugnummern bzw. Wagenreihungen angebunden. Die Suche funktioniert
            technisch, liefert aber voraussichtlich keine Treffer.
            {status?.formation_source?.note && <span className="mt-1 block text-faint">{status.formation_source.note}</span>}
          </div>
        )}

        <form onSubmit={submit} className="mt-6 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Fahrzeugnummer, z. B. 423 502"
            className="tnum h-10 min-w-0 flex-1 rounded-md border border-line bg-black/30 px-3 text-[14px] placeholder:text-faint focus:border-[var(--line-strong)] focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            className="h-10 rounded-md border border-[var(--line-strong)] bg-white/[0.06] px-4 text-[13px] font-medium hover:bg-white/[0.1]"
          >
            Suchen
          </button>
        </form>

        <div className="mt-8">
          {state.kind === "loading" && <p className="text-[13px] text-faint">Suche „{state.q}“ …</p>}
          {state.kind === "error" && (
            <p className="text-[13px] text-bad">Die Suche ist fehlgeschlagen: {state.message}</p>
          )}
          {state.kind === "done" && state.results.length === 0 && (
            <div className="rounded-md border border-dashed border-line px-4 py-6 text-[13px] leading-relaxed text-muted">
              <p className="text-fg">Kein Fahrzeug „{state.q}“ gefunden.</p>
              <p className="mt-1">
                {formationAvailable
                  ? "Für diese Nummer liegen keine Sichtungen vor. Prüfe die Schreibweise (Baureihe + Ordnungsnummer, z. B. 423 502)."
                  : "Das ist derzeit zu erwarten: Ohne angebundene Wagenreihungsquelle werden keine Fahrzeuge erfasst. Sobald eine Quelle verfügbar ist, erscheinen hier Sichtungen."}
              </p>
            </div>
          )}
          {state.kind === "done" && state.results.map((r) => <VehicleProfile key={r.vehicle.id} r={r} now={now} />)}
        </div>
      </div>
    </main>
  );
}

function VehicleProfile({ r, now }: { r: VehicleSearchResult; now: number }) {
  const v = r.vehicle;
  const sightings = [...r.sightings].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
  const splits = [...r.splits].sort((a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at));
  return (
    <article className="anim-in mb-10 border-t border-line pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="tnum text-2xl font-semibold tracking-tight">{v.id}</h2>
        <span className="text-[12px] text-muted">{v.vehicle_type_id ? `Baureihe ${v.vehicle_type_id}` : "Baureihe unbekannt"}</span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        <Field k="Status">{v.status ?? "unbekannt"}</Field>
        <Field k="Letzte Sichtung">
          {v.last_seen ? (
            <>
              {fmtRelative(v.last_seen, now)}
              {v.last_station_name && <span className="text-muted"> · {v.last_station_name}</span>}
              <span className="ml-2 align-middle">
                <DataBadge state="zuletzt" />
              </span>
            </>
          ) : (
            <DataBadge state="na" />
          )}
        </Field>
        <Field k="Erstmals gesehen">{fmtDateTime(v.first_seen)}</Field>
        <Field k="Letzte Fahrt">{v.last_trip_id ?? "–"}</Field>
      </dl>

      <section className="mt-6 rounded-md border border-line px-4 py-3">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[10px] font-medium uppercase tracking-[0.12em] text-faint">Vermutlicher Abstellort</h3>
          <DataBadge state={r.parking ? "vermutung" : "na"} />
        </div>
        {r.parking ? (
          <div className="text-[13px]">
            <div>
              {r.parking.station_name ?? "Ort unbekannt"}
              {r.parking.status && <span className="text-muted"> · {r.parking.status}</span>}
            </div>
            <div className="mt-0.5 text-[12px] text-muted">
              Sicherheit {fmtConfidence(r.parking.confidence)} · letzte Sichtung {fmtRelative(r.parking.last_sighting_at, now)}
            </div>
            {r.parking.reason && <p className="mt-1 text-[12px] text-faint">Begründung: {r.parking.reason}</p>}
            <p className="mt-1 text-[11px] text-faint">Abgeleitet aus Sichtungen – keine bestätigte Ortung.</p>
          </div>
        ) : (
          <p className="text-[12px] text-muted">Keine Vermutung möglich – zu wenige Sichtungen.</p>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
          Fahrtenbuch <span className="tnum normal-case tracking-normal">({sightings.length})</span>
        </h3>
        {sightings.length === 0 ? (
          <p className="text-[12px] text-muted">Keine Sichtungen erfasst.</p>
        ) : (
          <ol className="divide-y divide-[var(--line)] border-y border-line">
            {sightings.map((s, i) => (
              <li key={`${s.observed_at}-${i}`} className="grid grid-cols-[9rem_1fr_auto] gap-3 py-2 text-[13px]">
                <span className="tnum text-muted">{fmtDateTime(s.observed_at)}</span>
                <span className="min-w-0 truncate">
                  {s.station_name ?? "–"}
                  {s.trip_id && <span className="text-faint"> · Fahrt {s.trip_id}</span>}
                </span>
                <span className="tnum text-[12px] text-faint">
                  {s.position_in_formation != null ? `Pos. ${s.position_in_formation}` : ""}
                  {s.source ? ` · ${s.source}` : ""}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-6">
        <h3 className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.12em] text-faint">
          Mögliche Zugtrennungen {splits.length > 0 && <DataBadge state="vermutung" />}
        </h3>
        {splits.length === 0 ? (
          <p className="text-[12px] text-muted">Keine Trennungen oder Vereinigungen erkannt.</p>
        ) : (
          <ul className="space-y-2">
            {splits.map((s, i) => (
              <li key={`${s.detected_at}-${i}`} className="rounded-md border border-line px-3 py-2 text-[13px]">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>
                    {s.kind ?? "Änderung der Wagenreihung"} in {s.station_name ?? "unbekannt"}
                  </span>
                  <span className="tnum text-[12px] text-muted">{fmtDateTime(s.detected_at)}</span>
                </div>
                <div className="mt-0.5 text-[12px] text-muted">
                  {s.missing_vehicles?.length ? `Fehlend: ${s.missing_vehicles.join(", ")}` : ""}
                  {s.missing_vehicles?.length && s.new_vehicles?.length ? " · " : ""}
                  {s.new_vehicles?.length ? `Neu: ${s.new_vehicles.join(", ")}` : ""}
                  <span className="text-faint"> · Sicherheit {fmtConfidence(s.confidence)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.12em] text-faint">{k}</dt>
      <dd className="mt-0.5 text-[14px]">{children}</dd>
    </div>
  );
}
