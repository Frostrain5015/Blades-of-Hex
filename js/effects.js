import { HEX_SIZE, LOGICAL_W, settings, TACTICAL_CARD_CONFIG, COLONEL_CARDS, MORALE_CONFIG } from './config.js';
import { playSound } from './audio.js';
import { AIRSTRIKE_FLIGHT, getStukaFlightPosition } from '../rules/attackPresentation.js';

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

export function spawnGoldParticles(x, y, color = '#ffd700') {
    const n = particleCount(8);
    for (let i = 0; i < n; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 50 + Math.random() * 100;
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10,
            Math.cos(angle) * speed, Math.sin(angle) * speed - 60,
            color, 3 + Math.random() * 3, 0.4 + Math.random() * 0.4
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

// ===== 画布边框辉光（统一机制：颜色可配，技能宣告/重大事件共用） =====
export const borderFlash = { alpha: 0, color: '#ffd700' };

export function triggerBorderFlash(color = '#ffd700') {
    borderFlash.alpha = 0.90;
    borderFlash.color = color;
}

export function triggerTurnFlash(campColor) {
    if (!settings.turnFlash) return;
    turnFlash.alpha = 0.4;
    turnFlash.color = campColor;
}

// 兼容旧名：斩杀敌方将领的全军士气辉光，语义即边框辉光。
export function triggerFactionMoraleFlash(campColor) {
    triggerBorderFlash(campColor);
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

// ===== 统一“符号+标签”宣告特效（图标弹出/技能宣告/士气/晋升） =====
// 地块中央弹出图标，可选扩散环、文字标签、边框辉光、音效与飞角归位。
// 后续新“闪个图标”需求只填 opts，不再新增特效实现。
export const iconEffects = [];

export function spawnIconEffect(x, y, opts = {}) {
    iconEffects.push({
        kind: opts.kind || 'pop',
        unitId: opts.unitId || null,
        x, y,
        glyph: opts.glyph || '🎖️',
        label: opts.label || '',
        color: opts.color || '#ffd700',
        ring: opts.ring === true,
        flyTo: opts.flyTo || null,   // 'moraleCorner' | 'rankCorner'
        rank: opts.rank || 0,
        morale: opts.morale,
        startTime: performance.now(),
        duration: opts.duration || 900,
        phaseDuration: opts.flyTo ? 800 : 0
    });
    // 边框辉光：true 表示跟随图标主色，也可直接传颜色
    if (opts.borderFlash) triggerBorderFlash(opts.borderFlash === true ? (opts.color || '#ffd700') : opts.borderFlash);
    if (opts.sound) playSound(opts.sound);
}

// 将领技能触发宣告：图标+技能名+扩散环+边框辉光+提示音（主题色可配，默认金）
export function spawnCommanderSkillEffect(x, y, glyph = '🎖️', label = '', skipSound = false, color = '#ffd700') {
    spawnIconEffect(x, y, {
        kind: glyph === '🛡' ? 'shield' : 'skill',
        glyph, label, color,
        ring: true,
        borderFlash: color,
        sound: skipSound ? null : 'commanderSkill'
    });
}

// 士气变化：大图标弹出 + 文字标签（士气上升/下降/混乱）→ 缩小飞回右上士气角
export function spawnMoraleEffect(unit) {
    const existing = iconEffects.findIndex(effect => effect.kind === 'morale' && effect.unitId === unit.id);
    if (existing !== -1) iconEffects.splice(existing, 1);
    if (unit.morale === 2) return;
    const mc = MORALE_CONFIG[unit.morale];
    spawnIconEffect(unit.tile.x, unit.tile.y, {
        kind: 'morale',
        unitId: unit.id,
        glyph: mc.icon,
        label: mc.name,
        color: mc.color,
        flyTo: 'moraleCorner',
        morale: unit.morale,
        duration: 1500
    });
}

// 晋升：徽章弹出（无标签、无辉光、无音效）→ 缩小飞回右下军衔角
export function spawnRankUpEffect(x, y, rank) {
    spawnIconEffect(x, y, {
        kind: 'rankUp',
        glyph: '',
        color: '#ffd700',
        flyTo: 'rankCorner',
        rank,
        duration: 1500
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

export function getProjectileFlightMs(fromX, fromY, toX, toY) {
    return Math.min(190, 90 + Math.hypot(toX - fromX, toY - fromY) * 0.22);
}

export function spawnProjectile(fromX, fromY, toX, toY, isCrit, onImpact) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // 快速弹道：短飞行时间，读起来干脆有力（避免单位已消失后炮弹慢悠悠飘过去）
    const duration = getProjectileFlightMs(fromX, fromY, toX, toY);
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
    // 发射瞬间：炮口白热闪光 + 前冲火花锥（与已有炮击声同步打出力量感）
    spawnMuzzleFlash(fromX, fromY, toX, toY, isCrit);
}

// 炮口闪光（发射瞬间）
function spawnMuzzleFlash(x, y, toX, toY, isCrit) {
    const ang = Math.atan2(toY - y, toX - x);
    const mx = x + Math.cos(ang) * 9, my = y + Math.sin(ang) * 9;
    // 炮口闪（暖白、略收敛，避免过曝激光感）
    particles.push(new VisualParticle(mx, my, 0, 0, '#ffe6b0', isCrit ? 8 : 6, 0.08, 0));
    // 前冲火花锥
    const n = particleCount(isCrit ? 9 : 6);
    for (let i = 0; i < n; i++) {
        const a = ang + (Math.random() - 0.5) * 0.8;
        const sp = 140 + Math.random() * 240;
        particles.push(new VisualParticle(
            mx, my, Math.cos(a) * sp, Math.sin(a) * sp,
            Math.random() < 0.5 ? '#fff' : (isCrit ? '#ffcc55' : '#ffb055'),
            2 + Math.random() * 2.4, 0.1 + Math.random() * 0.16, 40
        ));
    }
}

export function updateProjectiles(now) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
        const p = projectiles[i];
        const elapsed = now - p.startTime;
        // 命中：一次性触发爆炸粒子 + 命中回调（闪光/后坐力/震屏），随即移除弹体
        if (!p.impactSpawned && elapsed >= p.duration) {
            p.impactSpawned = true;
            spawnCannonImpact(p.toX, p.toY, p.isCrit);
            if (p.onImpact) p.onImpact();
            projectiles.splice(i, 1);
        }
    }
}

export function drawProjectiles(ctx2d, now) {
    for (const p of projectiles) {
        const elapsed = now - p.startTime;
        const t = Math.min(1, Math.max(0, elapsed / p.duration));
        if (t >= 1) continue; // 命中后不再绘制弹体（爆炸由 updateProjectiles 触发）

        // 线性匀速冲向目标 + 极小弧线，末端不减速 → 干脆、无"顿一下"
        const arc = -Math.sin(t * Math.PI) * p.dist * 0.06;
        const hx = p.fromX + (p.toX - p.fromX) * t;
        const hy = p.fromY + (p.toY - p.fromY) * t + arc;
        // 运动模糊拖尾端（落后一小段），头尾连成一条速度光条
        const tailT = Math.max(0, t - 0.28);
        const tArc = -Math.sin(tailT * Math.PI) * p.dist * 0.06;
        const tx = p.fromX + (p.toX - p.fromX) * tailT;
        const ty = p.fromY + (p.toY - p.fromY) * tailT + tArc;

        ctx2d.save();
        ctx2d.lineCap = 'round';
        // 外层火焰辉光光条（低 bloom，偏火色而非霓虹）
        ctx2d.strokeStyle = p.isCrit ? '#e5591a' : '#e0751f';
        ctx2d.shadowColor = p.isCrit ? '#cc3a00' : '#b85410';
        ctx2d.shadowBlur = p.isCrit ? 10 : 7;
        ctx2d.lineWidth = p.isCrit ? 6 : 4.5;
        ctx2d.beginPath();
        ctx2d.moveTo(tx, ty);
        ctx2d.lineTo(hx, hy);
        ctx2d.stroke();
        // 内芯热铁色芯（不发光，去掉激光感）
        ctx2d.shadowBlur = 0;
        ctx2d.strokeStyle = p.isCrit ? '#ffd39a' : '#ffca90';
        ctx2d.lineWidth = p.isCrit ? 2 : 1.5;
        ctx2d.beginPath();
        ctx2d.moveTo(tx, ty);
        ctx2d.lineTo(hx, hy);
        ctx2d.stroke();
        ctx2d.restore();
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

// ===== 鱼雷（水下安静推进 → 目标处水柱爆炸） =====================
export const torpedoes = [];
export const torpedoSplashes = [];

// 鱼雷飞行时长（毫秒）：比炮弹慢约四倍；相邻海格也能清楚读出完整推进过程。
// 供战斗流程提前计算命中时刻（血条/伤害数字/爆炸均延迟到抵达）。
export function getTorpedoFlightMs(fromX, fromY, toX, toY) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return Math.max(620, Math.min(860, 520 + dist * 1.55));
}

export function spawnTorpedo(fromX, fromY, toX, toY, isCrit, onImpact) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = getTorpedoFlightMs(fromX, fromY, toX, toY);
    torpedoes.push({
        fromX, fromY,
        toX, toY,
        dx, dy, dist,
        startTime: performance.now(),
        duration,
        isCrit,
        impactSpawned: false,
        onImpact: onImpact || null
    });
}

function spawnTorpedoImpact(x, y, isCrit, startTime = performance.now()) {
    torpedoSplashes.push({
        x, y,
        startTime,
        duration: isCrit ? 780 : 680,
        isCrit
    });

    // 水滴仍走通用粒子更新，但只使用冷色并向屏幕上方喷起，避免看成舰炮火球。
    const count = particleCount(isCrit ? 42 : 30);
    const colors = ['#effcff', '#bdefff', '#76cae8', '#3b9fc4'];
    for (let i = 0; i < count; i++) {
        const side = (Math.random() - 0.5) * (isCrit ? 1.7 : 1.35);
        const speed = 90 + Math.random() * (isCrit ? 280 : 220);
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 12,
            y + (Math.random() - 0.5) * 7,
            Math.sin(side) * speed,
            -Math.cos(side) * speed * (0.65 + Math.random() * 0.55),
            colors[Math.floor(Math.random() * colors.length)],
            2 + Math.random() * (isCrit ? 5 : 3.8),
            0.36 + Math.random() * 0.45,
            260 + Math.random() * 180
        ));
    }

    triggerScreenShake(isCrit ? 7 : 4, isCrit ? 260 : 180);
    playSound('explosion');
}

export function updateTorpedoes(now) {
    for (let i = torpedoes.length - 1; i >= 0; i--) {
        const torpedo = torpedoes[i];
        if (!torpedo.impactSpawned && now - torpedo.startTime >= torpedo.duration) {
            torpedo.impactSpawned = true;
            spawnTorpedoImpact(torpedo.toX, torpedo.toY, torpedo.isCrit, now);
            if (torpedo.onImpact) torpedo.onImpact();
            torpedoes.splice(i, 1);
        }
    }
    for (let i = torpedoSplashes.length - 1; i >= 0; i--) {
        if (now - torpedoSplashes[i].startTime >= torpedoSplashes[i].duration) {
            torpedoSplashes.splice(i, 1);
        }
    }
}

export function drawTorpedoes(ctx2d, now) {
    for (const torpedo of torpedoes) {
        const t = Math.min(1, Math.max(0, (now - torpedo.startTime) / torpedo.duration));
        if (t >= 1 || torpedo.dist <= 0) continue;

        const ux = torpedo.dx / torpedo.dist;
        const uy = torpedo.dy / torpedo.dist;
        const nx = -uy;
        const ny = ux;
        const sway = Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI) * Math.min(3.5, torpedo.dist * 0.025);
        const headX = torpedo.fromX + torpedo.dx * t + nx * sway;
        const headY = torpedo.fromY + torpedo.dy * t + ny * sway;
        const trailLength = Math.min(30, 12 + torpedo.dist * 0.10);
        const tailX = headX - ux * trailLength;
        const tailY = headY - uy * trailLength;
        const angle = Math.atan2(torpedo.dy, torpedo.dx);

        ctx2d.save();
        // 水下尾迹刻意压低亮度和宽度，前段没有炮口闪光或爆炸声。
        const wake = ctx2d.createLinearGradient(tailX, tailY, headX, headY);
        wake.addColorStop(0, 'rgba(150, 224, 242, 0)');
        wake.addColorStop(0.55, 'rgba(150, 224, 242, 0.20)');
        wake.addColorStop(1, torpedo.isCrit ? 'rgba(225, 252, 255, 0.72)' : 'rgba(205, 245, 250, 0.52)');
        ctx2d.strokeStyle = wake;
        ctx2d.lineWidth = torpedo.isCrit ? 3 : 2;
        ctx2d.lineCap = 'round';
        ctx2d.beginPath();
        ctx2d.moveTo(tailX, tailY);
        ctx2d.lineTo(headX, headY);
        ctx2d.stroke();

        ctx2d.translate(headX, headY);
        ctx2d.rotate(angle);
        ctx2d.fillStyle = torpedo.isCrit ? 'rgba(214, 247, 251, 0.78)' : 'rgba(39, 82, 96, 0.78)';
        ctx2d.strokeStyle = 'rgba(228, 252, 255, 0.76)';
        ctx2d.lineWidth = 1;
        ctx2d.beginPath();
        ctx2d.ellipse(0, 0, torpedo.isCrit ? 9 : 7, torpedo.isCrit ? 3.2 : 2.6, 0, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.stroke();
        ctx2d.beginPath();
        ctx2d.moveTo(-5, 0);
        ctx2d.lineTo(-10, -4);
        ctx2d.lineTo(-10, 4);
        ctx2d.closePath();
        ctx2d.fill();
        ctx2d.restore();
    }

    for (const splash of torpedoSplashes) {
        const p = Math.min(1, Math.max(0, (now - splash.startTime) / splash.duration));
        const alpha = 1 - p * p;
        const scale = splash.isCrit ? 1.25 : 1;
        const ringRadius = HEX_SIZE * scale * (0.22 + p * 0.78);
        const plume = Math.sin(Math.min(1, p * 1.45) * Math.PI) * HEX_SIZE * 0.95 * scale;

        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.strokeStyle = 'rgba(183, 239, 255, 0.92)';
        ctx2d.lineWidth = Math.max(1.5, 5 * (1 - p));
        ctx2d.beginPath();
        ctx2d.ellipse(splash.x, splash.y + 4, ringRadius, ringRadius * 0.34, 0, 0, Math.PI * 2);
        ctx2d.stroke();

        // 向屏幕上方抬升的三股水柱，为俯视 2D 提供明确的“炸起”高度感。
        ctx2d.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
            const spread = i * 13 * scale;
            ctx2d.strokeStyle = i === 0
                ? 'rgba(239, 253, 255, 0.95)'
                : 'rgba(117, 207, 236, 0.82)';
            ctx2d.lineWidth = (i === 0 ? 10 : 7) * (1 - p * 0.65) * scale;
            ctx2d.beginPath();
            ctx2d.moveTo(splash.x + spread * 0.25, splash.y + 2);
            ctx2d.quadraticCurveTo(
                splash.x + spread * 0.8,
                splash.y - plume * 0.45,
                splash.x + spread,
                splash.y - plume
            );
            ctx2d.stroke();
        }
        ctx2d.restore();
    }
}

