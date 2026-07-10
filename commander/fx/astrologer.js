// 占星者星光力场特效模块 —— 注册到 ground 图层绘制星光 + 边界圈
import { HEX_SIZE, hexPath, ctx, getRoundIndex } from '../../js/config.js';
import { gameState } from '../../js/state.js';
import { registerFxLayer } from '../../js/fxRegistry.js';
import { getCommander } from '../index.js';

function _drawStarlightField(now) {
    const astrologerDef = getCommander('astrologer');
    if (!astrologerDef || !astrologerDef.isInWeatherShield) return;
    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || u.commander !== 'astrologer' || u.hp <= 0 || !gameState.tileMap) continue;
        const cq = tile.q, cr = tile.r, R = 3;
        const fieldTiles = [];
        const fieldSet = new Set();
        for (let dq = -R; dq <= R; dq++) {
            for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
                const ht = gameState.tileMap.get(`${cq + dq},${cr + dr}`);
                if (ht && !fieldSet.has(`${ht.q},${ht.r}`)) {
                    fieldSet.add(`${ht.q},${ht.r}`);
                    fieldTiles.push(ht);
                }
            }
        }
        if (fieldTiles.length === 0) continue;
        const time = now / 1000;
        const pulse = (Math.sin(time * 1.2) + 1) / 2;
        const sx = tile.x, sy = tile.y;

        // 星光粒子层
        ctx.save();
        ctx.shadowColor = 'rgba(200,230,255,0.4)';
        ctx.shadowBlur = 4;
        for (const ht of fieldTiles) {
            const seed = ht.q * 31 + ht.r * 17;
            const ptCount = 3 + ((seed * 7) % 3);
            for (let p = 0; p < ptCount; p++) {
                const pxOff = ((seed * (p + 1) * 13) % 29) - 14;
                const pyOff = ((seed * (p + 1) * 19) % 29) - 14;
                const flicker = Math.sin(time * 1.8 + seed * 0.3 + p * 2.1) * 0.5 + 0.5;
                const alpha = (0.25 + flicker * 0.2) * (p === 0 ? 1 : 0.6);
                if (p === 0) {
                    ctx.fillStyle = `rgba(255,245,220,${alpha})`;
                    ctx.font = '8px serif';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText('✦', ht.x + pxOff, ht.y + pyOff);
                } else {
                    const dotR = 1.2 + flicker * 0.8;
                    ctx.fillStyle = `rgba(200,230,255,${alpha * 0.7})`;
                    ctx.beginPath();
                    ctx.arc(ht.x + pxOff, ht.y + pyOff, dotR, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        ctx.shadowBlur = 0;
        ctx.restore();

        // 蓝黑色星光边界圈（力场外缘），采用与上校航程圈一致的邻接检查，遇到地图边界不渲染
        ctx.save();
        ctx.globalAlpha = 0.25 + pulse * 0.12;
        ctx.strokeStyle = '#1a1a3a';
        ctx.shadowColor = 'rgba(40,30,90,0.5)';
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const _neighborOffsets = [[1,0,0],[0,1,1],[-1,1,2],[-1,0,3],[0,-1,4],[1,-1,5]];
        for (const ht of fieldTiles) {
            for (const [ndq, ndr, ek] of _neighborOffsets) {
                const nq = ht.q + ndq, nr = ht.r + ndr;
                if (!gameState.tileMap.has(`${nq},${nr}`)) continue; // 出界→不描
                if (fieldSet.has(`${nq},${nr}`)) continue;            // 区域内→内部边不描
                const a0 = (Math.PI / 180) * (60 * ek - 30);
                const a1 = (Math.PI / 180) * (60 * (ek + 1) - 30);
                ctx.moveTo(ht.x + HEX_SIZE * Math.cos(a0), ht.y + HEX_SIZE * Math.sin(a0));
                ctx.lineTo(ht.x + HEX_SIZE * Math.cos(a1), ht.y + HEX_SIZE * Math.sin(a1));
            }
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

// 星移光柱：在 aboveUnits 层绘制，避免被单位遮挡
function _drawStarlightBeam(now) {
    const astrologerDef = getCommander('astrologer');
    if (!astrologerDef || !astrologerDef.isInWeatherShield) return;
    if (!gameState.weatherLockUntil || getRoundIndex(gameState) >= gameState.weatherLockUntil) return;
    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || u.commander !== 'astrologer' || u.hp <= 0) continue;
        const sx = tile.x, sy = tile.y;
        const beamTime = now / 600;
        const beamPulse = (Math.sin(beamTime * Math.PI * 2) + 1) / 2;
        ctx.save();
        const H = 120, cx = sx, cy = sy, W = 22;
        ctx.shadowColor = 'rgba(140,200,255,0.3)';
        ctx.shadowBlur = 35;
        const grad = ctx.createLinearGradient(cx, cy, cx, cy - H);
        grad.addColorStop(0, `rgba(140,210,255,${0.20 + beamPulse * 0.12})`);
        grad.addColorStop(0.3, `rgba(180,230,255,${0.30 + beamPulse * 0.15})`);
        grad.addColorStop(0.6, `rgba(200,240,255,${0.25 + beamPulse * 0.10})`);
        grad.addColorStop(1, `rgba(160,220,255,0)`);
        ctx.fillStyle = grad;
        const tw = W * 1.0, bw = W * 0.6;
        ctx.beginPath();
        ctx.moveTo(cx - bw * 0.5, cy - H);
        ctx.quadraticCurveTo(cx - tw * 0.5, cy - H * 0.5, cx - tw * 0.5, cy);
        ctx.lineTo(cx + tw * 0.5, cy);
        ctx.quadraticCurveTo(cx + tw * 0.5, cy - H * 0.5, cx + bw * 0.5, cy - H);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        const coreGrad = ctx.createLinearGradient(cx, cy, cx, cy - H);
        coreGrad.addColorStop(0, `rgba(220,245,255,${0.5 + beamPulse * 0.2})`);
        coreGrad.addColorStop(0.4, `rgba(255,255,255,${0.7 + beamPulse * 0.2})`);
        coreGrad.addColorStop(0.7, `rgba(220,245,255,${0.4 + beamPulse * 0.15})`);
        coreGrad.addColorStop(1, `rgba(200,235,255,0)`);
        ctx.fillStyle = coreGrad;
        ctx.shadowColor = 'rgba(180,230,255,0.5)';
        ctx.shadowBlur = 12 + beamPulse * 6;
        ctx.beginPath();
        ctx.roundRect(cx - 3, cy - H, 6, H, 3);
        ctx.fill();
        ctx.shadowBlur = 0;
        for (let i = 0; i < 5; i++) {
            const tOff = (beamTime * 0.5 + i / 5) % 1;
            const py = cy - tOff * H;
            const pxOff = Math.sin(tOff * Math.PI * 3 + i) * 3;
            const dotA = 0.7 * (1 - tOff) + beamPulse * 0.2;
            ctx.fillStyle = `rgba(255,250,235,${dotA})`;
            ctx.shadowColor = 'rgba(200,230,255,0.6)';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(cx + pxOff, py, 2 + (1 - tOff) * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        for (let s = 0; s < 5; s++) {
            const a = beamTime * 0.7 + (s / 5) * Math.PI * 2;
            const r = 6 + beamPulse * 8 + s * 3;
            const px = cx + Math.cos(a) * r;
            const py = cy - H + Math.sin(a) * r * 0.35;
            const sAlpha = 0.5 + beamPulse * 0.3 - s * 0.08;
            ctx.fillStyle = `rgba(255,245,235,${Math.max(0, sAlpha)})`;
            ctx.shadowColor = 'rgba(200,230,255,0.5)';
            ctx.shadowBlur = 8;
            ctx.font = '10px serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('✦', px, py);
        }
        ctx.restore();
    }
}

export function register() {
    registerFxLayer('ground', (c, now) => _drawStarlightField(now), 30);
    // 原版在天气粒子之后有第二次力场覆绘，雨雾天星光不被天气粒子盖住
    registerFxLayer('weatherOverlay', (c, now) => _drawStarlightField(now));
    registerFxLayer('aboveUnits', (c, now) => _drawStarlightBeam(now));
}
