import { CULTURE_STRIKE_TIMING as TIMING } from '../rules/cultureStrike.js';
import { HEX_SIZE } from './config.js';
import { playSound } from './audio.js';
import { isWaterTile } from '../rules/surfaces.js';

const mix = (a, b, t) => a + (b - a) * t;
const clamp = value => Math.max(0, Math.min(1, value));

export function presentCultureStrike(state, effect, startedAt = performance.now()) {
    const locate = point => state.tileMap.get(`${point?.q},${point?.r}`);
    const path = effect?.path?.map(locate);
    if (!path || path.length < 2 || path.some(tile => !tile)) return;
    const { kind, unitId, impactDelay, results = [] } = effect;
    const scene = { kind, unitId, path, startedAt, impactDelay, results, landingMine: effect.landingMine };
    (state.cultureStrikeEffects ||= []).push(scene);
    if (kind !== 'samuraiChain') return;
    const caster = path.at(-1).unit ?? state.unitDeathGhosts?.find(ghost => ghost.unit.id === unitId)?.unit;
    if (caster?.id !== unitId) return;
    caster._cultureStrikeMotion = scene;
}

export function getCultureStrikePosition(scene, now, size) {
    const elapsed = Math.max(0, now - scene.startedAt);
    const { path } = scene;
    const landing = path.at(-1);
    if (elapsed < TIMING.charge) {
        const start = path[0];
        return { x: start.x, y: start.y - Math.sin(Math.PI * elapsed / TIMING.charge) * size * 0.12 };
    }
    const dashTime = elapsed - TIMING.charge;
    const exitIndex = path.length - 2;
    const leg = Math.min(exitIndex, Math.floor(dashTime / TIMING.cut));
    const duration = leg === exitIndex ? TIMING.exit : TIMING.cut;
    const t = 1 - (1 - clamp((dashTime - leg * TIMING.cut) / duration)) ** 1.6;
    const from = path[leg], to = path[leg + 1];
    return t === 1 && leg === exitIndex ? { x: landing.x, y: landing.y }
        : { x: mix(from.x, to.x, t), y: mix(from.y, to.y, t) };
}

function drawCharge(ctx, tile, target, size, progress) {
    const sign = Math.sign(target.x - tile.x || 1);
    ctx.save();
    ctx.translate(tile.x + sign * size * 0.30, tile.y - size * 0.36);
    ctx.rotate(-sign * 0.28);
    ctx.globalCompositeOperation = 'lighter';
    const power = progress ** 2;
    const radius = size * (0.31 + 0.94 * power);
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    halo.addColorStop(0, '#fff8b1');
    halo.addColorStop(0.23, 'rgba(255,174,43,.64)');
    halo.addColorStop(1, 'rgba(255,165,31,0)');
    ctx.globalAlpha = 0.25 + 0.75 * power;
    ctx.fillStyle = halo;
    ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
    ctx.strokeStyle = '#fff7d2';
    ctx.shadowColor = '#ffbd4e';
    ctx.shadowBlur = size * 0.42;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, size * 0.055);
    ctx.beginPath();
    ctx.moveTo(-radius, 0); ctx.lineTo(radius, 0);
    ctx.moveTo(0, -radius * 0.73); ctx.lineTo(0, radius * 0.73);
    ctx.stroke();
    ctx.restore();
}

function bladePath(path, size) {
    return path.slice(0, -1).map((point, index) => {
        const from = path[Math.max(0, index - 1)], next = path[index + 1];
        const angle = Math.atan2(next.y - from.y, next.x - from.x);
        const sweep = size * (index % 2 ? 0.38 : -0.42);
        return { x: point.x - Math.sin(angle) * sweep, y: point.y + Math.cos(angle) * sweep - size * 0.14 };
    });
}

function drawBlade(ctx, from, to, size, progress, release) {
    if (progress <= 0) return;
    const burst = release < 0 ? 0 : (1 - clamp(release / 155)) ** 2;
    const fade = 1 - clamp(release / 310);
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const head = Math.hypot(to.x - from.x, to.y - from.y) * progress;
    const edge = size * (0.046 + burst * 0.37 + (progress < 1 ? 0.10 : 0));
    ctx.save();
    ctx.translate(from.x, from.y);
    ctx.rotate(angle);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = fade;
    ctx.shadowColor = '#ffad32';
    ctx.shadowBlur = size * (0.18 + burst * 0.54);
    ctx.fillStyle = burst > 0.35 ? '#fff1ba' : '#e9b664';
    ctx.beginPath();
    ctx.moveTo(-Math.min(size * 0.25, head / 3), 0);
    ctx.lineTo(head * 0.53, -edge);
    ctx.lineTo(head, 0);
    ctx.lineTo(head * 0.59, edge * 0.63);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#fff8dd';
    ctx.lineWidth = Math.max(1, size * (0.024 + burst * 0.04));
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(head, 0); ctx.stroke();
    if (burst > 0) {
        ctx.globalAlpha = burst;
        ctx.shadowBlur = 0;
        ctx.lineWidth = size * 0.026;
        for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.lineTo(head * 0.46, side * size * (0.23 + 0.23 * (1 - burst)));
            ctx.lineTo(head, 0);
            ctx.stroke();
        }
    }
    ctx.restore();
}

