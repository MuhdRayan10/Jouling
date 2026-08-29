export const JOULING_QR_PROTOCOL = "jouling.mission";
export const JOULING_QR_VERSION = "1";

function required(value, label) {
  const clean = String(value || "").trim();
  if (!clean) throw new Error(`${label} is required for a Jouling QR`);
  return clean;
}

export function buildJoulingQrPayload({ missionId, token }) {
  return JSON.stringify({
    protocol: JOULING_QR_PROTOCOL,
    v: Number(JOULING_QR_VERSION),
    mission: required(missionId, "Mission ID"),
    token: required(token, "Mission token")
  });
}

export function buildJoulingQrLink({ origin, missionId, token }) {
  const url = new URL("/", required(origin, "App origin"));
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("App origin must be an http or https URL");
  }
  url.searchParams.set("protocol", JOULING_QR_PROTOCOL);
  url.searchParams.set("v", JOULING_QR_VERSION);
  url.searchParams.set("mission", required(missionId, "Mission ID"));
  url.searchParams.set("token", required(token, "Mission token"));
  return url.toString();
}

function validateVersion(url, inferredProtocol) {
  const protocol = url.searchParams.get("protocol") || inferredProtocol;
  const version = url.searchParams.get("v") || (inferredProtocol ? JOULING_QR_VERSION : null);
  if (protocol && protocol !== JOULING_QR_PROTOCOL && protocol !== "ghostgrid.mission") {
    throw new Error("This QR uses an unsupported Jouling protocol");
  }
  if (version && version !== JOULING_QR_VERSION) {
    throw new Error(`This QR uses unsupported protocol version ${version}`);
  }
  return { protocol: protocol || "legacy-web-link", version: version || "legacy" };
}

function parseJsonPayload(value) {
  if (!value.startsWith("{")) return null;
  let payload;
  try {
    payload = JSON.parse(value);
  } catch {
    throw new Error("This QR contains invalid JSON");
  }
  if (!payload || Array.isArray(payload) || typeof payload !== "object") return null;
  const looksLikeJouling = payload.protocol || payload.mission || payload.missionId || payload.token;
  if (!looksLikeJouling) return null;

  const protocol = required(payload.protocol, "Protocol");
  const version = required(payload.v ?? payload.version, "Protocol version");
  if (protocol !== JOULING_QR_PROTOCOL && protocol !== "ghostgrid.mission") {
    throw new Error("This QR uses an unsupported Jouling protocol");
  }
  if (version !== JOULING_QR_VERSION) {
    throw new Error(`This QR uses unsupported protocol version ${version}`);
  }
  return {
    missionId: required(payload.mission ?? payload.missionId, "Mission ID"),
    token: required(payload.token, "Mission token"),
    protocol,
    version
  };
}

export function parseJoulingQrPayload(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) throw new Error("QR code was empty");

  const jsonPayload = parseJsonPayload(value);
  if (jsonPayload) return jsonPayload;

  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol === "jouling:" || url.protocol === "ghostgrid:") {
    if (url.hostname !== "mission") throw new Error("This is not a Jouling mission QR");
    const metadata = validateVersion(url, url.protocol === "jouling:" ? JOULING_QR_PROTOCOL : "ghostgrid.mission");
    return {
      missionId: required(url.pathname.replace(/^\/+/, ""), "Mission ID"),
      token: required(url.searchParams.get("token"), "Mission token"),
      ...metadata
    };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const missionId = url.searchParams.get("mission");
  const token = url.searchParams.get("token");
  if (!missionId && !token) return null;
  const metadata = validateVersion(url, null);
  return {
    missionId: required(missionId, "Mission ID"),
    token: required(token, "Mission token"),
    ...metadata
  };
}
