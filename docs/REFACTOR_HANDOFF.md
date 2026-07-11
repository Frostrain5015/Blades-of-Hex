# Refactor handoff

This document is the maintenance map for the six-stage refactor. The game intentionally remains native browser ESM: there is no bundler step.

## Architecture map

| Area | Source of truth | Responsibility |
| --- | --- | --- |
| Rules and text | `rules/` | All balance numbers, display text, emoji, card and commander definitions. |
| Match state | `engine/matchState.js` | Serializable match data, deterministic RNG state, snapshot restore. |
| View state | `js/state.js` | Local selection, HUD, animation state, and snapshot-to-view reconciliation. |
| Pure board model | `engine/HexTile.js` | Canvas-independent hex data used by snapshot restore and headless loading. |
| Browser runtime | `js/canvasRuntime.js`, `js/settingsRuntime.js` | Canvas, settings, and browser-only concerns. |
| UI controllers | `js/chatController.js`, `js/heroCarousel.js`, `js/preparationController.js` | Isolated DOM event and local UI state. |
| Network contract | `protocol/messages.js` | Versioned actions, snapshot validation, action revision, and camp-role mapping. |
| Multiplayer authority | `server.js` | Canonical room snapshot, revision ordering, room-rule validation, reconnect recovery, and rejection rollback. |

## Six-stage completion record

1. Rule data is centralized under `rules/`, frozen, and used to derive UI descriptions.
2. Match state, snapshots, deterministic RNG, pure tiles, and visual event bridging are separated from view state. Colonel air stacks are serialized and reset per match.
3. Browser-only canvas/settings code and independently owned chat, lobby-preparation, and hero-carousel controllers are outside the bootstrap module.
4. The server owns each room's canonical snapshot and revision. Clients submit versioned commands; stale, malformed, out-of-turn, and room-rule-mismatched actions are rejected and corrected from the canonical snapshot. A server-issued per-match seed drives network map randomness.
5. Secrets are local configuration or environment variables, static serving is allowlisted and root-contained, OAuth PKCE state is server-held, and the admin listener defaults to loopback with no hard-coded password or token.
6. Balance/asset documentation is generated from sources of truth, and this manual acceptance list documents the release gate.

## Local configuration

Copy the examples before enabling OAuth or the admin panel:

```text
auth-config.example.json  -> auth-config.json
admin-config.example.json -> admin-config.json
```

Both local files are intentionally ignored by Git. Environment variables override the corresponding values:

- `BOH_JWT_SECRET`
- `BOH_ADMIN_PASSWORD`
- `BOH_ADMIN_TOKEN`
- `BOH_AUTH_CONFIG`
- `BOH_ADMIN_CONFIG`
- `BOH_ADMIN_HOST`

Rotate any credentials that existed before this refactor, because removing a tracked file does not erase its Git history.

## Manual acceptance checklist

Automated test-suite work is intentionally out of scope for this refactor. Before release, manually verify:

1. Local, PVE, training 2P, training 3P, online 2P, and online 3P all expose independent **遭遇战** and **双将模式** checkboxes.
2. In dual-commander mode, each player gets five candidates, selects two with the green selected treatment, deploys them through two commander-deploy cards, and reviews manually.
3. In a three-player online room, create/join/ready/start gives red, blue, and green independent commander flows and keeps the same room rules for all clients.
4. On a non-active client, select a visible unit, then have the opponent move or attack. The selected HUD must remain visible, follow the unit by ID after movement, and close only if the target is gone or hidden by fog.
5. Open room chat, enter text, and use both the **发送** button and Enter. Both must produce one message; clicking outside the panel should still pass through to the board.
6. Check berserker `泣血`, martyr explosion audio, colonel air stacks/weak-point damage, strategist morale outcomes, and color emoji effect badges in a normal match.
7. Reconnect during an online match. The received revisioned snapshot must restore the board and preserve any valid local inspection target.
8. Start the server with local configuration present. Confirm `/index.html` is served, while `/server.js`, `/auth-config.json`, and traversal-like paths are rejected.

## Generated artifacts

- `docs/BALANCE.md`: generated from `rules/` with `node tools/generateBalanceDoc.mjs`.
- `asset-manifest.json`: generated with `node tools/generateAssetManifest.mjs`; it includes `engine/` and `protocol/` so any native ESM update invalidates the entry cache version.

Do not hand-edit generated artifacts. Change `rules/` or source modules, then regenerate them.
