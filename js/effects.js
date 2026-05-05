import { HEX_SIZE, hexToRgb, rgbToHex, settings } from './config.js';

// ===== 粒子系统 =====================
export const particles = [];

export class VisualParticle {
    constructor(x, y, vx, vy, color, size, life, gravity = 200) {
        this.x = x; this.y = y;
        this.vx = vx; this.vy = vy;
        this.color = color;
        this.size = size;
        this.life = life;
        this.maxLife = life;
        this.alpha = 1;
        this.gravity = gravity;
    }
    update(dt) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.vy += this.gravity * dt;
        this.life -= dt;
        this.alpha = Math.max(0, this.life / this.maxLife);
        return this.life > 0;
    }
    draw(ctx2d) {
        ctx2d.save();
        ctx2d.globalAlpha = this.alpha;
        ctx2d.fillStyle = this.color;
        ctx2d.beginPath();
        ctx2d.arc(this.x, this.y, this.size * (0.3 + 0.7 * this.alpha), 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.restore();
    }
}

function particleCount(base) {
    return Math.round(base * settings.particleDensity);
}

export function spawnExplosionParticles(x, y, color, count = 18) {
    const n = particleCount(count);
    for (let i = 0; i < n; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 250;
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 8, y + (Math.random() - 0.5) * 8,
            Math.cos(angle) * speed, Math.sin(angle) * speed,
            color, 2 + Math.random() * 4, 0.3 + Math.random() * 0.5
        ));
    }
}

export function spawnHealParticles(x, y) {
    const n = particleCount(14);
    for (let i = 0; i < n; i++) {
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 18,
            y + (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 25,
            -(25 + Math.random() * 45),
            Math.random() < 0.6 ? '#66ffaa' : '#aaffdd',
            1.5 + Math.random() * 3.5,
            0.7 + Math.random() * 0.7,
            -25  // gentle anti-gravity: float upward, decelerating
        ));
    }
}

export function spawnRecruitEffect(x, y) {
    const n = particleCount(16);
    for (let i = 0; i < n; i++) {
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 22,
            y + (Math.random() - 0.5) * 6,
            (Math.random() - 0.5) * 40,
            -(40 + Math.random() * 70),
            Math.random() < 0.5 ? '#c8dfff' : '#ffffff',
            1.5 + Math.random() * 3,
            0.5 + Math.random() * 0.8,
            60  // light gravity: spark-like arc
        ));
    }
}

export function spawnGoldParticles(x, y) {
    const n = particleCount(8);
    for (let i = 0; i < n; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 100;
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10,
            Math.cos(angle) * speed, Math.sin(angle) * speed - 60,
            '#ffd700', 3 + Math.random() * 3, 0.4 + Math.random() * 0.4
        ));
    }
}

export function spawnDirectionalParticles(fromX, fromY, toX, toY, color, count = 16) {
    const n = particleCount(count);
    const baseAngle = Math.atan2(toY - fromY, toX - fromX);
    const spread = Math.PI * 0.55;
    for (let i = 0; i < n; i++) {
        const a = baseAngle + (Math.random() - 0.5) * spread;
        const speed = 60 + Math.random() * 200;
        particles.push(new VisualParticle(
            toX + (Math.random() - 0.5) * 5,
            toY + (Math.random() - 0.5) * 5,
            Math.cos(a) * speed,
            Math.sin(a) * speed,
            color,
            2 + Math.random() * 4,
            0.25 + Math.random() * 0.45,
            180 + Math.random() * 100
        ));
    }
}

// ===== 攻击闪光 =====================
export const attackFlashes = [];

export function triggerAttackFlash(targetX, targetY, isCrit) {
    attackFlashes.push({
        x: targetX, y: targetY,
        startTime: Date.now(),
        duration: isCrit ? 400 : 280,
        maxRadius: isCrit ? HEX_SIZE * 2 : HEX_SIZE * 1.5,
        isCrit: isCrit
    });
}

