import { HEX_SIZE, hexPath } from '../../js/config.js';
import { gameState, getViewingCamp } from '../../js/state.js';
import { isTileVisible } from '../../js/fogOfWar.js';
import { registerFxLayer, registerFxListener, registerFxUpdate } from '../../js/fxRegistry.js';
import { DRONE_SIGNAL_RANGE } from '../tianyan.js';
import { areCommanderMechanicsSuppressed } from '../../rules/movement.js';

const deployEffects = [];

const clamp01 = v => Math.max(0, Math.min(1, v));
const easeOutCubic = t => 1 - Math.pow(1 - clamp01(t), 3);
const easeInOut = t => {
    t = clamp01(t);
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
};

function _isUnitVisible(tile) {
    if (!tile) return false;
    if (!gameState.skirmishFog) return true;
    return isTileVisible(tile, getViewingCamp(), gameState);
}

function _visibleTianyans() {
    const out = [];
    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (u && u.commander === 'tianyan' && !areCommanderMechanicsSuppressed(u) && u.hp > 0 && _isUnitVisible(tile)) out.push({ tile, unit: u });
    }
    return out;
}

function _strokeHexRegionBorder(ctx2d, tiles, insideFn, now, outer, inner) {
    const NB = [[1, 0, 0], [0, 1, 1], [-1, 1, 2], [-1, 0, 3], [0, -1, 4], [1, -1, 5]];
    ctx2d.save();
    ctx2d.beginPath();
    for (const ht of tiles) {
        for (const [dq, dr, edge] of NB) {
            const nq = ht.q + dq, nr = ht.r + dr;
            if (!gameState.tileMap.has(`${nq},${nr}`)) continue;
            if (insideFn(nq, nr)) continue;
            const a0 = (Math.PI / 180) * (60 * edge - 30);
            const a1 = (Math.PI / 180) * (60 * (edge + 1) - 30);
            ctx2d.moveTo(ht.x + HEX_SIZE * Math.cos(a0), ht.y + HEX_SIZE * Math.sin(a0));
            ctx2d.lineTo(ht.x + HEX_SIZE * Math.cos(a1), ht.y + HEX_SIZE * Math.sin(a1));
        }
    }
    ctx2d.lineJoin = 'round';
    ctx2d.lineCap = 'round';
    ctx2d.setLineDash([14, 9]);
    ctx2d.lineDashOffset = -(now / 22) % 23;
    ctx2d.strokeStyle = outer.color;
    ctx2d.lineWidth = outer.w;
    ctx2d.shadowColor = outer.glow;
    ctx2d.shadowBlur = outer.blur;
    ctx2d.stroke();
    if (inner) {
        ctx2d.strokeStyle = inner.color;
        ctx2d.lineWidth = inner.w;
        ctx2d.shadowBlur = 0;
        ctx2d.stroke();
    }
    ctx2d.setLineDash([]);
    ctx2d.restore();
}

function _drawSignalRanges(ctx2d, now) {
    const pulse = (Math.sin(now / 300) + 1) / 2;
    for (const { tile } of _visibleTianyans()) {
        const cq = tile.q, cr = tile.r;
        const rangeTiles = [];
        for (let dq = -DRONE_SIGNAL_RANGE; dq <= DRONE_SIGNAL_RANGE; dq++) {
            for (let dr = Math.max(-DRONE_SIGNAL_RANGE, -dq - DRONE_SIGNAL_RANGE); dr <= Math.min(DRONE_SIGNAL_RANGE, -dq + DRONE_SIGNAL_RANGE); dr++) {
                const ht = gameState.tileMap.get(`${cq + dq},${cr + dr}`);
                if (ht) rangeTiles.push(ht);
            }
        }
        const inRangeFn = (q, r) => Math.max(Math.abs(q - cq), Math.abs(r - cr), Math.abs((q + r) - (cq + cr))) <= DRONE_SIGNAL_RANGE;
        _strokeHexRegionBorder(ctx2d, rangeTiles, inRangeFn, now,
            { color: `rgba(120,200,255,${0.62 + pulse * 0.13})`, w: 2.6, glow: 'rgba(90,180,255,0.55)', blur: 7 + pulse * 4 },
            { color: `rgba(230,245,255,${0.4 + pulse * 0.2})`, w: 1 });
    }
}

