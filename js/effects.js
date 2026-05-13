import { HEX_SIZE, settings, TACTICAL_CARD_CONFIG } from './config.js';
import { playSound } from './audio.js';

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
    const n = particleCount(18);
    // 绿色十字星粒子 + 金色微光
    for (let i = 0; i < n; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 60;
        const isSparkle = Math.random() < 0.35;
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 22,
            y + (Math.random() - 0.5) * 8,
            Math.cos(angle) * speed * 0.4 + (Math.random() - 0.5) * 20,
            -(35 + Math.random() * 55),
            isSparkle ? '#ffeebb' : (Math.random() < 0.5 ? '#66ffaa' : '#88ffcc'),
            isSparkle ? 2.5 + Math.random() * 3 : 1.5 + Math.random() * 3,
            0.8 + Math.random() * 0.9,
            -20
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
        startTime: performance.now(),
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
            startTime: performance.now(),
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
            startTime: performance.now(),
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
    softFlashes.push({ x, y, startTime: performance.now(), duration: 550, maxRadius: HEX_SIZE * 1.2, color: '#66ffaa' });
}

export function triggerRecruitFlash(x, y) {
    softFlashes.push({ x, y, startTime: performance.now(), duration: 420, maxRadius: HEX_SIZE * 1.3, color: '#aac8ff' });
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

export const factionMoraleFlash = { alpha: 0, color: '', startTime: 0 };

export function triggerTurnFlash(campColor) {
    if (!settings.turnFlash) return;
    turnFlash.alpha = 0.4;
    turnFlash.color = campColor;
}

export function triggerFactionMoraleFlash(campColor) {
    factionMoraleFlash.alpha = 0.90;
    factionMoraleFlash.color = campColor;
    factionMoraleFlash.startTime = performance.now();
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

// ===== 将领技能触发特效 =====================
export const commanderSkillEffects = [];
export const commanderFlash = { alpha: 0 };

export function spawnCommanderSkillEffect(x, y, glyph = '🎖️', label = '') {
    commanderSkillEffects.push({
        x, y,
        glyph,
        label,
        startTime: performance.now(),
        duration: 900
    });
    // 画布边框辉光
    commanderFlash.alpha = 0.90;
    // 提示音
    playSound('commanderSkill');
}

// ===== 士气变化动画 =====================
export const moraleEffects = [];

export function spawnMoraleEffect(unit) {
    if (unit.morale === 2) return;
    moraleEffects.push({
        unitId: unit.id,
        x: unit.tile.x,
        y: unit.tile.y,
        morale: unit.morale,
        startTime: performance.now(),
        duration: 1500,
        phaseDuration: 800
    });
}

// ===== 晋升动画（无辉光，无音效，类似士气动画） =====================
export const rankUpEffects = [];

export function spawnRankUpEffect(x, y, rank) {
    rankUpEffects.push({
        x, y, rank,
        startTime: performance.now(),
        duration: 1500,
        phaseDuration: 800
    });
}

// ===== 天气粒子 =====================
export const rainParticles = [];
export const splashParticles = [];
export const fogBlobs = [];
export const windStreaks = [];

export function spawnWeatherParticles(now, weather, logicalW, logicalH) {
    if (weather === 'rain') {
        // 雨滴
        if (rainParticles.length < 120) {
            rainParticles.push({
                x: Math.random() * logicalW,
                y: -10,
                vx: 0,
                vy: 500 + Math.random() * 200,
                length: 15 + Math.random() * 8,
                alpha: 0.25 + Math.random() * 0.1
            });
        }
        // 溅射粒子上次生成以来经过的时间
    } else if (weather === 'fog') {
        if (fogBlobs.length < 45 && Math.random() < 0.5) {
            fogBlobs.push({
                x: -60 + Math.random() * (logicalW + 120),
                y: Math.random() * logicalH,
                rx: 50 + Math.random() * 80,
                ry: 25 + Math.random() * 40,
                vx: 35 + Math.random() * 35,
                vy: -10 + Math.random() * 20,
                life: 8 + Math.random() * 4,
                maxLife: 12,
                alpha: 0.25 + Math.random() * 0.20,
                born: now
            });
        }
    } else if (weather === 'wind') {
        if (windStreaks.length < 12 && Math.random() < 0.5) {
            windStreaks.push({
                x: -40,
                y: Math.random() * logicalH,
                length: 30 + Math.random() * 20,
                vy: -5 + Math.random() * 10,
                life: 0.4 + Math.random() * 0.4,
                maxLife: 0.8,
                alpha: 0.25 + Math.random() * 0.15,
                speed: 500 + Math.random() * 200
            });
        }
    }
}

// ===== 炮弹飞行特效（炮兵远程攻击） =====================
export const projectiles = [];

export function spawnProjectile(fromX, fromY, toX, toY, isCrit, onImpact) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = Math.min(380, 200 + dist * 0.6);
    projectiles.push({
        fromX, fromY,
        toX, toY,
        dist,
        startTime: performance.now(),
        duration,
        isCrit,
        impactSpawned: false,
        onImpact: onImpact || null
    });
}

export function updateProjectiles(now) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        const elapsed = now - p.startTime;
        // 炮弹到达目标 → 触发爆炸特效
        if (!p.impactSpawned && elapsed >= p.duration) {
            p.impactSpawned = true;
            if (p.onImpact) p.onImpact();
        }
        if (elapsed > p.duration + 400) {
            projectiles.splice(i, 1);
        }
    }
}