// ===== 无人机机枪弹道（比防空曳光弹更醒目，但避免激光感） =====================
export const droneProjectiles = [];
const DRONE_SHOT_COUNT = 5;
const DRONE_SHOT_INTERVAL_MS = 90;
const DRONE_SHOT_FLIGHT_MS = 100;
export const DRONE_PROJECTILE_IMPACT_MS = (DRONE_SHOT_COUNT - 1) * DRONE_SHOT_INTERVAL_MS + DRONE_SHOT_FLIGHT_MS;

export function spawnGuerrillaBullet(fromX, fromY, toX, toY, isCrit, onImpact) {
    droneProjectiles.push({
        fromX, fromY, toX, toY, startTime: performance.now(), duration: CULTURE_STRIKE_TIMING.normalBullet,
        isCrit, onImpact, isGuerrillaBullet: true
    });
    spawnDroneMuzzleFlash(fromX, fromY, toX, toY, isCrit);
}

export function spawnDroneProjectile(fromX, fromY, toX, toY, isCrit, onImpact) {
    const now = performance.now();
    for (let b = 0; b < DRONE_SHOT_COUNT; b++) {
        droneProjectiles.push({
            fromX: fromX + (Math.random() - 0.5) * 6,
            fromY: fromY + (Math.random() - 0.5) * 6,
            toX: toX + (Math.random() - 0.5) * 8,
            toY: toY + (Math.random() - 0.5) * 8,
            dist: Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2),
            startTime: now + b * DRONE_SHOT_INTERVAL_MS,
            duration: DRONE_SHOT_FLIGHT_MS,
            isCrit,
            impactSpawned: false,
            onImpact: b === DRONE_SHOT_COUNT - 1 ? onImpact : null
        });
    }
    for (let f = 0; f < 3; f++) {
        const ang = Math.atan2(toY - fromY, toX - fromX);
        const mx = fromX + Math.cos(ang) * 8;
        const my = fromY + Math.sin(ang) * 8;
        particles.push(new VisualParticle(mx, my, 0, 0, "#ffe7b8", 8 - f * 1.6, 0.07 + f * 0.018, 0));
        for (let s = 0; s < 6; s++) {
            const a = ang + (Math.random() - 0.5) * 0.9;
            const sp = 180 + Math.random() * 300;
            particles.push(new VisualParticle(mx, my, Math.cos(a) * sp, Math.sin(a) * sp, Math.random() < 0.3 ? "#ffe9c0" : "#ff9a3a", 1.8 + Math.random() * 2.6, 0.11 + Math.random() * 0.1, 30));
        }
    }
}

// 单发曳光弹（专供扫射逐帧追踪飞机位置用，不叠加 5 连发）
// 标记 _isStrafeTracer 以跳过不必要的爆炸粒子和降低渲染开销
export function spawnStrafeTracer(fromX, fromY, toX, toY) {
    droneProjectiles.push({
        fromX: fromX + (Math.random() - 0.5) * 6,
        fromY: fromY + (Math.random() - 0.5) * 6,
        toX: toX + (Math.random() - 0.5) * 8,
        toY: toY + (Math.random() - 0.5) * 8,
        dist: Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2),
        startTime: performance.now(),
        duration: 100,
        isCrit: false,
        impactSpawned: false,
        onImpact: null,
        _isStrafeTracer: true
    });
}

function spawnDroneMuzzleFlash(x, y, toX, toY, isCrit) {
    const ang = Math.atan2(toY - y, toX - x);
    const mx = x + Math.cos(ang) * 8, my = y + Math.sin(ang) * 8;
    // 中心暖色枪口闪
    particles.push(new VisualParticle(mx, my, 0, 0, '#ffe7b8', isCrit ? 8 : 6, 0.09, 0));
    // 更粗壮的火花锥
    const n = particleCount(isCrit ? 14 : 10);
    for (let i = 0; i < n; i++) {
        const a = ang + (Math.random() - 0.5) * 1.0;
        const sp = 180 + Math.random() * 300;
        particles.push(new VisualParticle(
            mx, my, Math.cos(a) * sp, Math.sin(a) * sp,
            Math.random() < 0.35 ? '#ffe9c0' : (isCrit ? '#ffc65a' : '#ff9a3a'),
            2.1 + Math.random() * 2.5, 0.11 + Math.random() * 0.15, 45
        ));
    }
}

export function updateDroneProjectiles(now) {
    for (let i = droneProjectiles.length - 1; i >= 0; i--) {
        const p = droneProjectiles[i];
        const elapsed = now - p.startTime;
        if (elapsed < 0) continue;
        if (!p.impactSpawned && elapsed >= p.duration) {
            p.impactSpawned = true;
            if (p.onImpact) p.onImpact();
            // 扫射曳光弹不产生命中火花（纯视觉，避免额外粒子开销）
            if (!p._isStrafeTracer) {
                spawnExplosionParticles(p.toX, p.toY, '#ffaa33', p.isCrit ? 8 : 5);
            }
            droneProjectiles.splice(i, 1);
        }
    }
}

export function drawDroneProjectiles(ctx2d, now) {
    for (const p of droneProjectiles) {
        const elapsed = now - p.startTime;
        if (elapsed < 0) continue;
        const t = Math.min(1, Math.max(0, elapsed / p.duration));
        if (t >= 1) continue;
        if (p.isGuerrillaBullet) {
            drawSniperBullet(ctx2d, { x: p.fromX, y: p.fromY }, { x: p.toX, y: p.toY }, HEX_SIZE, t);
            continue;
        }

        const hx = p.fromX + (p.toX - p.fromX) * t;
        const hy = p.fromY + (p.toY - p.fromY) * t;
        const tailT = Math.max(0, t - 0.14);
        const tx = p.fromX + (p.toX - p.fromX) * tailT;
        const ty = p.fromY + (p.toY - p.fromY) * tailT;

        ctx2d.save();
        ctx2d.lineCap = 'round';
        if (p._isStrafeTracer) {
            // 扫射曳光弹：轻量渲染，省去 shadowBlur 开销
            ctx2d.strokeStyle = 'rgba(255,138,34,0.74)';
            ctx2d.lineWidth = 3;
            ctx2d.beginPath();
            ctx2d.moveTo(tx, ty);
            ctx2d.lineTo(hx, hy);
            ctx2d.stroke();
            ctx2d.strokeStyle = 'rgba(255,220,145,0.58)';
            ctx2d.lineWidth = 1;
            ctx2d.beginPath();
            ctx2d.moveTo(tx, ty);
            ctx2d.lineTo(hx, hy);
            ctx2d.stroke();
            ctx2d.fillStyle = 'rgba(255,205,110,0.75)';
            ctx2d.beginPath();
            ctx2d.arc(hx, hy, 1.5, 0, Math.PI * 2);
            ctx2d.fill();
        } else {
            // 正常曳光弹：外辉 + 内芯 + 弹头
            ctx2d.strokeStyle = p.isCrit ? 'rgba(255,88,42,0.86)' : 'rgba(255,138,34,0.74)';
            ctx2d.shadowColor = p.isCrit ? 'rgba(255,64,30,0.62)' : 'rgba(255,176,48,0.48)';
            ctx2d.shadowBlur = p.isCrit ? 9 : 6;
            ctx2d.lineWidth = p.isCrit ? 5.5 : 4;
            ctx2d.beginPath();
            ctx2d.moveTo(tx, ty);
            ctx2d.lineTo(hx, hy);
            ctx2d.stroke();
            ctx2d.shadowBlur = 0;
            ctx2d.strokeStyle = p.isCrit ? 'rgba(255,240,190,0.78)' : 'rgba(255,220,145,0.58)';
            ctx2d.lineWidth = p.isCrit ? 1.7 : 1.25;
            ctx2d.beginPath();
            ctx2d.moveTo(tx, ty);
            ctx2d.lineTo(hx, hy);
            ctx2d.stroke();
            ctx2d.shadowColor = p.isCrit ? 'rgba(255,180,70,0.75)' : 'rgba(255,190,80,0.55)';
            ctx2d.shadowBlur = p.isCrit ? 7 : 4;
            ctx2d.fillStyle = p.isCrit ? 'rgba(255,238,160,0.9)' : 'rgba(255,205,110,0.75)';
            ctx2d.beginPath();
            ctx2d.arc(hx, hy, p.isCrit ? 2.4 : 1.8, 0, Math.PI * 2);
            ctx2d.fill();
        }
        ctx2d.restore();
    }
}

// ===== 无人机自爆：AA 子弹流（从无人机射向目标，模拟防空火力） =====================
export const droneSuicideFlak = [];

export function spawnDroneSuicideFlak(fromX, fromY, targetX, targetY) {
    droneSuicideFlak.push({
        fromX, fromY, targetX, targetY,
        startTime: performance.now(),
        duration: 700,
        seed: (fromX | 0) * 7 + (targetY | 0) * 13
    });
}

