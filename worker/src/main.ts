// Live-Webscanner. Läuft im Leerlauf ohne Browser und fragt nur den Schalter in Supabase ab.
// Chromium startet ausschließlich für einen erlaubten Scan und wird danach immer beendet.
import { chromium, type Browser } from "playwright";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { KeepAwake, SleepDetector, sleepReason } from "./awake.ts";
import { rpc, type Control, type Page } from "./control.ts";
import { inWindow, toBoardRecord, type BoardRecord } from "./parse.ts";
import { isAllowed, loadRobots } from "./robots.ts";
import { BahnExpertBoard, readDbfBoard, SiteBlocked } from "./sites.ts";

const WORKER_ID = `${hostname().split(".")[0]}-${randomUUID().slice(0, 8)}`;
const IDLE_POLL_MS = 5_000;
const SCAN_POLL_MS = 2_000;
/** Ein kompletter Scan aller fahrenden Züge (rund 45) dauert etwa 4 min */
const SCAN_TIMEOUT_MS = 12 * 60_000;
/** Danach wird keine weitere Wagenreihung begonnen; der Rest folgt beim nächsten Scan */
const FORMATION_BUDGET_MS = 10 * 60_000;
/** So lange darf der Schalter während eines Scans unerreichbar sein. Danach wird abgebrochen. */
const CONTROL_LOST_MS = 20_000;
/** So lange muss der Takt (2 s) ausbleiben, damit das als Ruhezustand gilt */
const SLEEP_GAP_MS = 20_000;
const MAX_FORMATIONS = 70;
const MIN_GAP_MS = 4_000;
/** Nur diese Seiten dürfen gelesen werden, auch wenn die Konfiguration etwas anderes enthält. */
const ALLOWED_HOSTS: Record<Page["kind"], string> = { board: "dbf.finalrewind.org", formation: "bahn.expert" };
const UA_SUFFIX = "sbahn-stuttgart-scanner/0.1 (privat, nichtkommerziell)";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      res();
    }
    signal?.addEventListener("abort", done);
  });

class Aborted extends Error {}
const keepAwake = new KeepAwake();
let stopping = false;
const stopCtl = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    stopping = true;
    stopCtl.abort();
  });
}

// Vom Webserver gestartet (Knopf „Jetzt scannen“): endet mit ihm
if (process.env.SCANNER_EXIT_WITH_PARENT === "1") {
  const stop = () => {
    stopping = true;
    stopCtl.abort();
  };
  process.stdin.on("end", stop).on("close", stop).on("error", stop).resume();
}

const shortError = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n")[0].slice(0, 300);

const lastAccess = new Map<string, number>();

