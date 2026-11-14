import { playSound } from './audio.js';
import { settings } from './settingsRuntime.js';
import { UNIT_BADGE_CENTER_Y, UNIT_BADGE_RADIUS } from './unitBadgeRenderer.js';
import { RIFLE_SHOT_INTERVAL_MS, RIFLE_TRACER_FLIGHT_MS } from '../rules/attackPresentation.js';

const shots = [];
const MUZZLE_MS = 50;
const IMPACT_MS = 200;
const RECOIL_MS = 100;
const HIT_KICK_MS = 108;
const TWO_PI = 2 * Math.PI;

export function spawnRifleShots(fromX, fromY, toX, toY, {
    attackerId, targetId, isCrit = false, dodged = false, isCity = false, delayMs = 0
} = {}) {
    const distance = Math.hypot(toX - fromX, toY - fromY);
    if (!Number.isFinite(distance) || distance === 0) return;
    const ux = (toX - fromX) / distance;
    const uy = (toY - fromY) / distance;
    const muzzleOffset = Math.min(UNIT_BADGE_RADIUS + 1, distance * 0.35);
    const startAt = performance.now() + delayMs;
    for (let index = 0; index < 2; index++) {
        const spread = dodged ? 24 + index * 5 : index === 0 ? -5 : 5;
        const depth = dodged ? -10 : isCity ? 13 : 9;
        const fireAt = startAt + index * RIFLE_SHOT_INTERVAL_MS;
        const hitX = toX - ux * depth - uy * spread;
        const hitY = toY - uy * depth + ux * spread + (isCity ? 3 : UNIT_BADGE_CENTER_Y);
        const angle = Math.atan2(uy, ux);
        const power = index === 0 ? 0.73 : isCrit ? 1.3 : 1;
        const debris = [];
        const count = Math.round((dodged ? 3 : 8) * settings.particleDensity);
        for (let i = 0; i < count; i++) {
            const direction = angle + Math.PI + (Math.random() - 0.5) * 2.4;
            const speed = 45 + Math.random() * 115;
            debris.push({ vx: Math.cos(direction) * speed, vy: Math.sin(direction) * speed - 20 });
        }
        const fireSound = index === 0 ? 'rifleShot' : 'rifleFollowup';
        const fireDelay = delayMs + index * RIFLE_SHOT_INTERVAL_MS;
        const fireTimer = fireDelay === 0 ? null : setTimeout(() => playSound(fireSound), fireDelay);
        if (fireTimer === null) playSound(fireSound);
        const impactTimer = dodged ? null : setTimeout(
            () => playSound('rifleImpact', { gain: power }), fireDelay + RIFLE_TRACER_FLIGHT_MS
        );
        shots.push({
            attackerId, targetId, dodged, isCity, index, power, angle, ux, uy, debris,
            muzzleX: fromX + ux * muzzleOffset, muzzleY: fromY + uy * muzzleOffset + UNIT_BADGE_CENTER_Y,
            hitX, hitY, fireAt, hitAt: fireAt + RIFLE_TRACER_FLIGHT_MS,
            fireTimer, impactTimer
        });
    }
}

export function updateRifleShots(now) {
    for (let i = shots.length - 1; i >= 0; i--) {
        if (now >= shots[i].hitAt + IMPACT_MS) shots.splice(i, 1);
    }
}

export function getRifleUnitOffset(unitId, now) {
    if (settings.reducedMotion || unitId == null || shots.length === 0) return null;
    let x = 0, y = 0;
    for (const shot of shots) {
        const fireAge = now - shot.fireAt;
        const hitAge = now - shot.hitAt;
        let force = 0;
        if (shot.attackerId === unitId && fireAge >= 0 && fireAge < RECOIL_MS) {
            force -= (shot.index === 0 ? 3.6 : 4.5) * (1 - fireAge / RECOIL_MS) ** 2;
        }
        if (!shot.dodged && shot.targetId === unitId && hitAge >= 0 && hitAge < HIT_KICK_MS) {
            force += 6 * shot.power * (1 - hitAge / HIT_KICK_MS) ** 2;
        }
        x += shot.ux * force;
        y += shot.uy * force;
    }
    return x || y ? { x, y } : null;
}

