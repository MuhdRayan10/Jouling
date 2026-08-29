import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { createGhostGridServer } from "../server/app.mjs";
import { GhostGridStore } from "../server/store.mjs";
import { PhotoVerifier } from "../server/verifier.mjs";
import { calculateAvoidedKwh, territoryProgress } from "../server/logic.mjs";

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

async function withServer(run, options = {}) {
  const store = options.store || new GhostGridStore();
  const verifier = options.verifier || new PhotoVerifier({ apiKey: null, demoMode: true });
  const server = createGhostGridServer({ store, verifier });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run({ baseUrl: `http://127.0.0.1:${port}`, store });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function json(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  return { response, payload: await response.json() };
}

test("bootstrap returns the map, current team, and competition state", async () => {
  await withServer(async ({ baseUrl }) => {
    const { response, payload } = await json(baseUrl, "/api/state?userId=u-demo");
    assert.equal(response.status, 200);
    assert.equal(payload.user.id, "u-demo");
    assert.equal(payload.team.id, "team-green");
    assert.equal(payload.missions.length, 6);
    assert.equal(payload.territories.length, 2);
    assert.equal(payload.territories[0].progress.completed, 2);
    assert.equal(payload.missions[0].qrToken, undefined, "QR secrets must not be exposed in bootstrap state");
  });
});

test("joining a team by invite code updates the participant and leaderboard", async () => {
  await withServer(async ({ baseUrl }) => {
    const { response, payload } = await json(baseUrl, "/api/teams/join", {
      method: "POST",
      body: JSON.stringify({ userId: "u-demo", teamCode: "WATTS4" })
    });
    assert.equal(response.status, 200);
    assert.equal(payload.team.id, "team-blue");
    assert.equal(payload.user.teamId, "team-blue");
    assert.equal(payload.team.memberCount, 8);
  });
});

test("creating a team makes its creator a competing member", async () => {
  await withServer(async ({ baseUrl }) => {
    const { response, payload } = await json(baseUrl, "/api/teams", {
      method: "POST",
      body: JSON.stringify({ userId: "u-demo", name: "Grid Guardians" })
    });
    assert.equal(response.status, 201);
    assert.equal(payload.team.name, "Grid Guardians");
    assert.equal(payload.team.memberCount, 1);
    assert.equal(payload.teams.find((team) => team.id === payload.team.id).rank, 5);
    assert.equal(payload.user.teamId, payload.team.id);
    assert.match(payload.team.code, /^[A-Z0-9]{6}$/);
  });
});

test("invalid or missing QR tokens are rejected", async () => {
  await withServer(async ({ baseUrl }) => {
    const { response, payload } = await json(baseUrl, "/api/missions/mission-library-ac/scan", {
      method: "POST",
      body: JSON.stringify({ userId: "u-demo", qrToken: "wrong" })
    });
    assert.equal(response.status, 403);
    assert.match(payload.error.message, /invalid|expired/i);
  });
});

test("verified proof awards impact and captures a three-node territory", async () => {
  await withServer(async ({ baseUrl }) => {
    const scan = await json(baseUrl, "/api/missions/mission-library-ac/scan", {
      method: "POST",
      body: JSON.stringify({ userId: "u-demo", qrToken: "qr_library_ac_2026" })
    });
    assert.equal(scan.response.status, 201);
    assert.equal(scan.payload.attempt.status, "awaiting_photo");

    const verified = await json(baseUrl, `/api/attempts/${scan.payload.attempt.id}/verify`, {
      method: "POST",
      body: JSON.stringify({ imageDataUrl: ONE_PIXEL_PNG })
    });
    assert.equal(verified.response.status, 200);
    assert.equal(verified.payload.accepted, true);
    assert.equal(verified.payload.impact.kwhSaved, 0.855);
    assert.equal(verified.payload.captures[0].territoryId, "territory-central");
    assert.equal(verified.payload.state.territories[0].ownerTeamId, "team-green");
    assert.equal(verified.payload.state.user.xp, 980);
    assert.equal(verified.payload.state.team.score, 3210, "mission XP plus capture bonus should be awarded");
  });
});

test("a resolved location enters cooldown", async () => {
  await withServer(async ({ baseUrl }) => {
    const scan = await json(baseUrl, "/api/missions/mission-library-ac/scan", {
      method: "POST",
      body: JSON.stringify({ userId: "u-demo", qrToken: "qr_library_ac_2026" })
    });
    await json(baseUrl, `/api/attempts/${scan.payload.attempt.id}/verify`, {
      method: "POST",
      body: JSON.stringify({ imageDataUrl: ONE_PIXEL_PNG })
    });
    const second = await json(baseUrl, "/api/missions/mission-library-ac/scan", {
      method: "POST",
      body: JSON.stringify({ userId: "u-demo", qrToken: "qr_library_ac_2026" })
    });
    assert.equal(second.response.status, 409);
    assert.match(second.payload.error.message, /cooling down/i);
  });
});

test("OpenAI verifier sends image input and requests strict structured output", async () => {
  let capturedRequest;
  const verifier = new PhotoVerifier({
    apiKey: "test-key",
    model: "gpt-5.4-mini",
    demoMode: false,
    fetchImpl: async (url, options) => {
      capturedRequest = { url, options, body: JSON.parse(options.body) };
      return new Response(JSON.stringify({
        model: "gpt-5.4-mini",
        output_text: JSON.stringify({
          completed: true,
          confidence: 0.93,
          reason: "Controller is visibly off.",
          observed_state: "Off state visible",
          safety_concern: false
        })
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  const mission = new GhostGridStore().findMission("mission-library-ac");
  const result = await verifier.verify({ mission, imageDataUrl: ONE_PIXEL_PNG, userId: "u-demo" });
  assert.equal(result.completed, true);
  assert.equal(capturedRequest.url, "https://api.openai.com/v1/responses");
  assert.equal(capturedRequest.options.headers.Authorization, "Bearer test-key");
  assert.equal(capturedRequest.body.input[0].content[1].type, "input_image");
  assert.equal(capturedRequest.body.input[0].content[1].image_url, ONE_PIXEL_PNG);
  assert.equal(capturedRequest.body.text.format.type, "json_schema");
  assert.equal(capturedRequest.body.text.format.strict, true);
  assert.equal(capturedRequest.body.store, false);
});

test("energy and territory calculations are deterministic", () => {
  assert.equal(calculateAvoidedKwh({ powerBeforeKw: 1.2, powerAfterKw: 0, avoidedMinutes: 45 }), 0.9);
  const store = new GhostGridStore();
  const progress = territoryProgress(store.state.territories[0], store.state.missions, "team-green");
  assert.equal(progress.completed, 2);
  assert.equal(progress.percent, 67);
});

test("OpenAPI contract is served from the running backend", async () => {
  await withServer(async ({ baseUrl }) => {
    const { response, payload } = await json(baseUrl, "/api/openapi.json");
    assert.equal(response.status, 200);
    assert.equal(payload.openapi, "3.1.0");
    assert.ok(payload.paths["/api/attempts/{attemptId}/verify"]);
    assert.ok(payload.paths["/api/teams/join"]);
  });
});
