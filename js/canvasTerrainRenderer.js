// Cached Canvas2D terrain presentation.  Geometry is compiled only when the
// board/projection revision changes; render() merely replays cached paths (or
// uses native Path2D objects when the browser provides them).

import {
    buildTerrainTopology,
    terrainFeatureType,
    terrainFortificationType,
    terrainTopologyTileKey
} from '../rules/terrainTopology.js';

export const CANVAS_TERRAIN_LAYER_VERSION = 1;
export const CANVAS_TERRAIN_PHASE = Object.freeze({
    GROUND: 'ground',
    RELIEF: 'relief',
    FORTIFICATIONS: 'fortifications',
    FORTIFICATIONS_FRONT: 'fortificationsFront',
    ALL: 'all'
});

const DEFAULT_HEX_SIZE = 30;
const HEX_UNIT_VERTICES = Object.freeze(Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 3 * (index + 0.5);
    return Object.freeze({ x: Math.cos(angle), y: Math.sin(angle) });
}));

const DEFAULT_PALETTE = Object.freeze({
    plainsSpeck: 'rgba(132,152,96,0.12)',
    forestGround: 'rgba(49,73,48,0.34)',
    forestLink: 'rgba(54,78,51,0.38)',
    forestTrunk: '#65503b',
    forestCanopy: '#667657',
    forestCanopyDark: '#46583f',
    mountainGround: 'rgba(89,82,72,0.24)',
    mountainLink: 'rgba(72,66,59,0.52)',
    mountainFace: '#857e73',
    mountainShade: '#5f5b55',
    mountainSnow: 'rgba(218,213,196,0.66)',
    settlementGround: 'rgba(109,88,63,0.24)',
    road: 'rgba(83,65,46,0.50)',
    roadHighlight: 'rgba(224,203,159,0.30)',
    building: '#b49a73',
    roof: '#76533e',
    buildingInk: 'rgba(49,39,31,0.88)',
    cityWallShadow: 'rgba(38,31,25,0.72)',
    cityWall: '#9b8b70',
    cityWallLight: 'rgba(235,218,178,0.62)',
    villageFence: 'rgba(156,128,83,0.82)',
    trenchOuter: 'rgba(63,47,31,0.82)',
    trenchEarth: '#927449',
    trenchLight: 'rgba(218,187,126,0.66)'
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
    }
    else {
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
        }
        else {
            path.trace(context);
            fillRule ? context.clip(fillRule) : context.clip();
        }
        return;
    }
    context.clip(path, fillRule);
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

function addPolygon(path, points, close = true) {
    if (!points?.length) return;
    path.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) path.lineTo(points[index].x, points[index].y);
    if (close) path.closePath();
}

function addLine(path, from, to) {
    path.moveTo(from.x, from.y);
    path.lineTo(to.x, to.y);
}

// Canvas arc()/ellipse() continue the current sub-path by inserting a straight
// segment when its start point differs from the previous current point.  The
// terrain layer batches every tree crown (and isolated trench) into shared
// paths, so each closed primitive must explicitly start its own sub-path.
// Otherwise distant circles are joined and fill() turns those connectors into
// large triangles spanning unrelated tiles.
function addCircle(path, x, y, radius) {
    path.moveTo(x + radius, y);
    path.arc(x, y, radius, 0, Math.PI * 2);
    path.closePath();
}

function addEllipse(path, x, y, radiusX, radiusY) {
    path.moveTo(x + radiusX, y);
    path.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    path.closePath();
}

function addEllipseArc(path, x, y, radiusX, radiusY, startAngle, endAngle) {
    path.moveTo(x + Math.cos(startAngle) * radiusX, y + Math.sin(startAngle) * radiusY);
    path.ellipse(x, y, radiusX, radiusY, 0, startAngle, endAngle);
}

function addHouse(paths, x, y, size, rotation = 0) {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const transform = (px, py) => ({ x: x + px * cos - py * sin, y: y + px * sin + py * cos });
    const halfWidth = size * 0.48;
    const top = -size * 0.12;
    const bottom = size * 0.42;
    addPolygon(paths.buildings, [
        transform(-halfWidth, top), transform(halfWidth, top),
        transform(halfWidth, bottom), transform(-halfWidth, bottom)
    ]);
    addPolygon(paths.roofs, [
        transform(-size * 0.62, top), transform(0, -size * 0.58), transform(size * 0.62, top)
    ]);
}