export function drawProjectiles(ctx2d, now) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        const elapsed = now - p.startTime;
        const t = Math.min(1, Math.max(0, elapsed / p.duration));
        const eased = 1 - Math.pow(1 - t, 2.5);

        const curX = p.fromX + (p.toX - p.fromX) * eased;
        const curY = p.fromY + (p.toY - p.fromY) * eased - Math.sin(t * Math.PI) * p.dist * 0.18;

        // 尾焰拖尾 — 长尾巴，大粒子
        const trailCount = p.isCrit ? 10 : 7;
        for (let j = 0; j < trailCount; j++) {
            const backT = Math.max(0, t - (0.015 + j * 0.035));
            const backEased = 1 - Math.pow(1 - backT, 2.5);
            const tx = p.fromX + (p.toX - p.fromX) * backEased;
            const ty = p.fromY + (p.toY - p.fromY) * backEased - Math.sin(backT * Math.PI) * p.dist * 0.18;
            const trailAlpha = 0.6 - j * 0.06;
            if (trailAlpha <= 0) continue;
            ctx2d.save();
            ctx2d.globalAlpha = trailAlpha;
            const r = (p.isCrit ? 5 : 3.5) - j * 0.3;
            if (r <= 0) { ctx2d.restore(); continue; }
            ctx2d.fillStyle = j <= 1 ? '#fff' : (p.isCrit ? '#ffaa00' : '#ff6622');
            ctx2d.shadowColor = p.isCrit ? '#ff6600' : '#cc4400';
            ctx2d.shadowBlur = p.isCrit ? 8 : 5;
            ctx2d.beginPath();
            ctx2d.arc(tx, ty, r, 0, Math.PI * 2);
            ctx2d.fill();
            ctx2d.restore();
        }

        // 炮弹本体
        ctx2d.save();
        ctx2d.fillStyle = '#fff';
        ctx2d.shadowColor = p.isCrit ? '#ff4400' : '#ff6622';
        ctx2d.shadowBlur = p.isCrit ? 14 : 9;
        ctx2d.beginPath();
        ctx2d.arc(curX, curY, p.isCrit ? 6 : 4.5, 0, Math.PI * 2);
        ctx2d.fill();
        // 内层高亮
        ctx2d.fillStyle = '#ffe8cc';
        ctx2d.shadowBlur = 0;
        ctx2d.beginPath();
        ctx2d.arc(curX, curY, p.isCrit ? 2.5 : 2, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.restore();

        // 命中后触发轰炸爆炸
        if (t >= 0.92 && !p.impactSpawned) {
            p.impactSpawned = true;
            spawnCannonImpact(p.toX, p.toY, p.isCrit);
        }
    }
}

// 炮弹命中轰炸爆炸
function spawnCannonImpact(x, y, isCrit) {
    const n = particleCount(isCrit ? 35 : 22);
    for (let i = 0; i < n; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 100 + Math.random() * 300;
        const isSmoke = Math.random() < 0.3;
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 10,
            y + (Math.random() - 0.5) * 6,
            Math.cos(angle) * speed,
            Math.sin(angle) * speed * 0.7 - 20 - Math.random() * 40,
            isSmoke ? '#887766' : (Math.random() < 0.5 ? '#ff6600' : '#ffaa00'),
            isSmoke ? 4 + Math.random() * 6 : 2.5 + Math.random() * 4,
            isSmoke ? 0.5 + Math.random() * 0.6 : 0.3 + Math.random() * 0.5,
            isSmoke ? 30 + Math.random() * 40 : 180 + Math.random() * 150
        ));
    }
    // 火花四溅
    const sparkN = particleCount(isCrit ? 12 : 6);
    for (let i = 0; i < sparkN; i++) {
        const a = Math.random() * Math.PI * 2;
        particles.push(new VisualParticle(
            x, y,
            Math.cos(a) * (200 + Math.random() * 350),
            Math.sin(a) * (200 + Math.random() * 350),
            '#ffedaa', 1.5 + Math.random() * 2, 0.15 + Math.random() * 0.25,
            200 + Math.random() * 200
        ));
    }
}

// ===== 单位后坐力（炮兵开火时向后微振） =====================
export const recoils = [];

export function triggerRecoil(x, y, targetX, targetY) {
    const dx = x - targetX;
    const dy = y - targetY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    recoils.push({
        x, y,
        ox: (dx / dist) * 4,
        oy: (dy / dist) * 4,
        startTime: performance.now(),
        duration: 180
    });
}

export function getRecoilOffset(x, y, now) {
    for (let i = recoils.length - 1; i >= 0; i--) {
        const r = recoils[i];
        const dx2 = x - r.x;
        const dy2 = y - r.y;
        if (Math.abs(dx2) < 3 && Math.abs(dy2) < 3) {
            const elapsed = now - r.startTime;
            if (elapsed >= r.duration) { recoils.splice(i, 1); return null; }
            const p = elapsed / r.duration;
            const force = Math.sin(p * Math.PI) * (1 - p);
            return { x: r.ox * force, y: r.oy * force };
        }
    }
    return null;
}

// ===== 近战突进特效（徽章撞向目标后弹回） =====================
export const charges = [];

export function triggerCharge(unitId, unitX, unitY, targetX, targetY) {
    const dx = targetX - unitX;
    const dy = targetY - unitY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const maxDist = Math.min(dist * 0.62, HEX_SIZE * 1.6);
    charges.push({
        unitId,
        ox: (dx / dist) * maxDist,
        oy: (dy / dist) * maxDist,
        startTime: performance.now(),
        duration: 160
    });
}

