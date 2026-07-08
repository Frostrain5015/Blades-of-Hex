// 堕天使双形态辉光特效模块 —— 注册到 underUnits 图层
import { HEX_SIZE, drawHexagonOutline, hexPath, ctx } from '../../js/config.js';
import { gameState } from '../../js/state.js';
import { registerFxLayer } from '../../js/fxRegistry.js';

function _drawFallenAngelAura(now) {
    const time = now / 1000;
    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || u.commander !== 'fallenAngel') continue;
        const pos = u.getVisualPos();
        const vx = pos.x, vy = pos.y;

        ctx.save();
        if (u._fallen) {
            const pulse = (Math.sin(time * 4 * Math.PI) + 1) / 2;
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 1, `rgba(40,25,30,${0.40 + pulse * 0.15})`, 3);
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 6, `rgba(50,30,40,${0.22 + pulse * 0.18})`, 2);
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 12, `rgba(35,20,30,${0.08 + pulse * 0.12})`, 1.5);
        } else {
            const pulse = (Math.sin(time * 3.5 * Math.PI) + 1) / 2;
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 1, `rgba(200,215,255,${0.50 + pulse * 0.20})`, 4);
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 8, `rgba(220,230,255,${0.25 + pulse * 0.25})`, 2.5);
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 16, `rgba(200,215,255,${0.08 + pulse * 0.15})`, 1.5);
        }
        ctx.restore();
    }
}

export function register() {
    // 原版在单位六边形辉光带（立绘之前）绘制，对应 ground 图层
    registerFxLayer('ground', (c, now) => _drawFallenAngelAura(now), 40);
}
