// Production Canvas2D layer orchestration for terrain and hydrography.
//
// The two specialised renderers deliberately know nothing about the legacy
// battlefield draw order.  This adapter gives the runtime and campaign editor
// one shared order, one board clip, and one cache invalidation boundary.

import {
    CANVAS_TERRAIN_PHASE,
    CanvasTerrainRenderer,
    isContinuousTerrainTile
} from './canvasTerrainRenderer.js';
import {
    CANVAS_HYDROGRAPHY_PHASE,
    CanvasHydrographyRenderer
} from './canvasHydrographyRenderer.js';
import { isWaterSurface } from '../rules/surfaces.js';

const DEFAULT_HEX_SIZE = 30;
const HEX_VERTICES = Object.freeze(Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 3 * (index + 0.5);
    return Object.freeze({ x: Math.cos(angle), y: Math.sin(angle) });
}));

function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function surfaceKind(tile) {
    if (typeof tile?.surface === 'string') return tile.surface;
    return tile?.surface?.kind ?? tile?.surface?.type ?? tile?.sourceTile?.surface;
}

function appendHex(path, tile, size) {
    const x = finite(tile?.x ?? tile?.center?.x, NaN);
    const y = finite(tile?.y ?? tile?.center?.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    path.moveTo(x + HEX_VERTICES[0].x * size, y + HEX_VERTICES[0].y * size);
    for (let index = 1; index < HEX_VERTICES.length; index++) {
        path.lineTo(x + HEX_VERTICES[index].x * size, y + HEX_VERTICES[index].y * size);
    }
    path.closePath();
    return true;
}

/**
 * Build a union clip from renderable cells.  On a classic board this is the
 * exact playable footprint; in borderless mode callers explicitly include the
 * render-only filler cells.  No map-edge effect stroke is generated.
 */
export function createCanvasBoardClip(renderTiles, {
    hexSize = DEFAULT_HEX_SIZE,
    pathFactory
} = {}) {
    const size = Math.max(1, finite(hexSize, DEFAULT_HEX_SIZE));
    let native = null;
    if (typeof pathFactory === 'function') {
        try { native = pathFactory(); } catch { native = null; }
    } else if (typeof globalThis.Path2D === 'function') {
        native = new globalThis.Path2D();
    }

    if (native) {
        for (const tile of renderTiles || []) appendHex(native, tile, size);
        return native;
    }

    // Canvas renderers call beginPath() before invoking function clips, so this
    // fallback appends all hex subpaths without allocating anything per frame.
    const commands = [];
    const recorder = {
        moveTo: (...args) => commands.push(['moveTo', ...args]),
        lineTo: (...args) => commands.push(['lineTo', ...args]),
        closePath: () => commands.push(['closePath'])
    };
    for (const tile of renderTiles || []) appendHex(recorder, tile, size);
    return context => {
        for (const [name, ...args] of commands) context[name]?.(...args);
    };
}

function hashInteger(hash, value) {
    hash ^= Number.isInteger(value) ? value : 0;
    return Math.imul(hash, 16777619);
}

function hashText(hash, value) {
    const text = typeof value === 'string' ? value : '';
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    // Delimit adjacent fields without constructing a composite string.
    hash ^= 0xff;
    return Math.imul(hash, 16777619);
}

function terrainFingerprint(tiles) {
    let hash = 2166136261;
    for (const tile of tiles || []) {
        hash = hashInteger(hash, tile?.q);
        hash = hashInteger(hash, tile?.r);
        hash = hashText(hash, tile?.terrain);
        hash = hashText(hash, tile?.fortification);
        hash = hashInteger(hash, tile?.isUrban ? 1 : 0);
        hash = hashInteger(hash, tile?.isCity ? 1 : 0);
        hash = hashInteger(hash, tile?.isVillage ? 1 : 0);
        hash = hashText(hash, tile?.urbanCenterKey);
    }
    return hash >>> 0;
}

function hydrographyFingerprint(tiles) {
    let hash = 2166136261;
    for (const tile of tiles || []) {
        hash = hashInteger(hash, tile?.q);
        hash = hashInteger(hash, tile?.r);
        hash = hashText(hash, surfaceKind(tile));
        hash = hashInteger(hash, tile?.isPort ? 1 : 0);
    }
    return hash >>> 0;
}

function hasHydrography(scene, playableTiles) {
    return playableTiles.some(tile => isWaterSurface(surfaceKind(tile)))
        || (scene?.rivers?.length || 0) > 0
        || (scene?.riverTopology?.segments?.length || 0) > 0
        || (scene?.ports?.length || 0) > 0;
}

function sameIdentity(left, right) {
    return Boolean(left && right
        && left.playableTiles === right.playableTiles
        && left.renderTiles === right.renderTiles
        && left.tileMap === right.tileMap
        && left.coastEdges === right.coastEdges
        && left.rivers === right.rivers
        && left.riverCrossings === right.riverCrossings
        && left.riverTopology === right.riverTopology
        && left.ports === right.ports
        && left.terrainFingerprint === right.terrainFingerprint
        && left.hydrographyFingerprint === right.hydrographyFingerprint
        && left.hexSize === right.hexSize);
}

/**
 * Cached integration boundary used by both the real battlefield and editor.
 * `sync()` is safe to call every frame: unchanged geometry does not allocate a
 * Path2D or rebuild either specialised renderer.
 */
export class CanvasBattlefieldLayers {
    constructor(options = {}) {
        this.hexSize = Math.max(1, finite(options.hexSize, DEFAULT_HEX_SIZE));
        this.pathFactory = options.pathFactory;
        this.clipPathFactory = options.clipPathFactory ?? options.pathFactory;
        this.terrainRenderer = options.terrainRenderer || new CanvasTerrainRenderer({
            hexSize: this.hexSize,
            pathFactory: this.pathFactory
        });
        this.hydrographyRenderer = options.hydrographyRenderer || new CanvasHydrographyRenderer({
            hexSize: this.hexSize,
            pathFactory: this.pathFactory
        });
        this.terrainActive = false;
        this.hydrographyActive = false;
        this.boardClip = null;
        this.scene = null;
        this._identity = null;
        this._revision = 0;
        this.syncCount = 0;
    }

    sync(scene = {}) {
        const candidates = scene.playableTiles || scene.tiles || [];
        const hasRenderOnlyCandidate = candidates.some(tile =>
            tile?.renderOnly === true || tile?.playable === false);
        const playableTiles = hasRenderOnlyCandidate
            ? candidates.filter(tile => tile?.renderOnly !== true && tile?.playable !== false)
            : candidates;
        const renderTiles = scene.renderTiles || scene.tiles || playableTiles;
        const identity = {
            playableTiles: scene.playableTiles || scene.tiles || playableTiles,
            renderTiles,
            tileMap: scene.tileMap,
            coastEdges: scene.coastEdges,
            rivers: scene.rivers,
            riverCrossings: scene.riverCrossings || scene.crossings,
            riverTopology: scene.riverTopology,
            ports: scene.ports,
            terrainFingerprint: terrainFingerprint(playableTiles),
            hydrographyFingerprint: hydrographyFingerprint(playableTiles),
            hexSize: this.hexSize
        };
        if (sameIdentity(this._identity, identity)) return false;

        const terrainActive = playableTiles.some(isContinuousTerrainTile);
        const hydrographyActive = hasHydrography(scene, playableTiles);
        const compiledScene = {
            ...scene,
            playableTiles,
            renderTiles,
            boardRevision: ++this._revision
        };

        this.boardClip = terrainActive || hydrographyActive
            ? createCanvasBoardClip(renderTiles, {
                hexSize: this.hexSize,
                pathFactory: this.clipPathFactory
            })
            : null;
        if (terrainActive) this.terrainRenderer.sync(compiledScene);
        if (hydrographyActive) this.hydrographyRenderer.sync(compiledScene);
        this.terrainActive = terrainActive;
        this.hydrographyActive = hydrographyActive;
        this.scene = compiledScene;
        this._identity = identity;
        this.syncCount++;
        return true;
    }

    renderGround(context, options = {}) {
        if (this.hydrographyActive) {
            this.hydrographyRenderer.render(context, {
                ...options,
                clip: this.boardClip,
                phase: CANVAS_HYDROGRAPHY_PHASE.SURFACE
            });
        }
        if (this.terrainActive) {
            this.terrainRenderer.render(context, {
                ...options,
                clip: this.boardClip,
                phase: CANVAS_TERRAIN_PHASE.GROUND
            });
        }
    }

    renderWaterways(context, options = {}) {
        if (!this.hydrographyActive) return;
        this.hydrographyRenderer.render(context, {
            ...options,
            clip: this.boardClip,
            phase: CANVAS_HYDROGRAPHY_PHASE.WATERWAYS
        });
    }

    renderRelief(context, options = {}) {
        if (!this.terrainActive) return;
        this.terrainRenderer.render(context, {
            ...options,
            clip: this.boardClip,
            phase: CANVAS_TERRAIN_PHASE.RELIEF
        });
    }

    renderDetails(context, options = {}) {
        if (this.terrainActive) {
            this.terrainRenderer.render(context, {
                ...options,
                clip: this.boardClip,
                phase: CANVAS_TERRAIN_PHASE.FORTIFICATIONS
            });
        }
        if (this.hydrographyActive) {
            this.hydrographyRenderer.render(context, {
                ...options,
                clip: this.boardClip,
                phase: CANVAS_HYDROGRAPHY_PHASE.DETAILS
            });
        }
    }

    getStats() {
        return Object.freeze({
            syncCount: this.syncCount,
            revision: this._revision,
            terrainActive: this.terrainActive,
            hydrographyActive: this.hydrographyActive,
            terrain: this.terrainRenderer.getStats?.() || null,
            hydrography: this.hydrographyRenderer.getStats?.() || null
        });
    }
}