export function getChargeOffset(unitId, now) {
    for (let i = charges.length - 1; i >= 0; i--) {
        const c = charges[i];
        if (c.unitId !== unitId) continue;
        const elapsed = now - c.startTime;
        if (elapsed >= c.duration) { charges.splice(i, 1); return null; }
        const p = elapsed / c.duration;
        // 快出 → 微过冲 → 急回
        let force;
        if (p < 0.22) force = p / 0.22;
        else if (p < 0.38) force = 1 - (p - 0.22) / 0.16 * 0.15;
        else force = 0.85 * (1 - (p - 0.38) / 0.62);
        return { x: c.ox * force, y: c.oy * force };
    }
    return null;
}

// ===== 吸血鬼嗜血：红色粒子流 =====================
export const bloodDrains = [];

export function spawnBloodDrain(fromX, fromY, toX, toY) {
    const count = Math.round(28 * settings.particleDensity);
    for (let i = 0; i < count; i++) {
        const orbitAngle = Math.random() * Math.PI * 2;
        const orbitRadius = 22 + Math.random() * 40;
        const orbitSpeed = 0.7 + Math.random() * 1.3;
        const peakHeight = 25 + Math.random() * 45;
        const delay = Math.random() * 0.25;
        bloodDrains.push({
            x: fromX, y: fromY,
            fromX, fromY, toX, toY,
            life: 1.1 + Math.random() * 0.6,
            maxLife: 1.7,
            size: 1.2 + Math.random() * 1.8,
            orbitAngle, orbitRadius, orbitSpeed, peakHeight,
            delay,
            trail: []
        });
    }
}

export function updateBloodDrains(dt) {
    for (let i = bloodDrains.length - 1; i >= 0; i--) {
        const b = bloodDrains[i];
        b.life -= dt;
        if (b.life <= 0) { bloodDrains.splice(i, 1); continue; }
        const rawT = 1 - b.life / b.maxLife;
        if (rawT < b.delay) continue;
        const t = (rawT - b.delay) / (1 - b.delay);
        const spiralFactor = Math.sin(t * Math.PI);
        const spiralAngle = b.orbitAngle + t * b.orbitSpeed * Math.PI * 2;
        const spiralX = Math.cos(spiralAngle) * b.orbitRadius * spiralFactor;
        const spiralY = Math.sin(spiralAngle) * b.orbitRadius * spiralFactor * 0.6;
        const baseX = b.fromX + (b.toX - b.fromX) * t;
        const baseY = b.fromY + (b.toY - b.fromY) * t - Math.sin(t * Math.PI) * b.peakHeight;
        b.x = baseX + spiralX;
        b.y = baseY + spiralY;
        b.trail.push({ x: b.x, y: b.y, life: 0.2 });
        for (let j = b.trail.length - 1; j >= 0; j--) {
            b.trail[j].life -= dt;
            if (b.trail[j].life <= 0) b.trail.splice(j, 1);
        }
        if (b.trail.length > 6) b.trail.splice(0, b.trail.length - 6);
    }
}

// ===== 谋士攻心：紫色波纹扩散 + 暗色粒子 =====================
export const lightningBolts = [];

export const gongxinRipples = [];

export function spawnGongxinRipple(x, y, intense = false) {
    const rings = [];
    const ringCount = intense ? 3 : 2;
    for (let i = 0; i < ringCount; i++) {
        rings.push({
            maxR: HEX_SIZE * (0.8 + i * 0.55),
            delay: i * 0.12
        });
    }
    // 暗色上升粒子
    const pCount = intense ? Math.round(22 * settings.particleDensity) : Math.round(12 * settings.particleDensity);
    for (let i = 0; i < pCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 3 + Math.random() * 18;
        particles.push(new VisualParticle(
            x + Math.cos(angle) * dist,
            y + Math.sin(angle) * dist,
            (Math.random() - 0.5) * 25,
            -(30 + Math.random() * 55),
            Math.random() < 0.3 ? '#bb88ff' : (Math.random() < 0.5 ? '#6644aa' : '#331166'),
            2 + Math.random() * 3,
            0.7 + Math.random() * 0.7,
            -8
        ));
    }
    gongxinRipples.push({
        x, y, rings,
        intense,
        startTime: performance.now(),
        duration: intense ? 1000 : 700
    });
}

export function updateGongxinRipples(now) {
    for (let i = gongxinRipples.length - 1; i >= 0; i--) {
        if (now - gongxinRipples[i].startTime > gongxinRipples[i].duration) {
            gongxinRipples.splice(i, 1);
        }
    }
}

export function drawGongxinRipples(ctx2d, now) {
    for (const r of gongxinRipples) {
        const elapsed = now - r.startTime;
        const alpha = Math.max(0, 1 - elapsed / r.duration);
        for (const ring of r.rings) {
            const localT = Math.max(0, Math.min(1, (elapsed - ring.delay * r.duration) / (r.duration * 0.7)));
            if (localT <= 0 || localT >= 1) continue;
            const radius = ring.maxR * localT;
            const ringAlpha = alpha * (1 - localT) * 0.7;
            ctx2d.save();
            ctx2d.globalAlpha = ringAlpha;
            ctx2d.beginPath();
            ctx2d.arc(r.x, r.y, radius, 0, Math.PI * 2);
            ctx2d.strokeStyle = r.intense ? '#cc88ff' : '#9966cc';
            ctx2d.lineWidth = 2.5 * (1 - localT);
            ctx2d.shadowColor = r.intense ? '#cc88ff' : '#8855bb';
            ctx2d.shadowBlur = 10 * (1 - localT);
            ctx2d.stroke();
            ctx2d.restore();
        }
    }
}

