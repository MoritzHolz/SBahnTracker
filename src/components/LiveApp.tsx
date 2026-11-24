"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { sheetHeightCss, TOP_BAR_PX, useBottomSheet } from "@/hooks/useBottomSheet";
import { useLiveData, useNow } from "@/hooks/useLiveData";
import { useScannerStatus } from "@/hooks/useScanner";
import { FALLBACK_LINE_COLOR, lineColor, lineTextColor } from "@/lib/api";
import { TrackCache } from "@/lib/position";
import { fmtRelative } from "@/lib/time";
import { summarizeTrip, tripMatchesQuery, tripsWithVehicle, type TripStatus, type TripSummary } from "@/lib/trips";
import { ScanNowButton } from "./panels/ScanNowButton";
import { Sidebar, type Filters, type LineInfo } from "./panels/Sidebar";
import { AppNav, Banner, isStale, ScannerBadge, SourceStatusBadge } from "./panels/StatusBar";
import { TrainDetail } from "./panels/TrainDetail";

const LiveMap = dynamic(() => import("./map/LiveMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-bg" />,
});

/** Höhe der zusammengeschobenen Blätter (Handy) */
const LIST_PEEK_PX = 126;
const DETAIL_PEEK_PX = 92;

const STATUS_RANK: Record<TripStatus, number> = {
  fahrend: 0,
  am_halt: 0,
  vor_abfahrt: 1,
  angekommen: 2,
  geplant: 3,
  ausfall: 4,
  beendet: 5,
};

function matchesStatus(s: TripSummary, f: Filters["status"]): boolean {
  switch (f) {
    case "alle":
      return true;
    case "unterwegs":
      return s.position != null;
    case "verspaetet":
      return (s.delay ?? 0) >= 3;
    default:
      return s.status === f;
  }
}

