import { buildHexRegionContours } from './rendering/hexRegionContours.js';

// Canvas2D-only target preview primitives.
//
// This module deliberately knows nothing about game state, rules, input, or board
// coordinates. Callers pass immutable visual descriptors whose points have already
// been projected into screen space. Keeping the contract this small also makes the
// descriptors reusable by a future PixiJS adapter.

export const TARGETING_PREVIEW_KINDS = Object.freeze([
    'attack',
    'heal',
    'mobility',
    'attach',
    'shield',
    'paratrooper',
    'plane'
]);

export const TARGETING_PREVIEW_COLORS = Object.freeze({
    attack: '#f03b32',
    heal: '#62d98b',
    mobility: '#58c9b3',
    attach: '#d9b55c',
    shield: '#7fbaff',
    paratrooper: '#69c7e8',
    plane: '#f0c86f',
    deployment: '#69c7e8',
    area: '#a0c8ff',
    antiAir: '#ff4636',
    origin: '#58c9b3'
});

const KIND_SET = new Set(TARGETING_PREVIEW_KINDS);
const CORNERS = Object.freeze([[-1, -1], [1, -1], [1, 1], [-1, 1]]);
const TAU = Math.PI * 2;

/**
 * Shared descriptor contract (documentation only):
 *
 * ScreenShape = {
 *   center: { x, y },       // projected CSS-pixel position
 *   size: number,           // projected hex/unit radius in CSS pixels
 *   points?: [{ x, y }]     // optional projected polygon; replaces regular hex
 * }
 *
 * Animated descriptors additionally accept `time` in seconds, a stable numeric
 * `phase`, `active`, `color`, and multiplier `alpha`. Supplying time explicitly
 * keeps rendering deterministic and lets the caller stop animation at no cost.
 */

function finite(value, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function positive(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
}

function opacity(value, fallback = 1) {
    return Math.max(0, Math.min(1, finite(value, fallback)));
}

function validPoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function centerOf(points) {
    let x = 0;
    let y = 0;
    for (const point of points) {
        x += point.x;
        y += point.y;
    }
    return { x: x / points.length, y: y / points.length };
}

function shapeCenter(shape, points) {
    return validPoint(shape?.center) ? shape.center : centerOf(points);
}

function shapeSize(shape, points, fallback = 30) {
    const configured = positive(shape?.size, 0);
    if (configured) return configured;
    const center = shapeCenter(shape, points);
    let radius = 0;
    for (const point of points) radius = Math.max(radius, Math.hypot(point.x - center.x, point.y - center.y));
    return positive(radius, fallback);
}

function waveAt(time, speed, phase) {
    return (Math.sin(finite(time) * speed + finite(phase)) + 1) / 2;
}

function colorFor(kind, configured, fallback = '#ffffff') {
    return configured || TARGETING_PREVIEW_COLORS[kind] || fallback;
}

/**
 * Build a pointy-top regular hex from an already projected screen-space center.
 * @param {{x:number, y:number}} center
 * @param {number} size Screen-space radius.
 * @returns {Array<{x:number, y:number}>}
 */
export function regularHexPoints(center, size) {
    if (!validPoint(center)) return [];
    const radius = positive(size, 0);
    if (!radius) return [];
    const result = [];
    for (let index = 0; index < 6; index++) {
        const angle = -Math.PI / 2 + index * Math.PI / 3;
        result.push({
            x: center.x + Math.cos(angle) * radius,
            y: center.y + Math.sin(angle) * radius
        });
    }
    return result;
}

function pointsFor(shape, fallbackSize = 0) {
    if (Array.isArray(shape?.points)) {
        const points = shape.points.filter(validPoint);
        if (points.length >= 3) return points;
    }
    return regularHexPoints(shape?.center, positive(shape?.size, fallbackSize));
}

function scaledPoints(points, scale) {
    if (scale === 1) return points;
    const center = centerOf(points);
    return points.map(point => ({
        x: center.x + (point.x - center.x) * scale,
        y: center.y + (point.y - center.y) * scale
    }));
}

function appendPolygonPath(ctx, points) {
    if (points.length < 3) return false;
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) ctx.lineTo(points[index].x, points[index].y);
    ctx.closePath();
    return true;
}

/**
 * Add the board union to the current Canvas2D clip.
 *
 * `descriptor.shapes` contains only screen-space shapes that are allowed to
 * receive effects. Omit off-board shapes. Infinite-mode fake tiles can opt in by
 * being included in this list; this module does not infer their gameplay status.
 * The caller should wrap this call in save()/restore(), or use renderTargetingPreview.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{shapes:ReadonlyArray<object>, size?:number, scale?:number}} descriptor
 * @returns {boolean} Whether a non-empty clip was installed.
 */
export function clipToBoard(ctx, descriptor = {}) {
    const shapes = Array.isArray(descriptor.shapes) ? descriptor.shapes : [];
    const fallbackSize = positive(descriptor.size, 0);
    const scale = positive(descriptor.scale, 1.005);
    let appended = false;
    ctx.beginPath();
    for (const shape of shapes) {
        const points = pointsFor(shape, fallbackSize);
        if (points.length < 3) continue;
        appended = appendPolygonPath(ctx, scaledPoints(points, scale)) || appended;
    }
    if (appended) ctx.clip();
    return appended;
}