export function spawnLightningStrike(x, y) {
    const mainSegments = [];
    let sx = x + (Math.random() - 0.5) * 16;
    let sy = y - 300;
    const steps = 10;
    const stepY = 300 / steps;
    const branchPoints = []; // fork points for branches
    for (let i = 0; i < steps; i++) {
        const prog = (i + 1) / steps;
        const driftToTarget = (x - sx) * 0.25;
        const jitter = (Math.random() - 0.5) * 22 * (1 - prog * 0.6);
        const ex = sx + driftToTarget + jitter;
        const ey = sy + stepY;
        mainSegments.push({ x1: sx, y1: sy, x2: ex, y2: ey });
        // 中段有概率分叉
        if (i >= 2 && i <= 7 && Math.random() < 0.35) {
            branchPoints.push({ bx: sx, by: sy, prog });
        }
        sx = ex; sy = ey;
    }
    mainSegments.push({ x1: sx, y1: sy, x2: x, y2: y });

    // 分叉短枝
    const branches = [];
    for (const bp of branchPoints) {
        const bSegs = [];
        let bx = bp.bx, by = bp.by;
        const bSteps = 2 + Math.floor(Math.random() * 2);
        const bLen = 40 + Math.random() * 50;
        const bAngle = (Math.random() - 0.5) * 1.2;
        for (let j = 0; j < bSteps; j++) {
            const bp2 = (j + 1) / bSteps;
            const ex2 = bx + Math.cos(bAngle) * (bLen / bSteps) + (Math.random() - 0.5) * 14;
            const ey2 = by + (bLen / bSteps) * 0.6 + Math.random() * 8;
            bSegs.push({ x1: bx, y1: by, x2: ex2, y2: ey2 });
            bx = ex2; by = ey2;
        }
        branches.push(bSegs);
    }

    lightningBolts.push({
        x, y,
        segments: mainSegments,
        branches,
        startTime: performance.now(),
        duration: 500,
        isStrike: true
    });

    // 落点电能扩散火花
    const sparkCount = Math.round(24 * settings.particleDensity);
    for (let i = 0; i < sparkCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 220;
        particles.push(new VisualParticle(
            x, y,
            Math.cos(angle) * speed,
            Math.sin(angle) * speed,
            Math.random() < 0.35 ? '#ffffff' : '#88ccff',
            1.5 + Math.random() * 3.5,
            0.2 + Math.random() * 0.45,
            0
        ));
    }
    // 地面小冲击波粒子（暖色）
    for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        particles.push(new VisualParticle(
            x, y,
            Math.cos(angle) * 30,
            Math.sin(angle) * 30,
            '#ffcc66',
            2 + Math.random() * 2,
            0.15 + Math.random() * 0.2,
            0
        ));
    }
}

export function updateLightningBolts(now) {
    for (let i = lightningBolts.length - 1; i >= 0; i--) {
        if (now - lightningBolts[i].startTime > lightningBolts[i].duration) {
            lightningBolts.splice(i, 1);
        }
    }
}

export function drawLightningBolts(ctx2d, now) {
    for (const b of lightningBolts) {
        const elapsed = now - b.startTime;
        const alpha = elapsed < 60 ? elapsed / 60 : Math.max(0, 1 - (elapsed - 60) / (b.duration - 60));
        const isStrike = b.isStrike;
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        if (isStrike) {
            // 外层粗辉光（白色）
            ctx2d.strokeStyle = '#ffffff';
            ctx2d.lineWidth = 6;
            ctx2d.shadowColor = '#ffffff';
            ctx2d.shadowBlur = 20;
            ctx2d.beginPath();
            ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
            for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
            ctx2d.stroke();
            // 中层亮蓝
            ctx2d.strokeStyle = '#a0d0ff';
            ctx2d.lineWidth = 3;
            ctx2d.shadowColor = '#88bbff';
            ctx2d.shadowBlur = 10;
            ctx2d.beginPath();
            ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
            for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
            ctx2d.stroke();
            // 核心亮白
            ctx2d.strokeStyle = '#ffffff';
            ctx2d.lineWidth = 1.5;
            ctx2d.shadowBlur = 0;
            ctx2d.beginPath();
            ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
            for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
            ctx2d.stroke();
            // 分叉短枝（细线）
            if (b.branches) {
                ctx2d.strokeStyle = '#a0d0ff';
                ctx2d.lineWidth = 1.2;
                ctx2d.shadowColor = '#88bbff';
                ctx2d.shadowBlur = 6;
                for (const br of b.branches) {
                    ctx2d.beginPath();
                    ctx2d.moveTo(br[0].x1, br[0].y1);
                    for (const seg of br) ctx2d.lineTo(seg.x2, seg.y2);
                    ctx2d.stroke();
                }
            }
        } else {
            // 外层辉光
            ctx2d.strokeStyle = '#c080ff';
            ctx2d.lineWidth = 4;
            ctx2d.shadowColor = '#d0a0ff';
            ctx2d.shadowBlur = 12;
            ctx2d.beginPath();
            ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
            for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
            ctx2d.stroke();
            // 核心亮线
            ctx2d.strokeStyle = '#f0e0ff';
            ctx2d.lineWidth = 1.5;
            ctx2d.shadowBlur = 0;
            ctx2d.beginPath();
            ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
            for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
            ctx2d.stroke();
        }
        ctx2d.restore();
    }
}

// ===== 百夫长乘胜：金焰粒子 + 胜利涟漪 =====================
export function spawnGoldenFlame(x, y) {
    const n = Math.round(10 * settings.particleDensity);
    for (let i = 0; i < n; i++) {
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 10,
            y + (Math.random() - 0.5) * 4,
            (Math.random() - 0.5) * 30,
            -(60 + Math.random() * 80),
            Math.random() < 0.3 ? '#ffffff' : (Math.random() < 0.5 ? '#ffdd44' : '#ffaa00'),
            2 + Math.random() * 3.5,
            0.4 + Math.random() * 0.5,
            -60
        ));
    }
}

