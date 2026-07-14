/**
 * Canvas2D operation-preview primitives.
 *
 * The renderer is deliberately independent from the board, DOM and game state.
 * Call it before drawing unit spheres so the route visually enters the source
 * and target bodies without covering their portraits.
 */

export const OPERATION_PREVIEW_ACTIONS = Object.freeze({
    MOVE: 'move',
    MELEE: 'melee',
    RANGED: 'ranged'
});

const EPSILON = 0.0001;
const VALID_ACTIONS = new Set(Object.values(OPERATION_PREVIEW_ACTIONS));

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function positiveModulo(value, divisor) {
    return ((value % divisor) + divisor) % divisor;
}

function isPoint(point) {
    return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function copyPoint(point) {
    return { x: point.x, y: point.y };
}

function requireContext(ctx) {
    if (!ctx || typeof ctx.save !== 'function' || typeof ctx.restore !== 'function') {
        throw new TypeError('operation preview requires a CanvasRenderingContext2D-compatible context');
    }
}

function requirePoint(point, label) {
    if (!isPoint(point)) throw new TypeError(`${label} must contain finite x and y coordinates`);
}

function requireRadius(unitRadius) {
    if (!Number.isFinite(unitRadius) || unitRadius <= 0) {
        throw new RangeError('unitRadius must be a positive finite number');
    }
}

function appendDistinct(points, point, epsilon = EPSILON) {
    if (!isPoint(point)) return;
    const previous = points[points.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) <= epsilon) return;
    points.push(copyPoint(point));
}

/**
 * Produces the exact route anchors used for movement.
 * Source and target visual centers always win over duplicate BFS endpoints.
 */
export function buildMoveOperationAnchors(source, target, bfsPath = []) {
    requirePoint(source, 'source');
    requirePoint(target, 'target');
    if (!Array.isArray(bfsPath)) throw new TypeError('bfsPath must be an array');

    const anchors = [];
    appendDistinct(anchors, source);
    for (const point of bfsPath) appendDistinct(anchors, point);

    const last = anchors[anchors.length - 1];
    if (last && Math.hypot(target.x - last.x, target.y - last.y) <= EPSILON) {
        anchors[anchors.length - 1] = copyPoint(target);
    } else {
        appendDistinct(anchors, target);
    }
    anchors[0] = copyPoint(source);
    return anchors;
}

/**
 * Converts route anchors into an arc-length sampled Catmull-Rom/Bezier curve.
 * The returned object is cacheable when the caller's BFS route is unchanged.
 */
export function buildSmoothOperationRoute(points, options = {}) {
    if (!Array.isArray(points)) throw new TypeError('points must be an array');
    const anchors = [];
    for (const point of points) appendDistinct(anchors, point);
    if (anchors.length < 2) return { points: [], anchors, totalLength: 0 };

    const tension = Number.isFinite(options.tension) ? clamp(options.tension, 0, 1.5) : 0.78;
    const samplesPerSegment = Number.isFinite(options.samplesPerSegment)
        ? Math.round(clamp(options.samplesPerSegment, 4, 48))
        : 20;
    const sampled = [];
    let totalLength = 0;

    for (let index = 0; index < anchors.length - 1; index++) {
        const p0 = anchors[Math.max(0, index - 1)];
        const p1 = anchors[index];
        const p2 = anchors[index + 1];
        const p3 = anchors[Math.min(anchors.length - 1, index + 2)];
        const c1 = {
            x: p1.x + (p2.x - p0.x) * tension / 6,
            y: p1.y + (p2.y - p0.y) * tension / 6
        };
        const c2 = {
            x: p2.x - (p3.x - p1.x) * tension / 6,
            y: p2.y - (p3.y - p1.y) * tension / 6
        };

        for (let step = 0; step <= samplesPerSegment; step++) {
            if (index > 0 && step === 0) continue;
            const t = step / samplesPerSegment;
            const u = 1 - t;
            const point = {
                x: u * u * u * p1.x
                    + 3 * u * u * t * c1.x
                    + 3 * u * t * t * c2.x
                    + t * t * t * p2.x,
                y: u * u * u * p1.y
                    + 3 * u * u * t * c1.y
                    + 3 * u * t * t * c2.y
                    + t * t * t * p2.y
            };
            const previous = sampled[sampled.length - 1];
            if (previous) totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
            sampled.push({ ...point, distance: totalLength });
        }
    }

    return { points: sampled, anchors, totalLength };
}

