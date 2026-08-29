# Jouling MVP

Jouling is the art of saving joules: a mobile-first territory game for institution-approved electricity-saving missions. Teams find missions on a map, scan physical QR codes, submit mandatory proof photos, earn verified impact and capture triangular zones.

## Run it

Use Node.js 20 or newer:

```bash
npm install
npm start
```

After pulling or merging a branch that changes `package.json`, run `npm install` again before `npm start`. If the machine's global npm cache has permission problems, use the project-local cache instead: `npm install --cache .npm-cache`.

Open [http://localhost:4173](http://localhost:4173). The default seeded participant is Ari on Green Circuit. The featured Central Library mission completes Green Circuit's third node and demonstrates a territory capture.

The campus view uses a locally served MapLibre GL JS client with OpenStreetMap tiles. Panning, zooming, mission filters and territory overlays work in the browser; loading the basemap requires an internet connection.

To run the automated tests:

```bash
npm test
```

## Deploy to Vercel

Import this repository in Vercel and use the **Other** framework preset. The
`public/` directory is deployed as the static PWA, while `api/[...path].mjs`
exposes the existing backend routes as a Vercel Function. No build command or
output-directory override is required.

Add these variables in **Project Settings → Environment Variables** for
Production, Preview, and Development:

```text
OPENAI_API_KEY=<your rotated key>
OPENAI_VISION_MODEL=gpt-5.4-mini
JOULING_DEMO_VERIFIER=false
```

Do not add `PORT`: Vercel manages the function runtime. After redeploying, open
`/api/health`; a working live-verification deployment reports `ok: true` and
`verifierMode: "openai"`.

The current store is intentionally in memory. It is suitable for a short demo,
but Vercel can replace function instances at any time, so production game state
requires a database.

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
6. To replay the pitch, tap the green Jouling bolt in the top-left five times within 3.5 seconds. This restores the complete seeded demo state and returns the map to its original centre and 14.25 zoom.

A purple **West Coast Power Sweep** is positioned beyond the initial map viewport. Pan west to discover it. The 240-metre team zone awards 1.5× XP for verified actions on approved lights, AC, projectors and screens, while the normal initial map centre and zoom remain unchanged.

## Generate physical QR labels

The standalone generator imports the same protocol module as the browser client, preventing the label format and scanner from drifting apart.

```bash
npm run qr -- --list
npm run qr -- --mission mission-library-ac
npm run qr -- --all
```

The default QR payload is domain-independent JSON carrying `protocol`, `v`, `mission`, and `token`. It is read by Jouling's in-app scanner and works unchanged on localhost, a Vercel preview, or the production deployment:

```json
{"protocol":"jouling.mission","v":1,"mission":"mission-library-ac","token":"qr_library_ac_2026"}
```

If a label must also open Jouling from the phone's native camera, generate an explicit web-link payload using the final Vercel production domain:

```bash
npm run qr -- --all --payload link --origin https://your-project.vercel.app
```

`--origin` can also come from `JOULING_APP_ORIGIN`. Link mode intentionally has no localhost default, preventing deployment-only failures. A link QR is tied to that domain; the default JSON QR is portable but must be scanned inside Jouling.

Generated SVG or PNG files are written to `generated-qr/` by default. Camera QR detection uses the browser's `BarcodeDetector` API where available. Camera access requires HTTPS or localhost. Manual mission-code entry is intentionally unavailable. The scanner continues to accept deployed web links, `jouling://mission/...`, and legacy GhostGrid payloads, so previously printed non-local codes remain compatible. Regenerate any labels that contain `localhost`.

## Architecture

- `public/`: responsive web UI, navigable MapLibre campus map, QR scanner, camera proof flow, shared QR protocol, team league and impact screens.
- `server/`: dependency-free Node HTTP server, in-memory session state, game rules and OpenAI photo verifier.
- `scripts/generate-qr.mjs`: standalone SVG/PNG label generator using the shared Jouling QR v1 schema.
- `docs/API_CONTRACT.md`: frontend/backend contract and competition semantics.
- `tests/`: end-to-end API, QR, verification, cooldown, territory and OpenAI request-contract tests.

The MVP intentionally keeps state only for the lifetime of the Node process. Every verified task immediately updates the participant, team, impact, territory, reward, leaderboard, daily-match and activity views; restarting the server resets the demo. Production upgrades would add real authentication, persistent storage, signed/rotating QR tokens, EcoVolt telemetry ingestion, anomaly IDs, object-storage retention policies, admin RBAC and institution-specific schedules.