function addPeak(paths, x, y, size, height, lean) {
    const left = { x: x - size, y: y + size * 0.42 };
    const top = { x: x + lean * size * 0.16, y: y - height };
    const split = { x: x + size * 0.08, y: y + size * 0.42 };
    const right = { x: x + size, y: y + size * 0.42 };
    addPolygon(paths.mountainDarkFaces, [left, top, split]);
    addPolygon(paths.mountainLightFaces, [top, right, split]);
    addPolygon(paths.mountainSnow, [
        top,
        { x: x - size * 0.18, y: y - height * 0.52 },
        { x: x + size * 0.02, y: y - height * 0.62 },
        { x: x + size * 0.28, y: y - height * 0.40 }
    ]);
}

function pseudoRandom(q, r, salt) {
    let value = Math.imul((q | 0) ^ 0x9e3779b9, 0x85ebca6b);
    value ^= Math.imul((r | 0) ^ salt, 0xc2b2ae35);
    value ^= value >>> 16;
    return (value >>> 0) / 0xffffffff;
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

function edgePoints(projected, edgeIndex, inset = 1) {
    const first = projected.vertices[edgeIndex];
    const second = projected.vertices[(edgeIndex + 1) % 6];
    if (inset === 1) return [first, second];
    const scalePoint = point => ({
        x: projected.x + (point.x - projected.x) * inset,
        y: projected.y + (point.y - projected.y) * inset
    });
    return [scalePoint(first), scalePoint(second)];
}

function scenePlayableTiles(scene) {
    const candidates = scene?.playableTiles || scene?.tiles || [];
    return candidates.filter(tile => tile?.renderOnly !== true && tile?.playable !== false);
}

function sceneRenderTiles(scene, playableTiles) {
    return scene?.renderTiles || scene?.tiles || playableTiles;
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
    const playableMap = scene?.tileMap instanceof Map
        ? scene.tileMap
        : new Map(playableTiles.map(tile => [terrainTopologyTileKey(tile), tile]));
    const topology = scene?.terrainTopology || buildTerrainTopology(playableTiles, playableMap);
    const projection = options.projection || scene?.projection || null;
    const fallbackSize = Math.max(1, finite(options.hexSize ?? scene?.board?.hexSize, DEFAULT_HEX_SIZE));
    const projected = new Map();
    for (const tile of playableTiles) {
        const point = projectTile(tile, projection, 'playable', fallbackSize);
        if (point) projected.set(terrainTopologyTileKey(tile), point);
    }

    // Touch the render projection at compile time as part of the public
    // playable/render contract.  Render-only cells are counted and projected,
    // but never promoted into authored terrain topology.
    let projectedRenderTileCount = 0;
    for (const tile of renderTiles) {
        const channel = tile?.renderOnly === true || tile?.playable === false ? 'render' : 'playable';
        if (projectTile(tile, projection, channel, fallbackSize)) projectedRenderTileCount++;
    }

    const paths = {
        plainsGround: new CompiledPath(pathFactory),
        plainsSpecks: new CompiledPath(pathFactory),
        forestGround: new CompiledPath(pathFactory),
        forestLinks: new CompiledPath(pathFactory),
        forestTrunks: new CompiledPath(pathFactory),
        forestCanopyDark: new CompiledPath(pathFactory),
        forestCanopy: new CompiledPath(pathFactory),
        mountainGround: new CompiledPath(pathFactory),
        mountainRidges: new CompiledPath(pathFactory),
        mountainDarkFaces: new CompiledPath(pathFactory),
        mountainLightFaces: new CompiledPath(pathFactory),
        mountainSnow: new CompiledPath(pathFactory),
        settlementGround: new CompiledPath(pathFactory),
        roads: new CompiledPath(pathFactory),
        buildings: new CompiledPath(pathFactory),
        roofs: new CompiledPath(pathFactory),
        cityWalls: new CompiledPath(pathFactory),
        villageFences: new CompiledPath(pathFactory),
        trenchLines: new CompiledPath(pathFactory),
        trenchIslands: new CompiledPath(pathFactory),
        trenchFronts: new CompiledPath(pathFactory)
    };

    for (const tileRef of topology.forest.tiles) {
        const point = projected.get(tileRef.key);
        if (!point) continue;
        // Slightly overlap authored neighbours so the terrain reads as one
        // continuous surface. The old centre-to-centre stroke made a dark bar
        // through every forest cluster and obscured the actual tree language.
        addPolygon(paths.forestGround, point.vertices.map(vertex => ({
            x: point.x + (vertex.x - point.x) * 1.01,
            y: point.y + (vertex.y - point.y) * 1.01
        })));
        for (let index = 0; index < 3; index++) {
            const offsetX = (pseudoRandom(tileRef.q, tileRef.r, 110 + index) - 0.5) * point.size * 1.05;
            const offsetY = (pseudoRandom(tileRef.q, tileRef.r, 210 + index) - 0.5) * point.size * 0.76;
            const scale = point.size * (0.18 + pseudoRandom(tileRef.q, tileRef.r, 310 + index) * 0.06);
            const x = point.x + offsetX;
            const y = point.y + offsetY;
            paths.forestTrunks.rect(x - scale * 0.08, y, scale * 0.16, scale * 0.58);
            addCircle(paths.forestCanopyDark, x + scale * 0.08, y - scale * 0.08, scale * 0.72);
            addCircle(paths.forestCanopy, x - scale * 0.18, y - scale * 0.22, scale * 0.55);
            addCircle(paths.forestCanopy, x + scale * 0.27, y - scale * 0.19, scale * 0.48);
        }
    }
    for (const link of topology.forest.links) {
        const from = projected.get(link.from.key);
        const to = projected.get(link.to.key);
        if (from && to) addLine(paths.forestLinks, from, to);
    }

    for (const tileRef of topology.mountain.tiles) {
        const point = projected.get(tileRef.key);
        if (!point) continue;
        addPolygon(paths.mountainGround, point.vertices.map(vertex => ({
            x: point.x + (vertex.x - point.x) * 1.01,
            y: point.y + (vertex.y - point.y) * 1.01
        })));
        const lean = pseudoRandom(tileRef.q, tileRef.r, 411) > 0.5 ? 1 : -1;
        addPeak(paths, point.x, point.y + point.size * 0.12, point.size * 0.54, point.size * 0.78, lean);
    }
    for (const link of topology.mountain.links) {
        const from = projected.get(link.from.key);
        const to = projected.get(link.to.key);
        if (from && to) addLine(paths.mountainRidges, from, to);
    }

    for (const tileRef of topology.plains.tiles) {
        const point = projected.get(tileRef.key);
        if (!point) continue;
        // A soft grass-soil base that sits behind forest/mountain overlays and
        // keeps empty tiles from reading as pure faction wash. Subtle random
        // specks break up the large solid-colour area without crossing to a
        // full tiled texture.
        addPolygon(paths.plainsGround, point.vertices.map(vertex => ({
            x: point.x + (vertex.x - point.x) * 1.01,
            y: point.y + (vertex.y - point.y) * 1.01
        })));
        // 2-3 tiny grass specks per tile for organic variation
        const speckCount = 2 + Math.round(pseudoRandom(tileRef.q, tileRef.r, 510) * 1.5);
        for (let index = 0; index < speckCount; index++) {
            const ox = (pseudoRandom(tileRef.q, tileRef.r, 610 + index) - 0.5) * point.size * 1.2;
            const oy = (pseudoRandom(tileRef.q, tileRef.r, 710 + index) - 0.5) * point.size * 0.9;
            const r = point.size * (0.03 + pseudoRandom(tileRef.q, tileRef.r, 810 + index) * 0.04);
            addCircle(paths.plainsSpecks, point.x + ox, point.y + oy, r);
        }
    }

    const addSettlementTile = (tileRef, kind) => {
        const point = projected.get(tileRef.key);
        if (!point) return;
        addPolygon(paths.settlementGround, point.vertices.map(vertex => ({
            x: point.x + (vertex.x - point.x) * 0.94,
            y: point.y + (vertex.y - point.y) * 0.94
        })));
        const first = kind === 'urban'
            ? [-0.42, -0.26, 0.24, -0.07]
            : [-0.34, -0.22, 0.28, -0.12];
        const second = kind === 'urban'
            ? [0.38, 0.24, 0.21, 0.05]
            : [0.34, 0.20, 0.23, 0.08];
        addHouse(paths, point.x + point.size * first[0], point.y + point.size * first[1], point.size * first[2], first[3]);
        addHouse(paths, point.x + point.size * second[0], point.y + point.size * second[1], point.size * second[2], second[3]);
    };

    for (const footprint of topology.urbanFootprints) {
        for (const tileRef of footprint.tiles) addSettlementTile(tileRef, 'urban');
        // The large-city footprint is already unified by one outer wall and a
        // shared ground material. Centre-to-centre roads read as unexplained
        // dark bars (and form a star in seven-cell cities), so urban links are
        // topology-only. Villages retain their lighter connecting tracks.
        for (const edge of footprint.boundaryEdges) {
            const point = projected.get(edge.tile.key);
            if (!point) continue;
            const [from, to] = edgePoints(point, edge.edgeIndex, 0.91);
            addLine(paths.cityWalls, from, to);
        }
    }

    for (const footprint of topology.villageFootprints) {
        for (const tileRef of footprint.tiles) addSettlementTile(tileRef, 'village');
        for (const link of footprint.links) {
            const from = projected.get(link.from.key);
            const to = projected.get(link.to.key);
            if (from && to) addLine(paths.roads, from, to);
        }
        for (const edge of footprint.boundaryEdges) {
            const point = projected.get(edge.tile.key);
            if (!point) continue;
            const [from, to] = edgePoints(point, edge.edgeIndex, 0.89);
            addLine(paths.villageFences, from, to);
        }
    }

    const trenchDegree = new Map(topology.trench.tiles.map(tile => [tile.key, 0]));
    for (const link of topology.trench.links) {
        trenchDegree.set(link.from.key, (trenchDegree.get(link.from.key) || 0) + 1);
        trenchDegree.set(link.to.key, (trenchDegree.get(link.to.key) || 0) + 1);
        const from = projected.get(link.from.key);
        const to = projected.get(link.to.key);
        if (!from || !to) continue;
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy) || 1;
        const normalX = -dy / length;
        const normalY = dx / length;
        const steps = 8;
        const groundOffsetY = from.size * 0.12;
        paths.trenchLines.moveTo(from.x, from.y + groundOffsetY);
        for (let step = 1; step <= steps; step++) {
            const ratio = step / steps;
            const zigzag = step === steps ? 0 : (step % 2 ? 1 : -1) * from.size * 0.055;
            paths.trenchLines.lineTo(
                from.x + dx * ratio + normalX * zigzag,
                from.y + dy * ratio + normalY * zigzag + groundOffsetY
            );
        }
    }
    for (const tileRef of topology.trench.tiles) {
        const point = projected.get(tileRef.key);
        if (!point) continue;
        const centerY = point.y + point.size * 0.08;
        if ((trenchDegree.get(tileRef.key) || 0) === 0) {
            addEllipse(paths.trenchIslands, point.x, centerY, point.size * 0.58, point.size * 0.34);
        }
        // Bottom bank is drawn again after units. This is the production
        // version of the prototype's rear-bank -> sphere -> front-bank stack.
        addEllipseArc(paths.trenchFronts, point.x, centerY, point.size * 0.58, point.size * 0.34, 0, Math.PI);
    }

    for (const path of Object.values(paths)) path.seal();
    const metrics = Object.freeze({
        playableTileCount: playableTiles.length,
        renderTileCount: renderTiles.length,
        projectedRenderTileCount,
        forestTileCount: topology.forest.tiles.length,
        forestLinkCount: topology.forest.links.length,
        mountainTileCount: topology.mountain.tiles.length,
        mountainRidgeCount: topology.mountain.links.length,
        urbanFootprintCount: topology.urbanFootprints.length,
        urbanWallEdgeCount: topology.urbanFootprints.reduce((sum, footprint) => sum + footprint.boundaryEdges.length, 0),
        villageFootprintCount: topology.villageFootprints.length,
        villageFenceEdgeCount: topology.villageFootprints.reduce((sum, footprint) => sum + footprint.boundaryEdges.length, 0),
        trenchTileCount: topology.trench.tiles.length,
        trenchLinkCount: topology.trench.links.length
    });
    return { paths: Object.freeze(paths), topology, metrics, fallbackSize };
}

