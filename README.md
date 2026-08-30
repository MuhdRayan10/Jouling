# Jouling

**Live website: [jouling.vercel.app](https://jouling.vercel.app)**

**Demo Video: [Video Link](https://youtu.be/tOAarREDPKA)**


Jouling is a mobile-first game that turns energy-saving actions into team missions. Players find approved tasks on a map, scan a physical QR label, submit a proof photo, earn XP and measurable impact, and compete for territory with their team.

## Run locally

Jouling requires **Node.js 20 or newer**.

1. Create a local environment file from the supplied example:

   ```bash
   cp .env.example .env
   ```

2. Fill in `.env` using the same fields as `.env.example`:

   ```text
   PORT=4173
   OPENAI_API_KEY=<your OpenAI API key>
   OPENAI_VISION_MODEL=gpt-5.4-mini
   JOULING_DEMO_VERIFIER=false
   ```

   Keep `.env` private and never commit API keys. To run without live AI verification, leave the key empty and set `JOULING_DEMO_VERIFIER=true`.

3. Install dependencies and start the app:

   ```bash
   npm install
   npm start
   ```

4. Open [http://localhost:4173](http://localhost:4173).

Run the automated test suite with:

```bash
npm test
```

## Generate mission QR codes

The QR generator and in-app scanner use the same Jouling v1 payload schema.

```bash
# List available missions
npm run qr -- --list

# Generate one mission label
npm run qr -- --mission mission-library-ac

# Generate labels for every mission
npm run qr -- --all
```

The default output is domain-independent and can be scanned inside Jouling. To generate QR codes that open the deployed website from a phone's native camera, use:

```bash
npm run qr -- --all --payload link --origin https://jouling.vercel.app
```

Generated files are written to `generated-qr/`.

## Technical overview

- A responsive, mobile-first web interface provides the map, scanner, proof-photo flow, teams, rewards and impact views.
- MapLibre GL JS and OpenStreetMap provide the navigable campus map, mission markers, territories and team sweep zones.
- Browser `BarcodeDetector` is used when available, with `jsQR` as the fallback QR decoder.
- A Node.js HTTP API manages missions, teams, cooldowns, territory capture and the in-memory demo state.
- OpenAI's Responses API performs structured server-side photo verification. The API key is never exposed to the browser.
- Vercel hosts the static app and serverless API routes.
- The MVP stores state in memory, so restarting the backend restores the seeded demo. A production release would replace this with persistent storage and institution-provided energy data.

## Project structure

```text
public/                 Web interface, MapLibre map and QR scanner
server/                 API, mission logic, state and photo verification
api/                    Vercel serverless entry point
scripts/generate-qr.mjs QR label generation CLI
tests/                  API, QR, verification and game-logic tests
docs/                   API and protocol documentation
```

### Main tools

- JavaScript and Node.js 20+
- MapLibre GL JS and OpenStreetMap
- OpenAI Responses API
- `BarcodeDetector` and `jsQR`
- `qrcode` CLI generation
- Vercel
