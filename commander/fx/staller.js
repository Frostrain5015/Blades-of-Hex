// 停滞者缚足色层 + 弩朵标记特效模块 —— 注册到 ground 图层
import { HEX_SIZE, HEX_NEIGHBORS, hexPath, ctx } from '../../js/config.js';
import { gameState } from '../../js/state.js';
import { registerFxLayer } from '../../js/fxRegistry.js';
import { areCommanderMechanicsSuppressed } from '../../rules/movement.js';

function _drawStallerZone(now) {
    const ring1 = new Set();
    const ring2 = new Set();
    const stallerData = [];
    const dirs1 = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
    const dirs2 = [[2,0],[2,-1],[2,-2],[1,-2],[1,1],[0,2],[0,-2],[-1,2],[-1,-1],[-2,0],[-2,1],[-2,2]];

    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || u.commander !== 'staller' || areCommanderMechanicsSuppressed(u) || u.hp <= 0) continue;
        const vp = u.getVisualPos();
        let centerTile = tile;
        let minDist = Infinity;
        for (const t of gameState.tiles) {
            const dx = t.x - vp.x, dy = t.y - vp.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < minDist) { minDist = d2; centerTile = t; }
        }
        stallerData.push({ vp, centerTile });
        for (const [dq, dr] of dirs1) {
            const nb = gameState.tileMap.get(`${centerTile.q + dq},${centerTile.r + dr}`);
            if (nb) ring1.add(nb);
        }
        for (const [dq, dr] of dirs2) {
            const nb = gameState.tileMap.get(`${centerTile.q + dq},${centerTile.r + dr}`);
            if (nb) ring2.add(nb);
        }
    }
    for (const t of ring1) ring2.delete(t);

    const breathe = 0.5 + 0.5 * Math.sin(now / 1200 * Math.PI * 2);

    // 第1圈：荆棘边框 + 底色
    const a1 = 0.22 + breathe * 0.12;
    for (const tile of ring1) {
        ctx.save();
        hexPath(ctx, tile.x, tile.y, HEX_SIZE - 2);
        ctx.strokeStyle = `rgba(139,90,43,${a1 + 0.08})`;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.lineDashOffset = now / 80;
        ctx.stroke();
        hexPath(ctx, tile.x, tile.y, HEX_SIZE - 2);
        ctx.fillStyle = `rgba(139,90,43,${a1 * 0.85})`;
        ctx.fill();
        ctx.restore();
    }

    // 第2圈：较淡的锁链边框 + 浅底色
    const a2 = 0.12 + breathe * 0.08;
    for (const tile of ring2) {
        ctx.save();
        hexPath(ctx, tile.x, tile.y, HEX_SIZE - 2);
        ctx.fillStyle = `rgba(139,90,43,${a2 * 0.45})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(139,90,43,${a2 + 0.06})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 6]);
        ctx.lineDashOffset = now / 80 + 2.5;
        ctx.stroke();
        ctx.restore();
    }

    // 停滞者光环 + 触须
    for (const sd of stallerData) {
        const sx = sd.vp.x, sy = sd.vp.y;
        const ringAlpha = 0.15 + breathe * 0.22;
        ctx.save();
        ctx.strokeStyle = `rgba(180,120,60,${ringAlpha})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = `rgba(180,120,60,${ringAlpha * 0.7})`;
        ctx.shadowBlur = 8;
        hexPath(ctx, sx, sy, HEX_SIZE + 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        const tendrilAlpha = 0.20 + breathe * 0.14;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighbor = gameState.tileMap.get(`${sd.centerTile.q + dq},${sd.centerTile.r + dr}`);
            if (!neighbor) continue;
            const ex = neighbor.x, ey = neighbor.y;
            const dx = ex - sx, dy = ey - sy;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const overX = ex + dx / dist * HEX_SIZE * 0.40;
            const overY = ey + dy / dist * HEX_SIZE * 0.40;
            const mx = (sx + overX) / 2, my = (sy + overY) / 2;
            const perpX = -dy / dist * 2.5, perpY = dx / dist * 2.5;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.quadraticCurveTo(mx + perpX, my + perpY, overX, overY);
            ctx.strokeStyle = `rgba(160,100,50,${tendrilAlpha})`;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 5]);
            ctx.lineDashOffset = now / 90;
            ctx.stroke();

            const tipX = sx + (overX - sx) * 0.78 + perpX * 0.4;
            const tipY = sy + (overY - sy) * 0.78 + perpY * 0.4;
            ctx.beginPath();
            ctx.arc(tipX, tipY, 2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(180,120,60,${tendrilAlpha + 0.08})`;
            ctx.fill();
            ctx.restore();
        }
    }

    // 殉道者自爆预警光环（2格范围）
    for (const tile of gameState.tiles) {
        if (!tile.unit || !tile.unit._martyrPrimed || tile.unit.hp <= 0) continue;
        const mx = tile.x, my = tile.y;
        const pulse = (Math.sin(now / 200) + 1) / 2;

        ctx.save();
        ctx.globalAlpha = 0.08 + pulse * 0.06;
        ctx.fillStyle = '#ff4400';
        for (let dq = -2; dq <= 2; dq++) {
            for (let dr = Math.max(-2, -dq - 2); dr <= Math.min(2, -dq + 2); dr++) {
                const nb = gameState.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                if (nb) {
                    hexPath(ctx, nb.x, nb.y, HEX_SIZE + 1);
                    ctx.fill();
                }
            }
        }
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = `rgba(255,60,0,${0.5 + pulse * 0.4})`;
        ctx.lineWidth = 3 + pulse * 2;
        ctx.shadowColor = '#ff2200';
        ctx.shadowBlur = 10 + pulse * 8;
        hexPath(ctx, mx, my, HEX_SIZE + 3);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💥', mx, my - HEX_SIZE * 0.7);
        ctx.restore();
    }
}

export function register() {
    registerFxLayer('ground', (c, now) => _drawStallerZone(now), 10);
}
