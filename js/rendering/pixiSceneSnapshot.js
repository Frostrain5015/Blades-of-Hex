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
    const radius = positive(source.radius, 21);
    if (radius <= 0) throw new TypeError('originMarker.radius must be positive');
    return {
        x: location.x,
        y: location.y,
        radius,
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

function normalizeRangeRegion(source, index) {
    return {
        id: id(source?.id, `range-region-${index}`),
        cells: (source?.cells || []).map((cell, cellIndex) =>
            points(cell?.points || cell, `rangeRegions[${index}].cells[${cellIndex}]`, 3)),
        edges: (source?.edges || []).map((edge, edgeIndex) =>
            points(edge?.points || edge, `rangeRegions[${index}].edges[${edgeIndex}]`, 2)),
        color: color(source?.color, 0x6ec8ff),
        fillAlpha: alpha(source?.fillAlpha, 0.035),
        lineAlpha: alpha(source?.lineAlpha, 0.76),
        lineWidth: positive(source?.lineWidth, 2.2),
        startedAtMs: Math.max(0, finite(source?.startedAtMs, 0)),
        durationMs: Math.max(1, positive(source?.durationMs, 360)),
        endingStartedAtMs: Math.max(0, finite(source?.endingStartedAtMs, 0)),
        endingDurationMs: Math.max(1, positive(source?.endingDurationMs, 240)),
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
        antiAirCells: (source.antiAirCells || []).map(normalizeAntiAirCell)
    };
    return createImmutableRenderValue(normalized, 'pixiSceneSnapshot');
}