export function drawAttackFlashes(ctx2d, now) {
    for (let i = attackFlashes.length - 1; i >= 0; i--) {
        const f = attackFlashes[i];
        const elapsed = now - f.startTime;
        const p = Math.min(elapsed / f.duration, 1);
        if (p >= 1) { attackFlashes.splice(i, 1); continue; }
        const radius = f.maxRadius * p;
        const alpha = Math.max(0, 1 - p * p);
        const grad = ctx2d.createRadialGradient(f.x, f.y, 0, f.x, f.y, radius);
        if (f.isCrit) {
            grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
            grad.addColorStop(0.2, `rgba(255, 200, 50, ${alpha * 0.9})`);
            grad.addColorStop(0.6, `rgba(255, 100, 0, ${alpha * 0.5})`);
            grad.addColorStop(1, 'rgba(255, 0, 0, 0)');
        } else {
            grad.addColorStop(0, `rgba(255, 255, 200, ${alpha * 0.8})`);
            grad.addColorStop(0.5, `rgba(255, 120, 50, ${alpha * 0.5})`);
            grad.addColorStop(1, 'rgba(255, 50, 0, 0)');
        }
        ctx2d.save();
        ctx2d.fillStyle = grad;
        ctx2d.beginPath();
        ctx2d.arc(f.x, f.y, radius, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.restore();
    }
}

// ===== 刀剑斩击特效（近战单位） =====================
export const meleeSlashes = [];

export function spawnMeleeSlash(x, y, fromX, fromY, isCrit) {
    const baseAngle = Math.atan2(y - fromY, x - fromX);
    const count = isCrit ? 2 : 1;
    for (let i = 0; i < count; i++) {
        const angleOff = (i - 0.5) * 1.1;
        meleeSlashes.push({
            x, y,
            angle: baseAngle + angleOff + (Math.random() - 0.5) * 0.25,
            startTime: Date.now(),
            duration: isCrit ? 350 : 240,
            len: HEX_SIZE * 1.6,
            isCrit
        });
    }
}

export function drawMeleeSlashes(ctx2d, now) {
    for (let i = meleeSlashes.length - 1; i >= 0; i--) {
        const s = meleeSlashes[i];
        const elapsed = now - s.startTime;
        const p = Math.min(elapsed / s.duration, 1);
        if (p >= 1) { meleeSlashes.splice(i, 1); continue; }

        // Sweep from one side to the other
        const halfLen = s.len * 0.5;
        const sweepStart = -halfLen + halfLen * 2 * p * 1.05;
        const sweepEnd = sweepStart + halfLen * 0.55;
        const alpha = 1 - p * p * p;

        ctx2d.save();
        ctx2d.translate(s.x, s.y);
        ctx2d.rotate(s.angle);
        ctx2d.globalAlpha = alpha;
        ctx2d.lineCap = 'round';
        ctx2d.strokeStyle = '#dce8f0';
        ctx2d.lineWidth = 4;
        ctx2d.beginPath();
        ctx2d.moveTo(sweepStart, 0);
        ctx2d.lineTo(Math.min(sweepEnd, halfLen), 0);
        ctx2d.stroke();

        ctx2d.restore();
    }
}

// ===== 斩击标记（攻击命中时溅射划痕） =====================
export const slashMarks = [];

export function spawnSlashMarks(x, y, fromX, fromY, isCrit) {
    const baseAngle = Math.atan2(y - fromY, x - fromX);
    const count = isCrit ? 3 : 2;
    for (let i = 0; i < count; i++) {
        slashMarks.push({
            x: x + (Math.random() - 0.5) * 8,
            y: y + (Math.random() - 0.5) * 8,
            angle: baseAngle + (Math.random() - 0.5) * 0.7,
            startTime: Date.now(),
            duration: isCrit ? 420 : 300,
            length: isCrit ? 12 + Math.random() * 8 : 6 + Math.random() * 6
        });
    }
}

export function drawSlashMarks(ctx2d, now) {
    for (let i = slashMarks.length - 1; i >= 0; i--) {
        const s = slashMarks[i];
        const elapsed = now - s.startTime;
        const p = Math.min(elapsed / s.duration, 1);
        if (p >= 1) { slashMarks.splice(i, 1); continue; }
        const alpha = 1 - p;
        const len = s.length * (1 + p * 0.3);
        ctx2d.save();
        ctx2d.translate(s.x, s.y);
        ctx2d.rotate(s.angle);
        ctx2d.globalAlpha = alpha;
        ctx2d.strokeStyle = '#fff';
        ctx2d.lineWidth = 2.2 * (1 - p * 0.5);
        ctx2d.shadowColor = '#ffaa00';
        ctx2d.shadowBlur = 5 * (1 - p);
        ctx2d.beginPath();
        ctx2d.moveTo(-len * 0.25, 0);
        ctx2d.lineTo(len * 0.75, 0);
        ctx2d.stroke();
        ctx2d.restore();
    }
}

// ===== 治疗 / 招募闪光（轻柔光环） =====================
export const softFlashes = [];

export function triggerHealFlash(x, y) {
    softFlashes.push({ x, y, startTime: Date.now(), duration: 550, maxRadius: HEX_SIZE * 1.2, color: '#66ffaa' });
}

export function triggerRecruitFlash(x, y) {
    softFlashes.push({ x, y, startTime: Date.now(), duration: 420, maxRadius: HEX_SIZE * 1.3, color: '#aac8ff' });
}

export function drawSoftFlashes(ctx2d, now) {
    for (let i = softFlashes.length - 1; i >= 0; i--) {
        const f = softFlashes[i];
        const elapsed = now - f.startTime;
        const p = Math.min(elapsed / f.duration, 1);
        if (p >= 1) { softFlashes.splice(i, 1); continue; }
        const alpha = (1 - p) * 0.45;
        ctx2d.save();
        ctx2d.strokeStyle = f.color;
        ctx2d.lineWidth = 2.5 * (1 - p * 0.6);
        ctx2d.globalAlpha = alpha;
        ctx2d.shadowColor = f.color;
        ctx2d.shadowBlur = 8 * (1 - p);
        ctx2d.beginPath();
        ctx2d.arc(f.x, f.y, f.maxRadius * p, 0, Math.PI * 2);
        ctx2d.stroke();
        ctx2d.restore();
    }
}

// ===== 屏幕震动 =====================
export const screenShake = { x: 0, y: 0, time: 0, duration: 0 };

export function triggerScreenShake(intensity, duration) {
    if (!settings.screenShake) return;
    screenShake.x = intensity;
    screenShake.y = intensity;
    screenShake.duration = duration;
    screenShake.time = duration;
}

// ===== 回合切换闪光 =====================
export const turnFlash = { alpha: 0, color: '' };

export function triggerTurnFlash(campColor) {
    if (!settings.turnFlash) return;
    turnFlash.alpha = 0.4;
    turnFlash.color = campColor;
}

// ===== 胜利彩纸 =====================
export let confettiPieces = [];

export function spawnConfetti(count = 120) {
    const colors = ['#ff0', '#f44', '#4f4', '#44f', '#f4f', '#0ff', '#fff', '#ffd700', '#ff8800', '#88ff00'];
    for (let i = 0; i < count; i++) {
        confettiPieces.push({
            x: Math.random() * window.innerWidth,
            y: -(20 + Math.random() * 300),
            vx: (Math.random() - 0.5) * 300,
            vy: 80 + Math.random() * 250,
            color: colors[Math.floor(Math.random() * colors.length)],
            w: 4 + Math.random() * 8,
            h: 2 + Math.random() * 4,
            rot: Math.random() * Math.PI * 2,
            rotV: (Math.random() - 0.5) * 8,
            alpha: 1
        });
    }
}

export function updateConfetti(dt) {
    for (const c of confettiPieces) {
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.vy += 250 * dt;
        c.rot += c.rotV * dt;
        c.alpha = Math.max(0, 1 - (c.y / (window.innerHeight + 200)) * 0.6);
    }
    confettiPieces = confettiPieces.filter(c => c.alpha > 0 && c.y < window.innerHeight + 100);
}

export function drawConfetti(ctx2d) {
    for (const c of confettiPieces) {
        ctx2d.save();
        ctx2d.translate(c.x, c.y);
        ctx2d.rotate(c.rot);
        ctx2d.globalAlpha = c.alpha;
        ctx2d.fillStyle = c.color;
        ctx2d.shadowColor = 'rgba(0,0,0,0.3)';
        ctx2d.shadowBlur = 2;
        ctx2d.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        ctx2d.restore();
    }
}

// ===== 士气变化动画 =====================
export const moraleEffects = [];

export function spawnMoraleEffect(unit) {
    if (unit.morale === 'normal') return;
    moraleEffects.push({
        unitId: unit.id,
        x: unit.tile.x,
        y: unit.tile.y,
        morale: unit.morale,
        startTime: Date.now(),
        duration: 1500,
        phaseDuration: 800
    });
}

// ===== 清除所有瞬时效果（用于撤销/读档） =====================
export function clearTransientEffects() {
    particles.length = 0;
    moraleEffects.length = 0;
    meleeSlashes.length = 0;
    attackFlashes.length = 0;
    softFlashes.length = 0;
    slashMarks.length = 0;
    confettiPieces.length = 0;
    screenShake.time = 0;
    screenShake.x = 0;
    screenShake.y = 0;
    turnFlash.alpha = 0;
}
