// Cached Canvas2D water/coast/river presentation.  Water is a neutral material
// layer, not a faction tint.  Only real playable land-water adjacencies may
// generate coasts; render-only edge cells can extend the water fill but never
// create gameplay topology or an artificial map-edge boundary.

import { HEX_NEIGHBORS } from '../rules/hex.js';
import { buildRiverTopology } from '../rules/hydrography.js';
import {
    SURFACE_BASE_COLORS,
    SURFACE_KIND,
    buildCoastTopology,
    isWaterSurface,
    tileCoordinateKey
} from '../rules/surfaces.js';

export const CANVAS_HYDROGRAPHY_LAYER_VERSION = 1;
export const CANVAS_HYDROGRAPHY_PHASE = Object.freeze({
    SURFACE: 'surface',
    WATERWAYS: 'waterways',
    DETAILS: 'details',
    ALL: 'all'
});

const DEFAULT_HEX_SIZE = 30;
const HEX_UNIT_VERTICES = Object.freeze(Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 3 * (index + 0.5);
    return Object.freeze({ x: Math.cos(angle), y: Math.sin(angle) });
}));

const DEFAULT_PALETTE = Object.freeze({
    shallowWater: '#4d7377',
    deepWater: '#263f4c',
    shallowWave: 'rgba(202,229,222,0.25)',
    deepWave: 'rgba(164,207,216,0.18)',
    coastShadow: 'rgba(35,29,21,0.94)',
    coastSand: '#d5c89f',
    coastFoam: 'rgba(216,239,230,0.80)',
    riverBankShadow: 'rgba(52,43,31,0.62)',
    riverBank: '#aa9872',
    riverInnerEdge: 'rgba(218,205,167,0.72)',
    riverWater: '#3f737c',
    riverHighlight: 'rgba(207,239,232,0.72)',
    bridgeShadow: 'rgba(49,37,25,0.92)',
    bridgeDeck: '#b28c55',
    bridgeTie: 'rgba(55,41,27,0.78)',
    ford: 'rgba(210,185,100,0.70)',
    fordHighlight: 'rgba(235,215,130,0.50)',
    portShadow: 'rgba(34,28,23,0.82)',
    portDeck: '#a8804d',
    portLight: 'rgba(232,211,164,0.72)'
});

function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function mergePalette(overrides) {
    return Object.freeze({ ...DEFAULT_PALETTE, ...(overrides || {}) });
}

function makeNativePath(pathFactory) {
    if (typeof pathFactory === 'function') {
        try { return pathFactory(); } catch { return null; }
    }
    if (typeof globalThis.Path2D === 'function') return new globalThis.Path2D();
    return null;
}

class CompiledPath {
    constructor(pathFactory) {
        this.native = makeNativePath(pathFactory);
        this.commands = [];
    }

    _push(name, ...args) {
        this.commands.push(Object.freeze([name, ...args]));
        if (typeof this.native?.[name] === 'function') this.native[name](...args);
        return this;
    }

    moveTo(x, y) { return this._push('moveTo', x, y); }
    lineTo(x, y) { return this._push('lineTo', x, y); }
    bezierCurveTo(...args) { return this._push('bezierCurveTo', ...args); }
    quadraticCurveTo(...args) { return this._push('quadraticCurveTo', ...args); }
    closePath() { return this._push('closePath'); }
    rect(...args) { return this._push('rect', ...args); }
    arc(...args) { return this._push('arc', ...args); }
    ellipse(...args) { return this._push('ellipse', ...args); }

    seal() {
        Object.freeze(this.commands);
        return Object.freeze(this);
    }

    trace(context) {
        context.beginPath();
        for (const [name, ...args] of this.commands) {
            if (typeof context[name] === 'function') context[name](...args);
        }
    }
}

