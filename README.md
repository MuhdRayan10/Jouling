# Jouling MVP

Jouling is the art of saving joules: a mobile-first territory game for institution-approved electricity-saving missions. Teams find missions on a map, scan physical QR codes, submit mandatory proof photos, earn verified impact and capture triangular zones.

## Run it

Use Node.js 20 or newer:

```bash
npm install
npm start
```

Open [http://localhost:4173](http://localhost:4173). The default seeded participant is Ari on Green Circuit. The featured Central Library mission completes Green Circuit's third node and demonstrates a territory capture.

The campus view uses a locally served MapLibre GL JS client with OpenStreetMap tiles. Panning, zooming, mission filters and territory overlays work in the browser; loading the basemap requires an internet connection.

To run the automated tests:

```bash
npm test
```

## Photo verification modes

The complete OpenAI Responses API integration is implemented server-side. The server automatically loads a local `.env` file:

```bash
cp .env.example .env
# Add OPENAI_API_KEY to .env and set JOULING_DEMO_VERIFIER=false
npm start
```

Never expose `OPENAI_API_KEY` in browser code. When live verification is enabled, the demo-proof button is hidden and a fresh camera/upload photo is mandatory. The verifier returns a structured outcome for successful completion, an active room/device, an obstructed camera, an unclear image, the wrong location/device, a missing required state, or a safety issue. Non-safety failures can be retaken within the same ten-minute attempt.

When no key is present, `JOULING_DEMO_VERIFIER=true` accepts a valid image payload and clearly labels its verdict as demo mode so the product loop can still run offline.

## Demonstration flow

1. Open the map and select **Close the cooling loop**.
2. Choose **Demo: validate this QR** or open the Scan tab and use the featured demo QR action.
3. Take the mandatory proof photo. The approved device and completed room state must be visible.
4. Submit the image. The backend returns a structured verdict, awards 0.855 kWh, XP and credits, and captures Central Commons.
5. Open Teams and Impact to see the updated leaderboard, reward wallet and Planet Relief metric.

## Generate physical QR labels

The standalone generator imports the same protocol module as the browser client, preventing the label format and scanner from drifting apart.

```bash
npm run qr -- --list
npm run qr -- --mission mission-library-ac
npm run qr -- --all --origin https://jouling.example
```

The canonical QR payload is a web link carrying `protocol=jouling.mission`, `v=1`, `mission`, and `token`. Example:

```text
http://localhost:4173/?protocol=jouling.mission&v=1&mission=mission-library-ac&token=qr_library_ac_2026
```

Generated SVG or PNG files are written to `generated-qr/` by default. Camera QR detection uses the browser's `BarcodeDetector` API where available. Camera access requires HTTPS or localhost. The participant must scan the physical label or open its QR link; manual mission-code entry is intentionally unavailable. `jouling://mission/...` and legacy GhostGrid QR links remain compatible.

## Architecture

- `public/`: responsive web UI, navigable MapLibre campus map, QR scanner, camera proof flow, shared QR protocol, team league and impact screens.
- `server/`: dependency-free Node HTTP server, in-memory session state, game rules and OpenAI photo verifier.
- `scripts/generate-qr.mjs`: standalone SVG/PNG label generator using the shared Jouling QR v1 schema.
- `docs/API_CONTRACT.md`: frontend/backend contract and competition semantics.
- `tests/`: end-to-end API, QR, verification, cooldown, territory and OpenAI request-contract tests.

The MVP intentionally keeps state only for the lifetime of the Node process. Every verified task immediately updates the participant, team, impact, territory, reward, leaderboard, daily-match and activity views; restarting the server resets the demo. Production upgrades would add real authentication, persistent storage, signed/rotating QR tokens, EcoVolt telemetry ingestion, anomaly IDs, object-storage retention policies, admin RBAC and institution-specific schedules.
