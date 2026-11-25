"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DataBadge, LineBadge } from "@/components/ui/Badges";
import { useNow } from "@/hooks/useLiveData";
import { useScannerStatus } from "@/hooks/useScanner";
import {
  fetchLines,
  FALLBACK_LINE_COLOR,
  searchTrain,
  searchVehicle,
  type Line,
  type TrainRun,
  type VehicleSearchResult,
} from "@/lib/api";
import { fmtDateTime, fmtRelative, fmtTime } from "@/lib/time";
import { parseTrainNumber, unitNumber } from "@/lib/trips";
import { ScanNowButton } from "./ScanNowButton";
import { AppNav } from "./StatusBar";

type LineStyleFn = (id: string) => { color: string; textColor: string };

function fmtConfidence(c: number | null | undefined): string {
  if (c == null || !Number.isFinite(c)) return "unbekannt";
  const pct = c <= 1 ? c * 100 : c;
  return `${Math.round(pct)} %`;
}

type State =
  | { kind: "idle" }
  | { kind: "loading"; q: string }
  | { kind: "done"; q: string; results: VehicleSearchResult[]; unit: string | null; train: string | null; runs: TrainRun[] }
  | { kind: "error"; q: string; message: string };

export function VehicleSearch() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = params.get("q") ?? "";
  const [input, setInput] = useState(initial);
  const [state, setState] = useState<State>({ kind: "idle" });
  const now = useNow(1_000);
  const { status: scanner, apply } = useScannerStatus(3_000);
  const [reload, setReload] = useState(0);
  const onScanned = useCallback(() => setReload((n) => n + 1), []);

  const [lines, setLines] = useState<Map<string, Line>>(() => new Map());
  useEffect(() => {
    fetchLines()
      .then((l) => setLines(new Map(l.map((x) => [x.id, x]))))
      .catch(() => undefined);
  }, []);
  const lineStyle: LineStyleFn = (id) => ({
    color: lines.get(id)?.color || FALLBACK_LINE_COLOR,
    textColor: lines.get(id)?.text_color || "#ffffff",
  });

  // Bei Navigation mit neuem ?q= das Eingabefeld nachziehen
  useEffect(() => {
    setInput(initial);
  }, [initial]);

  useEffect(() => {
    const q = initial.trim();
    if (!q) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    // Nach einem Scan still aktualisieren, statt das Ergebnis kurz auszublenden
    setState((prev) => (prev.kind === "done" && prev.q === q ? prev : { kind: "loading", q }));
    const train = parseTrainNumber(q);
    const unit = unitNumber(q);
    Promise.all([train ? Promise.resolve([]) : searchVehicle(unit ?? q), train ? searchTrain(train) : Promise.resolve([])])
      .then(([results, runs]) => !cancelled && setState({ kind: "done", q, results, unit, train, runs }))
      .catch((e: Error) => !cancelled && setState({ kind: "error", q, message: e.message }));
    return () => {
      cancelled = true;
    };
  }, [initial, reload]);

  // Nur mit Maus/Tastatur vorab ins Feld springen; auf dem Handy ginge sonst sofort die Tastatur auf
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) inputRef.current?.focus();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) inputRef.current?.blur();
    const q = input.trim();
    router.replace(q ? `/fahrzeuge?q=${encodeURIComponent(q)}` : "/fahrzeuge");
  };

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-10 border-b border-line bg-[var(--panel)] backdrop-blur-md">
        <div className="page-x mx-auto max-w-3xl py-3 compact:py-1.5 compact:pt-[calc(0.375rem+env(safe-area-inset-top))]">
          <AppNav active="fahrzeuge" />
        </div>
      </header>

      <div className="page-x page-b mx-auto max-w-3xl pt-8 compact:pt-5">
        <h1 className="text-xl font-semibold tracking-tight">Fahrzeugsuche</h1>
        <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted">
          Suche nach einer Fahrzeugnummer (z. B. „423 310“, auch Wagennummern wie „423 810“) oder einer Zugnummer (z. B. „7172“). Gezeigt werden Sichtungen in Wagenreihungen, ein
          vermuteter Abstellort und mögliche Zugtrennungen.
        </p>

        <div className="mt-4 rounded-md border border-line px-3 py-2.5 text-[12px] leading-relaxed text-muted max-md:hidden">
          <div className="mb-1 flex items-center gap-2">
            <DataBadge state="zuletzt" label="Webscanner und eigene Meldungen" />
          </div>
          Fahrzeugnummern stammen vom Webscanner (nur wenn eingeschaltet) und aus eigenen Meldungen über einen Zug
          auf der Karte („Fahrzeug melden“). Abstellorte und Zugtrennungen sind daraus abgeleitete Vermutungen.
        </div>

        <form onSubmit={submit} className="mt-6 flex gap-2 max-md:mt-4">
          <input
            ref={inputRef}
            enterKeyHint="search"
            autoCorrect="off"
            autoCapitalize="none"
            aria-label="Fahrzeug- oder Zugnummer"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="z. B. 423 310 oder 7172"
            className="tnum h-10 compact:h-12 min-w-0 flex-1 rounded-md border border-line bg-black/30 px-3 text-[14px] placeholder:text-faint focus:border-[var(--line-strong)] focus:outline-none"
          />
          <button
            type="submit"
            className="h-10 compact:h-12 compact:text-[15px] rounded-md border border-[var(--line-strong)] bg-white/[0.06] px-4 text-[13px] font-medium hover:bg-white/[0.1]"
          >
            Suchen
          </button>
        </form>
        <div className="mt-3 sm:max-w-xs">
          <ScanNowButton status={scanner} apply={apply} now={now} onFinished={onScanned} />
        </div>

        <div className="mt-8">
          {state.kind === "loading" && <p className="text-[13px] text-faint">Suche „{state.q}“ …</p>}
          {state.kind === "error" && (
            <p className="text-[13px] text-bad">Die Suche ist fehlgeschlagen: {state.message}</p>
          )}
          {state.kind === "done" && state.unit && state.unit.replace(/\D/g, "") !== state.q.replace(/\D/g, "") && (
            <p className="mb-4 text-[12px] text-muted">
              {state.q} ist ein Wagen der Einheit <span className="tnum text-fg">{state.unit}</span>.
            </p>
          )}
          {state.kind === "done" && state.train && <TrainRuns train={state.train} runs={state.runs} now={now} lineStyle={lineStyle} />}
          {state.kind === "done" && !state.train && state.results.length === 0 && (
            <div className="rounded-md border border-dashed border-line px-4 py-6 text-[13px] leading-relaxed text-muted">
              <p className="text-fg">Kein Fahrzeug „{state.q}“ gefunden.</p>
              <Link href="/" className="mt-2 inline-block text-[12px] text-accent hover:underline">
                Zur Karte
              </Link>
              <p className="mt-1">Dieses Fahrzeug wurde noch nicht erfasst. Je Scan werden die Fahrzeuge der Züge gelesen, die gerade über den Hbf (tief) unterwegs sind, S1 bis S3 zuerst. Scanne noch einmal oder melde es über einen Zug auf der Karte.</p>
            </div>
          )}
          {state.kind === "done" && state.results.map((r) => <VehicleProfile key={r.vehicle.id} r={r} now={now} lineStyle={lineStyle} />)}
        </div>
      </div>
    </main>
  );
}