function drawChain(ctx, scene, now, size) {
    const elapsed = now - scene.startedAt;
    const release = elapsed - scene.impactDelay;
    const { path } = scene;
    if (elapsed < TIMING.charge) {
        drawCharge(ctx, path[0], path[1], size, clamp(elapsed / TIMING.charge));
        return;
    }
    const blade = bladePath(path, size);
    for (let i = 1; i < blade.length; i++) {
        const t = clamp((elapsed - TIMING.charge - (i - 1) * TIMING.cut) / TIMING.cut);
        drawBlade(ctx, blade[i - 1], blade[i], size, 1 - (1 - t) ** 1.6, release);
    }
    const landAt = TIMING.charge + (path.length - 2) * TIMING.cut + TIMING.exit;
    const ripple = (elapsed - landAt) / 340;
    if (ripple >= 0 && ripple < 1) {
        const tile = path.at(-1);
        ctx.save();
        ctx.globalAlpha = (1 - ripple) * 0.7;
        ctx.strokeStyle = isWaterTile(tile) ? '#b7ebff' : '#e5be70';
        ctx.lineWidth = Math.max(0.9, size * 0.04);
        ctx.beginPath();
        ctx.ellipse(tile.x, tile.y + size * 0.20, size * (0.23 + ripple * 0.65),
            size * (0.09 + ripple * 0.25), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

function drawReticle(ctx, point, size, progress) {
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(-0.34 * (1 - progress));
    ctx.globalAlpha = progress;
    const radius = size * (0.63 + 0.48 * (1 - progress));
    ctx.shadowBlur = size * 0.19;
    ctx.shadowColor = '#ff4f49';
    ctx.strokeStyle = '#ff6558';
    ctx.lineWidth = Math.max(1, size * 0.046);
    for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0.12, Math.PI / 2 - 0.12);
        ctx.moveTo(radius * 0.68, 0); ctx.lineTo(radius * 1.25, 0);
        ctx.stroke();
        ctx.rotate(Math.PI / 2);
    }
    ctx.restore();
}

export function drawSniperBullet(ctx, from, to, size, progress) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const tail = Math.min(length * progress, size * 2.5);
    const width = size * 0.065;
    ctx.save();
    ctx.translate(mix(from.x, to.x, progress), mix(from.y, to.y, progress));
    ctx.rotate(angle);
    ctx.globalCompositeOperation = 'lighter';
    const trail = ctx.createLinearGradient(-Math.max(tail, 1), 0, size * 0.22, 0);
    trail.addColorStop(0, 'rgba(255,148,56,0)');
    trail.addColorStop(0.80, '#ffad58');
    trail.addColorStop(1, '#fff9dd');
    ctx.fillStyle = trail;
    ctx.shadowColor = '#ffa854';
    ctx.shadowBlur = size * 0.23;
    ctx.beginPath();
    ctx.moveTo(-tail, 0);
    ctx.lineTo(-size * 0.15, -width);
    ctx.lineTo(size * 0.22, 0);
    ctx.lineTo(-size * 0.15, width);
    ctx.closePath(); ctx.fill();
    ctx.restore();
}

function drawHit(ctx, origin, target, age, size, color) {
    if (age < 0 || age >= 190) return;
    const t = age / 190;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(target.x, target.y);
    ctx.rotate(Math.atan2(target.y - origin.y, target.x - origin.x));
    ctx.strokeStyle = color;
    ctx.globalAlpha = (1 - t) ** 2;
    ctx.lineWidth = Math.max(0.9, size * 0.034);
    for (let i = -2; i <= 2; i++) {
        const offset = i * size * (0.09 + t * 0.19);
        ctx.beginPath();
        ctx.moveTo(size * (0.08 + t * 0.40), offset);
        ctx.lineTo(size * (0.51 + t * 0.77), offset * 1.8);
        ctx.stroke();
    }
    ctx.restore();
}

export function drawCultureStrikeEffects(state, ctx, now) {
    const effects = state.cultureStrikeEffects;
    if (!effects?.length) return;
    const size = HEX_SIZE;
    for (let i = effects.length - 1; i >= 0; i--) {
        const scene = effects[i];
        const elapsed = now - scene.startedAt;
        if (elapsed > scene.impactDelay + 360) {
            effects.splice(i, 1);
            continue;
        }
        if (scene.kind === 'samuraiChain') {
            drawChain(ctx, scene, now, size);
        }
        const fireAt = scene.kind === 'samuraiChain' ? scene.impactDelay : TIMING.lock;
        if (elapsed >= fireAt && elapsed < fireAt + 120 && !scene.sounded) {
            scene.sounded = true;
            playSound(scene.kind === 'samuraiChain' ? 'crit' : 'attack');
        }
        for (const [index, hit] of scene.results.entries()) {
            const tile = state.tileMap.get(`${hit.q},${hit.r}`);
            if (!tile || hit.dodged) continue;
            drawHit(ctx, scene.kind === 'samuraiChain' ? scene.path[index] : scene.path[0],
                tile, elapsed - hit.delayMs, size, '#ffdb93');
        }
        if (scene.landingMine) {
            const tile = scene.path.at(-1);
            drawHit(ctx, scene.path.at(-2), tile, elapsed - scene.landingMine.delayMs, size * 1.45, '#ff8a36');
        }
        if (scene.kind === 'samuraiChain') {
            continue;
        }
        const lockAt = scene.kind === 'guerrillaSnipe' ? TIMING.lock : 0;
        if (elapsed < lockAt) {
            const hit = scene.results.at(-1);
            const target = state.tileMap.get(`${hit?.q},${hit?.r}`);
            if (target) drawReticle(ctx, target, size, clamp(elapsed / (lockAt * 0.60)));
            continue;
        }
        const travel = (elapsed - lockAt) / (scene.impactDelay - lockAt);
        if (travel <= 1) drawSniperBullet(ctx, scene.path[0], scene.path.at(-1), size, clamp(travel));
    }
}