function applyDescriptorAlpha(ctx, descriptor) {
    ctx.globalAlpha *= opacity(descriptor?.alpha, 1);
}

function drawCornerFrame(ctx, center, size, color, active, wave) {
    const half = size * ((active ? 0.72 : 0.665) + wave * (active ? 0.038 : 0.018));
    const arm = size * (active ? 0.225 : 0.19);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * (active ? 0.058 : 0.044);
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.globalAlpha *= active ? 0.99 : 0.7 + wave * 0.12;
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? size * (0.18 + wave * 0.1) : size * (0.04 + wave * 0.035);
    for (const [sx, sy] of CORNERS) {
        ctx.beginPath();
        ctx.moveTo(center.x + sx * (half - arm), center.y + sy * half);
        ctx.lineTo(center.x + sx * half, center.y + sy * half);
        ctx.lineTo(center.x + sx * half, center.y + sy * (half - arm));
        ctx.stroke();
    }
}

function drawMotifPass(ctx, kind, size, active, crispAlpha, soft, baseAlpha) {
    const width = size * (active ? 0.052 : 0.042);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';
    ctx.lineWidth = width * (soft ? 2.2 : 1);
    ctx.globalAlpha = baseAlpha * (soft ? crispAlpha * 0.2 : crispAlpha);
    ctx.shadowBlur = soft ? size * (active ? 0.24 : 0.13) : size * (active ? 0.08 : 0.025);

    if (kind === 'attack') {
        const inner = size * 0.105;
        const outer = size * 0.35;
        ctx.beginPath();
        ctx.moveTo(-outer, 0); ctx.lineTo(-inner, 0);
        ctx.moveTo(inner, 0); ctx.lineTo(outer, 0);
        ctx.moveTo(0, -outer); ctx.lineTo(0, -inner);
        ctx.moveTo(0, inner); ctx.lineTo(0, outer);
        ctx.stroke();
        return;
    }

    if (kind === 'heal') {
        const length = size * 0.46;
        const thickness = size * 0.145;
        ctx.globalAlpha = baseAlpha * (soft ? crispAlpha * 0.18 : crispAlpha * 0.94);
        ctx.fillRect(-thickness / 2, -length / 2, thickness, length);
        ctx.fillRect(-length / 2, -thickness / 2, length, thickness);
        return;
    }

    if (kind === 'mobility') {
        ctx.lineWidth = size * (active ? 0.064 : 0.052) * (soft ? 2.1 : 1);
        for (const y of [-size * 0.105, size * 0.135]) {
            ctx.beginPath();
            ctx.moveTo(-size * 0.21, y + size * 0.115);
            ctx.lineTo(0, y - size * 0.095);
            ctx.lineTo(size * 0.21, y + size * 0.115);
            ctx.stroke();
        }
        return;
    }

    if (kind === 'attach') {
        const radius = size * 0.245;
        ctx.beginPath();
        ctx.moveTo(0, -radius);
        ctx.lineTo(radius * 0.78, 0);
        ctx.lineTo(0, radius);
        ctx.lineTo(-radius * 0.78, 0);
        ctx.closePath();
        ctx.stroke();
        if (!soft) {
            ctx.globalAlpha = baseAlpha * crispAlpha * 0.28;
            ctx.fill();
            ctx.globalAlpha = baseAlpha * crispAlpha;
            ctx.beginPath();
            ctx.moveTo(0, -radius * 0.48);
            ctx.lineTo(0, radius * 0.48);
            ctx.stroke();
        }
        return;
    }

    if (kind === 'shield') {
        const width = size * 0.25;
        const top = -size * 0.255;
        ctx.beginPath();
        ctx.moveTo(0, top);
        ctx.bezierCurveTo(width * 0.42, top + size * 0.04, width, top + size * 0.09, width, top + size * 0.18);
        ctx.bezierCurveTo(width, size * 0.13, width * 0.52, size * 0.25, 0, size * 0.315);
        ctx.bezierCurveTo(-width * 0.52, size * 0.25, -width, size * 0.13, -width, top + size * 0.18);
        ctx.bezierCurveTo(-width, top + size * 0.09, -width * 0.42, top + size * 0.04, 0, top);
        ctx.closePath();
        ctx.stroke();
        if (!soft) {
            ctx.globalAlpha = baseAlpha * crispAlpha * 0.22;
            ctx.fill();
        }
        return;
    }

    if (kind === 'plane') {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = size * (active ? 0.052 : 0.043) * (soft ? 2.15 : 1);
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.37);
        ctx.quadraticCurveTo(size * 0.045, -size * 0.31, size * 0.055, -size * 0.19);
        ctx.lineTo(size * 0.075, -size * 0.065);
        ctx.lineTo(size * 0.36, size * 0.085);
        ctx.lineTo(size * 0.36, size * 0.17);
        ctx.lineTo(size * 0.075, size * 0.105);
        ctx.lineTo(size * 0.055, size * 0.285);
        ctx.lineTo(size * 0.16, size * 0.34);
        ctx.lineTo(size * 0.16, size * 0.39);
        ctx.lineTo(0, size * 0.36);
        ctx.lineTo(-size * 0.16, size * 0.39);
        ctx.lineTo(-size * 0.16, size * 0.34);
        ctx.lineTo(-size * 0.055, size * 0.285);
        ctx.lineTo(-size * 0.075, size * 0.105);
        ctx.lineTo(-size * 0.36, size * 0.17);
        ctx.lineTo(-size * 0.36, size * 0.085);
        ctx.lineTo(-size * 0.075, -size * 0.065);
        ctx.lineTo(-size * 0.055, -size * 0.19);
        ctx.quadraticCurveTo(-size * 0.045, -size * 0.31, 0, -size * 0.37);
        ctx.closePath();
        ctx.stroke();
        if (!soft) {
            ctx.globalAlpha = baseAlpha * crispAlpha * 0.16;
            ctx.fill();
        }
        return;
    }

    // Paratrooper motif.
    const radius = size * 0.235;
    ctx.beginPath();
    ctx.arc(0, -size * 0.105, radius, Math.PI, 0);
    ctx.moveTo(-radius, -size * 0.105);
    ctx.lineTo(-size * 0.085, size * 0.105);
    ctx.moveTo(radius, -size * 0.105);
    ctx.lineTo(size * 0.085, size * 0.105);
    ctx.moveTo(0, -size * 0.34);
    ctx.lineTo(0, size * 0.105);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, size * 0.145, size * 0.055, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, size * 0.2);
    ctx.lineTo(0, size * 0.34);
    ctx.moveTo(-size * 0.11, size * 0.25);
    ctx.lineTo(size * 0.11, size * 0.25);
    ctx.stroke();
}

