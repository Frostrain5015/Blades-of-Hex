// 亡灵法师特效模块：魂印地块标记 + 魂卒回魂黑烟
// 状态 + spawn 在 effects.js / gameState._soulMarks

import { soulRecallEffects } from '../../js/effects.js';
import { gameState, getViewingCamp } from '../../js/state.js';
import { isTileVisible } from '../../js/fogOfWar.js';
import { ctx, HEX_SIZE, hexPath } from '../../js/config.js';
import { registerFxLayer, registerFxUpdate } from '../../js/fxRegistry.js';

// 魂印 —— 深绿地块 + 鬼魂标记（原 renderer drawSoulMarks，立绘之前）
function _drawSoulMarks(now) {
    if (!gameState._soulMarks || gameState._soulMarks.length === 0) return;
    const time = now / 1000;
    for (const mark of gameState._soulMarks) {
        const tile = gameState.tileMap && gameState.tileMap.get(`${mark.q},${mark.r}`);
        if (!tile) continue;
        const vx = tile.x, vy = tile.y;
        const pulse = (Math.sin(time * 1.8 + mark.q) + 1) / 2;

        // 地块深绿底色 + 亮绿描边
        ctx.save();
        ctx.globalAlpha = 0.10 + pulse * 0.06;
        ctx.fillStyle = '#226644';
        hexPath(ctx, vx, vy, HEX_SIZE + 1);
        ctx.fill();
        ctx.globalAlpha = 0.3 + pulse * 0.15;
        ctx.strokeStyle = '#44ee88';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(68,238,136,0.5)';
        ctx.shadowBlur = 6 + pulse * 4;
        hexPath(ctx, vx, vy, HEX_SIZE + 1);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        // 鬼魂 emoji + 绿色鬼火
        const alpha = 0.5 + Math.sin(time * 2 + mark.q) * 0.2;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '18px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👻', vx, vy);
        ctx.restore();
        // 绿色鬼火闪烁
        ctx.save();
        const glowAlpha = 0.15 + Math.sin(time * 3) * 0.1;
        ctx.fillStyle = `rgba(68,255,136,${glowAlpha})`;
        ctx.beginPath();
        ctx.arc(vx, vy - 2, HEX_SIZE * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

function _ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

function _effectTileHidden(x, y) {
    if (!gameState.skirmishFog) return false;
    let best = null, bestD = Infinity;
    for (const tile of gameState.tiles) {
        const d = (tile.x - x) ** 2 + (tile.y - y) ** 2;
        if (d < bestD) { bestD = d; best = tile; }
    }
    return best ? !isTileVisible(best, getViewingCamp(), gameState) : false;
}

function _updateSoulRecall(now) {
    for (let i = soulRecallEffects.length - 1; i >= 0; i--) {
        if (now - soulRecallEffects[i].startTime > soulRecallEffects[i].duration) soulRecallEffects.splice(i, 1);
    }
}

function _drawSoulRecall(ctx2d, now) {
    for (let i = soulRecallEffects.length - 1; i >= 0; i--) {
        const fx = soulRecallEffects[i];
        const t = (now - fx.startTime) / fx.duration;
        if (t >= 1) { soulRecallEffects.splice(i, 1); continue; }
        if (_effectTileHidden(fx.toX, fx.toY)) continue;
        const land = fx.landFrac || 0.92;
        const p = Math.min(1, t / land);
        const px = fx.fromX + (fx.toX - fx.fromX) * _ease(p);
        const py = fx.fromY + (fx.toY - fx.fromY) * _ease(p);
        ctx2d.save();
        const swirl = Math.sin(p * Math.PI * 4) * 8;
        const r = 6 + p * 8 + swirl;
        const alpha = (1 - p) * 0.5 + 0.3;
        ctx2d.fillStyle = `rgba(25,15,40,${alpha})`;
        ctx2d.shadowColor = 'rgba(50,20,80,0.4)'; ctx2d.shadowBlur = 14 + p * 8;
        ctx2d.beginPath(); ctx2d.arc(px + swirl * 0.3, py - swirl * 0.5, r, 0, Math.PI * 2); ctx2d.fill();
        for (let s = 1; s <= 3; s++) {
            const sp = Math.max(0, p - s * 0.06);
            const sx = fx.fromX + (fx.toX - fx.fromX) * _ease(sp);
            const sy = fx.fromY + (fx.toY - fx.fromY) * _ease(sp);
            const sr = Math.max(1, r * (1 - s * 0.2));
            const sa = Math.max(0, alpha * (1 - s * 0.25));
            ctx2d.fillStyle = `rgba(25,15,40,${sa})`;
            ctx2d.beginPath(); ctx2d.arc(sx + Math.sin(sp * 5) * 3, sy + Math.cos(sp * 4) * 3, sr, 0, Math.PI * 2); ctx2d.fill();
        }
        ctx2d.shadowBlur = 0;
        ctx2d.restore();
    }
}

export function register() {
    registerFxUpdate((dt, now) => _updateSoulRecall(now));
    // 魂印在单位六边形辉光带末位（原 drawSoulMarks 调用位置）
    registerFxLayer('ground', (c, now) => _drawSoulMarks(now), 50);
    registerFxLayer('top', _drawSoulRecall);
}