/** Compile one immutable terrain layer. Prefer CanvasTerrainRenderer.sync(). */
export function createCanvasTerrainLayer(scene, options = {}) {
    if (!scene || typeof scene !== 'object') throw new TypeError('scene must be an object');
    const pathFactory = options.pathFactory;
    const compiled = buildPaths(scene, options, pathFactory);
    const projection = options.projection || scene.projection || null;
    return Object.freeze({
        version: CANVAS_TERRAIN_LAYER_VERSION,
        boardRevision: revisionOf(scene, options),
        projectionRevision: projectionRevisionOf(scene, projection, options),
        topology: compiled.topology,
        paths: compiled.paths,
        metrics: compiled.metrics,
        hexSize: compiled.fallbackSize,
        palette: mergePalette(options.palette)
    });
}

function drawGround(context, layer) {
    const { paths, palette, hexSize: size } = layer;
    // Plains has no ground tint — only random specks break up the faction wash.
    context.fillStyle = palette.plainsSpeck;
    fillPath(context, paths.plainsSpecks);

    context.fillStyle = palette.forestGround;
    fillPath(context, paths.forestGround);

    context.fillStyle = palette.mountainGround;
    fillPath(context, paths.mountainGround);

    // Topology links remain compiled for metrics and future contour work, but
    // are intentionally not painted: full-cell ground faces now provide the
    // continuity without unexplained centre-to-centre strips.

    context.fillStyle = palette.settlementGround;
    fillPath(context, paths.settlementGround);
    context.strokeStyle = palette.road;
    context.lineWidth = size * 0.17;
    strokePath(context, paths.roads);
    context.strokeStyle = palette.roadHighlight;
    context.lineWidth = Math.max(0.7, size * 0.025);
    context.setLineDash([size * 0.08, size * 0.09]);
    strokePath(context, paths.roads);
    context.setLineDash([]);
}

