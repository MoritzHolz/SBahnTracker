// Datensammler S-Bahn Stuttgart
// Quelle: NVBW EFA (efa-bw.de, MobiData BW) – Abfahrtsmonitor mit Echtzeit und kompletter Haltfolge.
// Wird per pg_cron alle 3 Minuten aufgerufen. Schreibt über security-definer-RPCs.

const EFA = "https://www.efa-bw.de/nvbw/";
const UA = "sbahn-stuttgart-tracking/0.1 (privates, nichtkommerzielles Projekt)";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Alle Linien S1–S6/S60 passieren Stuttgart Hbf (tief). Zeitfenster: 120 min zurück (auch stark verspätete Züge bleiben erfasst), ~2 h vor.
// S62 (Weil der Stadt – Feuerbach, nur HVZ) erreicht den Hbf nicht → zusätzlich Feuerbach, nur S62 übernehmen.
const MONITOR_STOPS: { id: string; name: string; lookBackMin: number; limit: number; onlyLines?: string[] }[] = [
  { id: "de:08111:6118", name: "Stuttgart Hbf (tief)", lookBackMin: 120, limit: 220 },
  { id: "de:08111:6157", name: "Feuerbach", lookBackMin: 50, limit: 60, onlyLines: ["S62"] },
];
const MAX_SHAPES_PER_RUN = 6;
// Gesamtbudget je Lauf (pg_net-Timeout 120 s, Edge-Limit 150 s)
const BUDGET_MS = 90_000;
// nur S-Bahn (EFA-Verkehrsmittel 1) – alle anderen ausschließen
const EXCL = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((m) => `&exclMOT_${m}=1`).join("");

type Json = Record<string, any>;

async function rpc(fn: string, body: Json) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`rpc ${fn} ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

async function table(method: "POST" | "PATCH", path: string, body: Json) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${t.slice(0, 300)}`);
  return t ? JSON.parse(t) : null;
}