function drawHologramMotifResolved(ctx, descriptor, kind, size, active, wave, color) {
    const scale = (active ? 1.08 : 0.94) + wave * (active ? 0.045 : 0.025);
    const crispAlpha = active ? 0.98 : 0.72 + wave * 0.1;

    ctx.save();
    applyDescriptorAlpha(ctx, descriptor);
    const baseAlpha = ctx.globalAlpha;
    ctx.translate(descriptor.center.x, descriptor.center.y);
    ctx.scale(scale, scale);
    // Screen blending washed the attack crosshair toward pale pink while its
    // corner frame stayed saturated. Keep attack in source-over so motif,
    // frame and glow share one aggressive warning red.
    ctx.globalCompositeOperation = kind === 'attack' ? 'source-over' : 'screen';
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    drawMotifPass(ctx, kind, size, active, crispAlpha, true, baseAlpha);
    drawMotifPass(ctx, kind, size, active, crispAlpha, false, baseAlpha);
    ctx.restore();
    return true;
}

/** Draw one of the accepted center holograms without a surrounding frame. */
export function drawHologramMotif(ctx, descriptor = {}) {
    const kind = KIND_SET.has(descriptor.kind) ? descriptor.kind : 'attack';
    if (!validPoint(descriptor.center)) return false;
    const size = positive(descriptor.size, 30);
    const active = Boolean(descriptor.active);
    const wave = Number.isFinite(descriptor.wave)
        ? Math.max(0, Math.min(1, descriptor.wave))
        : waveAt(descriptor.time, 2.15, descriptor.phase);
    return drawHologramMotifResolved(
        ctx,
        descriptor,
        kind,
        size,
        active,
        wave,
        colorFor(kind, descriptor.color)
    );
}

/** Draw a breathing square-corner unit target and its semantic hologram. */
export function drawUnitTargetPreview(ctx, descriptor = {}) {
    if (!validPoint(descriptor.center)) return false;
    const kind = KIND_SET.has(descriptor.kind) ? descriptor.kind : 'attack';
    const size = positive(descriptor.size, 30);
    const active = Boolean(descriptor.active);
    const wave = waveAt(descriptor.time, 2.15, descriptor.phase);
    const color = colorFor(kind, descriptor.color);

    ctx.save();
    applyDescriptorAlpha(ctx, descriptor);
    drawCornerFrame(ctx, descriptor.center, size, color, active, wave);
    ctx.restore();
    drawHologramMotifResolved(ctx, descriptor, kind, size, active, wave, color);
    return true;
}

function drawCompactCorners(ctx, center, half, arm) {
    for (const [sx, sy] of CORNERS) {
        ctx.beginPath();
        ctx.moveTo(center.x + sx * (half - arm), center.y + sy * half);
        ctx.lineTo(center.x + sx * half, center.y + sy * half);
        ctx.lineTo(center.x + sx * half, center.y + sy * (half - arm));
        ctx.stroke();
    }
}

