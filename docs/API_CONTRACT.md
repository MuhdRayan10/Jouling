# Jouling API contract

The mobile client communicates only with the Jouling backend. The OpenAI API key is never sent to the browser. A machine-readable OpenAPI 3.1 summary is available from `GET /api/openapi.json` while the server is running.

All responses use JSON. Errors have this shape:

```json
{
  "error": {
    "code": "request_error",
    "message": "Human-readable description"
  }
}
```

## Session and state

### `GET /api/state?userId=u-demo`

Returns the complete client bootstrap payload: participant, active team, ranked teams, map missions, territories, recent activity, reward pool and server time.

### `POST /api/session`

```json
{ "name": "Ari", "teamCode": "GREEN7" }
```

Creates a participant and joins the requested team, falling back to the default team when no code is supplied.

### `POST /api/demo/reset`

```json
{ "confirmation": "RESET_JOULING_DEMO" }
```

Restores the complete in-memory seed and returns fresh bootstrap state for `u-demo`. The client exposes this only through the hidden five-tap Jouling-bolt gesture used during demonstrations.

## Teams

### `POST /api/teams/join`

```json
{ "userId": "u-demo", "teamCode": "SOLAR9" }
```

Moves the participant into an existing team and returns refreshed app state.

### `POST /api/teams`

```json
{ "userId": "u-demo", "name": "The Negawatts" }
```

Creates a team, generates an invite code, and moves the participant into it.

## QR mission lifecycle

### `POST /api/missions/{missionId}/scan`

```json
{
  "userId": "u-demo",
  "qrToken": "qr_library_ac_2026"
}
```

The backend checks the QR token, active window and location cooldown, then creates a ten-minute attempt. The canonical, domain-independent v1 QR schema is:

```json
{"protocol":"jouling.mission","v":1,"mission":"mission-library-ac","token":"qr_library_ac_2026"}
```

The shared `public/qr-protocol.js` module builds and parses this exact schema for both the app and `scripts/generate-qr.mjs`. The generator's optional `--payload link --origin https://host` mode wraps the same fields in a deployed web link for native-camera deep linking. The scanner accepts both forms, plus `jouling://mission/...` and legacy GhostGrid payloads.

### `POST /api/attempts/{attemptId}/verify`

```json
{ "imageDataUrl": "data:image/jpeg;base64,..." }
```

The backend validates and forwards the image to the OpenAI Responses API with the mission-specific completion and safety criteria. The structured verdict contains completion, confidence, a failure code, observed state, a reason, user guidance and a safety flag. Supported failure codes are `room_still_active`, `camera_obscured`, `image_unclear`, `wrong_device_or_location`, `required_state_missing`, and `unsafe_action`.

Accepted missions atomically award XP, estimated/verified kWh, credits, node progress and any resulting territory capture. Retryable failures keep the ten-minute attempt open so the UI can request another photo. The photo itself is not retained in the in-memory MVP store.

## Competition rules

- A territory is defined by three configured mission nodes.
- A team captures it when all three nodes have accepted completions inside the capture window.
- Competition uses local completion progress; raw kWh remains an impact measure rather than the sole leaderboard basis.
- Each resolved mission has a cooldown and can be re-issued only for a new anomaly in a production integration.
- The institution controls mission availability, safe actions, schedules, targets and rewards.

## Live verification configuration

Set `OPENAI_API_KEY` on the server and optionally override `OPENAI_VISION_MODEL`. Without a key, `JOULING_DEMO_VERIFIER=true` accepts a valid proof-image payload so the whole product loop can be demonstrated offline. Production should set demo mode to `false`.