// 百夫长涟漪复用 softFlashes，直接调用 triggerHealFlash 风格即可
export function spawnVictoryRipple(x, y) {
    softFlashes.push({
        x, y,
        startTime: performance.now(),
        duration: 420,
        maxRadius: HEX_SIZE * 1.8,
        color: '#ffcc44'
    });
}

// ===== 尚书统御光环：金色波纹全图扩散 =====================
export const ministerRings = [];

export function spawnMinisterDominionRing(x, y) {
    ministerRings.push({
        x, y,
        startTime: performance.now(),
        duration: 1800,
        maxRadius: HEX_SIZE * 22
    });
}

export function updateMinisterRings(now) {
    for (let i = ministerRings.length - 1; i >= 0; i--) {
        if (now - ministerRings[i].startTime > ministerRings[i].duration) {
            ministerRings.splice(i, 1);
        }
    }
}

export function drawMinisterRings(ctx2d, now) {
    for (const r of ministerRings) {
        const elapsed = now - r.startTime;
        const progress = Math.max(0, Math.min(1, elapsed / r.duration));
        const radius = r.maxRadius * progress;
        const alpha = (1 - progress) * 0.55;
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.beginPath();
        ctx2d.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx2d.strokeStyle = '#ffd700';
        ctx2d.lineWidth = 3.5 * (1 - progress);
        ctx2d.shadowColor = '#ffd700';
        ctx2d.shadowBlur = 14 * (1 - progress);
        ctx2d.stroke();
        ctx2d.restore();
    }
}

// ===== 尚书屯田：金币雨 =====================
export const coinParticles = [];

export function spawnCoinRain(x, y, countMult = 1) {
    const n = Math.round(8 * settings.particleDensity * countMult);
    for (let i = 0; i < n; i++) {
        coinParticles.push({
            x: x + (Math.random() - 0.5) * 20,
            y: y - 35 - Math.random() * 20,
            vy: 60 + Math.random() * 70,
            vx: (Math.random() - 0.5) * 20,
            size: 3 + Math.random() * 2.5,
            life: 0.7 + Math.random() * 0.5,
            maxLife: 1.2,
            bounceY: y,
            bounced: false
        });
    }
}

export function updateCoinParticles(dt) {
    for (let i = coinParticles.length - 1; i >= 0; i--) {
        const c = coinParticles[i];
        c.life -= dt;
        if (c.life <= 0) { coinParticles.splice(i, 1); continue; }
        c.y += c.vy * dt;
        c.x += c.vx * dt;
        c.vy += 300 * dt;
        if (!c.bounced && c.y >= c.bounceY) {
            c.y = c.bounceY;
            c.vy = -(c.vy * 0.3);
            c.vx *= 0.5;
            if (Math.abs(c.vy) < 15) c.vy = 0;
            c.bounced = Math.abs(c.vy) < 5 ? true : c.bounced;
        }
    }
}

export function drawCoinParticles(ctx2d) {
    for (const c of coinParticles) {
        const progress = 1 - c.life / c.maxLife;
        const alpha = Math.max(0, 1 - progress * 0.7);
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.fillStyle = '#ffd700';
        ctx2d.shadowColor = '#cc9900';
        ctx2d.shadowBlur = 3;
        ctx2d.beginPath();
        ctx2d.ellipse(c.x, c.y, c.size, c.size * 0.5, 0, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.restore();
    }
}

// ===== 烧牌动画（对策卡使用广播） =====================
export const cardUseEffects = [];

// isLocal: true=释放者(从手牌位置飞入), false=观战者(中央直接出现)
export function spawnCardUseEffect(cardId, x, y, isLocal = false, fromX = 0, fromY = 0, displayName = null) {
    const cfg = TACTICAL_CARD_CONFIG[cardId];
    cardUseEffects.push({
        cardId, icon: cfg ? cfg.icon : '🃏', name: displayName || (cfg ? cfg.name : cardId),
        x, y, fromX, fromY, isLocal,
        startTime: performance.now(),
        duration: 1600,
        phaseDuration: 600,
        pauseDuration: 500
    });
}

// ===== 空袭特效 =====================
export const airstrikeEffects = [];

export function spawnAirstrikeEffect(cx, cy, results, type = 'airstrike') {
    airstrikeEffects.push({
        x: cx, y: cy, results, type,
        startTime: performance.now(),
        duration: 2000
    });
}

// ===== 圣骑士誓言金色光束（从天而降） =====================
export const goldenBeams = [];

export function spawnGoldenBeam(x, y) {
    const segments = [];
    const startY = y - 280;
    const steps = 8;
    for (let i = 0; i < steps; i++) {
        const prog = (i + 1) / steps;
        const sx = x + (Math.random() - 0.5) * 6 * (1 - prog);
        const sy = startY + (280 / steps) * i;
        const ex = x + (Math.random() - 0.5) * 6 * (1 - prog);
        const ey = startY + (280 / steps) * (i + 1);
        segments.push({ x1: sx, y1: sy, x2: ex, y2: ey });
    }
    goldenBeams.push({
        x, y,
        segments,
        startTime: performance.now(),
        duration: 700
    });
    // 落地金色粒子
    const n = Math.round(20 * settings.particleDensity);
    for (let i = 0; i < n; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 100;
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 12,
            y,
            Math.cos(angle) * speed,
            Math.sin(angle) * speed * 0.6 - 30 - Math.random() * 50,
            Math.random() < 0.3 ? '#ffffff' : (Math.random() < 0.5 ? '#ffedaa' : '#ffd700'),
            2 + Math.random() * 3.5,
            0.3 + Math.random() * 0.5,
            60 + Math.random() * 100
        ));
    }
}

