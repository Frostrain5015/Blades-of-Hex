import { createImmutableRenderValue } from './renderBackend.js';

export const PIXI_SCENE_SNAPSHOT_VERSION = 1;

const DEFAULTS = Object.freeze({
    surfaceColor: 0x0c1518,
    tileFillColor: 0x172428,
    gridColor: 0x476168,
    boundaryColor: 0xa7dbe0,
    unitColor: 0x738b91,
    unitOutlineColor: 0xd6f4f5,
    healthBackgroundColor: 0x071011,
    healthFillColor: 0x72e18b,
    originColor: 0x63efff
});

function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback) {
    return Math.max(0, finite(value, fallback));
}

function alpha(value, fallback = 1) {
    return Math.max(0, Math.min(1, finite(value, fallback)));
}

function color(value, fallback) {
    if (Number.isFinite(Number(value))) {
        return Math.max(0, Math.min(0xffffff, Math.trunc(Number(value))));
    }
    if (typeof value === 'string') {
        const source = value.trim();
        const match = /^(?:#|0x)?([0-9a-f]{6})$/i.exec(source);
        if (match) return Number.parseInt(match[1], 16);
        const short = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(source);
        if (short) return Number.parseInt(`${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`, 16);
    }
    return fallback;
}

function point(value, label) {
    const x = Array.isArray(value) ? value[0] : value?.x;
    const y = Array.isArray(value) ? value[1] : value?.y;
    if (!Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) {
        throw new TypeError(`${label} must contain finite x and y coordinates`);
    }
    return { x: Number(x), y: Number(y) };
}

function points(value, label, minimum) {
    if (!Array.isArray(value) || value.length < minimum) {
        throw new TypeError(`${label} must contain at least ${minimum} points`);
    }
    return value.map((entry, index) => point(entry, `${label}[${index}]`));
}

function id(value, fallback) {
    if (value === null || value === undefined || value === '') return fallback;
    return String(value);
}

function normalizeSurface(source = {}) {
    const bounds = source.bounds || source;
    return {
        x: finite(bounds.x, 0),
        y: finite(bounds.y, 0),
        width: positive(bounds.width, 0),
        height: positive(bounds.height, 0),
        color: color(source.color, DEFAULTS.surfaceColor),
        alpha: alpha(source.alpha, 1)
    };
}

function normalizeTile(source, index) {
    return {
        id: id(source?.id, `tile-${index}`),
        points: points(source?.points || source?.polygon, `tiles[${index}].points`, 3),
        fillColor: color(source?.fillColor ?? source?.color, DEFAULTS.tileFillColor),
        fillAlpha: alpha(source?.fillAlpha, 1),
        gridColor: color(source?.gridColor, DEFAULTS.gridColor),
        gridAlpha: alpha(source?.gridAlpha, 0.52),
        gridWidth: positive(source?.gridWidth, 1)
    };
}

function normalizeBoundary(source, index) {
    return {
        id: id(source?.id, `boundary-${index}`),
        points: points(source?.points, `boundaries[${index}].points`, 2),
        closed: Boolean(source?.closed),
        color: color(source?.color, DEFAULTS.boundaryColor),
        alpha: alpha(source?.alpha, 0.9),
        width: positive(source?.width, 2)
    };
}

function normalizeHealth(source, unitRadius) {
    if (source === null || source === false || source === undefined) return null;
    const health = typeof source === 'number' ? { ratio: source } : source;
    return {
        ratio: Math.max(0, Math.min(1, finite(health?.ratio, 0))),
        shieldRatio: Math.max(0, Math.min(1, finite(health?.shieldRatio, 0))),
        ringRadius: positive(health?.ringRadius, unitRadius + 3.1),
        trackColor: color(health?.trackColor ?? health?.backgroundColor, DEFAULTS.healthBackgroundColor),
        trackAlpha: alpha(health?.trackAlpha ?? health?.backgroundAlpha, 0.68),
        trackWidth: positive(health?.trackWidth, 2.1),
        fillColor: color(health?.fillColor, DEFAULTS.healthFillColor),
        fillAlpha: alpha(health?.fillAlpha, 1),
        fillWidth: positive(health?.fillWidth, 2.35),
        shieldRadius: positive(health?.shieldRadius, unitRadius + 4.35),
        shieldColor: color(health?.shieldColor, 0x68dff2),
        shieldAlpha: alpha(health?.shieldAlpha, 0.96),
        shieldWidth: positive(health?.shieldWidth, 1.45)
    };
}

function normalizeUnit(source, index) {
    const radius = positive(source?.radius, 15);
    if (radius <= 0) throw new TypeError(`units[${index}].radius must be positive`);
    const location = point(source, `units[${index}]`);
    return {
        id: id(source?.id, `unit-${index}`),
        x: location.x,
        y: location.y,
        radius,
        color: color(source?.color, DEFAULTS.unitColor),
        alpha: alpha(source?.alpha, 1),
        outlineColor: color(source?.outlineColor, DEFAULTS.unitOutlineColor),
        outlineAlpha: alpha(source?.outlineAlpha, 0.84),
        outlineWidth: positive(source?.outlineWidth, 1.5),
        highlightColor: color(source?.highlightColor, 0xffffff),
        highlightAlpha: alpha(source?.highlightAlpha, 0.2),
        shadowColor: color(source?.shadowColor, 0x000000),
        shadowAlpha: alpha(source?.shadowAlpha, 0.35),
        health: normalizeHealth(source?.health ?? source?.healthRatio, radius)
    };
}

function normalizeOriginMarker(source) {
    if (!source) return null;
    const location = point(source, 'originMarker');
    const unitRadius = positive(source.unitRadius, 15);
    const radius = positive(source.radius, unitRadius * 1.32);
    if (radius <= 0) throw new TypeError('originMarker.radius must be positive');
    return {
        x: location.x,
        y: location.y,
        radius,
        unitRadius,
        action: source.action === 'attack' ? 'attack' : 'move',
        color: color(source.color, DEFAULTS.originColor),
        alpha: alpha(source.alpha, 0.9),
        fillAlpha: alpha(source.fillAlpha, 0.1),
        ringWidth: positive(source.ringWidth, 1.6),
        hatchWidth: positive(source.hatchWidth, 1),
        hatchSpacing: Math.max(2, positive(source.hatchSpacing, 6)),
        motif: typeof source.motif === 'string' ? source.motif : 'origin',
        pulse: Boolean(source.pulse),
        pulsePeriodMs: Math.max(240, positive(source.pulsePeriodMs, 1400)),
        pulseAmount: Math.max(0, Math.min(0.24, positive(source.pulseAmount, 0.08)))
    };
}

const TARGET_MOTIFS = new Set([
    'attack', 'mobility', 'shield', 'heal', 'attach', 'deployment',
    'transport', 'area', 'origin'
]);

function normalizeTargetFrame(source, index) {
    const location = point(source?.center || source, `targetFrames[${index}].center`);
    const motif = TARGET_MOTIFS.has(source?.motif) ? source.motif : 'attack';
    return {
        id: id(source?.id, `target-frame-${index}`),
        x: location.x,
        y: location.y,
        size: Math.max(8, positive(source?.size, 31)),
        color: color(source?.color, DEFAULTS.originColor),
        alpha: alpha(source?.alpha, 1),
        active: Boolean(source?.active),
        motif,
        phase: finite(source?.phase, index * 0.31),
        startedAtMs: Math.max(0, finite(source?.startedAtMs, 0)),
        delayMs: Math.max(0, finite(source?.delayMs, 0)),
        durationMs: Math.max(1, positive(source?.durationMs, 300)),
        endingStartedAtMs: Math.max(0, finite(source?.endingStartedAtMs, 0)),
        endingDurationMs: Math.max(1, positive(source?.endingDurationMs, 220))
    };
}

function normalizeRegionCell(source, index, cellIndex) {
    // Legacy shape: plain polygon (array of points) — kept for tests/tools.
    // `.polygon` re-enters when an already-normalized scene is merged for
    // exit animations and normalized again.
    const polygon = Array.isArray(source) ? source : (source?.points ?? source?.polygon);
    if (Array.isArray(polygon)) {
        return { polygon: points(polygon, `rangeRegions[${index}].cells[${cellIndex}]`, 3) };
    }
    // Jelly-reveal cell: hexagon rebuilt per frame around its center.
    const location = point(source, `rangeRegions[${index}].cells[${cellIndex}]`);
    return {
        x: location.x,
        y: location.y,
        size: positive(source?.size, 30),
        distance: Math.max(0, finite(source?.distance, 0))
    };
}

function normalizeRangeRegion(source, index) {
    return {
        id: id(source?.id, `range-region-${index}`),
        cells: (source?.cells || []).map((cell, cellIndex) => normalizeRegionCell(cell, index, cellIndex)),
        fillPolygons: (source?.fillPolygons || []).map((cell, cellIndex) =>
            points(cell?.points || cell, `rangeRegions[${index}].fillPolygons[${cellIndex}]`, 3)),
        edges: (source?.edges || []).map((edge, edgeIndex) =>
            points(edge?.points || edge, `rangeRegions[${index}].edges[${edgeIndex}]`, 2)),
        color: color(source?.color, 0x41cdb9),
        borderColor: color(source?.borderColor, 0x50e1cd),
        innerLineColor: color(source?.innerLineColor, 0xd7fff8),
        fillAlpha: alpha(source?.fillAlpha, 0.13),
        lineAlpha: alpha(source?.lineAlpha, 0.72),
        linePulseAlpha: alpha(source?.linePulseAlpha, 0.14),
        lineWidth: positive(source?.lineWidth, 2.6),
        glowColor: color(source?.glowColor, 0x3ccdb9),
        glowAlpha: alpha(source?.glowAlpha, 0.42),
        glowBlur: Math.max(0, finite(source?.glowBlur, 6)),
        glowPulseBlur: Math.max(0, finite(source?.glowPulseBlur, 2.5)),
        innerLineAlpha: alpha(source?.innerLineAlpha, 0.34),
        innerLinePulseAlpha: alpha(source?.innerLinePulseAlpha, 0),
        innerLineWidth: positive(source?.innerLineWidth, 0.75),
        pulsePeriodMs: positive(source?.pulsePeriodMs, 420),
        startedAtMs: Math.max(0, finite(source?.startedAtMs, 0)),
        durationMs: Math.max(1, positive(source?.durationMs, 360)),
        endingStartedAtMs: Math.max(0, finite(source?.endingStartedAtMs, 0)),
        endingDurationMs: Math.max(1, positive(source?.endingDurationMs, 220)),
        phase: finite(source?.phase, index * 0.47)
    };
}

function normalizeAntiAirCell(source, index) {
    return {
        id: id(source?.id, `anti-air-${index}`),
        points: points(source?.points, `antiAirCells[${index}].points`, 3),
        x: finite(source?.x, 0),
        y: finite(source?.y, 0),
        radius: positive(source?.radius, 20),
        level: Math.max(1, Math.min(2, Math.trunc(finite(source?.level, 1)))),
        color: color(source?.color, 0xf1b44b),
        alpha: alpha(source?.alpha, 0.58),
        startedAtMs: Math.max(0, finite(source?.startedAtMs, 0)),
        delayMs: Math.max(0, finite(source?.delayMs, 0)),
        durationMs: Math.max(1, positive(source?.durationMs, 320)),
        endingStartedAtMs: Math.max(0, finite(source?.endingStartedAtMs, 0)),
        endingDurationMs: Math.max(1, positive(source?.endingDurationMs, 220)),
        phase: finite(source?.phase, index * 0.23)
    };
}

const ROUTE_ACTIONS = new Set(['move', 'melee', 'ranged']);
const ROUTE_TRAJECTORIES = new Set(['arc', 'straight']);

function normalizeRoutePath(source, index) {
    if (!source || !ROUTE_ACTIONS.has(source.action)) return null;
    const action = source.action;
    const points = (source.points || []).map((entry, pi) => {
        const x = Number.isFinite(entry?.x) ? entry.x : NaN;
        const y = Number.isFinite(entry?.y) ? entry.y : NaN;
        const distance = Number.isFinite(entry?.distance) ? entry.distance : 0;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new TypeError(`routePaths[${index}].points[${pi}] must contain finite x and y`);
        }
        return { x, y, distance };
    });
    if (points.length < 2) return null;
    const sx = Number.isFinite(source?.source?.x) ? source.source.x : points[0].x;
    const sy = Number.isFinite(source?.source?.y) ? source.source.y : points[0].y;
    const tx = Number.isFinite(source?.target?.x) ? source.target.x : points[points.length - 1].x;
    const ty = Number.isFinite(source?.target?.y) ? source.target.y : points[points.length - 1].y;
    return {
        id: String(source?.id ?? `route-path-${index}`),
        action,
        points,
        source: { x: sx, y: sy },
        target: { x: tx, y: ty },
        color: color(source?.color, action === 'move' ? 0x58c9b3 : 0xe95b50),
        alpha: alpha(source?.alpha, 1),
        unitRadius: positive(source?.unitRadius, 15),
        trajectory: ROUTE_TRAJECTORIES.has(source?.trajectory) ? source.trajectory : null,
        totalLength: Math.max(0, finite(source?.totalLength,
            points.reduce((acc, p, i) => i > 0 ? acc + Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) : 0, 0)
        ))
    };
}

