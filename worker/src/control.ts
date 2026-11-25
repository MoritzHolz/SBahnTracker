// Verbindung zu Supabase: nur die scanner_worker_*-Funktionen, abgesichert mit eigenem Secret (kein service_role-Key).

function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Umgebungsvariable ${name} fehlt (worker/.env, siehe docs/scanner.md).`);
    process.exit(2);
  }
  return v;
}

const URL_ = env("SUPABASE_URL");
const KEY = env("SUPABASE_ANON_KEY");
const SECRET = env("SCANNER_WORKER_SECRET");

export interface Page {
  id: string;
  kind: "board" | "formation";
  label: string;
  url: string;
  station_id: string;
  station_name: string;
  only_lines?: string[];
}

export interface Control {
  ok: boolean;
  error?: string;
  enabled: boolean;
  interval_min: number;
  formations_enabled: boolean;
  pages: Page[] | null;
  /** Ende des Zeitfensters, solange der Zeitplan den Rechner wach halten soll */
  keep_awake_until?: string | null;
  due: "interval" | "manual" | null;
  abort: boolean;
}

export async function rpc<T>(fn: string, args: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
  const res = await fetch(`${URL_}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_secret: SECRET, ...args }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${fn}: HTTP ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}
