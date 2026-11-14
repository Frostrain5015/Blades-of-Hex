import { settings } from './settingsRuntime.js';

const INK = '#142d47';
const STEEL = '#78b7d6';
const EDGE = '#d8eef6';
const IMPACT_MS = 480;

export function drawKmtStrongholdLink(ctx, a, b, now) {
    const breath = settings.reducedMotion ? 0.6 : 0.55 + 0.36 * Math.sin(now * Math.PI * 2 / 3400);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = `rgba(38,93,174,${0.15 + 0.19 * breath})`;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = `rgba(91,165,239,${0.28 + 0.28 * breath})`;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = `rgba(204,237,255,${0.33 + 0.25 * breath})`;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
}

export function drawKmtLinkParticles(ctx, x, y, now) {
    const count = settings.reducedMotion ? 2 : Math.round(5 * (settings.particleDensity ?? 1));
    if (!count) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const cycle = 1250 + (i % 3) * 210;
        const progress = settings.reducedMotion ? 0.38 + 0.16 * i : ((now + i * 463 + x * 9) % cycle) / cycle;
        const alpha = Math.sin(progress * Math.PI) ** 2;
        const px = side * (18 + (i % 3) * 3 + progress * 2);
        const tip = 18 - progress * (30 + (i % 3) * 4);
        const length = 4 + (i % 3) * 1.6;
        ctx.beginPath();
        ctx.moveTo(px, tip + length);
        ctx.lineTo(px, tip);
        ctx.strokeStyle = `rgba(67,152,239,${0.48 * alpha})`;
        ctx.lineWidth = 3.6;
        ctx.stroke();
        ctx.strokeStyle = `rgba(174,223,255,${0.92 * alpha})`;
        ctx.lineWidth = 1.25;
        ctx.stroke();
    }
    ctx.restore();
}

export function queueKmtStrongholdImpact(gameState, event) {
    if (!event) return;
    const { q, r, x, y, angle, delayMs = 0 } = event;
    if (![q, r, x, y, angle, delayMs].every(Number.isFinite)) return;
    gameState.kmtStrongholdImpacts.push({ q, r, x, y, angle, startAt: performance.now() + Math.max(0, delayMs) });
}

function drawImpact(ctx, impact, progress) {
    const reduceMotion = settings.reducedMotion;
    const alpha = (1 - progress) ** 1.45;
    const radius = reduceMotion ? 20 : 20 + 6 * progress;
    ctx.save();
    ctx.translate(impact.x, impact.y);
    ctx.rotate(impact.angle);
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.arc(0, 0, radius, -0.89, 0.89);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = EDGE;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    if (!reduceMotion && settings.particleDensity > 0) {
        const count = Math.round(6 * settings.particleDensity);
        ctx.beginPath();
        for (let i = 0; i < count; i++) {
            const angle = ((i + 0.5) / count - 0.5) * 1.5;
            const distance = radius + progress * (13 + (i % 3) * 5);
            const tail = distance - 4 * (1 - progress);
            ctx.moveTo(Math.cos(angle) * tail, Math.sin(angle) * tail);
            ctx.lineTo(Math.cos(angle) * distance, Math.sin(angle) * distance);
        }
        ctx.strokeStyle = '#f2db9c';
        ctx.lineWidth = 1.35;
        ctx.stroke();
    }
    ctx.restore();
}

export function drawKmtStrongholdImpacts(ctx, impacts, now, isVisible) {
    for (let i = impacts.length - 1; i >= 0; i--) {
        const impact = impacts[i];
        const progress = (now - impact.startAt) / IMPACT_MS;
        if (progress >= 1) impacts.splice(i, 1);
        else if (progress >= 0 && isVisible(impact)) drawImpact(ctx, impact, progress);
    }
}