function fillPath(context, path, fillRule) {
    if (!path || path.commands.length === 0) return;
    if (path.native) {
        if (fillRule) context.fill(path.native, fillRule);
        else context.fill(path.native);
    } else {
        path.trace(context);
        fillRule ? context.fill(fillRule) : context.fill();
    }
}

function strokePath(context, path) {
    if (!path || path.commands.length === 0) return;
    if (path.native) context.stroke(path.native);
    else {
        path.trace(context);
        context.stroke();
    }
}

function clipPath(context, path, fillRule) {
    if (!path) return;
    if (path instanceof CompiledPath) {
        if (path.native) {
            if (fillRule) context.clip(path.native, fillRule);
            else context.clip(path.native);
        } else {
            path.trace(context);
            fillRule ? context.clip(fillRule) : context.clip();
        }
        return;
    }
    if (fillRule) context.clip(path, fillRule);
    else context.clip(path);
}

function applyClip(context, clip) {
    if (!clip) return;
    if (typeof clip === 'function') {
        context.beginPath();
        clip(context);
        context.clip();
        return;
    }
    if (clip.path) clipPath(context, clip.path, clip.fillRule);
    else clipPath(context, clip, undefined);
}

function addPolygon(path, points) {
    if (!points?.length) return;
    path.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) path.lineTo(points[index].x, points[index].y);
    path.closePath();
}

function addLine(path, from, to) {
    path.moveTo(from.x, from.y);
    path.lineTo(to.x, to.y);
}

function addSmoothPolyline(path, points) {
    if (!Array.isArray(points) || points.length < 2) return;
    path.moveTo(points[0].x, points[0].y);
    for (let index = 0; index < points.length - 1; index++) {
        const p0 = points[Math.max(0, index - 1)];
        const p1 = points[index];
        const p2 = points[index + 1];
        const p3 = points[Math.min(points.length - 1, index + 2)];
        // Restrained Catmull-Rom conversion: the authored canonical vertices
        // remain exact, while the watercourse passes them with continuous
        // tangents instead of looking like a second hex-border polyline.
        const tangent = 0.145;
        path.bezierCurveTo(
            p1.x + (p2.x - p0.x) * tangent,
            p1.y + (p2.y - p0.y) * tangent,
            p2.x - (p3.x - p1.x) * tangent,
            p2.y - (p3.y - p1.y) * tangent,
            p2.x,
            p2.y
        );
    }
}

function projectionFunction(projection, channel) {
    if (!projection) return null;
    const direct = projection[channel];
    if (typeof direct === 'function') return direct;
    if (typeof direct?.projectTile === 'function') return direct.projectTile.bind(direct);
    if (channel === 'playable' && typeof projection.projectPlayableTile === 'function') return projection.projectPlayableTile.bind(projection);
    if (channel === 'render' && typeof projection.projectRenderTile === 'function') return projection.projectRenderTile.bind(projection);
    if (typeof projection.projectTile === 'function') return tile => projection.projectTile(tile, channel);
    return null;
}

function projectTile(tile, projection, channel, fallbackSize) {
    const fn = projectionFunction(projection, channel);
    const value = fn?.(tile) || null;
    const centre = value?.center || value || tile?.center || tile;
    const x = finite(centre?.x, NaN);
    const y = finite(centre?.y, NaN);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const size = Math.max(1, finite(value?.size ?? tile?.size, fallbackSize));
    const vertices = Array.isArray(value?.vertices) && value.vertices.length >= 6
        ? value.vertices.slice(0, 6).map(point => ({ x: finite(point?.x, x), y: finite(point?.y, y) }))
        : HEX_UNIT_VERTICES.map(point => ({ x: x + point.x * size, y: y + point.y * size }));
    return Object.freeze({ x, y, size, vertices: Object.freeze(vertices) });
}