export function updateGoldenBeams(now) {
    for (let i = goldenBeams.length - 1; i >= 0; i--) {
        if (now - goldenBeams[i].startTime > goldenBeams[i].duration) {
            goldenBeams.splice(i, 1);
        }
    }
}

export function drawGoldenBeams(ctx2d, now) {
    for (const b of goldenBeams) {
        const elapsed = now - b.startTime;
        const alpha = elapsed < 80 ? elapsed / 80 : Math.max(0, 1 - (elapsed - 80) / (b.duration - 80));
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        // 外层金色辉光
        ctx2d.strokeStyle = '#ffd700';
        ctx2d.lineWidth = 5;
        ctx2d.shadowColor = '#ffd700';
        ctx2d.shadowBlur = 18;
        ctx2d.beginPath();
        ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
        for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
        ctx2d.stroke();
        // 中层亮金
        ctx2d.strokeStyle = '#ffee88';
        ctx2d.lineWidth = 2.5;
        ctx2d.shadowColor = '#ffee88';
        ctx2d.shadowBlur = 8;
        ctx2d.beginPath();
        ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
        for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
        ctx2d.stroke();
        // 核心白线
        ctx2d.strokeStyle = '#ffffff';
        ctx2d.lineWidth = 1.2;
        ctx2d.shadowBlur = 0;
        ctx2d.beginPath();
        ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
        for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
        ctx2d.stroke();
        ctx2d.restore();
    }
}

// ===== 圣骑士至圣斩环绕光束 =====
export const paladinOrbitBeams = [];

export function spawnPaladinOrbitBeams(unitId, x, y, count) {
    clearPaladinOrbitBeams(unitId);
    for (let i = 0; i < count; i++) {
        paladinOrbitBeams.push({
            unitId, x, y,
            angle: (i / count) * Math.PI * 2,
            orbitRadius: HEX_SIZE * 0.88,
            orbitSpeed: 3.0,
            size: 32,
            startTime: performance.now()
        });
    }
}

export function clearPaladinOrbitBeams(unitId) {
    for (let i = paladinOrbitBeams.length - 1; i >= 0; i--) {
        if (paladinOrbitBeams[i].unitId === unitId) {
            paladinOrbitBeams.splice(i, 1);
        }
    }
}

export function updatePaladinOrbitBeams(now, getUnitPos) {
    for (let i = paladinOrbitBeams.length - 1; i >= 0; i--) {
        const b = paladinOrbitBeams[i];
        const pos = getUnitPos ? getUnitPos(b.unitId) : null;
        if (!pos) {
            paladinOrbitBeams.splice(i, 1);
            continue;
        }
        b.x = pos.x;
        b.y = pos.y;
        b.angle += b.orbitSpeed * 0.016;
    }
}

function _drawOrbitSword(ctx2d, b, now) {
    const elapsed = (now - b.startTime) / 1000;
    const cx = b.x + Math.cos(b.angle) * b.orbitRadius;
    const cy = b.y + Math.sin(b.angle) * b.orbitRadius * 0.5 - Math.sin(elapsed * 1.8) * 6;
    const hw = b.size * 0.16;
    const bladeLen = b.size * 0.85;
    const tipY = cy + bladeLen * 0.55;
    const guardY = cy - bladeLen * 0.15;
    const pommelY = cy - bladeLen * 0.45;

    ctx2d.save();
    ctx2d.shadowColor = '#ffd700';
    ctx2d.shadowBlur = 10;

    // blade — tapered polygon pointing down
    ctx2d.fillStyle = '#ffd700';
    ctx2d.beginPath();
    ctx2d.moveTo(cx, tipY);
    ctx2d.lineTo(cx + hw, guardY + hw * 0.4);
    ctx2d.lineTo(cx + hw * 0.5, guardY);
    ctx2d.lineTo(cx + hw * 0.3, pommelY);
    ctx2d.lineTo(cx - hw * 0.3, pommelY);
    ctx2d.lineTo(cx - hw * 0.5, guardY);
    ctx2d.lineTo(cx - hw, guardY + hw * 0.4);
    ctx2d.closePath();
    ctx2d.fill();

    // crossguard
    ctx2d.fillStyle = '#ffe055';
    ctx2d.fillRect(cx - hw * 1.4, guardY - hw * 0.25, hw * 2.8, hw * 0.5);

    ctx2d.shadowBlur = 0;

    // core bright line (no shadow)
    ctx2d.fillStyle = '#ffffff';
    ctx2d.beginPath();
    ctx2d.moveTo(cx, tipY - hw * 0.3);
    ctx2d.lineTo(cx + hw * 0.12, guardY + hw * 0.15);
    ctx2d.lineTo(cx, guardY - hw * 0.1);
    ctx2d.lineTo(cx - hw * 0.12, guardY + hw * 0.15);
    ctx2d.closePath();
    ctx2d.fill();

    // pommel
    ctx2d.beginPath();
    ctx2d.arc(cx, pommelY, hw * 0.5, 0, Math.PI * 2);
    ctx2d.fill();

    ctx2d.restore();
    return { cx, cy, unitY: b.y };
}