function berlinParts(d: Date) {
  const p = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (k: string) => p.find((x) => x.type === k)!.value;
  return { date: `${g("year")}${g("month")}${g("day")}`, iso: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}${g("minute")}` };
}

async function efa(path: string, timeoutMs = 20000) {
  const t0 = Date.now();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(EFA + path, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs) });
      const text = await r.text();
      if (!r.ok) throw new Error(`EFA HTTP ${r.status}`);
      return { status: r.status, ms: Date.now() - t0, data: JSON.parse(text) };
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
  throw lastErr;
}

const iso = (v: unknown) => (typeof v === "string" && v ? v : null);

function toStop(loc: Json, seq: number) {
  const parent = loc.parent ?? {};
  const props = loc.properties ?? {};
  const coord = Array.isArray(loc.coord) ? loc.coord : parent.coord;
  return {
    seq,
    station_id: parent.type === "stop" && parent.id ? parent.id : String(loc.id ?? "").split(":").slice(0, 3).join(":"),
    station_name: (parent.type === "stop" ? parent.name : null) ?? loc.name ?? "?",
    platform_id: loc.id ?? null,
    lat: coord ? coord[0] : null,
    lon: coord ? coord[1] : null,
    platform: props.platformName ?? props.platform ?? null,
    planned_platform: props.plannedPlatformName ?? props.stoppingPointPlanned ?? null,
    arr_planned: iso(loc.arrivalTimePlanned),
    arr_est: iso(loc.arrivalTimeEstimated),
    dep_planned: iso(loc.departureTimePlanned),
    dep_est: iso(loc.departureTimeEstimated),
    cancelled: Array.isArray(loc.realtimeStatus) && loc.realtimeStatus.includes("CANCELLED"),
  };
}

function buildTrip(ev: Json) {
  const tr = ev.transportation ?? {};
  const prev: Json[] = ev.previousLocations ?? [];
  const next: Json[] = ev.onwardLocations ?? [];
  const cur = {
    ...ev.location,
    arrivalTimePlanned: ev.arrivalTimePlanned, arrivalTimeEstimated: ev.arrivalTimeEstimated,
    departureTimePlanned: ev.departureTimePlanned, departureTimeEstimated: ev.departureTimeEstimated,
  };
  const all = [...prev, cur, ...next];
  const stops = all.map((l, i) => toStop(l, i));
  const first = stops[0];
  const last = stops[stops.length - 1];
  const firstDep = first.dep_planned ?? first.arr_planned;
  const serviceDate = berlinParts(new Date(firstDep ?? ev.departureTimePlanned)).iso;
  const lastArr = last.arr_est ?? last.arr_planned ?? last.dep_planned;
  const rs: string[] = ev.realtimeStatus ?? [];
  const dirMatch = String(tr.id ?? "").match(/:([HR]):j\d+$/);
  return {
    id: `${serviceDate}|${tr.id}|${tr.properties?.tripCode}`,
    service_date: serviceDate,
    line_id: tr.number,
    transport_id: tr.id,
    trip_code: tr.properties?.tripCode,
    train_number: tr.properties?.trainNumber ?? null,
    origin_name: tr.origin?.name ?? first.station_name,
    destination_name: tr.destination?.name ?? last.station_name,
    direction: dirMatch ? dirMatch[1] : null,
    first_dep: firstDep,
    last_arr: lastArr,
    has_realtime: rs.includes("MONITORED") || stops.some((s) => s.dep_est || s.arr_est),
    cancelled: rs.includes("TRIP_CANCELLED"),
    shape_signature: `${tr.id}|${first.station_id}|${last.station_id}`,
    stops,
    _ref: { stop: ev.location?.id, dep: ev.departureTimePlanned },
  };
}

function haversine(a: number[], b: number[]) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function fetchShape(trip: ReturnType<typeof buildTrip>) {
  const p = berlinParts(new Date(trip._ref.dep));
  const q = `XML_STOPSEQCOORD_REQUEST?outputFormat=rapidJSON&coordOutputFormat=WGS84[dd.ddddd]&line=${encodeURIComponent(trip.transport_id)}` +
    `&stop=${encodeURIComponent(trip._ref.stop)}&tripCode=${trip.trip_code}&date=${p.date}&time=${p.time}&tStOTType=all&useRealtime=0`;
  const res = await efa(q);
  const leg = res.data?.leg;
  const coords: number[][] = (leg?.coords ?? []).map((c: number[]) => [c[1], c[0]]); // -> [lon, lat]
  if (coords.length < 2) return null;
  let len = 0;
  for (let i = 1; i < coords.length; i++) len += haversine(coords[i - 1], coords[i]);
  const stopIds = (leg.stopSequence ?? []).map((s: Json) => s.parent?.id ?? s.id);
  return { coords, stopIds, len };
}

Deno.serve(async (req) => {
  const secret = req.headers.get("x-collector-secret") ?? "";
  try {
    if (!secret || !(await rpc("collector_auth", { p_secret: secret }))) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }

  const t0 = Date.now();
  const [run] = await table("POST", "collector_runs", { source: "efa_nvbw" });
  const result: Json = { trips_seen: 0, trips_upserted: 0, shapes_fetched: 0 };
  let httpStatus: number | null = null, httpMs: number | null = null;
  try {
    const trips = new Map<string, ReturnType<typeof buildTrip>>();
    const errors: string[] = [];
    for (const st of MONITOR_STOPS) {
      if (Date.now() - t0 > BUDGET_MS / 2) { errors.push(`${st.name}: übersprungen (Zeitbudget)`); continue; }
      const p = berlinParts(new Date(Date.now() - st.lookBackMin * 60000));
      let res;
      try {
        res = await efa(
        `XML_DM_REQUEST?outputFormat=rapidJSON&language=de&coordOutputFormat=WGS84[dd.ddddd]&type_dm=stop&name_dm=${st.id}` +
          `&mode=direct&useRealtime=1&limit=${st.limit}&depType=stopEvents&includeCompleteStopSeq=1` +
          `&itdDate=${p.date}&itdTime=${p.time}&excludedMeans=checkbox${EXCL}`,
        25000,
      );
      } catch (e) {
        errors.push(`${st.name}: ${String(e).slice(0, 120)}`);
        continue;
      }
      if (httpStatus === null) { httpStatus = res.status; httpMs = res.ms; }
      for (const ev of res.data?.stopEvents ?? []) {
        const tr = ev.transportation;
        if (tr?.product?.class !== 1 || !/^S\d+/.test(tr?.number ?? "")) continue;
        if (st.onlyLines && !st.onlyLines.includes(tr.number)) continue;
        const t = buildTrip(ev);
        if (t.stops.length < 2 || !t.trip_code) continue;
        const existing = trips.get(t.id);
        // bevorzugt den Eintrag mit den meisten Halten (vollständigste Haltfolge)
        if (!existing || t.stops.length > existing.stops.length) trips.set(t.id, t);
      }
    }
    result.trips_seen = trips.size;
    // 0 Fahrten zur Betriebszeit (ca. 4:30–1:00) ist verdächtig → als Fehler werten, aber nichts überschreiben
    const hour = Number(berlinParts(new Date()).time.slice(0, 2));
    if (trips.size === 0 && (hour >= 5 || hour < 1)) errors.push("keine S-Bahn-Fahrten erhalten");

    // fehlende Streckengeometrien nachladen (gedrosselt)
    const sigs = [...new Set([...trips.values()].map((t) => t.shape_signature))];
    const missing: string[] = sigs.length ? await rpc("missing_shape_signatures", { p_signatures: sigs }) : [];
    for (const sig of missing.slice(0, MAX_SHAPES_PER_RUN)) {
      if (Date.now() - t0 > BUDGET_MS * 0.75) break;
      const t = [...trips.values()].find((x) => x.shape_signature === sig)!;
      try {
        const sh = await fetchShape(t);
        if (sh) {
          await rpc("store_shape", { p_line_id: t.line_id, p_signature: sig, p_coords: sh.coords, p_stop_ids: sh.stopIds, p_length: sh.len });
          result.shapes_fetched++;
        }
      } catch (e) {
        result.shape_errors = (result.shape_errors ?? 0) + 1;
        console.error("shape", sig, String(e));
      }
    }

    const payload = [...trips.values()].map(({ _ref, ...rest }) => rest);
    for (let i = 0; i < payload.length; i += 40) {
      try {
        result.trips_upserted += await rpc("ingest_trips", { p_trips: payload.slice(i, i + 40) });
      } catch (e) {
        errors.push(`ingest batch ${i / 40}: ${String(e).slice(0, 120)}`);
      }
    }
    const ok = errors.length === 0 || (result.trips_upserted > 0 && errors.every((x) => x.startsWith("Feuerbach")));
    await table("PATCH", `collector_runs?id=eq.${run.id}`, {
      finished_at: new Date().toISOString(), ok, http_status: httpStatus, http_ms: httpMs,
      trips_seen: result.trips_seen, trips_upserted: result.trips_upserted, shapes_fetched: result.shapes_fetched,
      error: errors.length ? errors.join(" | ").slice(0, 1000) : null,
    });
    result.errors = errors;
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  } catch (e) {
    console.error(e);
    await table("PATCH", `collector_runs?id=eq.${run.id}`, {
      finished_at: new Date().toISOString(), ok: false, http_status: httpStatus, http_ms: httpMs, error: String(e).slice(0, 1000),
    }).catch(() => {});
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