export function updateDroneSuicideFlak(now) {
    for (let i = droneSuicideFlak.length - 1; i >= 0; i--) {
        if (now - droneSuicideFlak[i].startTime > droneSuicideFlak[i].duration) {
            droneSuicideFlak.splice(i, 1);
        }
    }
}

export function drawDroneSuicideFlak(ctx2d, now) {
    for (const fx of droneSuicideFlak) {
        const elapsed = now - fx.startTime;
        const t = elapsed / fx.duration;
        if (t >= 1) continue;
        const dx = fx.targetX - fx.fromX;
        const dy = fx.targetY - fx.fromY;
        const seed = fx.seed;
        for (let tr = 0; tr < 4; tr++) {
            const phase = (t * 7 + tr * 0.4 + seed * 0.02) % 1;
            const tp = phase < 0.7 ? phase / 0.7 : (1 - phase) / 0.3;
            const tx = fx.fromX + dx * tp;
            const ty = fx.fromY + dy * tp;
            const ta = 0.9 * (1 - tp);
            ctx2d.save();
            ctx2d.shadowColor = 'rgba(255,200,60,0.8)';
            ctx2d.shadowBlur = 6;
            ctx2d.fillStyle = `rgba(255,230,120,${ta})`;
            ctx2d.beginPath();
            ctx2d.arc(tx, ty, 2.2 + (1 - tp) * 2, 0, Math.PI * 2);
            ctx2d.fill();
            if (tp < 0.6) {
                ctx2d.shadowBlur = 2;
                ctx2d.strokeStyle = `rgba(255,220,80,${ta * 0.55})`;
                ctx2d.lineWidth = 1.5;
                ctx2d.beginPath();
                ctx2d.moveTo(tx, ty);
                ctx2d.lineTo(tx - dx * 0.05, ty - dy * 0.05);
                ctx2d.stroke();
            }
            ctx2d.restore();
        }
    }
}

// ===== 无人机自爆：带徽章的无人机棋子飞向目标 =====================
export const droneDives = [];

export function spawnDroneDive(fromX, fromY, toX, toY, campKey) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const duration = Math.min(400, 180 + dist * 0.35);
    droneDives.push({
        fromX, fromY, toX, toY,
        startTime: performance.now(),
        duration,
        campKey,
        impactSpawned: false
    });
}

export function updateDroneDives(now) {
    for (let i = droneDives.length - 1; i >= 0; i--) {
        const d = droneDives[i];
        if (!d.impactSpawned && now - d.startTime >= d.duration) {
            d.impactSpawned = true;
            // 抵达目标 → 大爆炸
            spawnExplosionParticles(d.toX, d.toY, '#ff6600', 40);
            spawnExplosionParticles(d.toX, d.toY, '#ffcc00', 25);
            triggerAttackFlash(d.toX, d.toY, true);
            triggerScreenShake(8, 300);
            playSound('explosion');
            droneDives.splice(i, 1);
        }
    }
}

