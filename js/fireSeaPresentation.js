import { getFireSeaState } from '../rules/cultures.js';

export const FIRE_SEA_FADE_IN_MS = 480;
export const FIRE_SEA_FADE_OUT_MS = 950;

function smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
}

function opacityAt(visual, now) {
    const duration = visual.target ? FIRE_SEA_FADE_IN_MS : FIRE_SEA_FADE_OUT_MS;
    const progress = smoothstep((now - visual.changedAt) / duration);
    return visual.from + (visual.target - visual.from) * progress;
}

// Reapplications keep an existing fire burning through the new strike's flight.
// The rule can expire immediately while its last visible flame fades out.
export function resolveFireSeaVisual(tile, now) {
    const fire = getFireSeaState(tile);
    const startsAt = tile._fireSeaVisualDelayUntil || 0;
    const ready = fire && now >= startsAt;
    let visual = tile._fireSeaVisual;
    if (!visual && !ready) return null;
    if (!visual) {
        visual = { from: 0, target: 1, changedAt: startsAt || now, layers: fire.layers };
    } else if (ready && visual.target === 0) {
        visual = { from: opacityAt(visual, now), target: 1, changedAt: now, layers: fire.layers };
    } else if (!fire && visual.target === 1) {
        visual = { ...visual, from: opacityAt(visual, now), target: 0, changedAt: now };
    } else if (ready) {
        visual.layers = fire.layers;
    }
    if (now >= startsAt) tile._fireSeaVisualDelayUntil = 0;
    const alpha = opacityAt(visual, now);
    tile._fireSeaVisual = !visual.target && alpha <= 0 ? null : visual;
    return alpha > 0 ? { alpha, layers: visual.layers } : null;
}

function scatter(seed, index) {
    const word = Math.imul(seed ^ Math.imul(index + 1, 0x9e3779b1), 0x85ebca6b);
    return ((word ^ (word >>> 13)) >>> 0) / 4294967296;
}

function softSpot(ctx, x, y, radius, center, middle, edge) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, center);
    glow.addColorStop(0.5, middle);
    glow.addColorStop(1, edge);
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function flameTongue(ctx, x, y, width, height, lean) {
    ctx.beginPath();
    ctx.moveTo(x - width, y);
    ctx.bezierCurveTo(x - width * 1.45, y - height * 0.34, x + lean - width, y - height * 0.7, x + lean, y - height);
    ctx.bezierCurveTo(x + lean + width * 0.22, y - height * 0.60, x + width * 1.4, y - height * 0.23, x + width, y);
    ctx.quadraticCurveTo(x, y + width * 0.9, x - width, y);
    ctx.fill();
}

export function drawFireSeaTile(ctx, tile, { alpha, layers }, hexSize, now, reducedMotion) {
    const seed = Math.imul(tile.q + 41, 73856093) ^ Math.imul(tile.r + 31, 19349663);
    const time = reducedMotion ? 0 : now / 1000;
    const fireSize = 0.66 + alpha * 0.34;
    ctx.save();
    ctx.globalAlpha = alpha;
    softSpot(ctx, tile.x, tile.y + hexSize * 0.1, hexSize * 0.88,
        'rgba(71,36,24,0.56)', 'rgba(61,32,23,0.36)', 'rgba(43,27,22,0)');
    softSpot(ctx, tile.x - hexSize * 0.09, tile.y + hexSize * 0.15, hexSize * 0.54,
        'rgba(247,139,62,0.31)', 'rgba(220,80,44,0.22)', 'rgba(220,80,44,0)');

    const flameCount = 4 + layers * 2;
    for (let index = 0; index < flameCount; index++) {
        const offset = index * 6;
        const angle = scatter(seed, offset) * Math.PI * 2;
        const radius = hexSize * (0.15 + scatter(seed, offset + 1) * 0.46);
        const x = tile.x + Math.cos(angle) * radius;
        const y = tile.y + Math.sin(angle) * radius * 0.74 + hexSize * 0.19;
        const phase = scatter(seed, offset + 2) * Math.PI * 2;
        const drift = Math.sin(time * (3.6 + scatter(seed, offset + 3) * 3) + phase);
        const height = hexSize * (0.28 + scatter(seed, offset + 4) * 0.25 + drift * 0.10) * fireSize;
        const width = hexSize * (0.050 + scatter(seed, offset + 5) * 0.035);
        const lean = width * (0.9 + drift * 1.5);
        ctx.globalAlpha = alpha * (0.77 + drift * 0.14);
        ctx.fillStyle = '#cc5125';
        flameTongue(ctx, x, y, width * 1.25, height, lean);
        ctx.fillStyle = '#ff9c47';
        flameTongue(ctx, x, y + 0.3, width * 0.81, height * 0.76, lean * 0.65);
        ctx.fillStyle = '#ffda8e';
        flameTongue(ctx, x, y + 0.6, width * 0.46, height * 0.48, lean * 0.36);
    }

    for (let index = 0; index < 3; index++) {
        const offset = 64 + index * 4;
        const phase = (time * (0.31 + index * 0.06) + scatter(seed, offset)) % 1;
        const x = tile.x + (scatter(seed, offset + 1) - 0.5 + phase * 0.38) * hexSize;
        const y = tile.y + hexSize * (0.17 - phase * 0.94);
        ctx.globalAlpha = Math.sqrt(alpha) * Math.sin(phase * Math.PI) * 0.42;
        softSpot(ctx, x, y, hexSize * (0.12 + phase * 0.29),
            'rgba(53,38,35,0.76)', 'rgba(75,55,49,0.46)', 'rgba(75,55,49,0)');
    }

    for (let index = 0; index < 5 + layers; index++) {
        const offset = 80 + index * 4;
        const phase = (time * (0.62 + scatter(seed, offset) * 0.45) + scatter(seed, offset + 1)) % 1;
        const x = tile.x + (scatter(seed, offset + 2) - 0.5 + phase * 0.30) * hexSize;
        const y = tile.y + hexSize * (0.2 - phase * 1.08);
        ctx.globalAlpha = alpha * Math.sin(phase * Math.PI) * 0.72;
        ctx.fillStyle = index % 2 ? '#ffbe68' : '#f08449';
        ctx.beginPath();
        ctx.arc(x, y, 0.65 + scatter(seed, offset + 3) * 0.7, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}