function surfaceKind(tile, playableByKey) {
    const value = typeof tile?.surface === 'string'
        ? tile.surface
        : tile?.surface?.kind ?? tile?.surface?.type ?? tile?.surfaceKind;
    if (isWaterSurface(value)) return value;

    const inheritedKey = tile?.surface?.inheritedFromKey;
    if (inheritedKey && playableByKey.has(inheritedKey)) return surfaceKind(playableByKey.get(inheritedKey), playableByKey);
    if (tile?.sourceTile) return surfaceKind(tile.sourceTile, playableByKey);

    // Detached v1 snapshots did not expose surface.kind.  Exact neutral base
    // colours remain a safe compatibility hint until every producer upgrades.
    const color = String(tile?.surface?.color ?? tile?.currentColor ?? '').toLowerCase();
    if (color === SURFACE_BASE_COLORS[SURFACE_KIND.SHALLOW_WATER].toLowerCase()) return SURFACE_KIND.SHALLOW_WATER;
    if (color === SURFACE_BASE_COLORS[SURFACE_KIND.DEEP_WATER].toLowerCase()) return SURFACE_KIND.DEEP_WATER;
    return SURFACE_KIND.LAND;
}

function scenePlayableTiles(scene) {
    const candidates = scene?.playableTiles || scene?.tiles || [];
    return candidates.filter(tile => tile?.renderOnly !== true && tile?.playable !== false);
}

function sceneRenderTiles(scene, playableTiles) {
    return scene?.renderTiles || scene?.tiles || playableTiles;
}

function edgePoints(projected, edgeIndex, inset = 1) {
    const first = projected.vertices[edgeIndex];
    const second = projected.vertices[(edgeIndex + 1) % 6];
    if (inset === 1) return [first, second];
    return [first, second].map(point => ({
        x: projected.x + (point.x - projected.x) * inset,
        y: projected.y + (point.y - projected.y) * inset
    }));
}

function boundsFor(projectedTiles) {
    if (!projectedTiles.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const projected of projectedTiles) {
        for (const point of projected.vertices) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
    }
    return Object.freeze({ minX, minY, maxX, maxY });
}

function addContinuousWaves(path, bounds, size, phaseOffset = 0) {
    if (!bounds) return;
    const stepY = size * 0.31;
    const span = Math.max(size * 1.8, size * 2.4);
    for (let y = bounds.minY - stepY; y <= bounds.maxY + stepY; y += stepY) {
        let x = bounds.minX - span;
        path.moveTo(x, y);
        let segment = 0;
        while (x < bounds.maxX + span) {
            const next = x + span;
            const bend = size * 0.075 * ((segment + phaseOffset) % 2 ? -1 : 1);
            path.bezierCurveTo(
                x + span * 0.28, y - bend,
                x + span * 0.70, y + bend,
                next, y
            );
            x = next;
            segment++;
        }
    }
}

function projectRiverVertex(vertex, projection, projectedPlayable, fallbackSize) {
    const fn = projection?.projectRiverVertex || projection?.riverVertex;
    if (typeof fn === 'function') {
        const value = fn.call(projection, vertex);
        const x = finite(value?.x, NaN);
        const y = finite(value?.y, NaN);
        if (Number.isFinite(x) && Number.isFinite(y)) return Object.freeze({ x, y, size: Math.max(1, finite(value?.size, fallbackSize)) });
    }
    for (const ref of vertex?.refs || []) {
        const tile = projectedPlayable.get(tileCoordinateKey(ref));
        if (!tile || !Number.isInteger(ref?.vertex) || ref.vertex < 0 || ref.vertex >= 6) continue;
        const point = tile.vertices[ref.vertex];
        return Object.freeze({ x: point.x, y: point.y, size: tile.size });
    }
    return null;
}

