// 狂战士血怒辉光模块 —— 注册到 underUnits 图层
import { HEX_SIZE, drawHexagonOutline, ctx } from '../../js/config.js';
import { gameState } from '../../js/state.js';
import { registerFxLayer } from '../../js/fxRegistry.js';

function _drawBerserkerAura(now) {
    const time = now / 1000;
    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || u.commander !== 'berserker' || u.hp >= u.maxHp) continue;
        const pos = u.getVisualPos();
        const vx = pos.x, vy = pos.y;

        const hpLostPct = ((u.maxHp - u.hp) / u.maxHp) * 100;
        const stacks = Math.min(50, Math.floor(hpLostPct / 1.5));
        if (stacks <= 0) continue;

        ctx.save();
        const intensity = stacks / 50;
        const ragePulse = (Math.sin(time * 6 * Math.PI) + 1) / 2;
        const rageAlpha = (0.15 + ragePulse * 0.25) * intensity;
        const rageR = HEX_SIZE + 3 + ragePulse * 5 * intensity;
        drawHexagonOutline(ctx, vx, vy, rageR, `rgba(255,40,0,${rageAlpha})`, 2 + intensity);
        drawHexagonOutline(ctx, vx, vy, rageR + 3, `rgba(255,100,40,${rageAlpha * 0.5})`, 1 + intensity * 0.5);
        ctx.restore();
    }
}

export function register() {
    // 原版在单位六边形辉光带（立绘之前）绘制，对应 ground 图层
    registerFxLayer('ground', (c, now) => _drawBerserkerAura(now), 41);
}