function _drawTianyanRadar(ctx2d, now) {
    const time = now / 1000;
    for (const { unit } of _visibleTianyans()) {
        const pos = unit.getVisualPos ? unit.getVisualPos() : unit.tile;
        const vx = pos.x, vy = pos.y;
        const seed = (Number(unit.id) || 0) * 0.37;
        const pulse = (Math.sin(time * 3.2 + seed) + 1) / 2;
        const radarR = HEX_SIZE + 12 + pulse * 2;
        const innerR = HEX_SIZE * 0.56;
        const sweepA = time * 3.1 + seed;
        const sweepHead = sweepA + 0.08;
        const ping = (time * 1.45 + seed) % 1;
        const pingR = HEX_SIZE * (0.34 + ping * 0.88);

        ctx2d.save();
        ctx2d.shadowColor = 'rgba(80,205,255,0.65)';
        ctx2d.shadowBlur = 14 + pulse * 5;
        const halo = ctx2d.createRadialGradient(vx, vy, 0, vx, vy, radarR);
        halo.addColorStop(0, `rgba(120,220,255,${0.16 + pulse * 0.04})`);
        halo.addColorStop(0.42, `rgba(95,205,255,${0.08 + pulse * 0.03})`);
        halo.addColorStop(0.72, 'rgba(85,190,255,0.035)');
        halo.addColorStop(1, 'rgba(80,180,255,0)');
        ctx2d.fillStyle = halo;
        ctx2d.beginPath();
        ctx2d.arc(vx, vy, radarR, 0, Math.PI * 2);
        ctx2d.fill();

        ctx2d.shadowBlur = 8;
        ctx2d.strokeStyle = `rgba(205,245,255,${0.30 + pulse * 0.18})`;
        ctx2d.lineWidth = 1.2;
        ctx2d.beginPath();
        ctx2d.arc(vx, vy, innerR, 0, Math.PI * 2);
        ctx2d.stroke();

        ctx2d.globalAlpha = 0.55 * (1 - ping);
        ctx2d.strokeStyle = 'rgba(135,230,255,0.92)';
        ctx2d.lineWidth = 1.8 * (1 - ping) + 0.7;
        ctx2d.beginPath();
        ctx2d.arc(vx, vy, pingR, 0, Math.PI * 2);
        ctx2d.stroke();
        ctx2d.globalAlpha = 1;

        ctx2d.beginPath();
        ctx2d.moveTo(vx, vy);
        ctx2d.arc(vx, vy, radarR, sweepHead - 0.36, sweepHead);
        ctx2d.closePath();
        const sweep = ctx2d.createRadialGradient(vx, vy, 0, vx, vy, radarR);
        sweep.addColorStop(0, 'rgba(145,230,255,0.18)');
        sweep.addColorStop(0.42, 'rgba(110,215,255,0.10)');
        sweep.addColorStop(0.76, 'rgba(100,200,255,0.03)');
        sweep.addColorStop(1, 'rgba(120,220,255,0)');
        ctx2d.fillStyle = sweep;
        ctx2d.fill();

        for (let i = 6; i >= 0; i--) {
            const k = 1 - i / 6;
            const a = sweepHead - i * 0.045;
            const ray = ctx2d.createLinearGradient(
                vx,
                vy,
                vx + Math.cos(a) * radarR,
                vy + Math.sin(a) * radarR
            );
            const headAlpha = 0.08 + k * 0.64;
            ray.addColorStop(0, `rgba(220,250,255,${headAlpha})`);
            ray.addColorStop(0.58, `rgba(165,230,255,${headAlpha * 0.45})`);
            ray.addColorStop(1, 'rgba(145,220,255,0)');
            ctx2d.strokeStyle = ray;
            ctx2d.lineWidth = 1 + k * 0.7;
            ctx2d.beginPath();
            ctx2d.moveTo(vx, vy);
            ctx2d.lineTo(vx + Math.cos(a) * radarR, vy + Math.sin(a) * radarR);
            ctx2d.stroke();
        }

        ctx2d.fillStyle = 'rgba(190,240,255,0.9)';
        ctx2d.shadowBlur = 10;
        ctx2d.beginPath();
        ctx2d.arc(vx, vy, 2.2, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.restore();
    }
}

function _drawDronePlaneIcon(ctx2d, x, y, size, alpha) {
    ctx2d.save();
    ctx2d.translate(x, y);
    ctx2d.globalAlpha = alpha;
    ctx2d.fillStyle = '#edfaff';
    ctx2d.font = `bold ${Math.round(size)}px "Segoe UI Symbol", "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx2d.textAlign = 'center';
    ctx2d.textBaseline = 'middle';
    ctx2d.shadowColor = 'rgba(150,230,255,0.9)';
    ctx2d.shadowBlur = 8;
    ctx2d.fillText('✈', 0, 1);
    ctx2d.restore();
}

function _drawDroneBadge(ctx2d, x, y, unit, now, opts = {}) {
    const time = now / 1000;
    const scale = opts.scale || 1;
    const alpha = opts.alpha == null ? 1 : opts.alpha;
    const floatY = opts.float === false ? 0 : Math.sin(time * 2.5) * 3;
    const disoriented = !!(unit && unit.morale === 0);
    const coreAlpha = alpha * (disoriented ? 0.62 : 1);
    const badgeR = 13.2 * scale;

    ctx2d.save();
    ctx2d.translate(x, y + floatY);
    ctx2d.globalAlpha = coreAlpha;

    ctx2d.globalAlpha = coreAlpha;
    ctx2d.shadowColor = 'rgba(50,180,255,0.75)';
    ctx2d.shadowBlur = 14 * scale;
    ctx2d.beginPath();
    ctx2d.arc(0, 0, badgeR, 0, Math.PI * 2);
    const grad = ctx2d.createRadialGradient(-badgeR * 0.25, -badgeR * 0.35, 0, 0, 0, badgeR);
    grad.addColorStop(0, 'rgba(60,130,170,0.92)');
    grad.addColorStop(0.45, 'rgba(17,54,84,0.94)');
    grad.addColorStop(1, 'rgba(5,14,29,0.98)');
    ctx2d.fillStyle = grad;
    ctx2d.fill();
    ctx2d.strokeStyle = `rgba(120,220,255,${0.72 * coreAlpha})`;
    ctx2d.lineWidth = 1.2 * scale;
    ctx2d.stroke();

    ctx2d.shadowBlur = 8 * scale;
    ctx2d.shadowColor = 'rgba(140,225,255,0.9)';
    _drawDronePlaneIcon(ctx2d, 0, 0, 20 * scale, coreAlpha);

    ctx2d.restore();
}

function _drawHologramRing(ctx2d, fx, elapsed, now) {
    const p = clamp01(elapsed / 500);
    const ep = easeOutCubic(p);
    const r = HEX_SIZE * (0.12 + ep * 0.94);
    const alpha = elapsed < 520 ? 0.78 : Math.max(0, 0.78 * (1 - (elapsed - 520) / 180));

    ctx2d.save();
    ctx2d.translate(fx.x, fx.y);
    ctx2d.globalAlpha = alpha;
    ctx2d.scale(1, 0.58);
    ctx2d.shadowColor = 'rgba(90,200,255,0.9)';
    ctx2d.shadowBlur = 18;
    ctx2d.strokeStyle = `rgba(100,210,255,${0.68 + 0.2 * Math.sin(now / 70)})`;
    ctx2d.lineWidth = 2.4;
    ctx2d.setLineDash([10, 7]);
    ctx2d.lineDashOffset = -now / 18;
    ctx2d.beginPath();
    ctx2d.arc(0, 0, r, 0, Math.PI * 2);
    ctx2d.stroke();
    ctx2d.setLineDash([]);
    ctx2d.globalAlpha = alpha * 0.22;
    const fill = ctx2d.createRadialGradient(0, 0, 0, 0, 0, r);
    fill.addColorStop(0, 'rgba(80,200,255,0)');
    fill.addColorStop(0.75, 'rgba(80,200,255,0.18)');
    fill.addColorStop(1, 'rgba(80,200,255,0)');
    ctx2d.fillStyle = fill;
    ctx2d.beginPath();
    ctx2d.arc(0, 0, r, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.restore();
}

function _drawDeployEffects(ctx2d, now) {
    for (const fx of deployEffects) {
        const elapsed = now - fx.startTime;
        const t = clamp01(elapsed / fx.duration);
        _drawHologramRing(ctx2d, fx, elapsed, now);

        const hexAppear = easeOutCubic((elapsed - 80) / 220);
        const condense = easeInOut((elapsed - 280) / 260);
        if (hexAppear > 0 && condense < 1) {
            const alpha = hexAppear * (1 - condense * 0.28);
            const r = HEX_SIZE * 0.72 * (1 - condense) + 15 * condense;
            ctx2d.save();
            ctx2d.globalAlpha = alpha;
            ctx2d.shadowColor = 'rgba(120,220,255,0.85)';
            ctx2d.shadowBlur = 14;
            ctx2d.strokeStyle = 'rgba(170,235,255,0.88)';
            ctx2d.lineWidth = 1.8;
            hexPath(ctx2d, fx.x, fx.y, r);
            ctx2d.stroke();
            ctx2d.globalAlpha = alpha * 0.35;
            hexPath(ctx2d, fx.x, fx.y, r * 0.62);
            ctx2d.stroke();
            for (let i = 0; i < 6; i++) {
                const a = Math.PI / 180 * (60 * i - 30);
                const x0 = fx.x + Math.cos(a) * r * 0.62;
                const y0 = fx.y + Math.sin(a) * r * 0.62;
                const x1 = fx.x + Math.cos(a) * r;
                const y1 = fx.y + Math.sin(a) * r;
                ctx2d.beginPath();
                ctx2d.moveTo(x0, y0);
                ctx2d.lineTo(x1, y1);
                ctx2d.stroke();
            }
            ctx2d.restore();
        }

        const badgeP = easeOutCubic((elapsed - 360) / 180);
        if (badgeP > 0) {
            const pop = 0.45 + badgeP * 0.72 + Math.sin(Math.min(1, badgeP) * Math.PI) * 0.08;
            _drawDroneBadge(ctx2d, fx.x, fx.y + 1, { id: fx.unitId || 11 }, now, {
                scale: pop,
                alpha: Math.min(1, badgeP) * (1 - Math.max(0, t - 0.78) / 0.22)
            });
        }
    }
}

function _updateDeployEffects(dt, now) {
    for (let i = deployEffects.length - 1; i >= 0; i--) {
        if (now - deployEffects[i].startTime > deployEffects[i].duration) deployEffects.splice(i, 1);
    }
}

export function register() {
    registerFxLayer('ground', _drawSignalRanges, 35);
    registerFxLayer('aboveUnits', _drawTianyanRadar, 20);
    registerFxLayer('overSkillFx', _drawDeployEffects, 30);
    registerFxListener('tianyan:droneDeploy', data => {
        if (!data || typeof data.x !== 'number' || typeof data.y !== 'number') return;
        deployEffects.push({
            x: data.x,
            y: data.y,
            q: data.q,
            r: data.r,
            unitId: data.unitId || 0,
            startTime: performance.now(),
            duration: 760
        });
    });
    registerFxUpdate(_updateDeployEffects);
}