function addBridge(paths, from, to, size) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const tangentX = dx / length;
    const tangentY = dy / length;
    const normalX = -tangentY;
    const normalY = tangentX;
    const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const half = size * 0.34;
    const a = { x: midpoint.x - normalX * half, y: midpoint.y - normalY * half };
    const b = { x: midpoint.x + normalX * half, y: midpoint.y + normalY * half };
    addLine(paths.bridgeDeck, a, b);
    for (let step = -2; step <= 2; step++) {
        const offset = step * size * 0.105;
        const cx = midpoint.x + tangentX * offset;
        const cy = midpoint.y + tangentY * offset;
        addLine(paths.bridgeTies,
            { x: cx - normalX * size * 0.22, y: cy - normalY * size * 0.22 },
            { x: cx + normalX * size * 0.22, y: cy + normalY * size * 0.22 });
    }
}

function addFord(paths, from, to, size) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const tangentX = dx / length;
    const tangentY = dy / length;
    const normalX = -tangentY;
    const normalY = tangentX;
    // Sandbanks: two thick bands parallel to the river, one on each bank
    for (const side of [-1, 1]) {
        const ox = normalX * size * 0.25 * side;
        const oy = normalY * size * 0.25 * side;
        addLine(paths.fords,
            { x: from.x + ox, y: from.y + oy },
            { x: to.x + ox, y: to.y + oy });
    }
    // Inner bank highlight (narrower, on top of the outer bands)
    for (const side of [-1, 1]) {
        const ox = normalX * size * 0.18 * side;
        const oy = normalY * size * 0.18 * side;
        addLine(paths.fordHighlights,
            { x: from.x + ox, y: from.y + oy },
            { x: to.x + ox, y: to.y + oy });
    }
}

function addPort(paths, land, water) {
    const dx = water.x - land.x;
    const dy = water.y - land.y;
    const length = Math.hypot(dx, dy) || 1;
    const tangentX = dx / length;
    const tangentY = dy / length;
    const normalX = -tangentY;
    const normalY = tangentX;
    const size = land.size;
    const start = { x: land.x + tangentX * size * 0.35, y: land.y + tangentY * size * 0.35 };
    const end = { x: land.x + tangentX * size * 0.98, y: land.y + tangentY * size * 0.98 };
    addLine(paths.portPiers, start, end);
    addLine(paths.portPiers,
        { x: end.x - normalX * size * 0.24, y: end.y - normalY * size * 0.24 },
        { x: end.x + normalX * size * 0.24, y: end.y + normalY * size * 0.24 });
    // A small crane-like angular mark remains legible under a unit sphere.
    const craneBase = { x: start.x - normalX * size * 0.22, y: start.y - normalY * size * 0.22 };
    const craneTop = { x: craneBase.x - tangentX * size * 0.30, y: craneBase.y - tangentY * size * 0.30 };
    paths.portDetails.moveTo(craneBase.x, craneBase.y);
    paths.portDetails.lineTo(craneTop.x, craneTop.y);
    paths.portDetails.lineTo(craneTop.x + normalX * size * 0.28, craneTop.y + normalY * size * 0.28);
}

function revisionOf(scene, options) {
    return options.boardRevision
        ?? scene?.boardRevision
        ?? scene?.revision
        ?? scene?.signature
        ?? null;
}

function projectionRevisionOf(scene, projection, options) {
    return options.projectionRevision
        ?? projection?.revision
        ?? scene?.projectionRevision
        ?? null;
}