function drawMuzzle(ctx, shot, age) {
    const fade = 1 - age / MUZZLE_MS;
    ctx.save();
    ctx.translate(shot.muzzleX, shot.muzzleY);
    ctx.rotate(shot.angle);
    ctx.scale(shot.power, shot.power);
    ctx.globalAlpha = fade;
    ctx.shadowColor = '#ff993e';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffae54';
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(1, -3);
    ctx.lineTo(5, -9);
    ctx.lineTo(8, -3);
    ctx.lineTo(17, 0);
    ctx.lineTo(8, 3);
    ctx.lineTo(4, 8);
    ctx.lineTo(0, 3);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff2cd';
    ctx.beginPath();
    ctx.ellipse(3, 0, 7, 2.5, 0, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
}

function drawTracer(ctx, shot, t) {
    const dx = shot.hitX - shot.muzzleX;
    const dy = shot.hitY - shot.muzzleY;
    const tail = Math.max(0, t - 0.47);
    const x = shot.muzzleX + dx * t, y = shot.muzzleY + dy * t;
    const tailX = shot.muzzleX + dx * tail, tailY = shot.muzzleY + dy * tail;
    const grad = ctx.createLinearGradient(tailX, tailY, x, y);
    grad.addColorStop(0, 'rgba(255, 152, 59, 0)');
    grad.addColorStop(0.55, '#f5ab58');
    grad.addColorStop(1, '#fff5d6');
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.7 + shot.power * 0.3);
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.2 * shot.power;
    ctx.strokeStyle = grad;
    ctx.shadowColor = '#ff8d3d';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.restore();
}

function drawImpact(ctx, shot, age) {
    const t = age / IMPACT_MS;
    const fade = 1 - t;
    const radius = (3 + 13 * Math.sqrt(t)) * shot.power;
    ctx.save();
    ctx.translate(shot.hitX, shot.hitY);
    ctx.scale(1, 0.68);
    const dust = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    dust.addColorStop(0, shot.isCity || shot.dodged ? '#ddba8b' : '#ffe4aa');
    dust.addColorStop(0.5, '#b78b60');
    dust.addColorStop(1, 'rgba(183, 139, 96, 0)');
    ctx.globalAlpha = fade * (shot.dodged ? 0.37 : 0.7);
    ctx.fillStyle = dust;
    ctx.fillRect(-radius, -radius, 2 * radius, 2 * radius);
    ctx.restore();

    ctx.save();
    ctx.translate(shot.hitX, shot.hitY);
    if (!shot.dodged && age < 60) {
        ctx.globalAlpha = (1 - age / 60) ** 1.4;
        ctx.fillStyle = '#fff1c5';
        ctx.beginPath();
        ctx.ellipse(0, 0, 5 * shot.power, 2.8 * shot.power, shot.angle + Math.PI / 2, 0, TWO_PI);
        ctx.fill();
    }
    if (!settings.reducedMotion) {
        ctx.globalAlpha = fade ** 1.6;
        ctx.strokeStyle = shot.dodged ? '#cbb38e' : '#ffbd68';
        ctx.lineWidth = (shot.dodged ? 1 : 1.7) * shot.power;
        const seconds = age / 1000;
        const tail = Math.max(0, seconds - 0.033);
        ctx.beginPath();
        for (const { vx, vy } of shot.debris) {
            ctx.moveTo(vx * tail, vy * tail + 145 * tail ** 2);
            ctx.lineTo(vx * seconds, vy * seconds + 145 * seconds ** 2);
        }
        ctx.stroke();
    }
    ctx.restore();
}

export function drawRifleShots(ctx, now) {
    for (const shot of shots) {
        const fireAge = now - shot.fireAt;
        const hitAge = now - shot.hitAt;
        if (fireAge < 0) continue;
        if (hitAge < 0) drawTracer(ctx, shot, fireAge / RIFLE_TRACER_FLIGHT_MS);
        if (fireAge < MUZZLE_MS) drawMuzzle(ctx, shot, fireAge);
        if (hitAge >= 0 && hitAge < IMPACT_MS) drawImpact(ctx, shot, hitAge);
    }
}

export function clearRifleShots() {
    for (const shot of shots) {
        clearTimeout(shot.fireTimer);
        clearTimeout(shot.impactTimer);
    }
    shots.length = 0;
}
