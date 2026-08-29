# GhostGrid MVP

GhostGrid is a mobile-first territory game for institution-approved electricity-saving missions. Teams find missions on a map, scan physical QR codes, submit proof photos, earn verified impact and capture triangular zones.

## Run it

No package installation is required. Use Node.js 20 or newer:

```bash
npm start
```

Open [http://localhost:4173](http://localhost:4173). The default seeded participant is Ari on Green Circuit. The featured Central Library mission completes Green Circuit's third node and demonstrates a territory capture.

To run the automated tests:

```bash
npm test
```

## Photo verification modes

The complete OpenAI Responses API integration is implemented server-side. Copy `.env.example` to your preferred environment configuration and export the values before starting:

```bash
export OPENAI_API_KEY="your-server-side-key"
export OPENAI_VISION_MODEL="gpt-5.4-mini"
export GHOSTGRID_DEMO_VERIFIER="false"
npm start
```

Never expose `OPENAI_API_KEY` in browser code. When no key is present, the default demo verifier accepts a valid image payload and labels its verdict as demo mode, allowing the full product loop to run offline.

## Demonstration flow

1. Open the map and select **Close the cooling loop**.
2. Choose **Demo: validate this QR** or open the Scan tab and use the featured demo QR action.
3. Take a real proof photo, or choose **Use sample proof for demo** when running without an API key.
4. Submit the image. The backend returns a structured verdict, awards 0.855 kWh, XP and credits, and captures Central Commons.
5. Open Teams and Impact to see the updated leaderboard, reward wallet and Planet Relief metric.

## Physical QR payload

For deployment, print QR codes whose payload is a mission URL. Example:

```text
http://localhost:4173/?mission=mission-library-ac&token=qr_library_ac_2026
```

Camera QR detection uses the browser's `BarcodeDetector` API where available. Camera access requires HTTPS or localhost. Manual mission codes and direct QR links remain available as fallbacks.

## Architecture

- `public/`: responsive web UI, campus map, QR scanner, camera proof flow, team league and impact screens.
- `server/`: dependency-free Node HTTP server, in-memory MVP state, game rules and OpenAI photo verifier.
- `docs/API_CONTRACT.md`: frontend/backend contract and competition semantics.
- `tests/`: end-to-end API, QR, verification, cooldown, territory and OpenAI request-contract tests.

Production upgrades would add real authentication, persistent storage, signed/rotating QR tokens, EcoVolt telemetry ingestion, anomaly IDs, object-storage retention policies, admin RBAC and institution-specific schedules.
