// 牧师特效模块：圣链治疗 + 治愈灵光六边形光环
import { healingChains } from '../../js/effects.js';
import { HEX_SIZE, hexPath, drawHexagonOutline, ctx } from '../../js/config.js';
import { gameState } from '../../js/state.js';
import { registerFxLayer, registerFxUpdate } from '../../js/fxRegistry.js';

// 治愈灵光 — 绿色六边形光环 + 向内辐射辉光（原 renderer drawUnitHexAuras 的 _healingAura 分支）
function _drawHealAuras(now) {
    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || !(u._healingAura > 0)) continue;
        const pos = u.getVisualPos();
        const vx = pos.x, vy = pos.y;
        ctx.save();
        const healPulse = (Math.sin(now / 300) + 1) / 2;
        const healAlpha = 0.35 + healPulse * 0.45;
        // 向内辐射：径向渐变，边缘亮、中心透明
        const innerGlow = ctx.createRadialGradient(vx, vy, HEX_SIZE * 0.15, vx, vy, HEX_SIZE);
        innerGlow.addColorStop(0, 'rgba(144,255,180,0)');
        innerGlow.addColorStop(0.45, 'rgba(144,255,180,0.06)');
        innerGlow.addColorStop(0.75, `rgba(144,255,180,${0.12 + healPulse * 0.10})`);
        innerGlow.addColorStop(1, `rgba(144,255,180,${0.25 + healPulse * 0.15})`);
        ctx.fillStyle = innerGlow;
        hexPath(ctx, vx, vy, HEX_SIZE);
        ctx.fill();
        // 外光环：浅亮绿色
        ctx.shadowColor = `rgba(144,255,180,${healAlpha * 0.7})`;
        ctx.shadowBlur = 14;
        drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 1,
            `rgba(144,255,200,${healAlpha})`, 3);
        ctx.restore();
    }
}

function _updateHealingChains(now) {
    for (let i = healingChains.length - 1; i >= 0; i--) {
        if (now - healingChains[i].startTime > healingChains[i].duration) healingChains.splice(i, 1);
    }
}

function _drawHealingChains(ctx2d, now) {
    for (const c of healingChains) {
        const elapsed = now - c.startTime;
        const progress = Math.min(1, elapsed / c.duration);
        const alpha = progress < 0.2 ? progress / 0.2 : Math.max(0, 1 - (progress - 0.2) / 0.8);
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.strokeStyle = '#66ffaa'; ctx2d.lineWidth = 3;
        ctx2d.shadowColor = '#44dd88'; ctx2d.shadowBlur = 12;
        ctx2d.beginPath(); ctx2d.moveTo(c.fromX, c.fromY); ctx2d.lineTo(c.toX, c.toY); ctx2d.stroke();
        ctx2d.strokeStyle = '#bbffdd'; ctx2d.lineWidth = 1.2; ctx2d.shadowBlur = 0;
        ctx2d.beginPath(); ctx2d.moveTo(c.fromX, c.fromY); ctx2d.lineTo(c.toX, c.toY); ctx2d.stroke();
        ctx2d.restore();
    }
}

export function register() {
    registerFxUpdate((dt, now) => _updateHealingChains(now));
    // 原版在雷击之后、迷雾遮罩之前绘制，对应 preFog 图层
    registerFxLayer('preFog', _drawHealingChains, 30);
    // 治愈灵光六边形光环（原 drawUnitHexAuras 内的 _healingAura 分支，立绘之前）
    registerFxLayer('ground', (c, now) => _drawHealAuras(now), 44);
}