function drawRelief(context, layer) {
    const { paths, palette, hexSize: size } = layer;
    context.fillStyle = palette.forestTrunk;
    fillPath(context, paths.forestTrunks);
    context.fillStyle = palette.forestCanopyDark;
    fillPath(context, paths.forestCanopyDark);
    context.fillStyle = palette.forestCanopy;
    fillPath(context, paths.forestCanopy);

    context.fillStyle = palette.mountainShade;
    fillPath(context, paths.mountainDarkFaces);
    context.fillStyle = palette.mountainFace;
    fillPath(context, paths.mountainLightFaces);
    context.fillStyle = palette.mountainSnow;
    fillPath(context, paths.mountainSnow);

    context.fillStyle = palette.building;
    context.strokeStyle = palette.buildingInk;
    context.lineWidth = Math.max(0.7, size * 0.025);
    fillPath(context, paths.buildings);
    strokePath(context, paths.buildings);
    context.fillStyle = palette.roof;
    fillPath(context, paths.roofs);
    strokePath(context, paths.roofs);

    context.lineCap = 'round';
    context.strokeStyle = palette.cityWallShadow;
    context.lineWidth = size * 0.16;
    strokePath(context, paths.cityWalls);
    context.strokeStyle = palette.cityWall;
    context.lineWidth = size * 0.105;
    strokePath(context, paths.cityWalls);
    context.strokeStyle = palette.cityWallLight;
    context.lineWidth = Math.max(0.7, size * 0.022);
    strokePath(context, paths.cityWalls);

    context.strokeStyle = palette.villageFence;
    context.lineWidth = size * 0.07;
    context.setLineDash([size * 0.10, size * 0.055]);
    strokePath(context, paths.villageFences);
    context.setLineDash([]);
}

