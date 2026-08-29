import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The local dev server maps /vendor/* onto node_modules at request time. Static
// hosts (Vercel) only ship public/, so the browser bundles are copied in here.
const HERE = fileURLToPath(new URL(".", import.meta.url));
const VENDOR_DIR = resolve(HERE, "../public/vendor");
const MAPLIBRE_SOURCE = resolve(HERE, "../node_modules/maplibre-gl/dist");
const MAPLIBRE_TARGET = resolve(VENDOR_DIR, "maplibre-gl");
const JSQR_SOURCE = resolve(HERE, "../node_modules/jsqr/dist/jsQR.js");
const JSQR_TARGET = resolve(VENDOR_DIR, "jsqr/jsqr.mjs");

await rm(VENDOR_DIR, { recursive: true, force: true });
await mkdir(MAPLIBRE_TARGET, { recursive: true });
await cp(MAPLIBRE_SOURCE, MAPLIBRE_TARGET, { recursive: true });
console.log(`Copied maplibre-gl dist -> ${MAPLIBRE_TARGET}`);

// jsQR ships a UMD bundle only. Wrap it so it can be lazily imported as an ES
// module by the Safari QR fallback, which has no BarcodeDetector to use.
const jsqrSource = await readFile(JSQR_SOURCE, "utf8");
await mkdir(resolve(VENDOR_DIR, "jsqr"), { recursive: true });
await writeFile(
  JSQR_TARGET,
  `const jsQRModule = (() => {\n` +
    `const module = { exports: {} };\n` +
    `const exports = module.exports;\n` +
    `${jsqrSource}\n` +
    `return module.exports;\n` +
    `})();\n` +
    `export default jsQRModule.default || jsQRModule;\n`
);
console.log(`Wrapped jsqr as ESM -> ${JSQR_TARGET}`);