/**
 * Creates the direct ranged trajectory. It never consumes the movement BFS
 * path. `trajectory: 'straight'` disables the small screen-upward arc.
 */
export function buildRangedOperationRoute(source, target, unitRadius, trajectory = 'arc') {
    requirePoint(source, 'source');
    requirePoint(target, 'target');
    requireRadius(unitRadius);
    if (trajectory !== 'arc' && trajectory !== 'straight') {
        throw new RangeError("trajectory must be 'arc' or 'straight'");
    }

    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= EPSILON) {
        return { points: [], anchors: [copyPoint(source)], totalLength: 0 };
    }

    const unitX = dx / distance;
    const unitY = dy / distance;
    const normalX = -unitY;
    const normalY = unitX;
    const upwardSign = normalY > 0 ? -1 : 1;
    const bend = trajectory === 'arc'
        ? Math.min(unitRadius * 1.24, distance * 0.075) * upwardSign
        : 0;
    const steps = Math.round(clamp(distance / Math.max(1, unitRadius * 0.22), 20, 56));
    const sampled = [];
    let totalLength = 0;

    for (let step = 0; step <= steps; step++) {
        const t = step / steps;
        const offset = Math.sin(t * Math.PI) * bend;
        const point = {
            x: source.x + dx * t + normalX * offset,
            y: source.y + dy * t + normalY * offset
        };
        const previous = sampled[sampled.length - 1];
        if (previous) totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
        sampled.push({ ...point, distance: totalLength });
    }

    return {
        points: sampled,
        anchors: [copyPoint(source), copyPoint(target)],
        totalLength
    };
}

/** Returns a position and tangent angle at an arc-length fraction. */
export function sampleOperationRoute(route, fraction) {
    const points = route?.points;
    if (!Array.isArray(points) || points.length === 0) return null;
    if (points.length === 1 || route.totalLength <= EPSILON) {
        return { x: points[0].x, y: points[0].y, angle: 0 };
    }

    const targetDistance = clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1) * route.totalLength;
    let low = 0;
    let high = points.length - 1;
    while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (points[middle].distance < targetDistance) low = middle + 1;
        else high = middle;
    }

    const index = Math.max(1, low);
    const previous = points[index - 1];
    const current = points[index];
    const span = Math.max(EPSILON, current.distance - previous.distance);
    const mix = clamp((targetDistance - previous.distance) / span, 0, 1);
    return {
        x: previous.x + (current.x - previous.x) * mix,
        y: previous.y + (current.y - previous.y) * mix,
        angle: Math.atan2(current.y - previous.y, current.x - previous.x)
    };
}

/**
 * Shared ranged cadence in seconds. At `flightDuration`, the carrier reaches
 * the target contact point and the impact ring begins on that same frame.
 */
export function getRangedPreviewTiming(time = 0) {
    const cycleDuration = 2.35;
    const flightDuration = 1.55;
    const impactDuration = 0.46;
    const safeTime = Number.isFinite(time) ? time : 0;
    const cycleTime = positiveModulo(safeTime, cycleDuration);
    const rawImpactProgress = (cycleTime - flightDuration) / impactDuration;
    const impactProgress = Math.abs(rawImpactProgress) <= EPSILON ? 0 : rawImpactProgress;
    return {
        cycleDuration,
        flightDuration,
        impactDuration,
        cycleTime,
        flightProgress: clamp(cycleTime / flightDuration, 0, 1),
        carrierVisible: cycleTime <= flightDuration + EPSILON,
        impactProgress,
        impactVisible: impactProgress >= 0 && impactProgress <= 1
    };
}

function routeFractionBeforeEnd(route, inset) {
    if (!route.totalLength) return 1;
    return clamp((route.totalLength - inset) / route.totalLength, 0, 1);
}

function traceRoute(ctx, route, endFraction = 1) {
    const points = route.points;
    if (points.length < 2) return false;
    const cappedFraction = clamp(endFraction, 0, 1);
    const cappedDistance = route.totalLength * cappedFraction;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index++) {
        const point = points[index];
        if (point.distance <= cappedDistance) {
            ctx.lineTo(point.x, point.y);
            continue;
        }
        const end = sampleOperationRoute(route, cappedFraction);
        if (end) ctx.lineTo(end.x, end.y);
        break;
    }
    return true;
}