/** Draw the accepted dashed tile socket used by deployment actions. */
export function drawTileDeploymentPreview(ctx, descriptor = {}) {
    const points = pointsFor(descriptor, positive(descriptor.size, 30));
    if (points.length < 3) return false;
    const center = shapeCenter(descriptor, points);
    const size = shapeSize(descriptor, points);
    const active = Boolean(descriptor.active);
    const wave = waveAt(descriptor.time, 3, descriptor.phase);
    const color = colorFor('deployment', descriptor.color);

    ctx.save();
    applyDescriptorAlpha(ctx, descriptor);
    const baseAlpha = ctx.globalAlpha;
    ctx.beginPath();
    appendPolygonPath(ctx, scaledPoints(points, 0.88));
    ctx.fillStyle = color;
    ctx.globalAlpha = baseAlpha * (active ? 0.12 : 0.085);
    ctx.fill();
    ctx.globalAlpha = baseAlpha * (active ? 0.88 : 0.62);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * (active ? 0.045 : 0.036);
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? size * 0.1 : size * 0.025;
    ctx.setLineDash([size * 0.12, size * 0.105]);
    ctx.lineDashOffset = active ? -finite(descriptor.time) * size * 0.34 : 0;
    ctx.stroke();
    ctx.setLineDash([]);

    const half = size * (active ? 0.5 + wave * 0.035 : 0.47);
    drawCompactCorners(ctx, center, half, size * 0.16);

    if (descriptor.showStructure ?? active) {
        ctx.globalAlpha = baseAlpha * 0.52;
        ctx.fillStyle = color;
        ctx.strokeStyle = descriptor.structureStroke || '#dff7ff';
        ctx.lineWidth = size * 0.025;
        ctx.beginPath();
        ctx.rect(center.x - size * 0.28, center.y - size * 0.08, size * 0.56, size * 0.3);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(center.x - size * 0.32, center.y - size * 0.08);
        ctx.lineTo(center.x, center.y - size * 0.28);
        ctx.lineTo(center.x + size * 0.32, center.y - size * 0.08);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.globalAlpha = baseAlpha * 0.76;
        ctx.beginPath();
        ctx.arc(center.x, center.y + size * 0.06, size * 0.055, 0, TAU);
        ctx.fillStyle = descriptor.structureLight || '#e6fbff';
        ctx.fill();
    }
    ctx.restore();
    return true;
}

/** Draw a compact area-center marker; active markers gain the central cross. */
export function drawAreaCenterPreview(ctx, descriptor = {}) {
    if (!validPoint(descriptor.center)) return false;
    const size = positive(descriptor.size, 30);
    const active = Boolean(descriptor.active);
    const wave = waveAt(descriptor.time, 3.1, descriptor.phase);
    const half = size * (active ? 0.56 + wave * 0.025 : 0.34);
    const arm = size * (active ? 0.18 : 0.11);
    const color = colorFor('area', descriptor.color);

    ctx.save();
    applyDescriptorAlpha(ctx, descriptor);
    const baseAlpha = ctx.globalAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = size * (active ? 0.045 : 0.03);
    ctx.globalAlpha = baseAlpha * (active ? 0.94 : 0.5);
    ctx.lineCap = 'square';
    ctx.shadowColor = color;
    ctx.shadowBlur = active ? size * 0.13 : size * 0.025;
    drawCompactCorners(ctx, descriptor.center, half, arm);
    if (active) {
        ctx.shadowBlur = 0;
        ctx.globalAlpha = baseAlpha * 0.82;
        ctx.beginPath();
        ctx.moveTo(descriptor.center.x - size * 0.12, descriptor.center.y);
        ctx.lineTo(descriptor.center.x + size * 0.12, descriptor.center.y);
        ctx.moveTo(descriptor.center.x, descriptor.center.y - size * 0.12);
        ctx.lineTo(descriptor.center.x, descriptor.center.y + size * 0.12);
        ctx.stroke();
    }
    ctx.restore();
    return true;
}

function boundsOf(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
    }
    return { minX, minY, maxX, maxY };
}

function drawHatchLines(ctx, bounds, spacing, reverse = false) {
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 1.4;
    for (let offset = -span * 2; offset <= span * 2; offset += spacing) {
        ctx.beginPath();
        if (reverse) {
            ctx.moveTo(centerX - span, centerY + offset - span);
            ctx.lineTo(centerX + span, centerY + offset + span);
        } else {
            ctx.moveTo(centerX - span, centerY + offset + span);
            ctx.lineTo(centerX + span, centerY + offset - span);
        }
        ctx.stroke();
    }
}