function TrainRuns({ train, runs, now, lineStyle }: { train: string; runs: TrainRun[]; now: number; lineStyle: LineStyleFn }) {
  return (
    <section>
      <h2 className="tnum text-2xl font-semibold tracking-tight">Zug {train}</h2>
      {runs.length === 0 ? (
        <p className="mt-3 text-[13px] text-muted">Keine Fahrt mit dieser Zugnummer erfasst.</p>
      ) : (
        <ol className="mt-4 divide-y divide-[var(--line)] border-y border-line">
          {runs.map((t) => {
            const f = t.formations[0];
            const active = t.first_dep && t.last_arr && Date.parse(t.first_dep) <= now && now <= Date.parse(t.last_arr) + 10 * 60_000;
            return (
              <li key={t.id} className="grid grid-cols-1 gap-1 py-2.5 text-[13px] sm:grid-cols-[8.5rem_1fr]">
                <span className="tnum text-muted">{fmtDateTime(t.first_dep)}</span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {t.line_id && <LineBadge id={t.line_id} {...lineStyle(t.line_id)} size="sm" />}
                    <span>
                      {t.origin_name ?? "–"} → {t.destination_name ?? "–"}
                    </span>
                    {active && <span className="text-[12px] text-ok">unterwegs</span>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
                    {f ? (
                      <>
                        <span>
                          Fahrzeuge{" "}
                          {f.vehicles.map((v, i) => (
                            <span key={v}>
                              {i > 0 && ", "}
                              <Link href={`/fahrzeuge?q=${encodeURIComponent(v)}`} className="tnum text-fg hover:underline compact:inline-block compact:py-2">
                                {v}
                              </Link>
                            </span>
                          ))}
                        </span>
                        <span>
                          {f.station_name ?? "Ort unbekannt"}, {fmtTime(f.observed_at)} · {f.source === "manual" ? "manuell gemeldet" : f.source}
                        </span>
                      </>
                    ) : (
                      <span>Fahrzeugnummer nicht erfasst</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function VehicleProfile({ r, now, lineStyle }: { r: VehicleSearchResult; now: number; lineStyle: LineStyleFn }) {
  const v = r.vehicle;
  const sightings = [...r.sightings].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at));
  const splits = [...r.splits].sort((a, b) => Date.parse(b.detected_at) - Date.parse(a.detected_at));
  return (
    <article className="anim-in mb-10 border-t border-line pt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="tnum text-2xl font-semibold tracking-tight">{v.id}</h2>
        <span className="text-[12px] text-muted">{v.vehicle_type_id ? `Baureihe ${v.vehicle_type_id}` : "Baureihe unbekannt"}</span>
      </div>
      {v.last_line_id && (
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted">
          <span>zuletzt als</span>
          <LineBadge id={v.last_line_id} {...lineStyle(v.last_line_id)} size="sm" />
          <span className="text-fg">
            Zug {v.last_train_number ?? "–"} → {v.last_destination ?? "–"}
          </span>
          {v.last_seen && (
            <span>
              {fmtTime(v.last_seen)}
              {v.last_station_name ? ` an ${v.last_station_name}` : ""}
            </span>
          )}
        </p>
      )}

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
            {sightings.map((s, i) => {
              const others = (s.formation ?? []).map(String).filter((x) => x !== v.id);
              return (
                <li key={`${s.observed_at}-${i}`} className="grid grid-cols-1 gap-1 py-2.5 text-[13px] sm:grid-cols-[8.5rem_1fr]">
                  <span className="tnum text-muted">{fmtDateTime(s.observed_at)}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.line_id && <LineBadge id={s.line_id} {...lineStyle(s.line_id)} size="sm" />}
                      <span className="tnum">Zug {s.train_number ?? "–"}</span>
                      {(s.origin_name || s.destination_name) && (
                        <span className="text-muted">
                          {s.origin_name ?? "–"} → {s.destination_name ?? "–"}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
                      <span>gesehen an {s.station_name ?? "unbekannt"}</span>
                      {others.length > 0 && (
                        <span>
                          mit{" "}
                          {others.map((o, j) => (
                            <span key={o}>
                              {j > 0 && ", "}
                              <Link href={`/fahrzeuge?q=${encodeURIComponent(o)}`} className="tnum text-muted hover:text-fg compact:inline-block compact:py-2">
                                {o}
                              </Link>
                            </span>
                          ))}
                        </span>
                      )}
                      <span>{s.source === "manual" || !s.source ? "manuell gemeldet" : s.source}</span>
                    </div>
                  </div>
                </li>
              );
            })}
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