function drawArrowhead(ctx, route, fraction, color, length, open = false) {
    const tip = sampleOperationRoute(route, fraction);
    if (!tip) return;
    ctx.save();
    ctx.translate(tip.x, tip.y);
    ctx.rotate(tip.angle);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-length, length * 0.58);
    if (!open) ctx.lineTo(-length * 0.68, 0);
    ctx.lineTo(-length, -length * 0.58);
    if (!open) ctx.closePath();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = open ? Math.max(2, length * 0.26) : Math.max(1.2, length * 0.08);
    if (open) ctx.stroke();
    else ctx.fill();
    ctx.restore();
}

function drawRouteChevron(ctx, route, fraction, color, size, alpha = 1) {
    const point = sampleOperationRoute(route, fraction);
    if (!point) return;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(point.angle);
    ctx.beginPath();
    ctx.moveTo(-size, -size * 0.56);
    ctx.lineTo(0, 0);
    ctx.lineTo(-size, size * 0.56);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, size * 0.29);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = alpha;
    ctx.stroke();
    ctx.restore();
}

function drawMoveRoute(ctx, route, unitRadius, color, time) {
    const pulseProgress = positiveModulo(time * 0.68, 1);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Same-hue foundation from the operation prototype: just enough width to
    // give the route military-map weight, without becoming a second outline.
    traceRoute(ctx, route);
    ctx.strokeStyle = color;
    ctx.lineWidth = unitRadius * 0.866;
    ctx.globalAlpha = 0.10;
    ctx.stroke();

    traceRoute(ctx, route);
    ctx.lineWidth = unitRadius * 0.24;
    ctx.setLineDash([unitRadius * 1.2, unitRadius * 0.734]);
    ctx.lineDashOffset = -time * unitRadius * 3.066;
    ctx.globalAlpha = 0.92;
    ctx.shadowColor = color;
    ctx.shadowBlur = unitRadius * 0.16;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    [0, 1 / 3, 2 / 3].forEach(offset => {
        drawRouteChevron(ctx, route, positiveModulo(time * 0.115 + offset, 0.92), color, unitRadius * 0.6, 0.72);
    });

    const destination = sampleOperationRoute(route, 1);
    if (destination) {
        ctx.beginPath();
        ctx.arc(destination.x, destination.y, unitRadius * (0.64 + pulseProgress * 0.84), 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = unitRadius * 0.10;
        ctx.globalAlpha = (1 - pulseProgress) * 0.58;
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
    drawArrowhead(ctx, route, 1, color, unitRadius * 1.08);
    ctx.restore();
    return pulseProgress;
}

function drawMeleeRoute(ctx, route, unitRadius, color, time, targetContactFraction) {
    const bodyEnd = Math.max(0.08, targetContactFraction - unitRadius * 1.24 / route.totalLength);
    const bodyPoints = route.points.filter(point => point.distance < route.totalLength * bodyEnd);
    const bodyTip = sampleOperationRoute(route, bodyEnd);
    if (bodyTip) bodyPoints.push({ ...bodyTip, distance: route.totalLength * bodyEnd });
    if (bodyPoints.length < 2) return;

    const left = [];
    const right = [];
    bodyPoints.forEach((point, index) => {
        const previous = bodyPoints[Math.max(0, index - 1)];
        const next = bodyPoints[Math.min(bodyPoints.length - 1, index + 1)];
        const angle = Math.atan2(next.y - previous.y, next.x - previous.x);
        const progress = index / Math.max(1, bodyPoints.length - 1);
        const halfWidth = unitRadius * (0.68 - progress * 0.44);
        left.push({
            x: point.x - Math.sin(angle) * halfWidth,
            y: point.y + Math.cos(angle) * halfWidth
        });
        right.push({
            x: point.x + Math.sin(angle) * halfWidth,
            y: point.y - Math.cos(angle) * halfWidth
        });
    });

    ctx.save();
    ctx.beginPath();
    left.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
    });
    for (let index = right.length - 1; index >= 0; index--) ctx.lineTo(right[index].x, right[index].y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.30;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = unitRadius * 0.12;
    ctx.globalAlpha = 0.88;
    ctx.stroke();
    ctx.globalAlpha = 1;

    [0, 0.26, 0.52].forEach(offset => {
        const fraction = positiveModulo(time * 0.2 + offset, Math.max(bodyEnd, EPSILON));
        drawRouteChevron(ctx, route, fraction, 'rgba(255,255,255,.9)', unitRadius * 0.5, 0.86);
    });

    // The head has its own silhouette and is substantially larger than the
    // taper's thin end, instead of looking like a thickened final line join.
    drawArrowhead(ctx, route, targetContactFraction, color, unitRadius * 1.84);
    ctx.restore();
}

function drawRangedCarrier(ctx, route, unitRadius, color, fraction) {
    const carrier = sampleOperationRoute(route, fraction);
    if (!carrier) return;
    ctx.save();
    ctx.translate(carrier.x, carrier.y);
    ctx.rotate(carrier.angle);
    ctx.shadowColor = color;
    ctx.shadowBlur = unitRadius * 0.36;

    ctx.beginPath();
    ctx.moveTo(-unitRadius * 0.62, 0);
    ctx.lineTo(-unitRadius * 0.16, 0);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.2, unitRadius * 0.12);
    ctx.globalAlpha = 0.34;
    ctx.stroke();

    [0.426, 0.256, 0.128].forEach((scale, index) => {
        ctx.beginPath();
        ctx.arc(0, 0, unitRadius * scale, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.10 + index * 0.18;
        ctx.fill();
    });
    ctx.restore();
}

function drawRangedImpact(ctx, target, unitRadius, color, timing) {
    if (!timing.impactVisible) return;
    const progress = clamp(timing.impactProgress, 0, 1);
    const eased = 1 - (1 - progress) * (1 - progress);
    ctx.save();
    ctx.beginPath();
    ctx.arc(target.x, target.y, unitRadius * (1.08 + eased * 1.28), 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = unitRadius * (0.12 - progress * 0.05);
    ctx.globalAlpha = (1 - progress) * 0.76;
    ctx.shadowColor = color;
    ctx.shadowBlur = unitRadius * 0.36;
    ctx.stroke();
    ctx.restore();
}

function drawRangedRoute(ctx, route, target, unitRadius, color, time, targetContactFraction) {
    const timing = getRangedPreviewTiming(time);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Deliberately one bright rail: no dark under-track and no second outline.
    traceRoute(ctx, route, targetContactFraction);
    ctx.strokeStyle = color;
    ctx.lineWidth = unitRadius * 0.172;
    ctx.setLineDash([unitRadius * 0.15, unitRadius * 0.44]);
    ctx.lineDashOffset = -time * unitRadius * 1.44;
    ctx.globalAlpha = 0.96;
    ctx.shadowColor = color;
    ctx.shadowBlur = unitRadius * 0.18;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
    drawArrowhead(ctx, route, targetContactFraction, color, unitRadius * 0.554, true);

    if (timing.carrierVisible) {
        drawRangedCarrier(ctx, route, unitRadius, color, timing.flightProgress * targetContactFraction);
    }
    drawRangedImpact(ctx, target, unitRadius, color, timing);
    ctx.restore();
    return timing;
}

/**
 * Draws the shared single-cell circular action origin marker.
 * The marker uses a translucent same-hue fill, diagonal hatch, solid inner
 * ring and animated outer ring. It is intended to sit behind the unit sphere.
 */
export function drawOperationOrigin(ctx, options) {
    requireContext(ctx);
    const {
        center,
        unitRadius,
        color,
        action = OPERATION_PREVIEW_ACTIONS.MOVE,
        time = 0
    } = options || {};
    requirePoint(center, 'center');
    requireRadius(unitRadius);
    if (!VALID_ACTIONS.has(action)) throw new RangeError(`unknown operation preview action: ${action}`);

    const safeTime = Number.isFinite(time) ? time : 0;
    const safeColor = color || '#58c9b3';
    const waveSpeed = action === OPERATION_PREVIEW_ACTIONS.MOVE ? 2.1 : 2.65;
    const wave = (Math.sin(safeTime * waveSpeed) + 1) / 2;
    const innerRadius = unitRadius * (1.32 + wave * 0.036);
    const outerRadius = unitRadius * (1.66 + wave * 0.05);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = safeColor;
    ctx.shadowBlur = unitRadius * (0.12 + wave * 0.11);

    ctx.beginPath();
    ctx.arc(center.x, center.y, innerRadius, 0, Math.PI * 2);
    ctx.fillStyle = safeColor;
    ctx.globalAlpha = 0.14 + wave * 0.025;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(center.x, center.y, innerRadius * 0.94, 0, Math.PI * 2);
    ctx.clip();
    ctx.strokeStyle = safeColor;
    ctx.lineWidth = Math.max(1, unitRadius * 0.052);
    ctx.globalAlpha = 0.28 + wave * 0.05;
    const spacing = unitRadius * 0.36;
    for (let offset = -unitRadius * 2.7; offset <= unitRadius * 2.7; offset += spacing) {
        ctx.beginPath();
        ctx.moveTo(center.x - unitRadius * 2, center.y + offset + unitRadius * 1.4);
        ctx.lineTo(center.x + unitRadius * 2, center.y + offset - unitRadius * 1.4);
        ctx.stroke();
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(center.x, center.y, innerRadius, 0, Math.PI * 2);
    ctx.strokeStyle = safeColor;
    ctx.lineWidth = unitRadius * 0.164;
    ctx.globalAlpha = 0.90;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center.x, center.y, outerRadius, 0, Math.PI * 2);
    ctx.lineWidth = unitRadius * 0.11;
    ctx.setLineDash([unitRadius * 0.2, unitRadius * 0.32]);
    ctx.lineDashOffset = -safeTime * unitRadius * 0.24;
    ctx.globalAlpha = 0.50 + wave * 0.09;
    ctx.stroke();
    ctx.restore();

    return { innerRadius, outerRadius, wave };
}

/**
 * Draws one production operation preview.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} options
 * @param {'move'|'melee'|'ranged'} options.action
 * @param {{x:number,y:number}} options.source exact source unit visual center
 * @param {{x:number,y:number}} options.target exact target/destination visual center
 * @param {{x:number,y:number}[]} [options.bfsPath] movement BFS pixel points only
 * @param {number} options.unitRadius rendered sphere radius in canvas units
 * @param {number} [options.time=0] animation time in seconds
 * @param {string|CanvasGradient|CanvasPattern} [options.color='#58c9b3']
 * @param {boolean} [options.drawOrigin=true]
 * @param {'arc'|'straight'} [options.trajectory='arc'] ranged-only path shape
 * @returns {{action:string,route:object,targetContactFraction:number,timing?:object}}
 */
export function drawOperationPreview(ctx, options) {
    requireContext(ctx);
    const {
        action,
        source,
        target,
        bfsPath = [],
        unitRadius,
        time = 0,
        color,
        drawOrigin = true,
        trajectory = 'arc'
    } = options || {};
    if (!VALID_ACTIONS.has(action)) throw new RangeError(`unknown operation preview action: ${action}`);
    requirePoint(source, 'source');
    requirePoint(target, 'target');
    requireRadius(unitRadius);

    const safeTime = Number.isFinite(time) ? time : 0;
    const safeColor = color || (action === OPERATION_PREVIEW_ACTIONS.MOVE ? '#58c9b3' : '#e95b50');
    let route;
    let targetContactFraction = 1;
    let timing;
    let destinationPulseProgress;

    if (action === OPERATION_PREVIEW_ACTIONS.MOVE) {
        route = buildSmoothOperationRoute(buildMoveOperationAnchors(source, target, bfsPath));
        if (route.points.length >= 2) {
            destinationPulseProgress = drawMoveRoute(ctx, route, unitRadius, safeColor, safeTime);
        }
    } else if (action === OPERATION_PREVIEW_ACTIONS.MELEE) {
        route = buildSmoothOperationRoute([source, target]);
        if (route.points.length >= 2) {
            targetContactFraction = routeFractionBeforeEnd(route, unitRadius);
            drawMeleeRoute(ctx, route, unitRadius, safeColor, safeTime, targetContactFraction);
        }
    } else {
        route = buildRangedOperationRoute(source, target, unitRadius, trajectory);
        if (route.points.length >= 2) {
            targetContactFraction = routeFractionBeforeEnd(route, unitRadius);
            timing = drawRangedRoute(
                ctx,
                route,
                target,
                unitRadius,
                safeColor,
                safeTime,
                targetContactFraction
            );
        } else {
            timing = getRangedPreviewTiming(safeTime);
        }
    }

    let origin;
    if (drawOrigin) {
        origin = drawOperationOrigin(ctx, {
            center: source,
            unitRadius,
            color: safeColor,
            action,
            time: safeTime
        });
    }

    return {
        action,
        route,
        targetContactFraction,
        timing,
        destinationPulseProgress,
        origin
    };
}
