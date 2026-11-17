# Blades of Hex

A browser-based hex-grid turn-based strategy game written in JavaScript ES modules, featuring combined-arms land, naval, and air warfare across single-player skirmishes, scripted campaigns, local hotseat, and real-time WebSocket multiplayer.

Live server: [https://boh.frostrain.tech/](https://boh.frostrain.tech/)

Full English Manual: **[Complete Game Rules & Mechanics Manual](docs/GAME_RULES.md)**

> This README documents the architecture, workflows, and tooling of the current repository baseline (`v5.1.0`). Unit stats, commander abilities, map layouts, and campaign missions change frequently; treat `rules/` and `campaign/` as the authoritative sources of truth.

## Features

### Game Modes

- **Single-Player Skirmish (PvE)**: Play against tiered AI opponents across multiple map families, optional Fog of War, and selectable faction rule modes (Standard, Historical Cultures, and Faction Synergies).
- **Dual AI Simulation**: Run AI-vs-AI matches directly in the browser or headless via CLI scripts for balance and regression testing.
- **Local Hotseat**: Two players take turns on the same device.
- **Online Multiplayer**: WebSocket rooms supporting 2-player and 3-player matches with reconnect recovery, rematches, room chat, and host-managed AI seats (`server/roomAi.js`).
- **Star Chronicles (Campaigns) & Recruit Training**: Data-driven single-player scenarios (`campaign/catalog.js`) featuring dialogue, staged triggers, dynamic objectives, star ratings, collectibles, and optional server-backed profile sync. Currently registered content includes the *Bloodstained Iris* (`blood-iris`) chronicle (10 scenarios across Chapter 1, Chapter 2, and the BI-13 boss stage) plus standalone recruit training.

### Combat, Economy, and Battlefield Systems

- **Unified Domain Engine**: Shared deterministic rules (`rules/`, `engine/`, `core/`) validate and resolve movement, ranged/melee combat, counterattacks, flanking morale penalties, weather, terrain, fortifications, and district control.
- **Land, Naval, and Air Operations**: Infantry, cavalry, artillery, cruisers, destroyers, submarines, carriers, shore batteries, airfields, airstrikes, and airborne drops, including amphibious embarkation/disembarkation and river crossings (bridges, fords, and floodgates).
- **Commanders, Cultures, and Synergies**: Playable commanders (`rules/commanders.js`, `commander/`), tactical counter cards (`rules/cards.js`), 8 Historical Cultures with signature units (`rules/cultures.js`), and multi-commander Faction Synergies (`rules/factionSynergies.js`).
- **Post-Match Review & Telemetry**: Built-in After-Action Report statistics view (`js/matchStats.js`, `js/matchStatsView.js`) and dual-layer JSON match recorder (`js/matchRecorder.js`) producing compact `.match-review.json` summaries and full `.match-full.json` timelines named by map acronym and second-precision timestamp (for example, `cr-20261117084515.match-review.json`).

## Quick Start

Requires **Node.js 20+** (Node.js 22+ recommended).

```powershell
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000). Other devices on the same LAN can connect via the LAN addresses printed on startup.

`npm start` launches the combined Node HTTP and WebSocket server (`server.js`), serving source files directly by default for rapid local iteration. Configure the listening port with `PORT` or `HTTP_PORT`.

### Frontend Development and Production Build

```powershell
# Start Vite dev server (defaults to 127.0.0.1:5173, proxying /api and /auth to :3000)
npm run dev

# Typecheck rendering boundaries and build production bundles into dist/
npm run typecheck
npm run build
```

To make `server.js` serve the built `dist/` bundle instead of raw source files:

```powershell
$env:BOH_SERVE_DIST = '1'
npm start
```

PM2 deployment via `ecosystem.config.js` enables `BOH_SERVE_DIST=1` automatically.

### itch.io HTML5 Build

```powershell
npm run build:itch
```

Generates a standalone build in `dist-itch/` using relative asset paths (`base: './'`), connecting WebSocket multiplayer to the remote server configured in `.env.itch`, and disabling Frost ID OAuth so player profiles stay local to browser storage. Zip the contents of `dist-itch/` (with `index.html` at the archive root) for upload.

## Testing and Developer Tools

```powershell
npm test                         # Full suite: static, unit, pve, campaign, net, cmdr, fx
npm run test:quick               # Full suite with shortened PvE turn loops
npm run typecheck                # TypeScript check against tsconfig.rendering.json
npm run selfplay                 # Headless AI-vs-AI self-play CLI (tools/runSelfPlay.mjs)

# Run individual test suites
node test/run-all.mjs --suite=static
node test/run-all.mjs --suite=unit
node test/run-all.mjs --suite=pve
node test/run-all.mjs --suite=campaign
node test/run-all.mjs --suite=net
node test/run-all.mjs --suite=cmdr
node test/run-all.mjs --suite=fx
```

Additional developer scripts and utilities:

- `tools/runSelfPlay.mjs`: Headless AI self-play runner sharing browser `gameLogic` and difficulty profiles (`imperator`, `legatus`, `optio`, `corporal`).
- `tools/runBenchmark.mjs`: Multi-game difficulty benchmark matrix outputting to `artifacts/benchmark/`.
- `tools/generateBalanceDoc.mjs`: Exports balance reference data derived from `rules/`.
- `tools/trimSounds.js`: Processes raw source audio into compressed runtime assets in `sounds/` using `ffmpeg-static`.
- `scripts/exportUnchartedPassageV2.mjs`: Map export utility for `uncharted-passage`.
- `campaign/terrain-preview-*.html` & `campaign/terrain-texture-preview.html`: Standalone Vite-built preview harnesses for terrain, water, actions, targeting, and air presentation.
- `campaign/editor/`: Built-in data-driven campaign board and trigger editor.
- `prototype/`: Standalone experimental prototypes (`3d-battlefield`, `akros-rpg`), excluded from production game builds.

### Local Agent Battle SDK (`tools/agentSdk.mjs`)

External LLM or programmatic agents can join an open multiplayer room slot over WebSocket. Create a multiplayer room in the UI with a free player seat, ensure both server and SDK share the same repository version, and use **Node.js 22+**. Full agent instructions and action schemas live in [tools/agentPrompt.md](tools/agentPrompt.md).

#### Node.js Module Integration

```js
import { joinAgent } from './tools/agentSdk.mjs';

const session = await joinAgent({
  server: 'ws://127.0.0.1:3000',
  room: '1',
  token: process.env.BOH_GAME_TOKEN,
  async planTurn({ prompt, observation, signal }) {
    // Return a { summary, actions } object or JSON string from your local agent.
    return localAgent.run({ system: prompt, input: JSON.stringify(observation), signal });
  },
  onEvent(event) {
    if (event.type === 'summary') console.log('Turn summary:', event.summary);
    if (event.type === 'actionResult') console.log(event.accepted ? 'Accepted' : 'Skipped', event.action);
  }
});

await session.done;
```

- `planTurn` is called only when it is the agent's active turn, and `signal` aborts if the turn expires, times out (`120000` ms default, `0` disables), or disconnects.
- Under Fog of War, `observation` contains only friendly-visible tiles/units and the agent's own hand.

#### Language-Agnostic JSONL Subprocess Mode

```powershell
node tools/agentSdk.mjs --server=ws://127.0.0.1:3000 --room=1 --timeout-ms=120000
```

- Reads `plan` objects line-by-line from `stdin` and emits turn prompts and status events (`joined`, `turn`, `summary`, `actionResult`, `turnEnded`, `turnCancelled`, `planError`, `inputError`) on `stdout` (diagnostics on `stderr`).
- Respond to `{"type":"turn","turnId":"...","prompt":"...","observation":{...}}` by writing a matching `{"type":"plan","turnId":"...","summary":"Hold line","actions":[]}` line.

## Architecture

```text
Browser Client (Vite + PixiJS / Canvas2D + Audio/GSAP)
  ├── Lobby, Skirmish, Tutorial, Campaign UI, and AAR Stats
  ├── Shared Rules and State Simulation (rules/, engine/, core/)
  ├── Client Runtime, AI Drivers, and Match Recorder (js/, ai/)
  └── WebSocket Sync Client (protocol/messages.js)
           │
Node Server (server.js)
  ├── Static Source or dist/ Bundle Serving (BOH_SERVE_DIST)
  ├── Authoritative Rooms, AI Seats, Reconnect, and Chat
  ├── Snapshot and Action Revision Validation
  ├── Frost ID OAuth Callbacks and /api/player-profile Sync
  └── Remote Admin Bridge and Ban Controls
```

### Repository Layout

| Path | Purpose |
| --- | --- |
| `js/` | Browser entry points, input/UI controllers, renderers, network client, AAR stats, and match recorder |
| `rules/` | Shared domain rules: units, commanders, cultures, faction synergies, standard maps, naval, ports, hydrography, and combat math |
| `engine/` | Core `matchState` and `HexTile` runtime primitives |
| `core/` | Headless simulation helpers, deterministic RNG, and DOM shims |
| `commander/` | Commander definitions and avatar/skill FX modules |
| `ai/` | Tiered AI architecture (`imperator`, `legatus`, `optio`, `corporal`) and shared `ai/core/` planners |
| `campaign/` | Campaign catalog, *Bloodstained Iris* and visual QA missions, runtime triggers, schema validation, and level editor |
| `protocol/` | Shared WebSocket message schemas, action validation, and state snapshots |
| `server/` | Room AI controller (`roomAi.js`) and MySQL/file player profile storage (`playerProfileStore.js`) |
| `admin/` | Standalone admin HTTP server and web console |
| `locales/` | English UI and campaign localization dictionaries |
| `test/` | Node unit/rule suites, static audit, Playwright end-to-end PvE/campaign/network tests, commander and FX suites |
| `tools/` | Self-play runner, benchmark matrix, balance doc generator, sound trimmer, and Local Agent SDK |
| `scripts/` | One-off map/data authoring scripts |

## Optional Server Configuration

### Frost ID OAuth and Player Profiles

Copy `auth-config.example.json` to `auth-config.json` (gitignored) or set `BOH_AUTH_CONFIG`. When MySQL access is configured (via `auth-config.json`, `BOH_FROST_ID_DATABASE_URL`, or a sibling `../frost-id/.env`), `/api/player-profile` persists campaign progress, collectibles, and settings across sessions. Without auth config, the server runs anonymously with browser-local storage.

Key environment variables:

- `PORT` / `HTTP_PORT`: HTTP and WebSocket port (default `3000`).
- `HTTPS_PORT`: Optional localhost HTTPS port when TLS certs exist (default `3443`).
- `BOH_SERVE_DIST`: Set to `1` to serve `dist/` instead of source files.
- `BOH_AUTH_CONFIG`: Path to auth configuration JSON.
- `BOH_JWT_SECRET`: Secret used to sign and verify session tokens.
- `BOH_FROST_ID_DATABASE_URL`: MySQL connection string for Frost ID player profiles.
- `BOH_ADMIN_CONFIG`: Path to admin configuration JSON.
- `BOH_ADMIN_TOKEN`: Token for admin console authentication.

### Local HTTPS

To serve HTTPS on localhost alongside HTTP, generate self-signed certificates in `certs/` (`certs/key.pem`, `certs/cert.pem`) and start the server:

```powershell
npm run generate-cert
npm run setup-https
```

### Admin Console

```powershell
npm run admin
```

Runs `admin/admin-server.js` as a separate process (see `admin-config.example.json`) to inspect active rooms and connections, close rooms, and manage IP bans. Never commit real tokens or credentials.

## Authoritative Sources

- Complete Game Rules Manual: [docs/GAME_RULES.md](docs/GAME_RULES.md)
- Units, specializations, and counters: [rules/units.js](rules/units.js)
- Commanders and skills: [rules/commanders.js](rules/commanders.js) and `commander/`
- Historical Cultures and unique units: [rules/cultures.js](rules/cultures.js)
- Faction Synergies: [rules/factionSynergies.js](rules/factionSynergies.js)
- Standard maps: [rules/standardMaps.js](rules/standardMaps.js)
- Naval, ports, surfaces, and hydrography: [rules/naval.js](rules/naval.js), [rules/ports.js](rules/ports.js), [rules/surfaces.js](rules/surfaces.js), [rules/hydrography.js](rules/hydrography.js)
- Multiplayer actions and snapshots: [protocol/messages.js](protocol/messages.js) and [server.js](server.js)
- Campaign catalog and chronicles: [campaign/catalog.js](campaign/catalog.js) and [campaign/content/bloodIris/chronicle.js](campaign/content/bloodIris/chronicle.js)
- Campaign level schema specification: [Campaign Level JSON Authoring Spec](campaign/Blades%20of%20Hex%E6%88%98%E5%BD%B9JSON%E5%88%9B%E4%BD%9CAgent%E5%AE%8C%E6%95%B4%E8%A7%84%E8%8C%83.md)

## License

[MIT](LICENSE) (c) 2026 Frostrain5015
