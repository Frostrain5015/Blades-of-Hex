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
    antiAir: '#ffb4aa',
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

/**
 * Draw anti-air coverage as single hatching for level 1 and cross-hatching for
 * level 2+. No perimeter is drawn, so board-edge range contours cannot appear.
 */
export function drawAntiAirCoveragePreview(ctx, descriptor = {}) {
    const cells = Array.isArray(descriptor.cells) ? descriptor.cells : [];
    const fallbackSize = positive(descriptor.size, 30);
    const color = colorFor('antiAir', descriptor.color);
    const groupAlpha = opacity(descriptor.alpha, 1);
    const groupHatchAlpha = opacity(descriptor.hatchAlpha, 0.38);
    let drawn = 0;

    for (const cell of cells) {
        const points = pointsFor(cell, fallbackSize);
        if (points.length < 3) continue;
        const size = shapeSize(cell, points, fallbackSize);
        const level = Math.max(1, Math.floor(finite(cell.level, 1)));
        const cellAlpha = opacity(cell.alpha, 1);
        const hatchAlpha = opacity(cell.hatchAlpha, groupHatchAlpha);
        const spacing = positive(cell.spacing, positive(descriptor.spacing, size * 0.27));
        const lineWidth = positive(cell.lineWidth, positive(descriptor.lineWidth, Math.max(1, size * 0.025)));

        ctx.save();
        const baseAlpha = ctx.globalAlpha * groupAlpha * cellAlpha;
        ctx.beginPath();
        appendPolygonPath(ctx, scaledPoints(points, positive(cell.scale, 0.89)));
        ctx.fillStyle = cell.fillColor || descriptor.fillColor || color;
        ctx.globalAlpha = baseAlpha * opacity(cell.fillAlpha, level >= 2 ? 0.085 : 0.045);
        ctx.fill();
        ctx.clip();
        ctx.strokeStyle = cell.color || color;
        ctx.lineWidth = lineWidth;
        ctx.globalAlpha = baseAlpha * hatchAlpha;
        ctx.globalCompositeOperation = 'screen';
        const bounds = boundsOf(points);
        drawHatchLines(ctx, bounds, spacing, false);
        if (level >= 2) drawHatchLines(ctx, bounds, spacing, true);
        ctx.restore();
        drawn++;
    }
    return drawn;
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

/**
 * Render a complete preview scene from immutable visual descriptors.
 * Draw order is coverage -> origins -> tile targets -> area centers -> units.
 * @returns {number} Number of accepted descriptors/cells drawn.
 */
export function renderTargetingPreview(ctx, scene = {}) {
    let drawn = 0;
    ctx.save();
    try {
        if (scene.boardClip && !clipToBoard(ctx, scene.boardClip)) return 0;
        for (const descriptor of list(scene.antiAir)) drawn += drawAntiAirCoveragePreview(ctx, descriptor);
        for (const descriptor of list(scene.origins)) drawn += Number(drawHatchedOriginPreview(ctx, descriptor));
        for (const descriptor of list(scene.tileDeployments)) drawn += Number(drawTileDeploymentPreview(ctx, descriptor));
        for (const descriptor of list(scene.areaCenters)) drawn += Number(drawAreaCenterPreview(ctx, descriptor));
        for (const descriptor of list(scene.unitTargets)) drawn += Number(drawUnitTargetPreview(ctx, descriptor));
    } finally {
        ctx.restore();
    }
    return drawn;
}
