// 纵横家连横辉光模块 —— 注册到 underUnits 图层
import { HEX_SIZE, drawHexagonOutline, hexPath, ctx } from '../../js/config.js';
import { gameState } from '../../js/state.js';
import { registerFxLayer } from '../../js/fxRegistry.js';

function _drawDiplomatAura(now) {
    const time = now / 1000;
    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || u.commander !== 'diplomat' || u.hp <= 0 || !u.tile) continue;
        const pos = u.getVisualPos();
        const vx = pos.x, vy = pos.y;

        if (u.tile.camp === u.camp) continue; // 己方行政区内无特效

        ctx.save();
        const dipPulse = (Math.sin(time * 2 * Math.PI) + 1) / 2;
        ctx.globalAlpha = 0.08 + dipPulse * 0.05;
        ctx.fillStyle = '#d4a017';
        hexPath(ctx, vx, vy, HEX_SIZE + 1);
        ctx.fill();

        ctx.globalAlpha = 0.4 + dipPulse * 0.2;
        ctx.strokeStyle = 'rgba(255,200,50,0.85)';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(255,200,50,0.5)';
        ctx.shadowBlur = 8 + dipPulse * 4;
        ctx.setLineDash([6, 5]);
        hexPath(ctx, vx, vy, HEX_SIZE + 1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

export function register() {
    registerFxLayer('ground', (c, now) => _drawDiplomatAura(now), 43);
}
