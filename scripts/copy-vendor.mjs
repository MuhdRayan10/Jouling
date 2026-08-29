import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The local dev server maps /vendor/maplibre-gl/* onto node_modules at request
// time. Static hosts (Vercel) only ship public/, so copy the dist bundle in.
const HERE = fileURLToPath(new URL(".", import.meta.url));
const SOURCE = resolve(HERE, "../node_modules/maplibre-gl/dist");
const TARGET = resolve(HERE, "../public/vendor/maplibre-gl");

await rm(TARGET, { recursive: true, force: true });
await mkdir(TARGET, { recursive: true });
await cp(SOURCE, TARGET, { recursive: true });

console.log(`Copied maplibre-gl dist -> ${TARGET}`);