export default function LiveApp() {
  const data = useLiveData();
  const now = useNow(1000);
  const [scanFast, setScanFast] = useState(false);
  const { status: scanner, apply: applyScanner } = useScannerStatus(scanFast ? 3_000 : 20_000);
  const scanBusy = scanner != null && (scanner.manual_pending || scanner.scan_state === "running");
  useEffect(() => setScanFast(scanBusy), [scanBusy]);
  const [trackCache] = useState(() => new TrackCache());

  const [query, setQuery] = useState("");
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(() => new Set());
  const [focusLine, setFocusLine] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>({ dest: "", station: "", status: "alle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const list = useBottomSheet("peek", LIST_PEEK_PX);
  const detail = useBottomSheet("half", DETAIL_PEEK_PX);

  // Nicht mehr gelieferte Trips aus dem Geometrie-Cache entfernen
  useEffect(() => {
    trackCache.prune(new Set(data.trips.map((t) => t.id)));
  }, [data.trips, trackCache]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedId(null);
        setFollow(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lineStyle = useCallback(
    (id: string) => ({ color: lineColor(data.lines, id), textColor: lineTextColor(data.lines, id) }),
    [data.lines],
  );

  const summaries = useMemo(
    () =>
      data.trips.map((t) =>
        summarizeTrip(t, trackCache.get(t, t.shape_id != null ? data.shapes.get(t.shape_id) : null), now),
      ),
    [data.trips, data.shapes, trackCache, now],
  );

  const lineOrder = useMemo(() => {
    const m = new Map<string, number>();
    data.lineList.forEach((l, i) => m.set(l.id, i));
    return m;
  }, [data.lineList]);

  const lineInfos: LineInfo[] = useMemo(() => {
    const ids = new Set<string>([...data.lineList.map((l) => l.id), ...data.trips.map((t) => t.line_id)]);
    const counts = new Map<string, number>();
    for (const s of summaries) if (s.position) counts.set(s.trip.line_id, (counts.get(s.trip.line_id) ?? 0) + 1);
    return [...ids]
      .sort((a, b) => (lineOrder.get(a) ?? 999) - (lineOrder.get(b) ?? 999) || a.localeCompare(b, "de", { numeric: true }))
      .map((id) => ({
        id,
        color: data.lines.get(id)?.color || FALLBACK_LINE_COLOR,
        textColor: lineTextColor(data.lines, id),
        count: counts.get(id) ?? 0,
      }));
  }, [data.lineList, data.trips, data.lines, summaries, lineOrder]);

  const destinations = useMemo(
    () => [...new Set(data.trips.map((t) => t.destination_name).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, "de")),
    [data.trips],
  );
  const stations = useMemo(
    () => [...new Set(data.trips.flatMap((t) => t.stops.map((s) => s.station_name)))].sort((a, b) => a.localeCompare(b, "de")),
    [data.trips],
  );

  const filterActive = query.trim() !== "" || filters.dest !== "" || filters.station !== "" || filters.status !== "alle";

  const matching = useMemo(
    () =>
      summaries.filter(
        (s) =>
          tripMatchesQuery(s.trip, query) &&
          (!filters.dest || s.trip.destination_name === filters.dest) &&
          (!filters.station || s.trip.stops.some((x) => x.station_name === filters.station)) &&
          matchesStatus(s, filters.status),
      ),
    [summaries, query, filters],
  );

  const listItems = useMemo(
    () =>
      matching
        .filter((s) => !hiddenLines.has(s.trip.line_id))
        .sort(
          (a, b) =>
            STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
            (lineOrder.get(a.trip.line_id) ?? 999) - (lineOrder.get(b.trip.line_id) ?? 999) ||
            a.trip.line_id.localeCompare(b.trip.line_id, "de", { numeric: true }) ||
            (a.nextArr ?? Infinity) - (b.nextArr ?? Infinity),
        ),
    [matching, hiddenLines, lineOrder],
  );

  const vehicleHits = useMemo(() => tripsWithVehicle(data.trips, query), [data.trips, query]);

  const matchIds = useMemo(() => (filterActive ? new Set(matching.map((s) => s.trip.id)) : null), [filterActive, matching]);

  const selected = selectedId ? summaries.find((s) => s.trip.id === selectedId) ?? null : null;
  const selectedTrack = selected
    ? trackCache.get(selected.trip, selected.trip.shape_id != null ? data.shapes.get(selected.trip.shape_id) : null)
    : null;
  const onMapCount = summaries.filter((s) => s.position && !hiddenLines.has(s.trip.line_id)).length;

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (!id) setFollow(false);
  }, []);

  const toggleLine = useCallback((id: string) => {
    setHiddenLines((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setFocusLine((f) => (f === id ? null : f));
  }, []);

  const stale = isStale(data.status, now);

  // Von Panels verdeckte Kartenränder
  const hasSelection = selected != null;
  const [isMobile, setIsMobile] = useState(false);
  const [isWide, setIsWide] = useState(true);
  const [viewportH, setViewportH] = useState(800);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => {
      setIsMobile(mq.matches);
      setIsWide(window.innerWidth >= 1024);
      setViewportH(window.innerHeight);
    };
    update();
    mq.addEventListener("change", update);
    window.addEventListener("resize", update);
    return () => {
      mq.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  const padding = useMemo(() => {
    if (isMobile) {
      const peek = hasSelection ? DETAIL_PEEK_PX : LIST_PEEK_PX;
      const bottom = (hasSelection ? detail.snap : list.snap) === "peek" ? peek : viewportH / 2;
      return { top: TOP_BAR_PX, bottom: Math.round(bottom), left: 0, right: 0 };
    }
    // Schmal (Tablet, Handy quer): die Details ersetzen die Liste
    const listVisible = !collapsed && (isWide || !hasSelection);
    return { top: 0, bottom: 0, left: listVisible ? 384 : 0, right: hasSelection ? 412 : 0 };
  }, [isMobile, isWide, viewportH, hasSelection, list.snap, detail.snap, collapsed]);

  // Kartenhinweise (Quellenangabe) über dem Blatt; bei ganz geöffnetem Blatt verdeckt es ohnehin die Karte
  const active = selected ? detail : list;
  const mapBottom = sheetHeightCss(active.snap === "full" ? "half" : active.snap, selected ? DETAIL_PEEK_PX : LIST_PEEK_PX);

  return (
    <main className="fixed inset-0 overflow-hidden overscroll-none bg-bg text-fg" style={{ ["--map-bottom" as string]: mapBottom }}>
      <LiveMap
        trips={data.trips}
        shapes={data.shapes}
        shapeList={data.shapeList}
        lines={data.lines}
        trackCache={trackCache}
        hiddenLines={hiddenLines}
        focusLine={focusLine}
        matchIds={matchIds}
        selectedId={selectedId}
        follow={follow}
        onSelect={select}
        onFollowChange={setFollow}
        padding={padding}
      />

      {/* Navigation (Handy) */}
      <header className="absolute inset-x-0 top-0 z-20 border-b border-line bg-[var(--panel)] pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
        <div className="page-x flex h-14 flex-col justify-center">
          <AppNav active="karte" />
        </div>
      </header>

      {/* Hinweise oben mittig */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-[calc(4rem+env(safe-area-inset-top))] z-10 flex flex-col items-center gap-1.5 px-3 md:top-24 md:z-30 lg:left-[392px] lg:top-3 lg:right-[420px] ${
          hasSelection ? "md:right-[420px]" : "md:left-[392px]"
        }`}
      >
        {stale && (
          <div className="pointer-events-auto">
            <Banner tone="warn">
              Daten veraltet – letzter erfolgreicher Abruf {data.status?.last_ok ? fmtRelative(data.status.last_ok, now) : "unbekannt"}.
              Positionen können stark abweichen.
            </Banner>
          </div>
        )}
        {data.error && (
          <div className="pointer-events-auto">
            <Banner tone="bad">Verbindung zur Datenquelle gestört. Neuer Versuch automatisch.</Banner>
          </div>
        )}
      </div>

      {/* Datenquellenstatus */}
      <div
        className={`absolute right-[max(0.75rem,env(safe-area-inset-right))] top-3 z-20 hidden flex-col items-end gap-1.5 transition-[right] duration-200 md:flex ${selected ? "md:right-[424px]" : ""}`}
      >
        <SourceStatusBadge status={data.status} tripCount={onMapCount} fetchedAt={data.fetchedAt} error={data.error} now={now} />
        <ScannerBadge status={scanner} now={now} />
      </div>

      {/* Hinweis Schätzung */}
      <div className={`pointer-events-none absolute bottom-3 z-10 hidden text-[10.5px] text-faint lg:block ${collapsed ? "left-3" : "left-[396px]"}`}>
        Alle Zugpositionen sind aus Fahrplan- und Echtzeitzeiten geschätzt – keine GPS-Ortung.
      </div>

      {/* Linke Seitenleiste / Bottom-Sheet */}
      {collapsed ? (
        <div className="absolute left-3 top-3 z-20 hidden items-center gap-3 rounded-lg border border-line bg-[var(--panel)] py-2 pl-3 pr-2 backdrop-blur-md md:flex">
          <AppNav active="karte" />
          <button
            onClick={() => setCollapsed(false)}
            className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-white/5 hover:text-fg"
            aria-label="Seitenleiste ausklappen"
            title="Seitenleiste ausklappen"
          >
            »
          </button>
        </div>
      ) : null}
      <aside
        ref={list.sheetRef}
        style={{ ["--sheet-h" as string]: list.height }}
        className={`absolute inset-x-0 bottom-0 z-20 flex h-[var(--sheet-h)] flex-col overflow-hidden rounded-t-xl border border-line bg-[var(--panel)] backdrop-blur-md md:inset-x-auto md:bottom-3 md:left-[max(0.75rem,env(safe-area-inset-left))] md:top-3 md:h-auto md:w-[372px] md:rounded-lg ${
          list.dragging ? "" : "transition-[height] duration-200"
        } ${collapsed ? "md:hidden" : ""} ${hasSelection ? "max-lg:invisible" : ""}`}
      >
        {/* Griff (Handy): ziehen oder antippen */}
        <div {...list.handleProps} className="shrink-0 touch-none select-none md:hidden">
          <button
            className="flex w-full flex-col items-center gap-2 px-4 pb-0.5 pt-2"
            onClick={list.toggle}
            aria-label={list.snap === "full" ? "Liste verkleinern" : "Liste vergrößern"}
          >
            <span className="h-1 w-9 rounded-full bg-white/25" />
            <SourceStatusBadge status={data.status} tripCount={onMapCount} fetchedAt={data.fetchedAt} error={data.error} now={now} />
          </button>
        </div>
        <div className="hidden items-center gap-2 border-b border-line px-4 pb-2.5 pt-3 md:flex">
          <div className="min-w-0 flex-1">
            <AppNav active="karte" />
          </div>
          <button
            onClick={() => setCollapsed(true)}
            className="hidden h-7 w-7 place-items-center rounded-md text-muted hover:bg-white/5 hover:text-fg md:grid"
            aria-label="Seitenleiste einklappen"
            title="Seitenleiste einklappen"
          >
            «
          </button>
        </div>
        <div
          className="min-h-0 flex-1"
          onFocus={(e) => {
            // Suchfeld nach oben holen, damit die Tastatur die Treffer nicht verdeckt
            if (e.target instanceof HTMLInputElement) list.setSnap("full");
            else if (list.snap === "peek") list.setSnap("half");
          }}
        >
          <Sidebar
            query={query}
            onQuery={setQuery}
            lines={lineInfos}
            hiddenLines={hiddenLines}
            onToggleLine={toggleLine}
            focusLine={focusLine}
            onFocusLine={setFocusLine}
            filters={filters}
            onFilters={setFilters}
            destinations={destinations}
            stations={stations}
            items={listItems}
            totalCount={summaries.length}
            selectedId={selectedId}
            onSelect={select}
            lineStyle={lineStyle}
            loading={data.loading}
            vehicleHits={vehicleHits}
            scan={<ScanNowButton status={scanner} apply={applyScanner} now={now} onFinished={data.refresh} />}
          />
        </div>
      </aside>

      {/* Rechtes Detailpanel / Sheet */}
      {selected && (
        <aside
          key={selected.trip.id}
          ref={detail.sheetRef}
          style={{ ["--sheet-h" as string]: detail.height }}
          className={`anim-in absolute inset-x-0 bottom-0 z-30 h-[var(--sheet-h)] overflow-hidden rounded-t-xl border border-line bg-[var(--panel)] backdrop-blur-md md:inset-x-auto md:bottom-3 md:right-[max(0.75rem,env(safe-area-inset-right))] md:top-3 md:h-auto md:w-[400px] md:rounded-lg ${
            detail.dragging ? "" : "transition-[height] duration-200"
          }`}
        >
          <TrainDetail
            key={selected.trip.id}
            summary={selected}
            track={selectedTrack}
            lineStyle={lineStyle(selected.trip.line_id)}
            scanner={scanner}
            now={now}
            follow={follow}
            onFollow={setFollow}
            onClose={() => select(null)}
            onReported={data.refresh}
            handleProps={detail.handleProps}
            onHandleTap={detail.toggle}
          />
        </aside>
      )}
    </main>
  );
}
