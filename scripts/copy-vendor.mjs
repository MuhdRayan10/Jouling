import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The local dev server maps /vendor/* onto node_modules at request time. Static
// hosts (Vercel) only ship public/, so the browser bundles are copied in here.
const HERE = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(import.meta.url);
const VENDOR_DIR = resolve(HERE, "../public/vendor");
const dependencyPath = (specifier, packageName) => {
  try {
    return require.resolve(specifier);
  } catch (error) {
    throw new Error(`${packageName} is not installed. Run npm install after pulling or merging dependency changes.`, { cause: error });
  }
};
const MAPLIBRE_PACKAGE = dependencyPath("maplibre-gl/package.json", "maplibre-gl");
const MAPLIBRE_SOURCE = resolve(dirname(MAPLIBRE_PACKAGE), "dist");
const MAPLIBRE_TARGET = resolve(VENDOR_DIR, "maplibre-gl");
const JSQR_SOURCE = dependencyPath("jsqr", "jsqr");
const JSQR_TARGET = resolve(VENDOR_DIR, "jsqr/jsqr.mjs");

// Validate and read every dependency before replacing the last successful
// vendor bundle. This keeps a stale node_modules error from leaving public/
// with a half-copied build.
await stat(MAPLIBRE_SOURCE);
const jsqrSource = await readFile(JSQR_SOURCE, "utf8");

await rm(VENDOR_DIR, { recursive: true, force: true });
await mkdir(MAPLIBRE_TARGET, { recursive: true });
await cp(MAPLIBRE_SOURCE, MAPLIBRE_TARGET, { recursive: true });
console.log(`Copied maplibre-gl dist -> ${MAPLIBRE_TARGET}`);

// jsQR ships a UMD bundle only. Wrap it so it can be lazily imported as an ES
// module by the Safari QR fallback, which has no BarcodeDetector to use.
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