export function drawDroneDives(ctx2d, now) {
    for (const d of droneDives) {
        const elapsed = now - d.startTime;
        const t = Math.min(1, Math.max(0, elapsed / d.duration));
        if (t >= 1) continue;

        const x = d.fromX + (d.toX - d.fromX) * t;
        const y = d.fromY + (d.toY - d.fromY) * t;

        // 拖尾光迹
        const tailT = Math.max(0, t - 0.15);
        const tx = d.fromX + (d.toX - d.fromX) * tailT;
        const ty = d.fromY + (d.toY - d.fromY) * tailT;
        const trailLen = Math.sqrt((x - tx) ** 2 + (y - ty) ** 2);

        ctx2d.save();

        if (trailLen > 2) {
            const grad = ctx2d.createLinearGradient(tx, ty, x, y);
            grad.addColorStop(0, 'rgba(100,200,255,0)');
            grad.addColorStop(1, 'rgba(100,200,255,0.6)');
            ctx2d.strokeStyle = grad;
            ctx2d.lineWidth = 8;
            ctx2d.lineCap = 'round';
            ctx2d.shadowColor = 'rgba(100,200,255,0.8)';
            ctx2d.shadowBlur = 14;
            ctx2d.beginPath();
            ctx2d.moveTo(tx, ty);
            ctx2d.lineTo(x, y);
            ctx2d.stroke();
        }

        // 无人机徽章（带脉冲）
        const pulse = Math.sin(elapsed * 0.015) * 0.15 + 1;
        const badgeR = 13 * pulse;
        ctx2d.shadowColor = 'rgba(60,180,255,0.9)';
        ctx2d.shadowBlur = 22;
        ctx2d.beginPath();
        ctx2d.arc(x, y, badgeR, 0, Math.PI * 2);
        const grad2 = ctx2d.createRadialGradient(x - 2, y - 3, 0, x, y, badgeR);
        grad2.addColorStop(0, '#b8e4ff');
        grad2.addColorStop(0.4, '#4a8af4');
        grad2.addColorStop(1, '#1a2a60');
        ctx2d.fillStyle = grad2;
        ctx2d.fill();
        ctx2d.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx2d.lineWidth = 1.5;
        ctx2d.stroke();

        // ✈ 图标
        ctx2d.shadowBlur = 0;
        ctx2d.font = 'bold 15px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx2d.textAlign = 'center';
        ctx2d.textBaseline = 'middle';
        ctx2d.fillStyle = '#fff';
        ctx2d.fillText('✈', x, y + 1);

        // 速度线
        const angle = Math.atan2(d.toY - d.fromY, d.toX - d.fromX);
        for (let s = 0; s < 3; s++) {
            const sa = angle + (s - 1) * 0.35;
            const sl = 10 + (s % 2) * 6;
            ctx2d.strokeStyle = `rgba(180,220,255,${0.15 + s * 0.1})`;
            ctx2d.lineWidth = 1.5;
            ctx2d.beginPath();
            ctx2d.moveTo(x - Math.cos(sa) * (badgeR + 2), y - Math.sin(sa) * (badgeR + 2));
            ctx2d.lineTo(x - Math.cos(sa) * (badgeR + sl), y - Math.sin(sa) * (badgeR + sl));
            ctx2d.stroke();
        }

        ctx2d.restore();
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

// E3 纵横家连横卡牌复制飞行特效
export function spawnCardCopyEffect(fromX, fromY, toX, toY, cardId) {
    // 金色卡牌轮廓从用卡方飞向目标阵营手牌区
    const midX = (fromX + toX) / 2;
    const midY = Math.min(fromY, toY) - 30;
    for (let i = 0; i < 8; i++) {
        const t = i / 7;
        const px = (1 - t) * (1 - t) * fromX + 2 * (1 - t) * t * midX + t * t * toX;
        const py = (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * midY + t * t * toY;
        spawnExplosionParticles(px, py, '#ffd700', 2);
    }
    // 到达时金色爆裂
    setTimeout(() => {
        spawnExplosionParticles(toX, toY, '#ffd700', 10);
        spawnExplosionParticles(toX, toY, '#ffaa00', 5);
    }, 800);
}

// E1 占星者星移特效：金色光柱 + 星辰爆裂
export function spawnAstrologerEffect(x, y) {
    spawnExplosionParticles(x, y, '#ffd700', 15);
    spawnExplosionParticles(x, y, '#6688ff', 10);
    for (let i = 0; i < 12; i++) {
        spawnExplosionParticles(x + (Math.random() - 0.5) * 20, y - 30 - Math.random() * 40, '#ffd700', 2);
    }
}

// E2 亡灵法师魂卒唤起特效
export function spawnNecromancerRaiseEffect(x, y) {
    spawnExplosionParticles(x, y, '#44ff88', 15);
    spawnExplosionParticles(x, y, '#8844ff', 10);
    spawnCommanderSkillEffect(x, y, '💀', '回魂');
}

// E5 补员特效：金币弹起 → 绿色治疗粒子
export function spawnReinforceEffect(x, y, healAmt) {
    spawnCoinRain(x, y, 0.8);
    triggerHealFlash(x, y);
    spawnHealParticles(x, y);
    if (healAmt > 0) {
        spawnExplosionParticles(x, y, '#44ff44', 10);
        spawnExplosionParticles(x, y, '#ffd700', 6);
    }
}

// ===== 烧牌动画（对策卡使用广播） =====================
export const cardUseEffects = [];

// isLocal: true=释放者(从手牌位置飞入), false=观战者(中央直接出现)
export function spawnCardUseEffect(cardId, x, y, isLocal = false, fromX = 0, fromY = 0, displayName = null) {
    const cfg = TACTICAL_CARD_CONFIG[cardId] || COLONEL_CARDS[cardId];
    cardUseEffects.push({
        cardId, icon: cfg ? cfg.icon : '🃏', name: displayName || (cfg ? cfg.name : cardId),
        x, y, fromX, fromY, isLocal,
        startTime: performance.now(),
        duration: 1600,
        phaseDuration: 600,
        pauseDuration: 500
    });
}

// ── 以下状态数组 + spawn 函数是共享数据源 ──
// 状态由 commander/fx/*.js 中对应的 update/draw 消费，
// spawn 函数被 gameLogic.js / main.js 调用。

// ===== 雷击（对策卡通用特效，不属特定将领） =====================
export const lightningBolts = [];

export function spawnLightningStrike(x, y) {
    const mainSegments = [];
    let sx = x + (Math.random() - 0.5) * 16;
    let sy = y - 300;
    const steps = 10;
    const stepY = 300 / steps;
    const branchPoints = [];
    for (let i = 0; i < steps; i++) {
        const prog = (i + 1) / steps;
        const driftToTarget = (x - sx) * 0.25;
        const jitter = (Math.random() - 0.5) * 22 * (1 - prog * 0.6);
        const ex = sx + driftToTarget + jitter;
        const ey = sy + stepY;
        mainSegments.push({ x1: sx, y1: sy, x2: ex, y2: ey });
        if (i >= 2 && i <= 7 && Math.random() < 0.35) {
            branchPoints.push({ bx: sx, by: sy, prog });
        }
        sx = ex; sy = ey;
    }
    mainSegments.push({ x1: sx, y1: sy, x2: x, y2: y });
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
        x, y, segments: mainSegments, branches,
        startTime: performance.now(), duration: 500, isStrike: true
    });
    const sparkCount = Math.round(24 * settings.particleDensity);
    for (let i = 0; i < sparkCount; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 80 + Math.random() * 220;
        particles.push(new VisualParticle(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed,
            Math.random() < 0.35 ? '#ffffff' : '#88ccff', 1.5 + Math.random() * 3.5, 0.2 + Math.random() * 0.45, 0));
    }
    for (let i = 0; i < 8; i++) {
        const angle = Math.random() * Math.PI * 2;
        particles.push(new VisualParticle(x, y, Math.cos(angle) * 30, Math.sin(angle) * 30,
            '#ffcc66', 2 + Math.random() * 2, 0.15 + Math.random() * 0.2, 0));
    }
}

export function updateLightningBolts(now) {
    for (let i = lightningBolts.length - 1; i >= 0; i--) {
        if (now - lightningBolts[i].startTime > lightningBolts[i].duration) lightningBolts.splice(i, 1);
    }
}

export function drawLightningBolts(ctx2d, now) {
    for (const b of lightningBolts) {
        const elapsed = now - b.startTime;
        const alpha = elapsed < 60 ? elapsed / 60 : Math.max(0, 1 - (elapsed - 60) / (b.duration - 60));
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.strokeStyle = '#ffffff'; ctx2d.lineWidth = 6;
        ctx2d.shadowColor = '#ffffff'; ctx2d.shadowBlur = 20;
        ctx2d.beginPath(); ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
        for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
        ctx2d.stroke();
        ctx2d.strokeStyle = '#a0d0ff'; ctx2d.lineWidth = 3;
        ctx2d.shadowColor = '#88bbff'; ctx2d.shadowBlur = 10;
        ctx2d.beginPath(); ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
        for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
        ctx2d.stroke();
        ctx2d.strokeStyle = '#ffffff'; ctx2d.lineWidth = 1.5; ctx2d.shadowBlur = 0;
        ctx2d.beginPath(); ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
        for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
        ctx2d.stroke();
        if (b.branches) {
            ctx2d.strokeStyle = '#a0d0ff'; ctx2d.lineWidth = 1.2;
            ctx2d.shadowColor = '#88bbff'; ctx2d.shadowBlur = 6;
            for (const br of b.branches) {
                ctx2d.beginPath(); ctx2d.moveTo(br[0].x1, br[0].y1);
                for (const seg of br) ctx2d.lineTo(seg.x2, seg.y2);
                ctx2d.stroke();
            }
        }
        ctx2d.restore();
    }
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

// ===== 谋士攻心：紫色波纹扩散 + 暗色粒子 =====================
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

// 百夫长涟漪复用 softFlashes
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

// ===== 尚书屯田 =====================
export const coinParticles = [];
const MAX_COIN_PARTICLES = 96;

export function spawnCoinRain(x, y, countMult = 1) {
    const n = Math.round(8 * settings.particleDensity * countMult);
    const available = Math.max(0, MAX_COIN_PARTICLES - coinParticles.length);
    for (let i = 0; i < Math.min(n, available); i++) {
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

// ===== 圣骑士至圣斩光束弹射 =====

export function updateCoinParticles(dt) {
    let writeIndex = 0;
    for (let i = 0; i < coinParticles.length; i++) {
        const c = coinParticles[i];
        c.life -= dt;
        if (c.life <= 0) continue;
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
        coinParticles[writeIndex++] = c;
    }
    coinParticles.length = writeIndex;
}

export function drawCoinParticles(ctx2d) {
    if (coinParticles.length === 0) return;
    ctx2d.save();
    ctx2d.fillStyle = '#ffd700';
    // 单次设置绘制状态；逐粒子 save/restore + shadowBlur 是收入爆发时的主要 Canvas 热点。
    ctx2d.shadowColor = '#b98500';
    ctx2d.shadowBlur = 1.5;
    for (const c of coinParticles) {
        const progress = 1 - c.life / c.maxLife;
        const alpha = Math.max(0, 1 - progress * 0.7);
        ctx2d.globalAlpha = alpha;
        ctx2d.beginPath();
        ctx2d.ellipse(c.x, c.y, c.size, c.size * 0.5, 0, 0, Math.PI * 2);
        ctx2d.fill();
    }
    ctx2d.restore();
}

export const paladinBeamProjectiles = [];

export function spawnPaladinBeamProjectiles(fromX, fromY, toX, toY, count) {
    for (let i = 0; i < count; i++) {
        const angleOff = (i - (count - 1) / 2) * 0.35;
        paladinBeamProjectiles.push({
            fromX, fromY, toX, toY, angleOff,
            startTime: performance.now(), duration: 280, impactSpawned: false
        });
    }
}

// ===== 天基打击轨道光束（天鹰阵营协同奖励卡特效） =====================
// 两段蓄力：光柱自天而降持续压制目标区域（期间结算三段小额伤害），
// 收尾时巨大光环沿光柱外圈坠落地面引发爆闪（结算主伤害）。
// 相位时刻需与 rules/cards.js 的 ORBITAL_STRIKE_TICK_DELAYS_MS 保持一致。
export const orbitalBeams = [];
const ORBITAL_BEAM_DURATION_MS = 1750;
const ORBITAL_BEAM_HALO_START_MS = 1250;
const ORBITAL_BEAM_HALO_LAND_MS = 1500;
const ORBITAL_BEAM_SKY_OFFSET = 1200;
// 冲击光波：与 rules/cards.js 的 ORBITAL_STRIKE_TICK_DELAYS_MS 四段结算一一对应。
// 前三段压制光波扩散到相邻格（解释周边扣血），末段主伤害光波明显增强。
const ORBITAL_BEAM_WAVES = [
    { at: 400, maxRadius: 1.85, width: 1.6, duration: 340, color: '#7fd0ff', glow: 8 },
    { at: 650, maxRadius: 1.85, width: 1.6, duration: 340, color: '#7fd0ff', glow: 8 },
    { at: 900, maxRadius: 1.85, width: 1.6, duration: 340, color: '#7fd0ff', glow: 8 },
    { at: 1500, maxRadius: 2.7, width: 4, duration: 460, color: '#eaf7ff', glow: 22 }
];

export function spawnOrbitalBeam(x, y) {
    orbitalBeams.push({ x, y, startTime: performance.now(), duration: ORBITAL_BEAM_DURATION_MS });
    // 落点离子火花：被光束电离的空气持续向上逸散
    const sparkCount = Math.round(16 * settings.particleDensity);
    for (let i = 0; i < sparkCount; i++) {
        particles.push(new VisualParticle(
            x + (Math.random() - 0.5) * 60, y - Math.random() * 40,
            (Math.random() - 0.5) * 80, -(180 + Math.random() * 240),
            Math.random() < 0.45 ? '#eaf7ff' : '#7fd0ff',
            1.2 + Math.random() * 2.4, 0.3 + Math.random() * 0.35, 0));
    }
}

export function updateOrbitalBeams(now) {
    for (let i = orbitalBeams.length - 1; i >= 0; i--) {
        if (now - orbitalBeams[i].startTime > orbitalBeams[i].duration) orbitalBeams.splice(i, 1);
    }
}

export function drawOrbitalBeams(ctx2d, now) {
    for (const b of orbitalBeams) {
        const elapsed = now - b.startTime;
        const skyY = b.y - ORBITAL_BEAM_SKY_OFFSET;
        const fadeIn = Math.min(1, elapsed / 150);
        const fadeOut = elapsed > ORBITAL_BEAM_HALO_LAND_MS
            ? Math.max(0, 1 - (elapsed - ORBITAL_BEAM_HALO_LAND_MS) / (ORBITAL_BEAM_DURATION_MS - ORBITAL_BEAM_HALO_LAND_MS))
            : 1;
        const alpha = fadeIn * fadeOut;
        if (alpha <= 0) continue;
        // 压制阶段的宽度脉动（模拟持续照射）
        const pulse = 1 + 0.12 * Math.sin(elapsed / 90);
        const coreWidth = (16 + 18 * fadeIn) * pulse;
        ctx2d.save();
        ctx2d.globalCompositeOperation = 'lighter';
        // 外层光晕柱
        const glow = ctx2d.createLinearGradient(b.x - coreWidth * 3, 0, b.x + coreWidth * 3, 0);
        glow.addColorStop(0, 'rgba(127, 208, 255, 0)');
        glow.addColorStop(0.5, `rgba(127, 208, 255, ${0.35 * alpha})`);
        glow.addColorStop(1, 'rgba(127, 208, 255, 0)');
        ctx2d.fillStyle = glow;
        ctx2d.fillRect(b.x - coreWidth * 3, skyY, coreWidth * 6, ORBITAL_BEAM_SKY_OFFSET);
        // 内层白芯
        ctx2d.globalAlpha = alpha * 0.95;
        ctx2d.fillStyle = '#eaf7ff';
        ctx2d.shadowColor = '#7fd0ff';
        ctx2d.shadowBlur = 28;
        ctx2d.fillRect(b.x - coreWidth / 2, skyY, coreWidth, ORBITAL_BEAM_SKY_OFFSET);
        // 落点压制光环（持续呼吸）
        ctx2d.globalAlpha = alpha * (0.4 + 0.15 * Math.sin(elapsed / 120));
        ctx2d.strokeStyle = '#9fe0ff';
        ctx2d.lineWidth = 3;
        ctx2d.beginPath();
        ctx2d.arc(b.x, b.y, 38 + 6 * Math.sin(elapsed / 120), 0, Math.PI * 2);
        ctx2d.stroke();
        // 冲击光波：随四段结算节拍从光束底端向外扩散
        for (const wave of ORBITAL_BEAM_WAVES) {
            const waveElapsed = elapsed - wave.at;
            if (waveElapsed <= 0 || waveElapsed >= wave.duration) continue;
            const waveProgress = waveElapsed / wave.duration;
            const eased = 1 - Math.pow(1 - waveProgress, 2.4);
            const radius = Math.max(2, eased * wave.maxRadius * HEX_SIZE);
            ctx2d.globalAlpha = (1 - waveProgress) * 0.85;
            ctx2d.strokeStyle = wave.color;
            ctx2d.lineWidth = wave.width * (1 - waveProgress * 0.4);
            ctx2d.shadowColor = wave.color;
            ctx2d.shadowBlur = wave.glow;
            ctx2d.beginPath();
            ctx2d.arc(b.x, b.y, radius, 0, Math.PI * 2);
            ctx2d.stroke();
        }
        // 收尾：巨大光环沿光柱外圈加速坠落（从目标上方 250px 开始，不从天幕顶端走）
        if (elapsed >= ORBITAL_BEAM_HALO_START_MS && elapsed < ORBITAL_BEAM_HALO_LAND_MS) {
            const haloProgress = (elapsed - ORBITAL_BEAM_HALO_START_MS) / (ORBITAL_BEAM_HALO_LAND_MS - ORBITAL_BEAM_HALO_START_MS);
            const eased = haloProgress * haloProgress;
            const haloY = b.y - 250 * (1 - eased);
            const haloRadius = 56 - eased * 12;
            ctx2d.globalAlpha = Math.min(1, haloProgress * 2.5);
            ctx2d.strokeStyle = '#eaf7ff';
            ctx2d.lineWidth = 5;
            ctx2d.shadowColor = '#7fd0ff';
            ctx2d.shadowBlur = 22;
            ctx2d.beginPath();
            ctx2d.ellipse(b.x, haloY, haloRadius, haloRadius * 0.32, 0, 0, Math.PI * 2);
            ctx2d.stroke();
        }
        // 落地爆闪 + 地面冲击波
        if (elapsed >= ORBITAL_BEAM_HALO_LAND_MS) {
            const flashProgress = Math.min(1, (elapsed - ORBITAL_BEAM_HALO_LAND_MS) / 220);
            const flashAlpha = 1 - flashProgress;
            // 强光爆闪（外层大范围）
            const flash = ctx2d.createRadialGradient(b.x, b.y, 0, b.x, b.y, 130);
            flash.addColorStop(0, '#ffffff');
            flash.addColorStop(0.25, 'rgba(255, 255, 255, 0.95)');
            flash.addColorStop(0.5, 'rgba(191, 234, 255, 0.7)');
            flash.addColorStop(1, 'rgba(127, 208, 255, 0)');
            ctx2d.globalAlpha = flashAlpha * 0.95;
            ctx2d.fillStyle = flash;
            ctx2d.fillRect(b.x - 130, b.y - 130, 260, 260);
            // 内层高亮核心
            if (flashProgress < 0.6) {
                ctx2d.globalAlpha = (1 - flashProgress / 0.6) * 0.8;
                ctx2d.fillStyle = '#ffffff';
                ctx2d.shadowColor = '#ffffff';
                ctx2d.shadowBlur = 30;
                ctx2d.beginPath();
                ctx2d.arc(b.x, b.y, 30 * (1 - flashProgress / 0.6), 0, Math.PI * 2);
                ctx2d.fill();
            }
            // 主冲击波
            ctx2d.shadowBlur = 14;
            ctx2d.globalAlpha = flashAlpha * 0.8;
            ctx2d.strokeStyle = '#9fe0ff';
            ctx2d.lineWidth = 4;
            ctx2d.shadowColor = '#7fd0ff';
            ctx2d.beginPath();
            ctx2d.arc(b.x, b.y, 40 + flashProgress * 140, 0, Math.PI * 2);
            ctx2d.stroke();
            // 外层冲击波余韵
            if (flashProgress > 0.15) {
                const outerAlpha = flashAlpha * 0.35 * Math.min(1, (flashProgress - 0.15) / 0.2);
                ctx2d.globalAlpha = outerAlpha;
                ctx2d.strokeStyle = '#7fd0ff';
                ctx2d.lineWidth = 2;
                ctx2d.shadowBlur = 8;
                ctx2d.beginPath();
                ctx2d.arc(b.x, b.y, 60 + flashProgress * 180, 0, Math.PI * 2);
                ctx2d.stroke();
            }
            ctx2d.shadowBlur = 0;
        }
        ctx2d.restore();
    }
}

// ===== 血月环形斩击特效（月蚀放血时绕目标一圈） =====
export const bloodMoonSlashes = [];

export function spawnBloodMoonSlash(x, y, killed = false) {
    bloodMoonSlashes.push({
        x, y, startTime: performance.now(),
        duration: killed ? 650 : 450,
        killed,
        sweepDir: Math.random() < 0.5 ? 1 : -1  // 随机顺时针/逆时针
    });
}

export function updateBloodMoonSlashes(now) {
    for (let i = bloodMoonSlashes.length - 1; i >= 0; i--) {
        if (now - bloodMoonSlashes[i].startTime > bloodMoonSlashes[i].duration) bloodMoonSlashes.splice(i, 1);
    }
}

export function drawBloodMoonSlashes(ctx2d, now) {
    for (const s of bloodMoonSlashes) {
        const elapsed = now - s.startTime;
        const progress = Math.min(1, elapsed / s.duration);
        const fadeOut = 1 - Math.pow(progress, 2);
        if (fadeOut <= 0) continue;

        ctx2d.save();
        ctx2d.globalCompositeOperation = 'lighter';

        // 刀锋斩击：一道弧光从目标外围绕过，如同刀锋切过
        const radius = 28 + progress * 8;
        const sweep = Math.min(1, progress * 1.8);  // 前半段快速扫过
        const sweepAngle = sweep * Math.PI * 1.6;    // 扫约 288°
        const baseAngle = s.sweepDir * (elapsed / 500) - 0.8;
        const startAngle = baseAngle;
        const endAngle = baseAngle + sweepAngle;

        // 刀锋轨迹由外圈到内圈共 3 条同心弧，间距随进度收缩（模拟刀锋切入感）
        const bladeCount = 3;
        for (let b = 0; b < bladeCount; b++) {
            const bladeT = b / bladeCount;
            const bladeRadius = radius + (1 - progress * 0.5) * (8 - bladeT * 4);
            const bladeAlpha = (1 - sweep * 0.3) * 0.7 * (1 - bladeT * 0.35);
            const bladeWidth = (5 + (1 - sweep) * 4) * (1 - bladeT * 0.3);

            ctx2d.globalAlpha = bladeAlpha * fadeOut;
            ctx2d.strokeStyle = b === 0 ? '#ff2244' : '#cc1133';
            ctx2d.shadowColor = '#ff4466';
            ctx2d.shadowBlur = 16 + (1 - sweep) * 10;
            ctx2d.lineWidth = bladeWidth;
            ctx2d.beginPath();
            ctx2d.arc(s.x, s.y, bladeRadius, startAngle, endAngle);
            ctx2d.stroke();
        }

        // 刀锋末尾的拖尾粒子（被斩击溅出的血珠）
        if (progress < 0.85) {
            const tailCount = Math.round(4 * (1 - progress));
            ctx2d.globalAlpha = (1 - progress) * 0.6 * fadeOut;
            ctx2d.fillStyle = '#ff4466';
            ctx2d.shadowBlur = 6;
            for (let i = 0; i < tailCount; i++) {
                const a = endAngle + (Math.random() - 0.5) * 0.3;
                const d = radius + (Math.random() - 0.5) * 6;
                ctx2d.beginPath();
                ctx2d.arc(s.x + Math.cos(a) * d, s.y + Math.sin(a) * d, 1.5 + Math.random() * 2, 0, Math.PI * 2);
                ctx2d.fill();
            }
        }

        // 斩杀额外：刀刃碰撞瞬间的血爆
        if (s.killed && progress < 0.3) {
            const burstAlpha = (1 - progress / 0.3) * 0.6;
            ctx2d.globalAlpha = burstAlpha * fadeOut;
            ctx2d.fillStyle = '#ff3355';
            ctx2d.shadowBlur = 12;
            for (let i = 0; i < 10; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = 15 + Math.random() * 45;
                ctx2d.beginPath();
                ctx2d.arc(s.x + Math.cos(angle) * dist, s.y + Math.sin(angle) * dist, 2 + Math.random() * 4, 0, Math.PI * 2);
                ctx2d.fill();
            }
        }

        ctx2d.restore();
    }
}

// ===== 圣骑士誓言金色光束 =====
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
        x, y, segments,
        startTime: performance.now(),
        duration: 700
    });
}

// ===== 圣骑士誓言剑环绕 =====
export const paladinOrbitBeams = [];

export function spawnPaladinOrbitBeams(unitId, x, y, count) {
    for (let i = paladinOrbitBeams.length - 1; i >= 0; i--) {
        if (paladinOrbitBeams[i].unitId === unitId) paladinOrbitBeams.splice(i, 1);
    }
    for (let i = 0; i < count; i++) {
        paladinOrbitBeams.push({
            unitId, x, y,
            angle: (i / count) * Math.PI * 2,
            orbitRadius: HEX_SIZE * 0.88,
            orbitSpeed: 1.8,
            size: 32,
            startTime: performance.now()
        });
    }
}

export function clearPaladinOrbitBeams(unitId) {
    for (let i = paladinOrbitBeams.length - 1; i >= 0; i--) {
        if (paladinOrbitBeams[i].unitId === unitId) paladinOrbitBeams.splice(i, 1);
    }
}

// ===== 牧师圣链治疗特效 =====
export const healingChains = [];

export function spawnHealingChain(fromX, fromY, toX, toY) {
    healingChains.push({
        fromX, fromY, toX, toY,
        startTime: performance.now(), duration: 600
    });
}

// ===== 亡灵法师——魂卒召回黑烟特效 =====
export const soulRecallEffects = [];

export function spawnSoulRecallEffect(fromX, fromY, toX, toY) {
    const startTime = performance.now();
    const dur = 900;
    soulRecallEffects.push({ fromX, fromY, toX, toY, startTime, duration: dur, landFrac: 0.92 });
    return startTime + dur * 0.92;
}

// ===== 空袭特效 =====
export const airstrikeEffects = [];

export function spawnAirstrikeEffect(cx, cy, results, type = 'airstrike', q = null, r = null, fromX = null, fromY = null, camp = null, startTime = performance.now(), options = null) {
    const explicitAntiAir = options?.antiAir != null && Number.isFinite(Number(options.antiAir))
        ? Number(options.antiAir)
        : null;
    const explicitAaSources = Array.isArray(options?.aaSources)
        ? options.aaSources.filter(s => Number.isFinite(s?.q) && Number.isFinite(s?.r)).map(s => ({ q: s.q, r: s.r }))
        : null;
    airstrikeEffects.push({
        x: cx, y: cy, fromX, fromY, q, r, results, type,
        startTime,
        duration: type === 'diveStrafe' ? 1500 : type === 'stukaStrafe' ? 1650 : AIRSTRIKE_FLIGHT.durationMs,
        camp,
        antiAir: explicitAntiAir,
        aaSources: explicitAaSources
    });
}

export function playStukaStrafe(tile, results, camp, options = null) {
    spawnAirstrikeEffect(tile.x, tile.y, results, 'stukaStrafe', tile.q, tile.r, null, null, camp, performance.now(), options);
    setTimeout(() => {
        playSound('machinegun');
        for (let index = 0; index < 20; index++) {
            const delay = index * 17;
            setTimeout(() => {
                const muzzle = getStukaFlightPosition(tile.x, tile.y, LOGICAL_W, (660 + delay) / 1650);
                spawnStrafeTracer(muzzle.x, muzzle.y, tile.x, tile.y);
            }, delay);
        }
    }, 660);
}

export function playAirCommandImpact(kind, results, tileMap, delayMs, { showDodges = false, detonatedMines = [] } = {}) {
    const strikes = results.map(hit => ({ ...hit, tile: tileMap.get(`${hit.q},${hit.r}`) })).filter(hit => hit.tile);
    const mines = (detonatedMines || []).map(mine => ({ ...mine, tile: tileMap.get(`${mine.q},${mine.r}`) })).filter(mine => mine.tile);
    const isStrafe = kind === 'strafe' || kind === 'stukaDiveBomb';
    setTimeout(() => {
        let impact = false;
        let mineDetonated = false;
        for (const { tile, dodged } of strikes) {
            if (dodged) {
                if (showDodges) spawnDodgeShimmer(tile.x, tile.y);
                continue;
            }
            impact = true;
            spawnExplosionParticles(tile.x, tile.y, '#ff8800', kind === 'stukaDiveBomb' ? 8 : isStrafe ? 15 : 10);
        }
        for (const mine of mines) {
            impact = true;
            mineDetonated = true;
            const { x, y } = mine.tile;
            const isWater = mine.mineType === 'water';
            spawnDirectionalParticles(x, y + 10, x, y - 50, '#ff4400', 20);
            spawnDirectionalParticles(x, y + 10, x, y - 50, '#ffaa00', 12);
            spawnExplosionParticles(x, y, isWater ? '#44aaff' : '#664400', 10);
            spawnCommanderSkillEffect(x, y, isWater ? '⚓' : '💣', isWater ? '引爆水雷' : '引爆地雷', true, '#ff6622');
        }
        if (!impact) return;
        if (!isStrafe || mineDetonated) playSound('explosion');
        triggerScreenShake(mineDetonated ? 7 : kind === 'stukaDiveBomb' ? 5 : isStrafe ? 6 : 8, (isStrafe && !mineDetonated) ? 300 : 400);
    }, delayMs);
}

// ===== 塞莱斯廷圣国【神谕】指引光束（神像→目标，绘制于战争迷雾之上） =====
export const celestineOracleBeams = [];

/**
 * 两段式：蓄力(chargeMs) → 光束飞行(travelMs) → 弹着爆发+余辉(lingerMs)。
 * kind: 'smite'（神罚，金焰）| 'shield'（赐福，圣辉）。
 * delayMs 用于赐福光束在神罚之后错峰升空。
 */
export function spawnCelestineOracleBeam(fromX, fromY, toX, toY, kind = 'smite', delayMs = 0, timing = {}) {
    celestineOracleBeams.push({
        fromX, fromY, toX, toY, kind,
        startTime: performance.now() + Math.max(0, delayMs),
        chargeMs: timing.chargeMs ?? 350,
        travelMs: timing.travelMs ?? 550,
        lingerMs: timing.lingerMs ?? 700
    });
}

// ===== E4 空运特效 =====
export const airliftEffects = [];
export const AIRLIFT_MS = 1500;
export const AIRLIFT_LAND_FRAC = 0.82;

export function spawnAirliftEffect(fromX, fromY, toX, toY, opts = {}) {
    const startTime = performance.now();
    airliftEffects.push({
        fromX, fromY, toX, toY,
        q: opts.q, r: opts.r,
        color: opts.color || '#8ab4ff',
        startTime, duration: AIRLIFT_MS, landFrac: AIRLIFT_LAND_FRAC
    });
    return startTime + AIRLIFT_MS * AIRLIFT_LAND_FRAC;
}

// ===== 国家文化与特色兵种特效（法式重炮 / 喀秋莎齐射 / 万岁冲锋 / 闪避 / 自由抵抗） =====
const HEAVY_CANNON_CHARGE_MS = 800;
export const HEAVY_CANNON_IMPACT_MS = HEAVY_CANNON_CHARGE_MS + 155;
export const KATYUSHA_IMPACT_TIMES = Object.freeze([235, 475, 715]);
export const KATYUSHA_IMPACT_MS = KATYUSHA_IMPACT_TIMES.at(-1);

export function getKatyushaDamageShares(damage) {
    const total = Math.max(0, Math.round(damage));
    const count = KATYUSHA_IMPACT_TIMES.length;
    return KATYUSHA_IMPACT_TIMES.map((_, i) => Math.round(total * (i + 1) / count) - Math.round(total * i / count));
}

export function stageKatyushaHealth(unit, before, after, startedAt, shares) {
    if (before <= after) return;
    const delta = before - after;
    const damage = shares?.reduce((total, share) => total + share, 0) === delta ? shares : getKatyushaDamageShares(delta);
    unit._katyushaHealth = { startedAt, before, shares: damage };
}

export function getKatyushaPresentedHealth(target, now) {
    const barrage = target._katyushaHealth;
    if (!barrage) return null;
    const elapsed = now - barrage.startedAt;
    if (elapsed >= KATYUSHA_IMPACT_MS) {
        target._katyushaHealth = null;
        return null;
    }
    return KATYUSHA_IMPACT_TIMES.reduce((hp, time, i) =>
        elapsed >= time ? hp - barrage.shares[i] : hp, barrage.before);
}
export const heavyCannonShells = [];
export const katyushaRockets = [];
export const banzaiDashes = [];
export const ringWaves = [];

/** 扩散圆环波纹（闪避水波 / 自由抵抗鼓舞 / 重炮冲击波共用）。 */
export function spawnRingWave(x, y, { color = '#ffd166', maxRadius = 56, duration = 560, lineWidth = 3, count = 1, glow = null } = {}) {
    const now = performance.now();
    for (let i = 0; i < count; i++) {
        ringWaves.push({
            x, y, color, maxRadius, duration, lineWidth,
            glow: glow || color,
            startTime: now + i * 95
        });
    }
}

export function spawnFreeResistanceWave(x, y) {
    spawnRingWave(x, y, { color: '#4598ff', maxRadius: 78, duration: 780, lineWidth: 5, glow: '#8bc5ff' });
    spawnRingWave(x, y, { color: '#f5f8ff', maxRadius: 64, duration: 700, lineWidth: 4, glow: '#cbdfff' });
    spawnRingWave(x, y, { color: '#ff5068', maxRadius: 50, duration: 620, lineWidth: 3.5, glow: '#ff8293' });
}

export function spawnDodgeShimmer(x, y) {
    spawnRingWave(x, y, { color: '#7dd3fc', maxRadius: 48, duration: 480, lineWidth: 2.8, count: 2, glow: '#e0f2fe' });
}

export function updateRingWaves(now) {
    for (let i = ringWaves.length - 1; i >= 0; i--) {
        if (now - ringWaves[i].startTime >= ringWaves[i].duration) {
            ringWaves.splice(i, 1);
        }
    }
}

export function drawRingWaves(ctx2d, now) {
    for (const w of ringWaves) {
        const elapsed = now - w.startTime;
        if (elapsed < 0) continue;
        const t = Math.min(1, elapsed / w.duration);
        const radius = 10 + (w.maxRadius - 10) * (1 - Math.pow(1 - t, 2));
        const alpha = (1 - t) * 0.85;
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.strokeStyle = w.color;
        ctx2d.shadowColor = w.glow;
        ctx2d.shadowBlur = 10;
        ctx2d.lineWidth = Math.max(1, w.lineWidth * (1 - t * 0.55));
        ctx2d.beginPath();
        ctx2d.arc(w.x, w.y, radius, 0, Math.PI * 2);
        ctx2d.stroke();
        ctx2d.restore();
    }
}

export function spawnHeavyCannonShell(fromX, fromY, toX, toY, isCrit = false, onImpact = null, opts = {}) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.hypot(dx, dy);
    const startTime = Number.isFinite(opts.startedAt) ? opts.startedAt : performance.now();
    const muzzleOffset = Math.min(22, dist * 0.42);
    heavyCannonShells.push({
        fromX, fromY, toX, toY,
        muzzleX: fromX + dx / (dist || 1) * muzzleOffset,
        muzzleY: fromY + dy / (dist || 1) * muzzleOffset,
        startTime, isCrit,
        dodged: opts.dodged === true,
        areaImpact: opts.areaImpact !== false,
        splash: opts.splash || [],
        fired: false,
        onImpact: onImpact || null
    });
}

