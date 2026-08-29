import { createServer as createHttpServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { apiContract } from "./contract.mjs";
import { JoulingStore } from "./store.mjs";
import { PhotoVerifier } from "./verifier.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const PUBLIC_DIR = resolve(HERE, "../public");
const MAPLIBRE_DIST_DIR = resolve(HERE, "../node_modules/maplibre-gl/dist");
const MAX_JSON_BYTES = 7 * 1024 * 1024;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(body);
}

async function readJson(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_JSON_BYTES) throw Object.assign(new Error("Request body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), { statusCode: 400 });
  }
}

async function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const vendorPrefix = "/vendor/maplibre-gl/";
  const rootDirectory = pathname.startsWith(vendorPrefix) ? MAPLIBRE_DIST_DIR : PUBLIC_DIR;
  const relativePath = pathname.startsWith(vendorPrefix) ? pathname.slice(vendorPrefix.length) : pathname.replace(/^\/+/, "");
  const safePath = normalize(relativePath);
  if (isAbsolute(safePath) || safePath === ".." || safePath.startsWith(`..${sep}`)) return false;
  let filePath = resolve(join(rootDirectory, safePath));
  if (filePath !== rootDirectory && !filePath.startsWith(`${rootDirectory}${sep}`)) return false;
  try {
    let fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = join(filePath, "index.html");
      fileStat = await stat(filePath);
    }
    const body = await readFile(filePath);
    const extension = extname(filePath);
    const sourceAsset = [".html", ".css", ".js", ".mjs"].includes(extension);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extension] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": sourceAsset ? "no-cache" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "Permissions-Policy": "camera=(self), geolocation=(self)",
      "Content-Security-Policy": "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; media-src 'self' blob:; style-src 'self'; script-src 'self'; connect-src 'self' https://tile.openstreetmap.org; worker-src 'self' blob:; font-src 'self'; frame-ancestors 'none'"
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

export function createJoulingRequestHandler({ store = new JoulingStore(), verifier = new PhotoVerifier() } = {}) {
  return async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        return sendJson(res, 200, {
          ok: true,
          persistenceMode: store.persistenceMode || "memory",
          verifierMode: verifier.apiKey ? "openai" : (verifier.demoMode ? "demo" : "unavailable"),
          visionModel: verifier.apiKey ? verifier.model : null
        });
      }
      if (req.method === "GET" && url.pathname === "/api/openapi.json") {
        return sendJson(res, 200, apiContract);
      }
      if (req.method === "GET" && url.pathname === "/api/state") {
        return sendJson(res, 200, await store.bootstrap(url.searchParams.get("userId") || "u-demo"));
      }
      if (req.method === "GET" && url.pathname === "/api/leaderboard") {
        return sendJson(res, 200, { teams: await store.leaderboard() });
      }
      if (req.method === "POST" && url.pathname === "/api/session") {
        const body = await readJson(req);
        return sendJson(res, 201, await store.createSession(body));
      }
      if (req.method === "POST" && url.pathname === "/api/teams/join") {
        const body = await readJson(req);
        return sendJson(res, 200, await store.joinTeam(body));
      }
      if (req.method === "POST" && url.pathname === "/api/teams") {
        const body = await readJson(req);
        return sendJson(res, 201, await store.createTeam(body));
      }

      const scanMatch = url.pathname.match(/^\/api\/missions\/([^/]+)\/scan$/);
      if (req.method === "POST" && scanMatch) {
        const body = await readJson(req);
        const result = await store.scanMission({ ...body, missionId: decodeURIComponent(scanMatch[1]) });
        return sendJson(res, 201, result);
      }

      const verifyMatch = url.pathname.match(/^\/api\/attempts\/([^/]+)\/verify$/);
      if (req.method === "POST" && verifyMatch) {
        const body = await readJson(req);
        const attempt = await store.getAttempt(decodeURIComponent(verifyMatch[1]));
        const mission = await store.findMission(attempt.missionId);
        const verification = await verifier.verify({
          mission,
          imageDataUrl: body.imageDataUrl,
          userId: attempt.userId
        });
        return sendJson(res, 200, await store.completeAttempt(attempt.id, verification));
      }

      if (url.pathname.startsWith("/api/")) {
        return sendJson(res, 404, { error: { code: "not_found", message: "API route not found" } });
      }
      if (req.method === "GET" && await serveStatic(req, res, url)) return;
      sendJson(res, 404, { error: { code: "not_found", message: "Page not found" } });
    } catch (error) {
      const statusCode = Number(error.statusCode) || 500;
      if (statusCode >= 500) console.error(error);
      sendJson(res, statusCode, {
        error: {
          code: statusCode >= 500 ? "server_error" : "request_error",
          message: statusCode >= 500 ? (error.message || "Unexpected server error") : error.message
        }
      });
    }
  };
}

export function createJoulingServer(options = {}) {
  return createHttpServer(createJoulingRequestHandler(options));
}