function _drawOrbitSwordsPass(ctx2d, now, pass) {
    for (const b of paladinOrbitBeams) {
        const elapsed = (now - b.startTime) / 1000;
        const cy = b.y + Math.sin(b.angle) * b.orbitRadius * 0.5 - Math.sin(elapsed * 1.8) * 6;
        // back pass: sword center above unit center (behind badge)
        // front pass: sword center at or below unit center (in front of badge)
        const isFront = cy >= b.y;
        if ((pass === 'front') !== isFront) continue;
        _drawOrbitSword(ctx2d, b, now);
    }
}

export function drawPaladinOrbitBeamsBack(ctx2d, now) {
    _drawOrbitSwordsPass(ctx2d, now, 'back');
}

export function drawPaladinOrbitBeamsFront(ctx2d, now) {
    _drawOrbitSwordsPass(ctx2d, now, 'front');
}

export function drawPaladinOrbitBeams(ctx2d, now) {
    _drawOrbitSwordsPass(ctx2d, now, 'front');
}

// ===== 圣骑士至圣斩光束弹射 =====
export const paladinBeamProjectiles = [];

export function spawnPaladinBeamProjectiles(fromX, fromY, toX, toY, count) {
    for (let i = 0; i < count; i++) {
        const angleOff = (i - (count - 1) / 2) * 0.35;
        paladinBeamProjectiles.push({
            fromX, fromY, toX, toY,
            angleOff,
            startTime: performance.now(),
            duration: 280,
            impactSpawned: false
        });
    }
}

// 将环绕剑从轨道位置发射到目标（返回每把剑的位置数据用于联机同步）
export function launchPaladinOrbitSwords(unitId, targetX, targetY, count) {
    const datas = [];
    for (let i = paladinOrbitBeams.length - 1; i >= 0 && datas.length < count; i--) {
        if (paladinOrbitBeams[i].unitId === unitId) {
            const b = paladinOrbitBeams[i];
            const n = performance.now();
            const elapsed = (n - b.startTime) / 1000;
            const cx = b.x + Math.cos(b.angle) * b.orbitRadius;
            const cy = b.y + Math.sin(b.angle) * b.orbitRadius * 0.5 - Math.sin(elapsed * 1.8) * 6;
            datas.push({ fromX: cx, fromY: cy, toX: targetX, toY: targetY });
            paladinOrbitBeams.splice(i, 1);
        }
    }
    // 生成弹射剑
    for (let i = 0; i < datas.length; i++) {
        const d = datas[i];
        const angleOff = (i - (datas.length - 1) / 2) * 0.35;
        paladinBeamProjectiles.push({
            fromX: d.fromX, fromY: d.fromY,
            toX: d.toX, toY: d.toY,
            angleOff,
            startTime: performance.now(),
            duration: 280,
            impactSpawned: false
        });
    }
    return datas;
}

export function updatePaladinBeamProjectiles(now) {
    for (let i = paladinBeamProjectiles.length - 1; i >= 0; i--) {
        const p = paladinBeamProjectiles[i];
        const elapsed = now - p.startTime;
        if (elapsed > p.duration + 300) {
            paladinBeamProjectiles.splice(i, 1);
        }
    }
}

export function drawPaladinBeamProjectiles(ctx2d, now) {
    for (const p of paladinBeamProjectiles) {
        const elapsed = now - p.startTime;
        const t = Math.min(1, Math.max(0, elapsed / p.duration));
        const eased = 1 - Math.pow(1 - t, 2);

        const dx = p.toX - p.fromX;
        const dy = p.toY - p.fromY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const baseAngle = Math.atan2(dy, dx);
        const flightAngle = baseAngle + p.angleOff * (1 - t);

        const curX = p.fromX + dx * eased;
        const curY = p.fromY + dy * eased - Math.sin(t * Math.PI) * dist * 0.12;
        const s = 26; // sword size

        // 尾迹粒子
        const trailLen = 6;
        for (let j = 0; j < trailLen; j++) {
            const backT = Math.max(0, t - (0.015 + j * 0.04));
            if (backT <= 0) continue;
            const backEased = 1 - Math.pow(1 - backT, 2);
            const tx = p.fromX + dx * backEased;
            const ty = p.fromY + dy * backEased - Math.sin(backT * Math.PI) * dist * 0.12;
            const trailAlpha = 0.5 - j * 0.07;
            if (trailAlpha <= 0) continue;
            ctx2d.save();
            ctx2d.globalAlpha = trailAlpha;
            ctx2d.fillStyle = j <= 1 ? '#ffffff' : '#ffd700';
            ctx2d.shadowColor = '#ffd700';
            ctx2d.shadowBlur = 6;
            ctx2d.beginPath();
            ctx2d.arc(tx, ty, 2.5 - j * 0.25, 0, Math.PI * 2);
            ctx2d.fill();
            ctx2d.restore();
        }

        // 飞行剑 — 剑尖朝向目标
        ctx2d.save();
        ctx2d.translate(curX, curY);
        ctx2d.rotate(flightAngle);
        const hw = s * 0.16;
        const bladeLen = s * 0.85;
        const tipX = bladeLen * 0.55;
        const guardX = -bladeLen * 0.15;
        const pommelX = -bladeLen * 0.45;

        ctx2d.shadowColor = '#ffd700';
        ctx2d.shadowBlur = 10;
        ctx2d.fillStyle = '#ffd700';
        ctx2d.beginPath();
        ctx2d.moveTo(tipX, 0);
        ctx2d.lineTo(guardX + hw * 0.4, -hw);
        ctx2d.lineTo(guardX, -hw * 0.5);
        ctx2d.lineTo(pommelX, -hw * 0.3);
        ctx2d.lineTo(pommelX, hw * 0.3);
        ctx2d.lineTo(guardX, hw * 0.5);
        ctx2d.lineTo(guardX + hw * 0.4, hw);
        ctx2d.closePath();
        ctx2d.fill();

        // crossguard
        ctx2d.fillStyle = '#ffe055';
        ctx2d.fillRect(guardX - hw * 0.25, -hw * 1.4, hw * 0.5, hw * 2.8);

        ctx2d.shadowBlur = 0;

        // core line (no shadow)
        ctx2d.fillStyle = '#ffffff';
        ctx2d.beginPath();
        ctx2d.moveTo(tipX - hw * 0.3, 0);
        ctx2d.lineTo(guardX + hw * 0.15, -hw * 0.15);
        ctx2d.lineTo(guardX - hw * 0.1, 0);
        ctx2d.lineTo(guardX + hw * 0.15, hw * 0.15);
        ctx2d.closePath();
        ctx2d.fill();

        // pommel (same fillStyle white, no extra shadow)
        ctx2d.beginPath();
        ctx2d.arc(pommelX, 0, hw * 0.5, 0, Math.PI * 2);
        ctx2d.fill();

        ctx2d.restore();

        // 命中目标
        if (t >= 0.88 && !p.impactSpawned) {
            p.impactSpawned = true;
            const n = Math.round(14 * settings.particleDensity);
            for (let k = 0; k < n; k++) {
                const a = Math.random() * Math.PI * 2;
                const spd = 60 + Math.random() * 180;
                particles.push(new VisualParticle(
                    p.toX, p.toY,
                    Math.cos(a) * spd,
                    Math.sin(a) * spd * 0.7 - 30 - Math.random() * 40,
                    Math.random() < 0.3 ? '#ffffff' : '#ffd700',
                    1.5 + Math.random() * 3,
                    0.2 + Math.random() * 0.4,
                    80 + Math.random() * 120
                ));
            }
            // 小闪光
            attackFlashes.push({
                x: p.toX, y: p.toY,
                startTime: performance.now(),
                duration: 200,
                maxRadius: HEX_SIZE * 1.1,
                isCrit: false
            });
        }
    }
}