function buildPaths(scene, options, pathFactory) {
    const playableTiles = scenePlayableTiles(scene);
    const renderTiles = sceneRenderTiles(scene, playableTiles);
    const playableByKey = new Map(playableTiles.map(tile => [tileCoordinateKey(tile), tile]));
    const projection = options.projection || scene?.projection || null;
    const fallbackSize = Math.max(1, finite(options.hexSize ?? scene?.board?.hexSize, DEFAULT_HEX_SIZE));
    const projectedPlayable = new Map();
    for (const tile of playableTiles) {
        const point = projectTile(tile, projection, 'playable', fallbackSize);
        if (point) projectedPlayable.set(tileCoordinateKey(tile), point);
    }
    const projectedRender = new Map();
    for (const tile of renderTiles) {
        const channel = tile?.renderOnly === true || tile?.playable === false ? 'render' : 'playable';
        const point = projectTile(tile, projection, channel, fallbackSize);
        if (point) projectedRender.set(tileCoordinateKey(tile), point);
    }

    const paths = {
        shallowMask: new CompiledPath(pathFactory),
        deepMask: new CompiledPath(pathFactory),
        shallowWaves: new CompiledPath(pathFactory),
        deepWaves: new CompiledPath(pathFactory),
        coasts: new CompiledPath(pathFactory),
        stream: new CompiledPath(pathFactory),
        river: new CompiledPath(pathFactory),
        bridgeDeck: new CompiledPath(pathFactory),
        bridgeTies: new CompiledPath(pathFactory),
        fords: new CompiledPath(pathFactory),
        fordHighlights: new CompiledPath(pathFactory),
        portPiers: new CompiledPath(pathFactory),
        portDetails: new CompiledPath(pathFactory)
    };

    const shallowProjected = [];
    const deepProjected = [];
    for (const tile of renderTiles) {
        const point = projectedRender.get(tileCoordinateKey(tile));
        if (!point) continue;
        const kind = surfaceKind(tile, playableByKey);
        if (kind === SURFACE_KIND.SHALLOW_WATER) {
            addPolygon(paths.shallowMask, point.vertices.map(vertex => ({
                x: point.x + (vertex.x - point.x) * 1.012,
                y: point.y + (vertex.y - point.y) * 1.012
            })));
            shallowProjected.push(point);
        } else if (kind === SURFACE_KIND.DEEP_WATER) {
            addPolygon(paths.deepMask, point.vertices.map(vertex => ({
                x: point.x + (vertex.x - point.x) * 1.012,
                y: point.y + (vertex.y - point.y) * 1.012
            })));
            deepProjected.push(point);
        }
    }
    addContinuousWaves(paths.shallowWaves, boundsFor(shallowProjected), fallbackSize, 0);
    addContinuousWaves(paths.deepWaves, boundsFor(deepProjected), fallbackSize, 1);

    const playableKeys = new Set(playableByKey.keys());
    const suppliedCoasts = Array.isArray(scene?.coastEdges) ? scene.coastEdges : null;
    const coasts = suppliedCoasts || buildCoastTopology(playableTiles, playableByKey);
    let coastEdgeCount = 0;
    for (const coast of coasts) {
        const landKey = tileCoordinateKey(coast?.land);
        const waterKey = tileCoordinateKey(coast?.water);
        // This is the critical map-edge guard: both sides must be real.
        if (!playableKeys.has(landKey) || !playableKeys.has(waterKey)) continue;
        const land = projectedPlayable.get(landKey);
        if (!land || !Number.isInteger(coast?.landEdge)) continue;
        const [from, to] = edgePoints(land, coast.landEdge);
        addLine(paths.coasts, from, to);
        coastEdgeCount++;
    }

    const topology = scene?.riverTopology
        || buildRiverTopology(scene?.rivers || [], scene?.riverCrossings || scene?.crossings || []);
    const projectedSegments = new Map();
    const projectedRiverGroups = new Map();
    let streamSegmentCount = 0;
    let riverSegmentCount = 0;
    for (const segment of topology?.segments || []) {
        if (!segment?.from || !segment?.to || segment.zeroLength || segment.adjacent === false) continue;
        const from = projectRiverVertex(segment.from, projection, projectedPlayable, fallbackSize);
        const to = projectRiverVertex(segment.to, projection, projectedPlayable, fallbackSize);
        if (!from || !to) continue;
        const groupKey = `${segment.riverId}:${segment.width === 'river' ? 'river' : 'stream'}`;
        if (!projectedRiverGroups.has(groupKey)) projectedRiverGroups.set(groupKey, []);
        projectedRiverGroups.get(groupKey).push({ segment, from, to });
        projectedSegments.set(`${segment.riverId}:${segment.segmentIndex}`, { from, to, segment });
        if (segment.width === 'river') riverSegmentCount++;
        else streamSegmentCount++;
    }
    for (const entries of projectedRiverGroups.values()) {
        entries.sort((left, right) => left.segment.segmentIndex - right.segment.segmentIndex);
        let stretch = [];
        const flush = () => {
            if (stretch.length < 2) return;
            const path = entries[0].segment.width === 'river' ? paths.river : paths.stream;
            addSmoothPolyline(path, stretch);
        };
        for (const entry of entries) {
            const previous = stretch[stretch.length - 1];
            if (previous && (Math.abs(previous.x - entry.from.x) > 0.01 || Math.abs(previous.y - entry.from.y) > 0.01)) {
                flush();
                stretch = [];
            }
            if (stretch.length === 0) stretch.push(entry.from);
            stretch.push(entry.to);
        }
        flush();
    }

    let bridgeCount = 0;
    let fordCount = 0;
    for (const crossing of topology?.crossings || []) {
        const resolved = projectedSegments.get(`${crossing?.riverId}:${crossing?.segmentIndex}`);
        if (!resolved) continue;
        const size = (resolved.from.size + resolved.to.size) / 2;
        if (crossing.kind === 'bridge') {
            addBridge(paths, resolved.from, resolved.to, size);
            bridgeCount++;
        } else if (crossing.kind === 'ford') {
            addFord(paths, resolved.from, resolved.to, size);
            fordCount++;
        }
    }

    let portCount = 0;
    const ports = scene?.ports || playableTiles.filter(tile => tile?.isPort);
    for (const port of ports || []) {
        const key = tileCoordinateKey(port);
        const tile = playableByKey.get(key);
        const portPos = projectedPlayable.get(key);
        if (!tile || !portPos || !tile.isPort) continue;
        // 港口已是浅水地块：栈桥从最近的真陆地画向港口水域。
        // 取港口六邻中第一个真陆地作为栈桥起点。
        let land = null;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighborKey = tileCoordinateKey(tile.q + dq, tile.r + dr);
            const neighbor = playableByKey.get(neighborKey);
            if (!neighbor || isWaterSurface(surfaceKind(neighbor, playableByKey))) continue;
            land = projectedPlayable.get(neighborKey) || null;
            if (land) break;
        }
        if (!land) continue;
        // 港口自身作为水面端
        addPort(paths, land, portPos);
        portCount++;
    }

    for (const path of Object.values(paths)) path.seal();
    return {
        paths: Object.freeze(paths),
        topology,
        fallbackSize,
        metrics: Object.freeze({
            playableTileCount: playableTiles.length,
            renderTileCount: renderTiles.length,
            projectedRenderTileCount: projectedRender.size,
            shallowWaterTileCount: shallowProjected.length,
            deepWaterTileCount: deepProjected.length,
            coastEdgeCount,
            streamSegmentCount,
            riverSegmentCount,
            bridgeCount,
            fordCount,
            portCount
        })
    };
}

