// 吸血鬼嗜血红色粒子流特效模块
// update + draw 在此，状态数组 + spawn 在 effects.js（共享数据源）

import { VisualParticle, particles, bloodDrains } from '../../js/effects.js';
import { registerFxLayer, registerFxUpdate } from '../../js/fxRegistry.js';

// ===== update =====
function _updateBloodDrains(dt) {
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

// ===== draw =====
function _drawBloodDrains(ctx, now) {
    if (bloodDrains.length === 0) return;
    for (const b of bloodDrains) {
        const rawT = 1 - b.life / b.maxLife;
        if (rawT < b.delay) continue;
        const t = (rawT - b.delay) / (1 - b.delay);
        const alpha = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.8) / 0.2);
        if (alpha <= 0) continue;
        if (b.trail.length > 1) {
            for (let j = 1; j < b.trail.length; j++) {
                const trailAlpha = alpha * 0.3 * (j / b.trail.length);
                ctx.save();
                ctx.globalAlpha = trailAlpha;
                ctx.strokeStyle = '#ff4444';
                ctx.lineWidth = b.size * 0.6 * (j / b.trail.length);
                ctx.shadowColor = '#cc1111';
                ctx.shadowBlur = 2;
                ctx.beginPath();
                ctx.moveTo(b.trail[j - 1].x, b.trail[j - 1].y);
                ctx.lineTo(b.trail[j].x, b.trail[j].y);
                ctx.stroke();
                ctx.restore();
            }
        }
        ctx.save();
        ctx.globalAlpha = alpha * 0.5;
        ctx.fillStyle = '#ff2222'; ctx.shadowColor = '#ff4444'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.size * 1.6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ffffff'; ctx.shadowColor = '#ff8888'; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.size * 0.45, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = '#ff3333'; ctx.shadowColor = '#cc0000'; ctx.shadowBlur = 4;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.size * 0.85, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }
}

export function register() {
    registerFxUpdate(_updateBloodDrains);
    // 原版在治疗光环之后、雷击之前绘制（迷雾遮罩之下，遭遇战中不穿透迷雾泄露战况）
    registerFxLayer('combatFx', _drawBloodDrains);
}