function drawFortifications(context, layer) {
    const { paths, palette, hexSize: size } = layer;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    // A trench is a dark cut flanked by earthworks, not a brown connector
    // between units. Build the banks first and leave the recessed channel as
    // the visually dominant final pass.
    context.strokeStyle = palette.trenchOuter;
    context.lineWidth = size * 0.24;
    strokePath(context, paths.trenchLines);
    strokePath(context, paths.trenchIslands);
    context.strokeStyle = palette.trenchEarth;
    context.lineWidth = size * 0.19;
    strokePath(context, paths.trenchLines);
    strokePath(context, paths.trenchIslands);
    context.strokeStyle = palette.trenchLight;
    context.lineWidth = size * 0.145;
    context.setLineDash([size * 0.09, size * 0.05]);
    strokePath(context, paths.trenchLines);
    strokePath(context, paths.trenchIslands);
    context.setLineDash([]);
    context.strokeStyle = palette.trenchOuter;
    context.lineWidth = size * 0.085;
    strokePath(context, paths.trenchLines);
    strokePath(context, paths.trenchIslands);
}

function drawFortificationFronts(context, layer) {
    const { paths, palette, hexSize: size } = layer;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = palette.trenchOuter;
    context.lineWidth = size * 0.19;
    strokePath(context, paths.trenchFronts);
    context.strokeStyle = palette.trenchEarth;
    context.lineWidth = size * 0.125;
    strokePath(context, paths.trenchFronts);
    context.strokeStyle = palette.trenchLight;
    context.lineWidth = Math.max(0.7, size * 0.022);
    context.setLineDash([size * 0.09, size * 0.055]);
    strokePath(context, paths.trenchFronts);
    context.setLineDash([]);
}