/** Compile one immutable hydrography layer. */
export function createCanvasHydrographyLayer(scene, options = {}) {
    if (!scene || typeof scene !== 'object') throw new TypeError('scene must be an object');
    const compiled = buildPaths(scene, options, options.pathFactory);
    const projection = options.projection || scene.projection || null;
    return Object.freeze({
        version: CANVAS_HYDROGRAPHY_LAYER_VERSION,
        boardRevision: revisionOf(scene, options),
        projectionRevision: projectionRevisionOf(scene, projection, options),
        topology: compiled.topology,
        paths: compiled.paths,
        metrics: compiled.metrics,
        hexSize: compiled.fallbackSize,
        palette: mergePalette(options.palette)
    });
}

function drawMaskedWaves(context, mask, waves, style, width, dashOffset) {
    if (!mask.commands.length || !waves.commands.length) return;
    context.save();
    clipPath(context, mask);
    context.strokeStyle = style;
    context.lineWidth = width;
    context.lineCap = 'round';
    context.setLineDash([width * 5.2, width * 3.8]);
    context.lineDashOffset = dashOffset;
    strokePath(context, waves);
    context.restore();
}

function drawSurface(context, layer, options) {
    const { paths, palette, hexSize: size } = layer;
    context.fillStyle = palette.shallowWater;
    fillPath(context, paths.shallowMask);
    context.fillStyle = palette.deepWater;
    fillPath(context, paths.deepMask);
    const now = finite(options.now, 0);
    const motion = options.reducedMotion ? 0 : -(now / 1000) * size * 0.12;
    drawMaskedWaves(context, paths.shallowMask, paths.shallowWaves, palette.shallowWave, Math.max(0.8, size * 0.022), motion);
    drawMaskedWaves(context, paths.deepMask, paths.deepWaves, palette.deepWave, Math.max(0.8, size * 0.020), motion * 0.72);
}