function spawnHeavyCannonMuzzleBlast(s, angle) {
    const bx = s.muzzleX - Math.cos(angle) * 9;
    const by = s.muzzleY - Math.sin(angle) * 9;
    spawnMuzzleFlash(bx, by, s.toX, s.toY, true);
    triggerRecoil(s.fromX, s.fromY, s.toX, s.toY);
    triggerScreenShake(s.isCrit ? 4.5 : 3, 95);
    if (settings.reducedMotion) return;
    // 炮口冲击波碎片与炽热炮尾烟气，强化重炮开火瞬间的后坐力与推进感
    const blastCount = particleCount(14);
    for (let j = 0; j < blastCount; j++) {
        const isSmoke = j % 3 === 0;
        const spread = (Math.random() - 0.5) * (isSmoke ? 1.45 : 0.52);
        const fireAngle = angle + spread;
        const speed = isSmoke ? (55 + Math.random() * 85) : (230 + Math.random() * 210);
        particles.push(new VisualParticle(
            bx, by,
            Math.cos(fireAngle) * speed,
            Math.sin(fireAngle) * speed,
            isSmoke ? '#948678' : (j % 2 === 0 ? '#fff3c4' : '#ff9838'),
            isSmoke ? (5 + Math.random() * 5) : (2.4 + Math.random() * 2.5),
            isSmoke ? (0.34 + Math.random() * 0.25) : (0.14 + Math.random() * 0.14),
            isSmoke ? -18 : 30
        ));
    }
}

