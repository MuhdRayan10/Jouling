#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import QRCode from "qrcode";
import { buildJoulingQrPayload, JOULING_QR_PROTOCOL, JOULING_QR_VERSION } from "../public/qr-protocol.js";
import { createSeedState } from "../server/seed.mjs";

function readArgs(argv) {
  const values = { origin: process.env.JOULING_APP_ORIGIN || "http://localhost:4173", format: "svg" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--all" || argument === "--list" || argument === "--help") values[argument.slice(2)] = true;
    else if (argument.startsWith("--")) values[argument.slice(2)] = argv[++index];
  }
  return values;
}

function printHelp() {
  console.log(`Jouling QR generator

Usage:
  npm run qr -- --mission mission-library-ac
  npm run qr -- --all --origin https://jouling.example
  npm run qr -- --mission mission-library-ac --output labels/library-ac.png --format png

Options:
  --mission <id|code>  Mission ID or short code from the seed configuration
  --all                Generate one QR for every configured mission
  --origin <url>       Public Jouling app origin (default: http://localhost:4173)
  --output <path>      Output path for a single mission
  --format <svg|png>   QR image format (default: svg)
  --list               List available mission IDs and codes
  --help               Show this help`);
}

function safeFileName(mission) {
  return mission.code.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function generate(mission, options, multiple) {
  const format = String(options.format || "svg").toLowerCase();
  if (!new Set(["svg", "png"]).has(format)) throw new Error("--format must be svg or png");
  const payload = buildJoulingQrPayload({
    origin: options.origin,
    missionId: mission.id,
    token: mission.qrToken
  });
  const output = resolve(options.output && !multiple
    ? options.output
    : `generated-qr/${safeFileName(mission)}.${format}`);
  await mkdir(dirname(output), { recursive: true });
  await QRCode.toFile(output, payload, {
    type: format,
    errorCorrectionLevel: "M",
    margin: 4,
    width: format === "png" ? 900 : undefined,
    color: { dark: "#173728", light: "#FFFFFF" }
  });
  console.log(`Generated ${mission.code} → ${output} (${JOULING_QR_PROTOCOL} v${JOULING_QR_VERSION})`);
}

const options = readArgs(process.argv.slice(2));
const missions = createSeedState().missions;

if (options.help) {
  printHelp();
} else if (options.list) {
  for (const mission of missions) console.log(`${mission.id.padEnd(30)} ${mission.code.padEnd(12)} ${mission.location}`);
} else {
  const selected = options.all
    ? missions
    : missions.filter((mission) => mission.id === options.mission || mission.code.toUpperCase() === String(options.mission || "").toUpperCase());
  if (!selected.length) {
    printHelp();
    throw new Error("Choose a configured mission with --mission, or use --all");
  }
  for (const mission of selected) await generate(mission, options, selected.length > 1);
}
