// Scanner-Steuerung ohne Schlüsseleingabe, nur im Entwicklungsserver auf dem eigenen Rechner.
// Der Schlüssel bleibt auf dem Server (worker/.env). Ein Worker startet ausschließlich auf Knopfdruck, nie beim Öffnen der Seite.
import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isLocalRequest } from "@/lib/localRequest";
import { scannerControl, type ScannerAction } from "@/lib/scanner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: ScannerAction[] = ["check", "enable", "disable", "scan_now", "set_interval", "set_formations"];
const WORKER_DIR = path.join(process.cwd(), "worker");

const store = globalThis as unknown as { scannerWorker?: ChildProcess };

async function controlKey(): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null;
  try {
    const env = await readFile(path.join(WORKER_DIR, ".env"), "utf8");
    return env.match(/^SCANNER_CONTROL_KEY=(.+)$/m)?.[1].trim() ?? null;
  } catch {
    return null;
  }
}

function startWorker(): void {
  const running = store.scannerWorker;
  if (running && running.exitCode === null && running.signalCode === null) return;
  // Offene stdin-Pipe: endet der Webserver, beendet sich auch der Worker.
  // Next.js setzt eigene Variablen (u. a. NODE_OPTIONS), die der Worker nicht erben soll.
  const child = spawn(process.execPath, ["--env-file=.env", "src/main.ts"], {
    cwd: WORKER_DIR,
    stdio: ["pipe", "inherit", "inherit"],
    env: { ...process.env, NODE_OPTIONS: "", SCANNER_EXIT_WITH_PARENT: "1" },
  });
  child.on("error", (e) => console.error("Webscanner-Worker nicht gestartet:", e.message));
  store.scannerWorker = child;
}

export async function GET(req: Request) {
  const local = isLocalRequest(req.headers, false) && (await controlKey()) !== null;
  return Response.json({ local });
}

export async function POST(req: Request) {
  const key = isLocalRequest(req.headers, true) ? await controlKey() : null;
  if (!key) return Response.json({ error: "Nicht verfügbar." }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: ScannerAction; value?: number } | null;
  const action = body?.action;
  const value = body?.value;
  if (!action || !ACTIONS.includes(action) || (value !== undefined && !Number.isInteger(value))) {
    return Response.json({ error: "Unbekannte Aktion." }, { status: 400 });
  }
  try {
    const status = await scannerControl(key, action, value);
    if ((action === "scan_now" || action === "enable") && !status.worker_online) startWorker();
    return Response.json({ status });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