function appendRoundRectPath(ctx, x, y, width, height, radius) {
    const r = Math.max(0, Math.min(radius, width / 2, height / 2));
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function insetContour(contour, insetPx) {
    const count = Array.isArray(contour) ? contour.length : 0;
    if (count < 3 || !Number.isFinite(insetPx) || insetPx <= 0) return contour;
    return contour.map((pt, index) => {
        const prev = contour[(index - 1 + count) % count];
        const next = contour[(index + 1) % count];
        const dx1 = pt.x - prev.x;
        const dy1 = pt.y - prev.y;
        const dx2 = next.x - pt.x;
        const dy2 = next.y - pt.y;
        const len1 = Math.hypot(dx1, dy1);
        const len2 = Math.hypot(dx2, dy2);
        if (len1 <= 1e-6 || len2 <= 1e-6) return pt;
        const n1x = -dy1 / len1;
        const n1y = dx1 / len1;
        const n2x = -dy2 / len2;
        const n2y = dx2 / len2;
        const bx = n1x + n2x;
        const by = n1y + n2y;
        const denom = Math.max(0.4, 1 + n1x * n2x + n1y * n2y);
        return {
            x: pt.x + (insetPx * bx) / denom,
            y: pt.y + (insetPx * by) / denom
        };
    });
}

export function strokeHexRegionContours(ctx, contours, style) {
    if (!contours.length) return;
    const insetPx = finite(style?.insetPx, 0);
    ctx.save();
    ctx.globalAlpha *= style.alpha ?? 1;
    ctx.beginPath();
    for (const contour of contours) {
        appendPolygonPath(ctx, insetPx > 0 ? insetContour(contour, insetPx) : contour);
    }
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.lineWidth;
    ctx.shadowColor = style.glow;
    ctx.shadowBlur = style.glowBlur;
    ctx.stroke();
    ctx.strokeStyle = style.inner;
    ctx.lineWidth = style.innerWidth;
    ctx.shadowBlur = 0;
    ctx.stroke();
    ctx.restore();
}

const DIAGONAL_HATCH_SLOPE = 0.7;

function drawClippedDiagonalHatches(ctx, cells, options = {}) {
    if (!Array.isArray(cells) || !cells.length) return 0;
    const fallbackSize = positive(options.size, 30);
    const groupAlpha = opacity(options.alpha, 1);
    if (groupAlpha <= 0) return 0;

    const stripeWidth = positive(options.stripeWidth, 3.2);
    const spacing = positive(options.spacing, 14);
    const clipScale = positive(options.clipScale, 0.95);
    const styles = Array.isArray(options.styles) && options.styles.length
        ? options.styles
        : [options.color || 'rgba(255, 70, 54, 0.30)'];

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    ctx.save();
    ctx.globalAlpha *= groupAlpha;
    ctx.beginPath();
    let appended = false;
    for (const cell of cells) {
        const points = scaledPoints(pointsFor(cell, fallbackSize), clipScale);
        if (!appendPolygonPath(ctx, points)) continue;
        appended = true;
        for (const pt of points) {
            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;
        }
    }
    if (!appended) {
        ctx.restore();
        return 0;
    }
    ctx.clip();

    const padY = fallbackSize;
    const topY = minY - padY;
    const bottomY = maxY + padY;
    const cMin = (minX - fallbackSize) + DIAGONAL_HATCH_SLOPE * topY;
    const cMax = (maxX + fallbackSize) + DIAGONAL_HATCH_SLOPE * bottomY;
    const kStart = Math.floor(cMin / spacing);
    const kEnd = Math.ceil(cMax / spacing);
    const styleCount = styles.length;

    ctx.lineWidth = stripeWidth;
    ctx.lineCap = 'butt';
    for (let parity = 0; parity < styleCount; parity++) {
        ctx.strokeStyle = styles[parity];
        ctx.beginPath();
        for (let k = kStart; k <= kEnd; k++) {
            if (styleCount > 1 && (((k % styleCount) + styleCount) % styleCount) !== parity) continue;
            const c = k * spacing;
            ctx.moveTo(c - DIAGONAL_HATCH_SLOPE * topY, topY);
            ctx.lineTo(c - DIAGONAL_HATCH_SLOPE * bottomY, bottomY);
        }
        ctx.stroke();
    }

    ctx.restore();
    return cells.length;
}

export function drawAntiAirCoveragePreview(ctx, descriptor = {}) {
    const cells = Array.isArray(descriptor.cells) ? descriptor.cells : [];
    const fallbackSize = positive(descriptor.size, 30);
    const color = colorFor('antiAir', descriptor.color);
    const groupAlpha = opacity(descriptor.alpha, 1);
    const levelOneAlpha = opacity(descriptor.levelOneAlpha, 0.11);
    const levelTwoAlpha = opacity(descriptor.levelTwoAlpha, 0.20);
    const levelTwoHatchAlpha = opacity(descriptor.levelTwoHatchAlpha, 0.30);
    const insetPx = finite(descriptor.insetPx, 0);
    if (!cells.length) return 0;

    const levelTwoCells = [];
    for (const level of [1, 2]) {
        ctx.save();
        ctx.beginPath();
        for (const cell of cells) {
            const cellLevel = cell.level >= 2 ? 2 : 1;
            if (cellLevel !== level) continue;
            if (level === 2) levelTwoCells.push(cell);
            appendPolygonPath(ctx, scaledPoints(pointsFor(cell, fallbackSize), 0.998));
        }
        ctx.fillStyle = descriptor.fillColor || color;
        ctx.globalAlpha *= groupAlpha * (level === 1 ? levelOneAlpha : levelTwoAlpha);
        ctx.fill();
        ctx.restore();
    }

    if (levelTwoCells.length && levelTwoHatchAlpha > 0) {
        drawClippedDiagonalHatches(ctx, levelTwoCells, {
            size: fallbackSize,
            alpha: groupAlpha * levelTwoHatchAlpha,
            styles: [descriptor.hatchColor || color],
            stripeWidth: descriptor.hatchWidth,
            spacing: descriptor.hatchSpacing
        });
    }

    const keyedCells = Array.isArray(descriptor.contours)
        ? null
        : cells.filter(cell => Number.isFinite(cell.q) && Number.isFinite(cell.r) && validPoint(cell.center));
    const contours = Array.isArray(descriptor.contours)
        ? descriptor.contours
        : buildHexRegionContours(keyedCells, fallbackSize);
    const pulse = waveAt(descriptor.time, 3.6, descriptor.phase);
    strokeHexRegionContours(ctx, contours, {
        stroke: color,
        lineWidth: Math.max(5.4, fallbackSize * 0.13),
        inner: descriptor.innerColor || 'rgba(255,215,197,0.64)',
        innerWidth: 1.4,
        glow: descriptor.glowColor || '#ff3c2f',
        glowBlur: 7 + pulse * 4,
        alpha: groupAlpha * (0.86 + pulse * 0.14),
        insetPx
    });
    return cells.length;
}

/**
 * Draw alternating diagonal green/red stripes inside cells covered by both friendly and hostile AA.
 */
export function drawAirViewOverlapHatches(ctx, descriptor = {}) {
    const greenColor = descriptor.greenColor || 'rgba(40, 217, 124, 0.28)';
    const redColor = descriptor.redColor || 'rgba(255, 70, 54, 0.28)';
    return drawClippedDiagonalHatches(ctx, descriptor.cells, {
        size: descriptor.size,
        alpha: descriptor.alpha,
        styles: [greenColor, redColor],
        stripeWidth: descriptor.stripeWidth,
        spacing: descriptor.spacing
    });
}

/**
 * Draw centered high-contrast airfield beacon (`🛫`) with optional building/launcher state.
 */
export function drawAirViewAirfieldMarker(ctx, descriptor = {}) {
    if (!validPoint(descriptor.center)) return false;
    const size = positive(descriptor.size, 30);
    const isFriendly = descriptor.isFriendly !== false;
    const isReady = descriptor.isReady !== false;
    const isLauncher = descriptor.isLauncher === true;
    const reducedMotion = descriptor.reducedMotion === true;
    const time = reducedMotion ? 0 : finite(descriptor.time, 0);
    const wave = reducedMotion ? 0.5 : waveAt(time, 2.75, descriptor.phase);

    const baseColor = isLauncher ? '#7ae8ff' : (isFriendly ? '#2be88a' : '#ff4d40');
    const glowColor = isLauncher ? '#4dd2ff' : (isFriendly ? '#16c96e' : '#ff3224');
    const bgColor = isFriendly ? 'rgba(11, 46, 30, 0.90)' : 'rgba(54, 14, 14, 0.90)';
    const ringColor = isLauncher ? '#ebfcff' : (isFriendly ? '#c8ffdf' : '#ffd8d4');
    const { x, y } = descriptor.center;
    const radius = Math.max(15.5, size * 0.55);

    ctx.save();
    applyDescriptorAlpha(ctx, descriptor);
    const baseAlpha = ctx.globalAlpha;

    if (isLauncher) {
        ctx.save();
        ctx.strokeStyle = '#7ae8ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = reducedMotion ? 0 : -(time * 22);
        ctx.globalAlpha = baseAlpha * 0.92;
        ctx.beginPath();
        ctx.arc(x, y, radius + 6.5, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
    }

    if (!reducedMotion) {
        const radarT = ((time / 1.5) + (isFriendly ? 0 : 0.5)) % 1;
        ctx.beginPath();
        ctx.arc(x, y, radius + radarT * 11, 0, TAU);
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = baseAlpha * (1 - radarT) * 0.55;
        ctx.stroke();
    }

    ctx.globalAlpha = baseAlpha;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = (isLauncher ? 13 : 9) + wave * 5;
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = isLauncher ? 2.8 : 2.5;
    if (!isReady) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = baseAlpha * 0.75;
    ctx.beginPath();
    ctx.arc(x, y, radius - 2.6, 0, TAU);
    ctx.stroke();

    ctx.globalAlpha = baseAlpha;
    ctx.font = '17px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🛫', x, y + 0.5);

    if (isLauncher) {
        ctx.fillStyle = '#0c232b';
        ctx.strokeStyle = '#7ae8ff';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        appendRoundRectPath(ctx, x - 14, y + 12, 28, 12, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#bff6ff';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText('出击', x, y + 18.5);
    } else if (!isReady) {
        ctx.font = 'bold 9px sans-serif';
        ctx.fillStyle = '#ffe596';
        ctx.fillText('建', x + radius * 0.65, y + radius * 0.7);
    }

    ctx.restore();
    return true;
}

/**
 * Draw top-right translucent floating badge with twin AA cannon vector glyph (Scheme A).
 */
export function drawAirViewAaSourceBadge(ctx, descriptor = {}) {
    if (!validPoint(descriptor.center)) return false;
    const size = positive(descriptor.size, 30);
    const isFriendly = descriptor.isFriendly === true;
    const reducedMotion = descriptor.reducedMotion === true;
    const time = reducedMotion ? 0 : finite(descriptor.time, 0);
    const wave = reducedMotion ? 0.5 : waveAt(time, 2.38, descriptor.phase);

    const x = descriptor.center.x + size * 0.44;
    const y = descriptor.center.y - size * 0.42;
    const radius = Math.max(11.5, size * 0.39);
    const baseColor = isFriendly ? '#2be88a' : '#ff4d40';
    const glowColor = isFriendly ? '#16c96e' : '#ff3224';
    const bgColor = isFriendly ? 'rgba(11, 46, 30, 0.64)' : 'rgba(54, 14, 14, 0.64)';
    const ringColor = isFriendly ? '#c8ffdf' : '#ffd8d4';
    const scale = radius * 0.58;

    ctx.save();
    applyDescriptorAlpha(ctx, descriptor);
    const baseAlpha = ctx.globalAlpha;

    ctx.globalAlpha = baseAlpha * 0.90;
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = reducedMotion ? 7 : 7 + wave * 4;
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = baseColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 0.9;
    ctx.globalAlpha = baseAlpha * 0.68;
    ctx.beginPath();
    ctx.arc(x, y, radius - 2.4, 0, TAU);
    ctx.stroke();

    ctx.translate(x, y);
    ctx.globalAlpha = baseAlpha * 0.96;
    ctx.strokeStyle = ringColor;
    ctx.fillStyle = ringColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.7, radius * 0.145);
    ctx.beginPath();
    ctx.moveTo(-scale * 0.12, scale * 0.36);
    ctx.lineTo(-scale * 0.78, -scale * 0.62);
    ctx.moveTo(scale * 0.32, scale * 0.24);
    ctx.lineTo(-scale * 0.32, -scale * 0.72);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(scale * 0.15, scale * 0.42, scale * 0.36, Math.PI, 0);
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = Math.max(1.4, radius * 0.11);
    ctx.beginPath();
    ctx.moveTo(-scale * 0.46, scale * 0.54);
    ctx.lineTo(scale * 0.74, scale * 0.54);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(-scale * 0.82, -scale * 0.72, Math.max(1.1, radius * 0.085), 0, TAU);
    ctx.fill();

    ctx.restore();
    return true;
}

/** Draw the accepted circular, diagonally-hatched action-origin marker. */
export function drawHatchedOriginPreview(ctx, descriptor = {}) {
    if (!validPoint(descriptor.center)) return false;
    const size = positive(descriptor.size, 30);
    const color = colorFor('origin', descriptor.color);
    const wave = waveAt(descriptor.time, 2.65, descriptor.phase);
    const innerRadius = size * (0.66 + wave * 0.018);
    const outerRadius = size * (0.83 + wave * 0.025);

    ctx.save();
    applyDescriptorAlpha(ctx, descriptor);
    const baseAlpha = ctx.globalAlpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = size * (0.06 + wave * 0.055);

    ctx.beginPath();
    ctx.arc(descriptor.center.x, descriptor.center.y, innerRadius, 0, TAU);
    ctx.fillStyle = color;
    ctx.globalAlpha = baseAlpha * (0.14 + wave * 0.025);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(descriptor.center.x, descriptor.center.y, innerRadius * 0.94, 0, TAU);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, size * 0.026);
    ctx.globalAlpha = baseAlpha * (0.28 + wave * 0.05);
    const bounds = {
        minX: descriptor.center.x - size,
        minY: descriptor.center.y - size,
        maxX: descriptor.center.x + size,
        maxY: descriptor.center.y + size
    };
    drawHatchLines(ctx, bounds, positive(descriptor.spacing, size * 0.18), false);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(descriptor.center.x, descriptor.center.y, innerRadius, 0, TAU);
    ctx.strokeStyle = color;
    ctx.lineWidth = size * 0.082;
    ctx.globalAlpha = baseAlpha * 0.9;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(descriptor.center.x, descriptor.center.y, outerRadius, 0, TAU);
    ctx.lineWidth = size * 0.055;
    ctx.setLineDash([size * 0.1, size * 0.16]);
    ctx.lineDashOffset = -finite(descriptor.time) * size * 0.12;
    ctx.globalAlpha = baseAlpha * (0.5 + wave * 0.09);
    ctx.stroke();
    ctx.restore();
    return true;
}

