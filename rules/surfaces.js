// Pure battlefield-surface rules shared by authoring, simulation and renderers.
// `board.surface` is intentionally sparse: only water cells are persisted;
// every omitted real board coordinate is land.
import { HEX_NEIGHBORS } from './hex.js';

export const SURFACE_KIND = Object.freeze({
    LAND: 'land',
    SHALLOW_WATER: 'shallowWater',
    DEEP_WATER: 'deepWater'
});

export const SURFACE_KINDS = Object.freeze(Object.values(SURFACE_KIND));
export const SURFACE_SPEC_KINDS = Object.freeze([
    SURFACE_KIND.SHALLOW_WATER,
    SURFACE_KIND.DEEP_WATER
]);

// These are neutral material colours, not faction colours. They also provide a
// safe Canvas2D fallback while the richer water renderer is unavailable.
export const SURFACE_BASE_COLORS = Object.freeze({
    [SURFACE_KIND.SHALLOW_WATER]: '#4e8794',
    [SURFACE_KIND.DEEP_WATER]: '#294f67'
});

export function tileCoordinateKey(qOrTile, r) {
    const q = typeof qOrTile === 'object' ? qOrTile?.q : qOrTile;
    const row = typeof qOrTile === 'object' ? qOrTile?.r : r;
    return `${q},${row}`;
}

export function normalizeSurfaceKind(kind) {
    return SURFACE_KINDS.includes(kind) ? kind : SURFACE_KIND.LAND;
}

export function isWaterSurface(kind) {
    return kind === SURFACE_KIND.SHALLOW_WATER || kind === SURFACE_KIND.DEEP_WATER;
}

export function isLandSurface(kind) {
    return !isWaterSurface(kind);
}

export function getTileSurface(tile) {
    return normalizeSurfaceKind(tile?.surface);
}

export function isWaterTile(tile) {
    return isWaterSurface(getTileSurface(tile));
}

export function isLandTile(tile) {
    return !isWaterTile(tile);
}

export function getSurfaceBaseColor(kind) {
    return SURFACE_BASE_COLORS[normalizeSurfaceKind(kind)] || null;
}

/** Build the sparse coordinate -> water-kind lookup used by runtime loaders. */
export function buildSurfaceMap(specs = []) {
    const result = new Map();
    for (const spec of specs || []) {
        if (!Number.isInteger(spec?.q) || !Number.isInteger(spec?.r)) continue;
        if (!SURFACE_SPEC_KINDS.includes(spec?.kind)) continue;
        result.set(tileCoordinateKey(spec.q, spec.r), spec.kind);
    }
    return result;
}

export function getSurfaceKindAt(surfaceMap, q, r) {
    return normalizeSurfaceKind(surfaceMap?.get(tileCoordinateKey(q, r)));
}

/**
 * Canonical shared-edge key. Missing neighbours are deliberately not accepted:
 * the boundary of a classic board is not an authored coastline.
 */
export function canonicalHexEdgeKey(a, b) {
    if (!a || !b) return null;
    const left = { q: Number(a.q), r: Number(a.r) };
    const right = { q: Number(b.q), r: Number(b.r) };
    if (![left.q, left.r, right.q, right.r].every(Number.isInteger)) return null;
    const first = left.q < right.q || (left.q === right.q && left.r <= right.r) ? left : right;
    const second = first === left ? right : left;
    return `${first.q},${first.r}|${second.q},${second.r}`;
}

/**
 * Derive exact land/water shared-edge topology from real tiles only.
 * `edge` follows the renderer's clockwise hex-edge index; `neighborIndex`
 * follows HEX_NEIGHBORS. No board-edge pseudo coast is ever generated.
 */
export function buildCoastTopology(tiles = [], tileMap = null) {
    const realKeys = new Set((tiles || []).map(tile => tileCoordinateKey(tile)));
    const realTileMap = tileMap instanceof Map
        ? tileMap
        : new Map((tiles || []).map(tile => [tileCoordinateKey(tile), tile]));
    const coasts = [];
    const seen = new Set();

    for (const land of tiles || []) {
        if (!isLandTile(land)) continue;
        for (let neighborIndex = 0; neighborIndex < HEX_NEIGHBORS.length; neighborIndex++) {
            const [dq, dr] = HEX_NEIGHBORS[neighborIndex];
            const neighborKey = tileCoordinateKey(land.q + dq, land.r + dr);
            if (!realKeys.has(neighborKey)) continue;
            const water = realTileMap.get(neighborKey);
            if (!water || !isWaterTile(water)) continue;
            const key = canonicalHexEdgeKey(land, water);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const landEdge = (5 - neighborIndex + 6) % 6;
            coasts.push(Object.freeze({
                key,
                land: Object.freeze({ q: land.q, r: land.r }),
                water: Object.freeze({ q: water.q, r: water.r }),
                landEdge,
                waterEdge: (landEdge + 3) % 6,
                neighborIndex,
                waterKind: getTileSurface(water)
            }));
        }
    }

    return Object.freeze(coasts);
}

export function hasAdjacentWater(surfaceMap, q, r) {
    return HEX_NEIGHBORS.some(([dq, dr]) => isWaterSurface(getSurfaceKindAt(surfaceMap, q + dq, r + dr)));
}
