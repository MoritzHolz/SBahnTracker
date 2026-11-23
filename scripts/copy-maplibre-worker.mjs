// Kopiert den MapLibre-Web-Worker nach public/, da Bundler import.meta.url
// umschreiben und MapLibre den Worker sonst nicht findet (siehe src/components/map/maplibre.ts).
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
const destDir = join(root, "public/maplibre");
mkdirSync(destDir, { recursive: true });
copyFileSync(src, join(destDir, "maplibre-gl-worker.mjs"));
console.log("maplibre-gl-worker.mjs → public/maplibre/");