function list(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function drawBatchedInactiveTileDeployments(ctx, descriptors) {
    if (!descriptors.length) return 0;
    const batches = new Map();
    const fallbackSingles = [];
    for (const descriptor of descriptors) {
        if (descriptor.active || descriptor.showStructure) {
            fallbackSingles.push(descriptor);
            continue;
        }
        const points = pointsFor(descriptor, positive(descriptor.size, 30));
        if (points.length < 3) continue;
        const center = shapeCenter(descriptor, points);
        const size = shapeSize(descriptor, points);
        const color = colorFor('deployment', descriptor.color);
        const alpha = Math.round(opacity(descriptor.alpha, 1) * 20) / 20;
        if (alpha <= 0) continue;
        const bucketKey = `${color}|${alpha}|${Math.round(size * 10)}`;
        let bucket = batches.get(bucketKey);
        if (!bucket) {
            bucket = { color, alpha, size, entries: [] };
            batches.set(bucketKey, bucket);
        }
        bucket.entries.push({ points: scaledPoints(points, 0.88), center });
    }
    let drawn = 0;
    for (const bucket of batches.values()) {
        const { color, alpha, size, entries } = bucket;
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        for (const entry of entries) appendPolygonPath(ctx, entry.points);
        ctx.globalAlpha *= 0.085;
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha *= alpha * 0.62;
        ctx.strokeStyle = color;
        ctx.lineWidth = size * 0.036;
        ctx.shadowBlur = 0;
        ctx.setLineDash([size * 0.12, size * 0.105]);
        ctx.lineDashOffset = 0;
        ctx.beginPath();
        for (const entry of entries) appendPolygonPath(ctx, entry.points);
        ctx.stroke();
        ctx.setLineDash([]);

        const half = size * 0.47;
        const arm = size * 0.16;
        ctx.beginPath();
        for (const entry of entries) {
            const { center } = entry;
            for (const [sx, sy] of CORNERS) {
                ctx.moveTo(center.x + sx * (half - arm), center.y + sy * half);
                ctx.lineTo(center.x + sx * half, center.y + sy * half);
                ctx.lineTo(center.x + sx * half, center.y + sy * (half - arm));
            }
        }
        ctx.stroke();
        ctx.restore();
        drawn += entries.length;
    }
    for (const descriptor of fallbackSingles) drawn += Number(drawTileDeploymentPreview(ctx, descriptor));
    return drawn;
}

function drawBatchedInactiveAreaCenters(ctx, descriptors) {
    if (!descriptors.length) return 0;
    const batches = new Map();
    const activeSingles = [];
    for (const descriptor of descriptors) {
        if (descriptor.active) {
            activeSingles.push(descriptor);
            continue;
        }
        if (!validPoint(descriptor.center)) continue;
        const size = positive(descriptor.size, 30);
        const color = colorFor('area', descriptor.color);
        const alpha = Math.round(opacity(descriptor.alpha, 1) * 20) / 20;
        if (alpha <= 0) continue;
        const bucketKey = `${color}|${alpha}|${Math.round(size * 10)}`;
        let bucket = batches.get(bucketKey);
        if (!bucket) {
            bucket = { color, alpha, size, centers: [] };
            batches.set(bucketKey, bucket);
        }
        bucket.centers.push(descriptor.center);
    }
    let drawn = 0;
    for (const bucket of batches.values()) {
        const { color, alpha, size, centers } = bucket;
        const half = size * 0.34;
        const arm = size * 0.11;
        ctx.save();
        ctx.globalAlpha *= alpha * 0.5;
        ctx.strokeStyle = color;
        ctx.lineWidth = size * 0.03;
        ctx.lineCap = 'square';
        ctx.shadowBlur = 0;
        ctx.beginPath();
        for (const center of centers) {
            for (const [sx, sy] of CORNERS) {
                ctx.moveTo(center.x + sx * (half - arm), center.y + sy * half);
                ctx.lineTo(center.x + sx * half, center.y + sy * half);
                ctx.lineTo(center.x + sx * half, center.y + sy * (half - arm));
            }
        }
        ctx.stroke();
        ctx.restore();
        drawn += centers.length;
    }
    for (const descriptor of activeSingles) drawn += Number(drawAreaCenterPreview(ctx, descriptor));
    return drawn;
}

/**
 * Render a complete preview scene from immutable visual descriptors.
 * Draw order is coverage -> origins -> tile targets -> area centers -> units.
 * @returns {number} Number of accepted descriptors/cells drawn.
 */
export function renderTargetingPreview(ctx, scene = {}) {
    let drawn = 0;
    // The coverage polygons are already real board cells. Draw their strokes
    // before clipping motifs so a perimeter on the board edge keeps its width.
    for (const descriptor of list(scene.antiAir)) drawn += drawAntiAirCoveragePreview(ctx, descriptor);
    ctx.save();
    try {
        if (scene.boardClip && !clipToBoard(ctx, scene.boardClip)) return drawn;
        for (const descriptor of list(scene.origins)) drawn += Number(drawHatchedOriginPreview(ctx, descriptor));
        const tileDeployments = list(scene.tileDeployments);
        drawn += tileDeployments.length > 1
            ? drawBatchedInactiveTileDeployments(ctx, tileDeployments)
            : tileDeployments.reduce((count, descriptor) => count + Number(drawTileDeploymentPreview(ctx, descriptor)), 0);
        const areaCenters = list(scene.areaCenters);
        drawn += areaCenters.length > 1
            ? drawBatchedInactiveAreaCenters(ctx, areaCenters)
            : areaCenters.reduce((count, descriptor) => count + Number(drawAreaCenterPreview(ctx, descriptor)), 0);
        for (const descriptor of list(scene.unitTargets)) drawn += Number(drawUnitTargetPreview(ctx, descriptor));
    } finally {
        ctx.restore();
    }
    return drawn;
}