function spawnHeavyCannonImpactDebris(s) {
    spawnCannonImpact(s.toX, s.toY, true);
    spawnCannonImpact(s.toX, s.toY, s.isCrit);
    triggerAttackFlash(s.toX, s.toY, true);
    spawnRingWave(s.toX, s.toY, {
        color: '#ff9d3b',
        maxRadius: HEX_SIZE * (s.areaImpact ? 2.45 : 1.2),
        duration: 540,
        lineWidth: 5,
        count: s.areaImpact ? 2 : 1,
        glow: '#fff4c2'
    });
    triggerScreenShake(s.isCrit ? 11 : 8, s.isCrit ? 280 : 220);
    if (!settings.reducedMotion) {
        const radialCount = particleCount(s.areaImpact ? 24 : 12);
        for (let j = 0; j < radialCount; j++) {
            const angle = (j / radialCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
            const speed = (s.areaImpact ? 225 : 145) + Math.random() * 125;
            particles.push(new VisualParticle(
                s.toX, s.toY,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                j % 3 === 0 ? '#fff5c8' : (j % 2 === 0 ? '#ff9f43' : '#ff5e1a'),
                2.5 + Math.random() * 2.8,
                0.26 + Math.random() * 0.22,
                35
            ));
        }
        // 高温破甲碎屑高抛轨迹
        const ejectaCount = particleCount(s.isCrit ? 12 : 8);
        for (let j = 0; j < ejectaCount; j++) {
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
            const speed = 130 + Math.random() * 180;
            particles.push(new VisualParticle(
                s.toX + (Math.random() - 0.5) * 12,
                s.toY + (Math.random() - 0.5) * 6,
                Math.cos(angle) * speed,
                Math.sin(angle) * speed,
                j % 2 === 0 ? '#5b5046' : '#ffb84d',
                3 + Math.random() * 3.5,
                0.45 + Math.random() * 0.3,
                320
            ));
        }
    }
    for (const hit of s.splash) {
        spawnDirectionalParticles(s.toX, s.toY, hit.x, hit.y, '#ffd07a', 13);
        spawnExplosionParticles(hit.x, hit.y, '#ff8a3d', 11);
    }
}

export function updateHeavyCannonShells(now) {
    let fireSound = false;
    let impactSound = false;
    for (let i = heavyCannonShells.length - 1; i >= 0; i--) {
        const s = heavyCannonShells[i];
        const elapsed = now - s.startTime;
        if (!s.fired && elapsed >= HEAVY_CANNON_CHARGE_MS) {
            s.fired = true;
            fireSound = true;
            const angle = Math.atan2(s.toY - s.fromY, s.toX - s.fromX);
            spawnHeavyCannonMuzzleBlast(s, angle);
        }
        if (elapsed >= HEAVY_CANNON_IMPACT_MS) {
            heavyCannonShells.splice(i, 1);
            if (!s.dodged) {
                impactSound = true;
                spawnHeavyCannonImpactDebris(s);
            }
            if (s.onImpact) s.onImpact();
        }
    }
    if (fireSound) playSound('cannon');
    if (impactSound) playSound('explosion');
}

function drawHeavyCannonCharge(ctx, s, t) {
    const strength = t ** 1.65;
    const angle = Math.atan2(s.toY - s.fromY, s.toX - s.fromX);
    // 收敛脉动：蓄能末端微幅高频聚缩，增强“即将击发”的张力
    const snapPulse = t > 0.78 ? 1 + Math.sin((t - 0.78) * Math.PI * 14) * 0.1 : 1;
    const radius = (7 + strength * 24) * snapPulse;
    const glow = ctx.createRadialGradient(s.muzzleX, s.muzzleY, 0, s.muzzleX, s.muzzleY, radius);
    glow.addColorStop(0, `rgba(255,252,226,${0.2 + strength * 0.8})`);
    glow.addColorStop(0.28, `rgba(255,190,74,${0.18 + strength * 0.7})`);
    glow.addColorStop(0.65, `rgba(255,108,24,${0.08 + strength * 0.35})`);
    glow.addColorStop(1, 'rgba(255,80,10,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(s.muzzleX - radius, s.muzzleY - radius, radius * 2, radius * 2);

    // 外圈向内收缩的蓄能环，配合 0.8s 节奏压缩到炮口核心
    const ringRadius = Math.max(4.5, 29 * (1 - t ** 1.25) + 4.5);
    ctx.save();
    ctx.strokeStyle = `rgba(255,222,138,${0.18 + strength * 0.72})`;
    ctx.lineWidth = 1.2 + strength * 1.8;
    ctx.beginPath();
    ctx.arc(s.muzzleX, s.muzzleY, ringRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 沿射界前指的短暂炮线微光，突出即将倾泻的重火力方向
    const aimLen = 10 + strength * 26;
    ctx.strokeStyle = `rgba(255,214,132,${0.12 + strength * 0.55})`;
    ctx.lineWidth = 1.4 + strength * 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.muzzleX, s.muzzleY);
    ctx.lineTo(s.muzzleX + Math.cos(angle) * aimLen, s.muzzleY + Math.sin(angle) * aimLen);
    ctx.stroke();
    ctx.restore();

    const count = settings.reducedMotion ? 0 : particleCount(18);
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
        const delay = (i % 5) * 0.08;
        const progress = Math.max(0, (t - delay) / (1 - delay));
        const streakAngle = i * 2.39996 + progress * 0.85;
        const distance = 3.5 + (28 + (i % 5) * 4.5) * (1 - progress ** 1.45);
        const x = Math.cos(streakAngle), y = Math.sin(streakAngle);
        ctx.moveTo(s.muzzleX + x * distance, s.muzzleY + y * distance);
        ctx.lineTo(s.muzzleX + x * (distance + 2.5 + progress * 5.5), s.muzzleY + y * (distance + 2.5 + progress * 5.5));
    }
    ctx.lineWidth = 1.4 + strength * 0.9;
    ctx.strokeStyle = `rgba(255,222,140,${0.25 + strength * 0.72})`;
    ctx.stroke();

    if (t > 0.5) {
        const coreR = 1.8 + ((t - 0.5) / 0.5) ** 1.6 * (s.isCrit ? 5.6 : 4.4);
        ctx.fillStyle = `rgba(255,253,240,${0.4 + strength * 0.6})`;
        ctx.beginPath();
        ctx.arc(s.muzzleX, s.muzzleY, coreR, 0, Math.PI * 2);
        ctx.fill();
    }
}

export function drawHeavyCannonShells(ctx2d, now) {
    for (const s of heavyCannonShells) {
        const elapsed = now - s.startTime;
        if (elapsed < 0 || elapsed >= HEAVY_CANNON_IMPACT_MS) continue;
        if (elapsed < HEAVY_CANNON_CHARGE_MS) {
            ctx2d.save();
            drawHeavyCannonCharge(ctx2d, s, elapsed / HEAVY_CANNON_CHARGE_MS);
            ctx2d.restore();
            continue;
        }
        const t = (elapsed - HEAVY_CANNON_CHARGE_MS) / (HEAVY_CANNON_IMPACT_MS - HEAVY_CANNON_CHARGE_MS);
        const dx = s.toX - s.muzzleX;
        const dy = s.toY - s.muzzleY;
        const dist = Math.hypot(dx, dy) || 1;
        const hx = s.muzzleX + dx * t;
        const hy = s.muzzleY + dy * t;
        const tailT = Math.max(0, t - Math.min(0.65, 68 / dist));
        const tx = s.muzzleX + dx * tailT;
        const ty = s.muzzleY + dy * tailT;
        const angle = Math.atan2(dy, dx);

        ctx2d.save();
        ctx2d.lineCap = 'round';
        ctx2d.strokeStyle = s.isCrit ? '#e11d48' : '#ea580c';
        ctx2d.shadowColor = s.isCrit ? '#fb7185' : '#f59e0b';
        ctx2d.shadowBlur = 16;
        ctx2d.lineWidth = s.isCrit ? 11 : 9;
        ctx2d.beginPath();
        ctx2d.moveTo(tx, ty);
        ctx2d.lineTo(hx, hy);
        ctx2d.stroke();

        ctx2d.strokeStyle = '#ffaa47';
        ctx2d.lineWidth = s.isCrit ? 5.6 : 4.5;
        ctx2d.stroke();

        ctx2d.shadowBlur = 0;
        ctx2d.strokeStyle = '#fff5cc';
        ctx2d.lineWidth = 2.8;
        ctx2d.stroke();

        // 弹头音障激波锥 + 高亮核心
        const coneSpan = s.isCrit ? 10 : 8.5;
        ctx2d.strokeStyle = 'rgba(255, 240, 190, 0.82)';
        ctx2d.lineWidth = 1.6;
        ctx2d.beginPath();
        ctx2d.moveTo(hx - Math.cos(angle - 0.55) * coneSpan, hy - Math.sin(angle - 0.55) * coneSpan);
        ctx2d.lineTo(hx + Math.cos(angle) * 3, hy + Math.sin(angle) * 3);
        ctx2d.lineTo(hx - Math.cos(angle + 0.55) * coneSpan, hy - Math.sin(angle + 0.55) * coneSpan);
        ctx2d.stroke();

        ctx2d.fillStyle = '#fffef4';
        ctx2d.beginPath();
        ctx2d.arc(hx, hy, s.isCrit ? 5.6 : 4.6, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.restore();
    }
}

export function spawnKatyushaBarrage(fromX, fromY, toX, toY, isCrit = false, onImpact = null, opts = {}) {
    const baseTime = opts.startedAt ?? performance.now();
    const impacts = opts.splash || [];
    const count = Math.max(3, 2 + impacts.length);
    for (const impactAt of KATYUSHA_IMPACT_TIMES) {
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
            const spread = 12 * (0.4 + Math.random() * 0.6);
            const splash = i >= 2 && impacts.length ? impacts[(i - 2) % impacts.length] : null;
            const rx = (splash?.x ?? toX) + Math.cos(angle) * spread;
            const ry = (splash?.y ?? toY) + Math.sin(angle) * spread;
            const dx = rx - fromX;
            const dy = ry - fromY;
            const dist = Math.hypot(dx, dy);
            katyushaRockets.push({
                fromX: fromX + (Math.random() - 0.5) * 10,
                fromY: fromY + (Math.random() - 0.5) * 10,
                toX: rx, toY: ry, dist,
                arcScale: 0.10 + (i % 3) * 0.03,
                startTime: baseTime + impactAt - KATYUSHA_IMPACT_TIMES[0] + Math.min(i, 3) * 11,
                duration: KATYUSHA_IMPACT_TIMES[0] - Math.min(i, 3) * 11,
                isCrit,
                dodged: opts.dodged === true,
                muzzle: i === 0 ? { fromX, fromY, toX, toY } : null,
                onImpact: i === 0 && impactAt === KATYUSHA_IMPACT_MS ? onImpact : null
            });
        }
    }
}

export function updateKatyushaRockets(now) {
    for (let i = katyushaRockets.length - 1; i >= 0; i--) {
        const r = katyushaRockets[i];
        const elapsed = now - r.startTime;
        if (elapsed < 0) continue;
        if (r.muzzle) {
            const { fromX, fromY, toX, toY } = r.muzzle;
            spawnMuzzleFlash(fromX, fromY, toX, toY, r.isCrit);
            playSound('cannon');
            triggerRecoil(fromX, fromY, toX, toY);
            r.muzzle = null;
        }
        if (elapsed >= r.duration) {
            if (!r.dodged) spawnExplosionParticles(r.toX, r.toY, '#ff7b29', r.isCrit ? 12 : 8);
            if (r.onImpact) r.onImpact();
            katyushaRockets.splice(i, 1);
        }
    }
}

export function drawKatyushaRockets(ctx2d, now) {
    for (const r of katyushaRockets) {
        const elapsed = now - r.startTime;
        if (elapsed < 0) continue;
        const t = Math.min(1, elapsed / r.duration);
        if (t >= 1) continue;
        const arc = -Math.sin(t * Math.PI) * Math.max(26, r.dist * r.arcScale);
        const hx = r.fromX + (r.toX - r.fromX) * t;
        const hy = r.fromY + (r.toY - r.fromY) * t + arc;
        const tailT = Math.max(0, t - 0.34);
        const tArc = -Math.sin(tailT * Math.PI) * Math.max(26, r.dist * r.arcScale);
        const tx = r.fromX + (r.toX - r.fromX) * tailT;
        const ty = r.fromY + (r.toY - r.fromY) * tailT + tArc;

        ctx2d.save();
        ctx2d.lineCap = 'round';
        ctx2d.strokeStyle = 'rgba(203, 213, 225, 0.55)';
        ctx2d.lineWidth = 4;
        ctx2d.beginPath();
        ctx2d.moveTo(tx, ty);
        ctx2d.lineTo(hx, hy);
        ctx2d.stroke();

        ctx2d.strokeStyle = '#ff5722';
        ctx2d.shadowColor = '#ff8a00';
        ctx2d.shadowBlur = 9;
        ctx2d.lineWidth = 2.6;
        ctx2d.beginPath();
        ctx2d.moveTo((tx + hx) * 0.5, (ty + hy) * 0.5);
        ctx2d.lineTo(hx, hy);
        ctx2d.stroke();
        ctx2d.restore();
    }
}

export function spawnBanzaiDash(fromX, fromY, toX, toY, { killed = false, healAmt = 0, followup = false, destX = toX, destY = toY, dodged = false, showDodge = false, delayMs = 0 } = {}) {
    const travelMs = Math.max(180, delayMs || 270);
    banzaiDashes.push({
        fromX, fromY, toX, toY, destX, destY,
        startTime: performance.now(),
        duration: travelMs + 340,
        travelMs
    });
    // 起跳瞬间地面起跃波纹
    spawnRingWave(fromX, fromY, { color: '#fca5a5', maxRadius: 26, duration: 210, lineWidth: 2, glow: '#ef4444' });
    setTimeout(() => {
        if (dodged) {
            if (showDodge) spawnDodgeShimmer(toX, toY);
            return;
        }
        spawnMeleeSlash(toX, toY, fromX, fromY, true);
        spawnSlashMarks(toX, toY, fromX, fromY, true);
        spawnDirectionalParticles(fromX, fromY, toX, toY, '#ef4444', 18);
        // 落地冲击波纹
        spawnRingWave(destX, destY, { color: '#f87171', maxRadius: 46, duration: 360, lineWidth: 3.2, glow: '#dc2626' });
        triggerAttackFlash(toX, toY, killed);
        playSound(killed ? 'crit' : 'attack');
        triggerScreenShake(killed ? 8 : 5, 260);
        if (killed && healAmt > 0) {
            spawnHealParticles(destX, destY);
            spawnRingWave(destX, destY, { color: '#fca5a5', maxRadius: 56, duration: 540, lineWidth: 3, count: 2, glow: '#ef4444' });
        }
        if (followup) {
            spawnCommanderSkillEffect(destX, destY, '⚔️', '再次行动');
            spawnRingWave(destX, destY, { color: '#ffd799', maxRadius: 40, duration: 480, lineWidth: 2, glow: '#f06456' });
        }
    }, travelMs);
}

export function updateBanzaiDashes(now) {
    for (let i = banzaiDashes.length - 1; i >= 0; i--) {
        if (now - banzaiDashes[i].startTime >= banzaiDashes[i].duration) {
            banzaiDashes.splice(i, 1);
        }
    }
}

export function drawBanzaiDashes(ctx2d, now) {
    for (const d of banzaiDashes) {
        const elapsed = Math.max(0, now - d.startTime);
        const t = Math.min(1, elapsed / d.duration);
        const leapMs = 110;
        const hangMs = 55;
        const dashMs = Math.max(80, d.travelMs - leapMs - hangMs);
        const baseAngle = Math.atan2(d.toY - d.fromY, d.toX - d.fromX);
        ctx2d.save();

        // 阶段1-2：起跳与滞空刀锋蓄力闪光
        if (elapsed < leapMs + hangMs + 60) {
            const p = Math.min(1, elapsed / leapMs);
            const liftY = d.fromY - 26 * (1 - (1 - p) * (1 - p));
            const chargeAlpha = elapsed < leapMs ? p * 0.65 : Math.max(0, 1 - (elapsed - leapMs - hangMs) / 60) * 0.9;
            if (chargeAlpha > 0.01) {
                ctx2d.globalAlpha = chargeAlpha;
                ctx2d.strokeStyle = '#fecaca';
                ctx2d.shadowColor = '#ef4444';
                ctx2d.shadowBlur = 14;
                ctx2d.lineWidth = 2.4;
                ctx2d.beginPath();
                ctx2d.arc(d.fromX, liftY, 18 + (elapsed >= leapMs ? 4 : 0), baseAngle - 0.9, baseAngle + 0.9);
                ctx2d.stroke();
            }
        }

        // 阶段3：空中急速突进流光轨迹
        if (elapsed >= leapMs + hangMs) {
            const dashProgress = Math.min(1, (elapsed - leapMs - hangMs) / dashMs);
            const dashEase = 1 - Math.pow(1 - dashProgress, 3);
            const startY = d.fromY - 26;
            const headX = d.fromX + (d.toX - d.fromX) * dashEase;
            const headY = startY + (d.toY - startY) * dashEase;
            const fadeOut = elapsed > d.travelMs ? Math.max(0, 1 - (elapsed - d.travelMs) / 260) : 1;

            ctx2d.globalAlpha = fadeOut * 0.9;
            ctx2d.lineCap = 'round';
            ctx2d.strokeStyle = '#dc2626';
            ctx2d.shadowColor = '#f87171';
            ctx2d.shadowBlur = 14;
            ctx2d.lineWidth = 6.5 * (0.45 + 0.55 * fadeOut);
            ctx2d.beginPath();
            ctx2d.moveTo(d.fromX, startY);
            ctx2d.lineTo(headX, headY);
            ctx2d.stroke();

            ctx2d.strokeStyle = '#fef2f2';
            ctx2d.lineWidth = 2.4 * (0.45 + 0.55 * fadeOut);
            ctx2d.beginPath();
            ctx2d.moveTo(d.fromX, startY);
            ctx2d.lineTo(headX, headY);
            ctx2d.stroke();
        }

        // 阶段4：抵达斩出弧形刀光
        if (elapsed >= d.travelMs - 20) {
            const slashT = Math.min(1, (elapsed - (d.travelMs - 20)) / 240);
            const slashAlpha = Math.max(0, 1 - slashT);
            const r = 34 + slashT * 14;
            ctx2d.globalAlpha = slashAlpha * 0.95;
            ctx2d.strokeStyle = '#fef2f2';
            ctx2d.shadowColor = '#ef4444';
            ctx2d.shadowBlur = 18;
            ctx2d.lineWidth = 6 * (1 - slashT * 0.65);
            ctx2d.lineCap = 'round';
            ctx2d.beginPath();
            ctx2d.arc(d.toX, d.toY, r, baseAngle - 1.05, baseAngle + 1.05);
            ctx2d.stroke();

            ctx2d.strokeStyle = '#fca5a5';
            ctx2d.lineWidth = 2.5 * (1 - slashT * 0.5);
            ctx2d.beginPath();
            ctx2d.arc(d.toX, d.toY, r * 0.82, baseAngle - 0.85, baseAngle + 0.85);
            ctx2d.stroke();
        }

        ctx2d.restore();
    }
}

export const guerrillaAmbushes = [];
export const guerrillaVeils = [];

/** 游击纵队进入隐匿：暗影绿雾旋涡收敛 + 潜行封印波纹 */
export function spawnGuerrillaConcealmentFx(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = performance.now();
    spawnCommanderSkillEffect(x, y, '🌿', '敌后隐匿', false, '#86efac');
    spawnRingWave(x, y, { color: '#4ade80', maxRadius: 48, duration: 540, lineWidth: 3.4, count: 2, glow: '#16a34a' });
    guerrillaVeils.push({ x, y, startTime: now, duration: 760 });
    for (let i = 0; i < 16; i++) {
        const angle = (Math.PI * 2 * i) / 16;
        const dist = 28 + Math.random() * 14;
        const sx = x + Math.cos(angle) * dist;
        const sy = y + Math.sin(angle) * dist;
        spawnDirectionalParticles(sx, sy, x, y, i % 3 === 0 ? '#bbf7d0' : '#22c55e', 1);
    }
}

/** 游击纵队破隐奇袭：瞬影残像突进 + X形双刃斩光 + 得手烟遁撤离表现 */
export function spawnGuerrillaAmbushFx(fromX, fromY, toX, toY, { killed = false, dodged = false, retreatMp = 0 } = {}) {
    if (!Number.isFinite(fromX) || !Number.isFinite(fromY) || !Number.isFinite(toX) || !Number.isFinite(toY)) return;
    const now = performance.now();
    guerrillaAmbushes.push({
        fromX, fromY, toX, toY,
        killed: Boolean(killed),
        dodged: Boolean(dodged),
        startTime: now,
        duration: killed ? 680 : 540
    });
    spawnCommanderSkillEffect(toX, toY, '🗡️', killed ? '奇袭斩杀' : '奇袭', true, killed ? '#fde047' : '#86efac');
    if (dodged) {
        spawnDodgeShimmer(toX, toY);
        return;
    }
    triggerAttackFlash(toX, toY, true);
    spawnDirectionalParticles(fromX, fromY, toX, toY, '#fde047', 12);
    spawnDirectionalParticles(fromX, fromY, toX, toY, '#4ade80', 10);
    spawnRingWave(toX, toY, {
        color: killed ? '#fde047' : '#86efac',
        maxRadius: killed ? 52 : 38,
        duration: killed ? 520 : 380,
        lineWidth: killed ? 3.5 : 2.6,
        count: killed ? 2 : 1,
        glow: killed ? '#ef4444' : '#22c55e'
    });
    triggerScreenShake(killed ? 7 : 4.5, killed ? 240 : 170);
    if (killed && retreatMp > 0) {
        setTimeout(() => {
            guerrillaVeils.push({ x: fromX, y: fromY, startTime: performance.now(), duration: 640 });
            spawnCommanderSkillEffect(fromX, fromY, '💨', `脱身 +${retreatMp}⚡`, true, '#a7f3d0');
            spawnRingWave(fromX, fromY, { color: '#6ee7b7', maxRadius: 42, duration: 500, lineWidth: 2.8, glow: '#10b981' });
        }, 160);
    }
}

export function updateGuerrillaAmbushes(now) {
    for (let i = guerrillaAmbushes.length - 1; i >= 0; i--) {
        if (now - guerrillaAmbushes[i].startTime >= guerrillaAmbushes[i].duration) {
            guerrillaAmbushes.splice(i, 1);
        }
    }
    for (let i = guerrillaVeils.length - 1; i >= 0; i--) {
        if (now - guerrillaVeils[i].startTime >= guerrillaVeils[i].duration) {
            guerrillaVeils.splice(i, 1);
        }
    }
}

export function drawGuerrillaAmbushes(ctx2d, now) {
    for (const v of guerrillaVeils) {
        const t = Math.min(1, Math.max(0, (now - v.startTime) / v.duration));
        const inv = 1 - t;
        ctx2d.save();
        // 内收暗影斗篷圆环 + 旋转叶影叶片
        const shrinkR = 34 * (1 - t * 0.72);
        ctx2d.globalAlpha = inv * 0.72;
        ctx2d.strokeStyle = '#4ade80';
        ctx2d.shadowColor = '#16a34a';
        ctx2d.shadowBlur = 12;
        ctx2d.lineWidth = 2.6 * inv + 0.8;
        ctx2d.setLineDash([7, 5]);
        ctx2d.lineDashOffset = -t * 36;
        ctx2d.beginPath();
        ctx2d.arc(v.x, v.y, Math.max(4, shrinkR), 0, Math.PI * 2);
        ctx2d.stroke();
        ctx2d.setLineDash([]);
        for (let k = 0; k < 5; k++) {
            const ang = t * 4.2 + (k * Math.PI * 2) / 5;
            const px = v.x + Math.cos(ang) * (shrinkR * 0.85);
            const py = v.y + Math.sin(ang) * (shrinkR * 0.85);
            ctx2d.fillStyle = k % 2 === 0 ? 'rgba(20, 83, 45, 0.75)' : 'rgba(134, 239, 172, 0.85)';
            ctx2d.beginPath();
            ctx2d.ellipse(px, py, 6.5 * inv + 2, 3.2 * inv + 1, ang + 0.6, 0, Math.PI * 2);
            ctx2d.fill();
        }
        ctx2d.restore();
    }

    for (const a of guerrillaAmbushes) {
        const elapsed = Math.max(0, now - a.startTime);
        const t = Math.min(1, elapsed / a.duration);
        const alpha = 1 - t;
        const dx = a.toX - a.fromX;
        const dy = a.toY - a.fromY;
        const baseAngle = Math.atan2(dy, dx);
        ctx2d.save();

        // 1. 投掷旋转飞镖轨迹（主飞镖 + 双侧护镖拖尾）
        const flightMs = 165;
        const dashT = Math.min(1, elapsed / flightMs);
        const tailT = Math.max(0, dashT - 0.28);
        const dartX = a.fromX + dx * dashT;
        const dartY = a.fromY + dy * dashT - Math.sin(dashT * Math.PI) * 10;
        const tailX = a.fromX + dx * tailT;
        const tailY = a.fromY + dy * tailT - Math.sin(tailT * Math.PI) * 10;
        const flightAlpha = elapsed <= flightMs
            ? 0.95
            : Math.max(0, 1 - (elapsed - flightMs) / 140);

        if (flightAlpha > 0.01) {
            ctx2d.globalAlpha = flightAlpha * 0.72;
            ctx2d.lineCap = 'round';
            ctx2d.strokeStyle = a.killed ? '#fde047' : '#4ade80';
            ctx2d.shadowColor = a.killed ? '#ef4444' : '#86efac';
            ctx2d.shadowBlur = 10;
            ctx2d.lineWidth = 3.2;
            ctx2d.beginPath();
            ctx2d.moveTo(tailX, tailY);
            ctx2d.lineTo(dartX, dartY);
            ctx2d.stroke();

            // 旋转四芒飞镖本体
            const spin = elapsed * 0.036;
            const drawDart = (cx, cy, radius, rot, dAlpha) => {
                ctx2d.save();
                ctx2d.globalAlpha = dAlpha;
                ctx2d.translate(cx, cy);
                ctx2d.rotate(rot);
                ctx2d.fillStyle = a.killed ? '#fef08a' : '#ecfdf5';
                ctx2d.strokeStyle = a.killed ? '#ef4444' : '#22c55e';
                ctx2d.lineWidth = 1.4;
                ctx2d.beginPath();
                for (let p = 0; p < 4; p++) {
                    const ang = (p * Math.PI) / 2;
                    const tipX = Math.cos(ang) * radius;
                    const tipY = Math.sin(ang) * radius;
                    const midAng = ang + Math.PI / 4;
                    const innerX = Math.cos(midAng) * (radius * 0.28);
                    const innerY = Math.sin(midAng) * (radius * 0.28);
                    if (p === 0) ctx2d.moveTo(tipX, tipY);
                    else ctx2d.lineTo(tipX, tipY);
                    ctx2d.lineTo(innerX, innerY);
                }
                ctx2d.closePath();
                ctx2d.fill();
                ctx2d.stroke();
                ctx2d.restore();
            };

            drawDart(dartX, dartY, 10.5, spin, flightAlpha);
            const nx = -Math.sin(baseAngle);
            const ny = Math.cos(baseAngle);
            const subT = Math.max(0, dashT - 0.09);
            if (subT > 0) {
                const sx = a.fromX + dx * subT;
                const sy = a.fromY + dy * subT - Math.sin(subT * Math.PI) * 8;
                drawDart(sx + nx * 7, sy + ny * 7, 6.2, -spin * 1.15, flightAlpha * 0.78);
                drawDart(sx - nx * 7, sy - ny * 7, 6.2, spin * 1.15, flightAlpha * 0.78);
            }
        }

        // 2. 飞镖命中目标后爆裂 X 形交叉斩光（仅未闪避时爆裂）
        if (!a.dodged && elapsed >= flightMs - 20) {
            const slashT = Math.min(1, (elapsed - (flightMs - 20)) / (a.duration - (flightMs - 20)));
            const slashAlpha = Math.max(0, 1 - slashT);
            const bladeLen = 28 + slashT * 14;
            for (const dir of [-0.72, 0.72]) {
                const ang = baseAngle + dir;
                const ux = Math.cos(ang);
                const uy = Math.sin(ang);
                const nx = -uy;
                const ny = ux;
                ctx2d.globalAlpha = slashAlpha * 0.95;
                ctx2d.fillStyle = a.killed ? '#fef08a' : '#dcfce7';
                ctx2d.shadowColor = a.killed ? '#ef4444' : '#4ade80';
                ctx2d.shadowBlur = 14;
                ctx2d.beginPath();
                ctx2d.moveTo(a.toX - ux * bladeLen, a.toY - uy * bladeLen);
                ctx2d.quadraticCurveTo(a.toX + nx * 6 * slashAlpha, a.toY + ny * 6 * slashAlpha, a.toX + ux * bladeLen, a.toY + uy * bladeLen);
                ctx2d.quadraticCurveTo(a.toX - nx * 4 * slashAlpha, a.toY - ny * 4 * slashAlpha, a.toX - ux * bladeLen, a.toY - uy * bladeLen);
                ctx2d.fill();
            }
        }
        ctx2d.restore();
    }
}

// ===== 清除所有瞬时效果（用于联机重连状态恢复） =====================
export function clearTransientEffects() {
    particles.length = 0;
    iconEffects.length = 0;
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
    droneProjectiles.length = 0;
    heavyCannonShells.length = 0;
    katyushaRockets.length = 0;
    banzaiDashes.length = 0;
    guerrillaAmbushes.length = 0;
    guerrillaVeils.length = 0;
    ringWaves.length = 0;
    torpedoes.length = 0;
    torpedoSplashes.length = 0;
    recoils.length = 0;
    charges.length = 0;
    lightningBolts.length = 0;
    orbitalBeams.length = 0;
    screenShake.time = 0;
    cardUseEffects.length = 0;
    bloodDrains.length = 0;
    gongxinRipples.length = 0;
    ministerRings.length = 0;
    coinParticles.length = 0;
    paladinBeamProjectiles.length = 0;
    goldenBeams.length = 0;
    paladinOrbitBeams.length = 0;
    healingChains.length = 0;
    soulRecallEffects.length = 0;
    airstrikeEffects.length = 0;
    airliftEffects.length = 0;
    celestineOracleBeams.length = 0;
    screenShake.x = 0;
    screenShake.y = 0;
    turnFlash.alpha = 0;
    borderFlash.alpha = 0;
}
import { CULTURE_STRIKE_TIMING } from '../rules/cultureStrike.js';
import { drawSniperBullet } from './cultureStrikeFx.js';