function drawWaterways(context, layer) {
    const { paths, palette, hexSize: size } = layer;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    context.strokeStyle = palette.coastShadow;
    context.lineWidth = size * 0.12;
    strokePath(context, paths.coasts);
    context.strokeStyle = palette.coastSand;
    context.lineWidth = size * 0.050;
    strokePath(context, paths.coasts);
    context.strokeStyle = palette.coastFoam;
    context.lineWidth = Math.max(0.8, size * 0.026);
    context.setLineDash([size * 0.11, size * 0.075]);
    context.lineDashOffset = size * 0.05;
    strokePath(context, paths.coasts);
    context.setLineDash([]);

    const drawRiverPath = (path, waterWidth) => {
        context.strokeStyle = palette.riverBankShadow;
        context.lineWidth = waterWidth + size * 0.15;
        strokePath(context, path);
        context.strokeStyle = palette.riverBank;
        context.lineWidth = waterWidth + size * 0.10;
        strokePath(context, path);
        context.strokeStyle = palette.riverInnerEdge;
        context.lineWidth = waterWidth + size * 0.045;
        strokePath(context, path);
        context.strokeStyle = palette.riverWater;
        context.lineWidth = waterWidth;
        strokePath(context, path);
        context.strokeStyle = palette.riverHighlight;
        context.lineWidth = Math.max(0.7, size * 0.022);
        context.setLineDash([size * 0.12, size * 0.16]);
        strokePath(context, path);
        context.setLineDash([]);
    };
    drawRiverPath(paths.stream, size * 0.095);
    drawRiverPath(paths.river, size * 0.19);
}

function drawDetails(context, layer) {
    const { paths, palette, hexSize: size } = layer;
    context.lineCap = 'round';
    context.lineJoin = 'round';

    context.strokeStyle = palette.bridgeShadow;
    context.lineWidth = size * 0.24;
    strokePath(context, paths.bridgeDeck);
    context.strokeStyle = palette.bridgeDeck;
    context.lineWidth = size * 0.15;
    strokePath(context, paths.bridgeDeck);
    context.strokeStyle = palette.bridgeTie;
    context.lineWidth = Math.max(0.8, size * 0.025);
    strokePath(context, paths.bridgeTies);

    // Sandbank outer bands (two lines parallel to river, one per bank)
    context.strokeStyle = palette.ford;
    context.lineWidth = Math.max(2, size * 0.09);
    context.lineCap = 'round';
    strokePath(context, paths.fords);
    // Sandbank inner highlights (narrower, lighter, on top of outer)
    context.strokeStyle = palette.fordHighlight;
    context.lineWidth = Math.max(1.5, size * 0.055);
    strokePath(context, paths.fordHighlights);

    context.strokeStyle = palette.portShadow;
    context.lineWidth = size * 0.18;
    strokePath(context, paths.portPiers);
    context.strokeStyle = palette.portDeck;
    context.lineWidth = size * 0.11;
    strokePath(context, paths.portPiers);
    context.strokeStyle = palette.portLight;
    context.lineWidth = Math.max(0.8, size * 0.025);
    strokePath(context, paths.portPiers);
    context.strokeStyle = palette.portShadow;
    context.lineWidth = Math.max(1.2, size * 0.05);
    strokePath(context, paths.portDetails);
}