/** Draw a previously compiled layer without rebuilding geometry. */
export function drawCanvasTerrainLayer(context, layer, options = {}) {
    if (!context || !layer) return false;
    const phase = options.phase || CANVAS_TERRAIN_PHASE.ALL;
    const alpha = clamp(finite(options.alpha, 1), 0, 1);
    context.save();
    applyClip(context, options.clip);
    context.globalAlpha = finite(context.globalAlpha, 1) * alpha;
    if (phase === CANVAS_TERRAIN_PHASE.ALL || phase === CANVAS_TERRAIN_PHASE.GROUND) drawGround(context, layer);
    if (phase === CANVAS_TERRAIN_PHASE.ALL || phase === CANVAS_TERRAIN_PHASE.RELIEF) drawRelief(context, layer);
    if (phase === CANVAS_TERRAIN_PHASE.ALL || phase === CANVAS_TERRAIN_PHASE.FORTIFICATIONS) drawFortifications(context, layer);
    if (phase === CANVAS_TERRAIN_PHASE.ALL || phase === CANVAS_TERRAIN_PHASE.FORTIFICATIONS_FRONT) drawFortificationFronts(context, layer);
    context.restore();
    return true;
}

/**
 * Small stateful cache boundary for the production renderer.  Call sync() when
 * game state is submitted and render() every frame.  A stable boardRevision +
 * projectionRevision guarantees that no paths are re-created in render().
 */
export class CanvasTerrainRenderer {
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
            topology: boardRevision == null ? scene?.terrainTopology : null,
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
            && previous.projection === identity.projection
            && previous.boardRevision === identity.boardRevision
            && previous.projectionRevision === identity.projectionRevision
            && previous.palette === identity.palette
            && previous.pathFactory === identity.pathFactory
            && previous.hexSize === identity.hexSize;
        if (unchanged) return false;
        this.layer = createCanvasTerrainLayer(scene, merged);
        this._identity = identity;
        this.rebuildCount++;
        return true;
    }

    invalidate() {
        this._identity = null;
    }

    render(context, options = {}) {
        if (!this.layer) return false;
        const rendered = drawCanvasTerrainLayer(context, this.layer, options);
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

export function isContinuousTerrainTile(tile) {
    const terrain = terrainFeatureType(tile);
    return terrain === 'forest'
        || terrain === 'mountain'
        || terrainFortificationType(tile) === 'trench'
        || tile?.isUrban === true
        || tile?.isVillage === true;
}
