export const apiContract = {
  openapi: "3.1.0",
  info: {
    title: "GhostGrid MVP API",
    version: "1.0.0",
    description: "Contract between the mobile web client and the GhostGrid mission, team, territory, and proof-verification backend."
  },
  servers: [{ url: "/" }],
  paths: {
    "/api/health": {
      get: { summary: "Health and verifier-mode check", responses: { "200": { description: "Healthy" } } }
    },
    "/api/state": {
      get: {
        summary: "Get all client bootstrap state",
        parameters: [{ name: "userId", in: "query", schema: { type: "string" } }],
        responses: { "200": { description: "User, team, map missions, territories, leaderboard, activity and reward pool" } }
      }
    },
    "/api/session": {
      post: {
        summary: "Create a participant session and join an initial team",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" }, teamCode: { type: "string" } } } } } },
        responses: { "201": { description: "Bootstrap state for the new participant" } }
      }
    },
    "/api/teams/join": {
      post: {
        summary: "Join an existing team by ID or invite code",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["userId"], properties: { userId: { type: "string" }, teamId: { type: "string" }, teamCode: { type: "string" } } } } } },
        responses: { "200": { description: "Updated bootstrap state" }, "404": { description: "Unknown team" } }
      }
    },
    "/api/teams": {
      post: {
        summary: "Create a team and move the participant into it",
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["userId", "name"], properties: { userId: { type: "string" }, name: { type: "string" } } } } } },
        responses: { "201": { description: "Updated bootstrap state" } }
      }
    },
    "/api/leaderboard": {
      get: { summary: "Rank teams by score", responses: { "200": { description: "Ranked teams" } } }
    },
    "/api/missions/{missionId}/scan": {
      post: {
        summary: "Validate a physical QR and create a short-lived mission attempt",
        parameters: [{ name: "missionId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["userId", "qrToken"], properties: { userId: { type: "string" }, qrToken: { type: "string" } } } } } },
        responses: { "201": { description: "Attempt awaiting proof photo" }, "403": { description: "Invalid QR token" }, "409": { description: "Mission unavailable or cooling down" } }
      }
    },
    "/api/attempts/{attemptId}/verify": {
      post: {
        summary: "Verify proof photo, award impact, and recalculate territory ownership",
        parameters: [{ name: "attemptId", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["imageDataUrl"], properties: { imageDataUrl: { type: "string", contentEncoding: "base64" } } } } } },
        responses: { "200": { description: "Structured verdict, impact, captures, and updated state" }, "413": { description: "Image too large" }, "502": { description: "OpenAI verification error" } }
      }
    }
  }
};