function normalizeWorld(source = {}) {
    const scale = finite(source.scale, 1);
    if (scale <= 0) throw new TypeError('world.scale must be positive');
    return {
        x: finite(source.x, 0),
        y: finite(source.y, 0),
        scale
    };
}

/**
 * Convert already-resolved presentation geometry into a renderer-only DTO.
 * This function intentionally knows nothing about camps, ranges, BFS or card
 * legality. Callers decide what should be visible; the backend only draws it.
 */
export function createPixiSceneSnapshot(source = {}) {
    const normalized = {
        version: PIXI_SCENE_SNAPSHOT_VERSION,
        revision: Math.max(0, Math.trunc(finite(source.revision, 0))),
        world: normalizeWorld(source.world),
        surface: normalizeSurface(source.surface),
        tiles: (source.tiles || []).map(normalizeTile),
        boundaries: (source.boundaries || []).map(normalizeBoundary),
        units: (source.units || []).map(normalizeUnit),
        originMarker: normalizeOriginMarker(source.originMarker),
        targetFrames: (source.targetFrames || []).map(normalizeTargetFrame),
        rangeRegions: (source.rangeRegions || []).map(normalizeRangeRegion),
        antiAirCells: (source.antiAirCells || []).map(normalizeAntiAirCell),
        routePaths: (source.routePaths || [])
            .map(normalizeRoutePath)
            .filter(Boolean)
    };
    return createImmutableRenderValue(normalized, 'pixiSceneSnapshot');
}
