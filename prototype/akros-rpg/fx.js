// 打击感：命中停顿、屏幕震动、伤害与金钱浮字、火花与拾取粒子。
// 全部走同一个 update/draw，主循环只调两次。

import { PALETTE, rgba } from './art.js';
import { formatMoney, clamp } from './util.js';

export const fx = {
    shake: 0,
    shakeX: 0,
    shakeY: 0,
    hitStop: 0,
    texts: [],
    particles: [],
    slashes: []
};

// ============ 触发 ============

export function addShake(magnitude) {
    fx.shake = Math.min(14, fx.shake + magnitude);
}

/** 命中停顿：把这一帧的 dt 吞掉，制造 60ms 的"顿感"。 */
export function addHitStop(seconds) {
    fx.hitStop = Math.max(fx.hitStop, seconds);
}

export function spawnDamageText(x, y, value, crit) {
    fx.texts.push({
        x: x + (Math.random() - 0.5) * 10, y: y - 42,
        text: crit ? `${value}!` : `${value}`,
        color: crit ? PALETTE.gold : '#f0e4cc',
        size: crit ? 22 : 15,
        life: crit ? 1.0 : 0.8, maxLife: crit ? 1.0 : 0.8,
        vy: -46, bold: crit
    });
}

export function spawnHealText(x, y, value) {
    fx.texts.push({
        x, y: y - 46, text: `+${value}`, color: '#a8d97c',
        size: 15, life: 0.9, maxLife: 0.9, vy: -34, bold: false
    });
}

export function spawnMoneyText(x, y, cents) {
    fx.texts.push({
        x, y: y - 34, text: `+${formatMoney(cents)}`, color: PALETTE.warmGold,
        size: 14, life: 1.1, maxLife: 1.1, vy: -30, bold: false
    });
}

export function spawnNoticeText(x, y, text, color) {
    fx.texts.push({
        x, y: y - 58, text, color: color || PALETTE.gold,
        size: 16, life: 1.5, maxLife: 1.5, vy: -18, bold: true
    });
}

/** 命中火花：沿受击方向溅出。 */
export function spawnHitSparks(x, y, angle, count, color) {
    for (let i = 0; i < count; i++) {
        const a = angle + (Math.random() - 0.5) * 1.5;
        const speed = 90 + Math.random() * 190;
        fx.particles.push({
            x, y: y - 26, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - 40,
            life: 0.24 + Math.random() * 0.24, maxLife: 0.48,
            size: 1.4 + Math.random() * 2, color: color || '#ffd9a0', gravity: 420
        });
    }
}

export function spawnCoinBurst(x, y) {
    for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const speed = 70 + Math.random() * 120;
        fx.particles.push({
            x, y: y - 20, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
            life: 0.5 + Math.random() * 0.3, maxLife: 0.8,
            size: 2 + Math.random() * 1.6, color: PALETTE.warmGold, gravity: 340
        });
    }
}

export function spawnDust(x, y, count) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        fx.particles.push({
            x, y, vx: Math.cos(a) * 40, vy: Math.sin(a) * 18 - 10,
            life: 0.4 + Math.random() * 0.3, maxLife: 0.7,
            size: 2 + Math.random() * 2.4, color: '#b4a58a', gravity: 40
        });
    }
}

/** 挥砍弧线：一次性的扇形残影。 */
export function spawnSlashArc(x, y, angle, arc, radius, color) {
    fx.slashes.push({ x, y, angle, arc, radius, life: 0.22, maxLife: 0.22, color: color || '#fff4d6' });
}

// ============ 更新与绘制 ============

/** 返回本帧实际可用的 dt（命中停顿期间为 0）。 */
export function consumeHitStop(dt) {
    if (fx.hitStop <= 0) return dt;
    fx.hitStop -= dt;
    return 0;
}

export function updateFx(dt) {
    if (fx.shake > 0) {
        fx.shake = Math.max(0, fx.shake - dt * 46);
        fx.shakeX = (Math.random() - 0.5) * fx.shake;
        fx.shakeY = (Math.random() - 0.5) * fx.shake;
    } else {
        fx.shakeX = 0; fx.shakeY = 0;
    }

    for (let i = fx.texts.length - 1; i >= 0; i--) {
        const t = fx.texts[i];
        t.life -= dt;
        t.y += t.vy * dt;
        t.vy += 52 * dt;
        if (t.life <= 0) fx.texts.splice(i, 1);
    }
    for (let i = fx.particles.length - 1; i >= 0; i--) {
        const p = fx.particles[i];
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += p.gravity * dt;
        if (p.life <= 0) fx.particles.splice(i, 1);
    }
    for (let i = fx.slashes.length - 1; i >= 0; i--) {
        fx.slashes[i].life -= dt;
        if (fx.slashes[i].life <= 0) fx.slashes.splice(i, 1);
    }
}

/** 画在角色之下的层：挥砍弧。 */
export function drawSlashes(ctx) {
    for (const s of fx.slashes) {
        const k = s.life / s.maxLife;
        ctx.save();
        ctx.translate(s.x, s.y - 22);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k * 0.85;
        const g = ctx.createRadialGradient(0, 0, s.radius * 0.35, 0, 0, s.radius);
        g.addColorStop(0, rgba('#ffffff', 0));
        g.addColorStop(0.7, s.color);
        g.addColorStop(1, rgba('#ffffff', 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, s.radius * (0.8 + 0.2 * (1 - k)), s.angle - s.arc / 2, s.angle + s.arc / 2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }
}

/** 画在角色之上的层：粒子与浮字。 */
export function drawFx(ctx) {
    for (const p of fx.particles) {
        const k = clamp(p.life / p.maxLife, 0, 1);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.restore();
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of fx.texts) {
        const k = clamp(t.life / t.maxLife, 0, 1);
        const pop = t.life > t.maxLife - 0.1 ? 1 + (t.life - (t.maxLife - 0.1)) * 3 : 1;
        ctx.globalAlpha = Math.min(1, k * 2);
        ctx.font = `${t.bold ? 'bold ' : ''}${Math.round(t.size * pop)}px "Noto Serif SC","Songti SC",serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10,7,4,0.85)';
        ctx.strokeText(t.text, t.x, t.y);
        ctx.fillStyle = t.color;
        ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
}

export function resetFx() {
    fx.texts.length = 0;
    fx.particles.length = 0;
    fx.slashes.length = 0;
    fx.shake = 0;
    fx.hitStop = 0;
}