// ===== 牧师圣链治疗特效 =====
export const healingChains = [];

export function spawnHealingChain(fromX, fromY, toX, toY) {
    healingChains.push({
        fromX, fromY, toX, toY,
        startTime: performance.now(),
        duration: 600
    });
    // 起点绿色粒子
    for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 50;
        particles.push(new VisualParticle(
            fromX, fromY,
            Math.cos(angle) * speed,
            Math.sin(angle) * speed - 20,
            '#88ffcc', 2 + Math.random() * 2.5, 0.4 + Math.random() * 0.4, -10
        ));
    }
    // 终点绿色粒子
    for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 30 + Math.random() * 50;
        particles.push(new VisualParticle(
            toX, toY,
            Math.cos(angle) * speed,
            Math.sin(angle) * speed - 20,
            '#66ffaa', 2 + Math.random() * 2.5, 0.4 + Math.random() * 0.4, -10
        ));
    }
}

export function updateHealingChains(now) {
    for (let i = healingChains.length - 1; i >= 0; i--) {
        if (now - healingChains[i].startTime > healingChains[i].duration) {
            healingChains.splice(i, 1);
        }
    }
}

export function drawHealingChains(ctx2d, now) {
    for (const c of healingChains) {
        const elapsed = now - c.startTime;
        const progress = Math.min(1, elapsed / c.duration);
        const alpha = progress < 0.2 ? progress / 0.2 : Math.max(0, 1 - (progress - 0.2) / 0.8);

        ctx2d.save();
        ctx2d.globalAlpha = alpha;

        // 绿色光束
        ctx2d.strokeStyle = '#66ffaa';
        ctx2d.lineWidth = 3;
        ctx2d.shadowColor = '#44dd88';
        ctx2d.shadowBlur = 12;
        ctx2d.beginPath();
        ctx2d.moveTo(c.fromX, c.fromY);
        ctx2d.lineTo(c.toX, c.toY);
        ctx2d.stroke();

        // 核心亮线
        ctx2d.strokeStyle = '#bbffdd';
        ctx2d.lineWidth = 1.2;
        ctx2d.shadowBlur = 0;
        ctx2d.beginPath();
        ctx2d.moveTo(c.fromX, c.fromY);
        ctx2d.lineTo(c.toX, c.toY);
        ctx2d.stroke();

        ctx2d.restore();
    }
}

// ===== 清除所有瞬时效果（用于撤销/读档） =====================
export function clearTransientEffects() {
    particles.length = 0;
    moraleEffects.length = 0;
    rankUpEffects.length = 0;
    meleeSlashes.length = 0;
    attackFlashes.length = 0;
    softFlashes.length = 0;
    slashMarks.length = 0;
    confettiPieces.length = 0;
    rainParticles.length = 0;
    splashParticles.length = 0;
    fogBlobs.length = 0;
    windStreaks.length = 0;
    projectiles.length = 0;
    recoils.length = 0;
    charges.length = 0;
    bloodDrains.length = 0;
    lightningBolts.length = 0;
    gongxinRipples.length = 0;
    ministerRings.length = 0;
    coinParticles.length = 0;
    goldenBeams.length = 0;
    paladinOrbitBeams.length = 0;
    paladinBeamProjectiles.length = 0;
    healingChains.length = 0;
    screenShake.time = 0;
    cardUseEffects.length = 0;
    airstrikeEffects.length = 0;
    screenShake.x = 0;
    screenShake.y = 0;
    turnFlash.alpha = 0;
    factionMoraleFlash.alpha = 0;
    factionMoraleFlash.startTime = 0;
}