async function scan(runId: number, control: Control): Promise<void> {
  const abort = new AbortController();
  let reason = "";
  const cancel = (why: string) => {
    if (!abort.signal.aborted) {
      reason = why;
      abort.abort();
    }
  };
  const onStop = () => cancel("Worker wird beendet");
  stopCtl.signal.addEventListener("abort", onStop);
  let step = "Browser wird gestartet";
  let url: string | null = null;
  let browser: Browser | null = null;

  // Herzschlag: überwacht den Schalter während des Scans
  let lastOk = Date.now();
  let beating = false;
  const sleepDetector = new SleepDetector(SLEEP_GAP_MS);
  const checkSleep = () => {
    const gap = sleepDetector.tick();
    if (gap > 0) cancel(sleepReason(gap));
  };
  const beat = async () => {
    // zuerst prüfen: nach dem Aufwachen sind auch alle anderen Zeitlimits abgelaufen
    checkSleep();
    if (beating) return;
    beating = true;
    try {
      const c = await rpc<Control>("scanner_worker_poll", { p_worker_id: WORKER_ID, p_run_id: runId, p_step: step, p_url: url }, 8_000);
      if (c.ok) lastOk = Date.now();
      if (!c.ok || c.abort) cancel("Scanner wurde ausgeschaltet");
    } catch {
      if (Date.now() - lastOk > CONTROL_LOST_MS) cancel("Verbindung zur Steuerung verloren");
    } finally {
      beating = false;
    }
  };
  const beatTimer = setInterval(beat, SCAN_POLL_MS);
  const timeout = setTimeout(() => {
    checkSleep();
    cancel("Zeitüberschreitung (12 min)");
  }, SCAN_TIMEOUT_MS);
  // Abbruch schließt den Browser; laufende Playwright-Aufrufe enden dadurch sofort
  abort.signal.addEventListener("abort", () => void browser?.close().catch(() => {}));
  const check = () => {
    checkSleep();
    if (abort.signal.aborted) throw new Aborted(reason);
  };

  const problems: string[] = [];
  let boardsOk = 0;
  const planned = new Map<string, string>();
  const lineOf = new Map<string, string>();
  const startedAt = Date.now();

  const visit = async (page: Page, ua: string) => {
    const target = new URL(page.url);
    if (target.protocol !== "https:" || target.host !== ALLOWED_HOSTS[page.kind]) throw new SiteBlocked(`${target.host} ist nicht freigegeben.`);
    const robots = await loadRobots(target.origin, ua, abort.signal);
    if (!isAllowed(robots, target.pathname + target.search)) throw new SiteBlocked(`${target.host}: robots.txt untersagt den Abruf.`);
    const gap = Math.max(MIN_GAP_MS, robots.crawlDelaySec * 1000);
    const wait = (lastAccess.get(target.host) ?? 0) + gap - Date.now();
    if (wait > 0) {
      step = `Wartet ${Math.ceil(wait / 1000)} s (Abstandsregel von ${target.host})`;
      await sleep(wait, abort.signal);
    }
    check();
    lastAccess.set(target.host, Date.now());
    step = page.label;
    url = page.url;
    void beat();
  };

  try {
    void beat();
    browser = await chromium.launch({ headless: true });
    check();
    const probe = await browser.newPage();
    const ua = `${await probe.evaluate(() => navigator.userAgent)} ${UA_SUFFIX}`;
    await probe.close();
    const ctx = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin", userAgent: ua, viewport: { width: 1280, height: 900 } });

    const pages = control.pages ?? [];
    for (const page of pages.filter((p) => p.kind === "board")) {
      try {
        await visit(page, ua);
        const rows = await readDbfBoard(ctx, page.url);
        const now = Date.now();
        const records: BoardRecord[] = rows
          .map((r) => toBoardRecord(r, page.station_name, now))
          .filter((r): r is BoardRecord => r !== null && inWindow(r, now) && (!page.only_lines || (r.line !== null && page.only_lines.includes(r.line))));
        const hour = Number(new Intl.DateTimeFormat("de-DE", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Berlin" }).format(now).replace(/\D/g, ""));
        if (records.length === 0 && !page.only_lines && hour >= 5) {
          throw new Error(`${page.label}: keine S-Bahn-Fahrten erkannt (Sperrung oder umgebaute Seite).`);
        }
        check();
        const res = await rpc<{ ok: boolean; error?: string; captured: number; new: number; updated: number; skipped: number }>("scanner_worker_ingest", {
          p_run_id: runId, p_page: { ...page, source: new URL(page.url).host }, p_records: records,
        });
        if (!res.ok) throw new Aborted("Scanner wurde ausgeschaltet");
        if (res.skipped > 0) problems.push(`${page.label}: ${res.skipped} Datensätze nicht verwertbar`);
        for (const r of records) {
          planned.set(r.train_number, (r.dep_planned ?? r.arr_planned)!);
          if (r.line) lineOf.set(r.train_number, r.line);
        }
        boardsOk++;
        log(`Lauf ${runId}: ${page.label}: ${rows.length} Zeilen, ${res.captured} S-Bahnen (${res.new} neu, ${res.updated} aktualisiert)`);
      } catch (e) {
        check();
        if (e instanceof Aborted) throw e;
        problems.push(`${page.label}: ${shortError(e)}`);
      }
    }

    if (control.formations_enabled && boardsOk > 0) {
      for (const page of pages.filter((p) => p.kind === "formation")) {
        let board: BahnExpertBoard | null = null;
        try {
          // Seite nur öffnen, wenn überhaupt noch Wagenreihungen fehlen.
          // Die Datenbank liefert die Reihenfolge: S1, S2, S3, danach die übrigen Linien
          let targets = await rpc<string[] | null>("scanner_worker_formation_targets", { p_run_id: runId, p_trains: [...planned.keys()], p_limit: MAX_FORMATIONS });
          if (targets === null) throw new Aborted("Scanner wurde ausgeschaltet");
          if (targets.length === 0) continue;
          await visit(page, ua);
          board = await BahnExpertBoard.open(ctx, page.url);
          const visible = new Set(await board.trainNumbers());
          const unlisted = targets.filter((t) => !visible.has(t));
          if (unlisted.length) log(`Lauf ${runId}: nicht auf ${new URL(page.url).host} gelistet: ${unlisted.map((t) => `${lineOf.get(t) ?? "?"} ${t}`).join(", ")}`);
          targets = targets.filter((t) => visible.has(t));
          let found = 0;
          let failed = 0;
          for (const [i, no] of targets.entries()) {
            check();
            if (Date.now() - startedAt > FORMATION_BUDGET_MS) {
              problems.push(`Zeit reichte nicht: ${targets.length - i} Züge folgen beim nächsten Scan`);
              break;
            }
            step = `${lineOf.get(no) ?? "S-Bahn"}: Wagenreihung S ${no} (${i + 1}/${targets.length})`;
            try {
              const units = await board.readFormation(no);
              check();
              const res = await rpc<{ ok: boolean; error?: string; stored?: boolean }>("scanner_worker_ingest_formation", {
                p_run_id: runId, p_page: page, p_train: no, p_planned: planned.get(no),
                p_vehicles: units.length ? units.map((u) => u.unit) : null, p_groups: units.length ? units : null,
              });
              if (!res.ok && res.error === "aborted") throw new Aborted("Scanner wurde ausgeschaltet");
              if (res.stored) found++;
              failed = 0;
            } catch (e) {
              check();
              if (e instanceof Aborted) throw e;
              problems.push(`Wagenreihung S ${no}: ${shortError(e)}`);
              if (++failed >= 3) throw new Error("drei Züge hintereinander nicht lesbar, Rest übersprungen");
            }
            await sleep(MIN_GAP_MS, abort.signal);
          }
          log(`Lauf ${runId}: ${found} von ${targets.length} Wagenreihungen gelesen`);
        } catch (e) {
          check();
          if (e instanceof Aborted) throw e;
          problems.push(`${page.label}: ${shortError(e)}`);
        } finally {
          await board?.close();
        }
      }
    }
    check();
    step = "Scan wird abgeschlossen";
    const status = boardsOk === 0 ? "error" : problems.length ? "partial" : "ok";
    await finish(runId, status, problems.length ? problems.join(" | ") : null);
  } catch (e) {
    checkSleep();
    const aborted = e instanceof Aborted || abort.signal.aborted;
    const isTimeout = aborted && reason.startsWith("Zeit");
    await finish(runId, aborted && !isTimeout ? "aborted" : "error", aborted ? reason : shortError(e));
  } finally {
    clearInterval(beatTimer);
    clearTimeout(timeout);
    stopCtl.signal.removeEventListener("abort", onStop);
    await browser?.close().catch(() => {});
    while (beating) await sleep(50);
  }
}

async function finish(runId: number, status: string, error: string | null): Promise<void> {
  for (let i = 0; i < 4; i++) {
    try {
      await rpc("scanner_worker_finish", { p_run_id: runId, p_status: status, p_error: error });
      log(`Lauf ${runId}: ${status}${error ? ` (${error})` : ""}`);
      return;
    } catch (e) {
      log(`Abschluss von Lauf ${runId} nicht gemeldet: ${shortError(e)}`);
      await sleep(2_000);
    }
  }
}

log(`Webscanner-Worker ${WORKER_ID} bereit. Wartet auf den Schalter.`);
let lastMsg = "";
while (!stopping) {
  try {
    const c = await rpc<Control>("scanner_worker_poll", { p_worker_id: WORKER_ID });
    const msg = !c.ok ? "Ein anderer Worker ist aktiv." : c.enabled ? "Scanner EIN" : "Scanner AUS";
    if (msg !== lastMsg) log((lastMsg = msg));
    if (c.ok && c.due) {
      const runId = await rpc<number | null>("scanner_worker_start", { p_worker_id: WORKER_ID, p_trigger: c.due });
      if (runId !== null) {
        log(`Lauf ${runId} gestartet (${c.due})`);
        // Nur für die Dauer des Scans. Dauerhaft wach hält ausschließlich der Schalter (worker/mac.sh wach ein)
        keepAwake.hold(true);
        try {
          await scan(runId, c);
        } finally {
          keepAwake.hold(false);
        }
      }
    }
  } catch (e) {
    const msg = `Steuerung nicht erreichbar: ${shortError(e)}`;
    if (msg !== lastMsg) log((lastMsg = msg));
  }
  await sleep(IDLE_POLL_MS, stopCtl.signal);
}
log("Worker beendet.");
process.stdin.destroy();
