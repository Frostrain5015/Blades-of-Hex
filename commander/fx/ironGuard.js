// 铁卫灵光特效模块 —— 注册到 ground 图层绘制盾阵外边界光环
import { HEX_SIZE, hexPath, ctx } from '../../js/config.js';
import { gameState } from '../../js/state.js';
import { registerFxLayer } from '../../js/fxRegistry.js';
import { areCommanderMechanicsSuppressed } from '../../rules/movement.js';

// 铁卫灵光（7格集群外边界）
function _drawIronGuardAura(now) {
    const pulse = (Math.sin(now / 400) + 1) / 2;

    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || u.commander !== 'ironGuard' || areCommanderMechanicsSuppressed(u) || u._shield <= 0) continue;
        const shieldRatio = Math.min(1, u._shield / Math.max(u._shieldMax, 1));
        const alpha = (0.45 + pulse * 0.30) * shieldRatio;
        const fillAlpha = (0.04 + pulse * 0.04) * shieldRatio;
        const clr = `rgba(100,180,255,${alpha})`;

        const vp = u.getVisualPos();
        const auraX = vp.x, auraY = vp.y;
        const offX = auraX - tile.x;
        const offY = auraY - tile.y;

        // 收集自身+6邻格的所有六边形顶点，筛选外边界
        const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
        const vertCount = new Map();
        for (const [dq, dr] of dirs) {
            const ht = gameState.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (!ht) continue;
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 180) * (60 * i - 30);
                const vx = ht.x + offX + HEX_SIZE * Math.cos(angle);
                const vy = ht.y + offY + HEX_SIZE * Math.sin(angle);
                const vk = `${vx.toFixed(1)},${vy.toFixed(1)}`;
                vertCount.set(vk, (vertCount.get(vk) || 0) + 1);
            }
        }
        const outer = [];
        for (const [vk, cnt] of vertCount) {
            if (cnt < 3) {
                const [vx, vy] = vk.split(',').map(Number);
                outer.push({ x: vx, y: vy });
            }
        }
        if (outer.length < 6) continue;
        const gx = tile.x, gy = tile.y;
        outer.sort((a, b) => Math.atan2(a.y - gy, a.x - gx) - Math.atan2(b.y - gy, b.x - gx));

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(outer[0].x, outer[0].y);
        for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i].x, outer[i].y);
        ctx.closePath();
        ctx.fillStyle = clr.replace(/[\d.]+\)$/, `${fillAlpha})`);
        ctx.fill();
        ctx.strokeStyle = clr;
        ctx.lineWidth = 1 + shieldRatio * 2.5;
        ctx.shadowColor = clr;
        ctx.shadowBlur = (14 + pulse * 6) * shieldRatio;
        ctx.stroke();
        ctx.restore();
    }
}

export function register() {
    registerFxLayer('ground', (c, now) => _drawIronGuardAura(now), 20);
}