/** Draw a previously compiled hydrography layer without rebuilding geometry. */
export function drawCanvasHydrographyLayer(context, layer, options = {}) {
    if (!context || !layer) return false;
    const phase = options.phase || CANVAS_HYDROGRAPHY_PHASE.ALL;
    const alpha = clamp(finite(options.alpha, 1), 0, 1);
    context.save();
    applyClip(context, options.clip);
    context.globalAlpha = finite(context.globalAlpha, 1) * alpha;
    if (phase === CANVAS_HYDROGRAPHY_PHASE.ALL || phase === CANVAS_HYDROGRAPHY_PHASE.SURFACE) drawSurface(context, layer, options);
    if (phase === CANVAS_HYDROGRAPHY_PHASE.ALL || phase === CANVAS_HYDROGRAPHY_PHASE.WATERWAYS) drawWaterways(context, layer);
    if (phase === CANVAS_HYDROGRAPHY_PHASE.ALL || phase === CANVAS_HYDROGRAPHY_PHASE.DETAILS) drawDetails(context, layer);
    context.restore();
    return true;
}

export class CanvasHydrographyRenderer {
    constructor(options = {}) {
        this.options = { ...options };
        this.layer = null;
        this.rebuildCount = 0;
        this.renderCount = 0;
        this._identity = null;
    }

    sync(scene, options = {}) {
        const merged = { ...this.options, ...options };
        const projection = merged.projection || scene?.projection || null;
        const boardRevision = revisionOf(scene, merged);
        const projectionRevision = projectionRevisionOf(scene, projection, merged);
        const identity = {
            scene: boardRevision == null ? scene : null,
            tiles: boardRevision == null ? scene?.tiles : null,
            topology: boardRevision == null ? scene?.riverTopology : null,
            coasts: boardRevision == null ? scene?.coastEdges : null,
            projection: projectionRevision == null ? projection : null,
            boardRevision,
            projectionRevision,
            palette: merged.palette || null,
            pathFactory: merged.pathFactory || null,
            hexSize: merged.hexSize ?? scene?.board?.hexSize ?? DEFAULT_HEX_SIZE
        };
        const previous = this._identity;
        const unchanged = previous
            && previous.scene === identity.scene
            && previous.tiles === identity.tiles
            && previous.topology === identity.topology
            && previous.coasts === identity.coasts
            && previous.projection === identity.projection
            && previous.boardRevision === identity.boardRevision
            && previous.projectionRevision === identity.projectionRevision
            && previous.palette === identity.palette
            && previous.pathFactory === identity.pathFactory
            && previous.hexSize === identity.hexSize;
        if (unchanged) return false;
        this.layer = createCanvasHydrographyLayer(scene, merged);
        this._identity = identity;
        this.rebuildCount++;
        return true;
    }

    invalidate() {
        this._identity = null;
    }

    render(context, options = {}) {
        if (!this.layer) return false;
        const rendered = drawCanvasHydrographyLayer(context, this.layer, options);
        if (rendered) this.renderCount++;
        return rendered;
    }

    getStats() {
        return Object.freeze({
            rebuildCount: this.rebuildCount,
            renderCount: this.renderCount,
            boardRevision: this.layer?.boardRevision ?? null,
            projectionRevision: this.layer?.projectionRevision ?? null,
            metrics: this.layer?.metrics || null
        });
    }
}
