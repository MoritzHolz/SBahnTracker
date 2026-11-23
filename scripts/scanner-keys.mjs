// Erzeugt Steuerschlüssel (Dashboard) und Worker-Secret. Klartext landet nur in worker/.env (nicht im Git).
// Ausgegeben wird nur SQL mit SHA-256-Hashes zum Einfügen im Supabase SQL Editor.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../worker/.env", import.meta.url));
if (existsSync(file) && !process.argv.includes("--force")) {
  console.error("worker/.env existiert bereits. Mit --force neu erzeugen (alte Schlüssel werden ungültig).");
  process.exit(1);
}
const example = fileURLToPath(new URL("../.env.example", import.meta.url));
const pub = Object.fromEntries(
  readFileSync(example, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const raw = [...randomBytes(16)].map((b) => ALPHA[b % ALPHA.length]).join("");
const controlKey = raw.match(/.{4}/g).join("-");
const workerSecret = randomBytes(32).toString("hex");
const sha = (v) => createHash("sha256").update(v, "utf8").digest("hex");

writeFileSync(
  file,
  `SUPABASE_URL=${pub.NEXT_PUBLIC_SUPABASE_URL}
SUPABASE_ANON_KEY=${pub.NEXT_PUBLIC_SUPABASE_ANON_KEY}
SCANNER_WORKER_SECRET=${workerSecret}
# Steuerschlüssel fürs Dashboard (/scanner). Wird vom Worker nicht benötigt.
SCANNER_CONTROL_KEY=${controlKey}
`,
  { mode: 0o600 },
);
console.log(`insert into private.app_config (key, value) values
  ('scanner_control_hash', '${sha(controlKey)}'),
  ('scanner_worker_hash', '${sha(workerSecret)}')
on conflict (key) do update set value = excluded.value;`);
