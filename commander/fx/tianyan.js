import { HEX_SIZE, hexPath, drawHexagonOutline } from '../../js/config.js';
import { gameState, getViewingCamp } from '../../js/state.js';
import { isTileVisible } from '../../js/fogOfWar.js';
import { getTransparentPortrait } from '../../js/portraitLoader.js';
import { registerFxLayer, registerFxListener, registerFxUpdate } from '../../js/fxRegistry.js';
import { DRONE_SIGNAL_RANGE } from '../tianyan.js';

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
        if (u && u.commander === 'tianyan' && u.hp > 0 && _isUnitVisible(tile)) out.push({ tile, unit: u });
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

function _drawPennantScan(ctx2d, unit, vx, vy, now) {
    const portrait = getTransparentPortrait(unit.commander);
    const iw = portrait && (portrait.naturalWidth || portrait.width);
    const ih = portrait && (portrait.naturalHeight || portrait.height);
    if (!iw || !ih) return;

    const pw = 55;
    const ph = pw * (ih / iw);
    const cutIn = 16;
    const pointExtend = 7;
    const pX = vx - pw / 2;
    const pY = vy - ph - 14;
    const scanY = pY - 8 + ((now / 18 + unit.id * 7) % (ph + 24));

    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.moveTo(pX, pY);
    ctx2d.lineTo(pX + pw, pY);
    ctx2d.lineTo(pX + pw, pY + ph - cutIn);
    ctx2d.lineTo(pX + pw / 2, pY + ph + pointExtend);
    ctx2d.lineTo(pX, pY + ph - cutIn);
    ctx2d.closePath();
    ctx2d.clip();

    const lineGrad = ctx2d.createLinearGradient(pX, scanY, pX + pw, scanY);
    lineGrad.addColorStop(0, 'rgba(70,190,255,0)');
    lineGrad.addColorStop(0.5, 'rgba(170,235,255,0.42)');
    lineGrad.addColorStop(1, 'rgba(70,190,255,0)');
    ctx2d.fillStyle = lineGrad;
    ctx2d.shadowColor = 'rgba(120,220,255,0.6)';
    ctx2d.shadowBlur = 8;
    ctx2d.fillRect(pX, scanY, pw, 3.5);

    ctx2d.globalAlpha = 0.12;
    ctx2d.fillStyle = '#58caff';
    for (let y = pY + 4; y < pY + ph; y += 7) ctx2d.fillRect(pX, y, pw, 1);
    ctx2d.restore();

    ctx2d.save();
    ctx2d.globalAlpha = 0.25 + 0.08 * Math.sin(now / 420);
    ctx2d.strokeStyle = 'rgba(120,220,255,0.85)';
    ctx2d.shadowColor = 'rgba(70,180,255,0.6)';
    ctx2d.shadowBlur = 10;
    ctx2d.lineWidth = 0.9;
    ctx2d.beginPath();
    ctx2d.moveTo(pX, pY + ph - cutIn);
    ctx2d.lineTo(pX + pw / 2, pY + ph + pointExtend);
    ctx2d.lineTo(pX + pw, pY + ph - cutIn);
    ctx2d.stroke();
    ctx2d.restore();
}

function _drawTianyanRadar(ctx2d, now) {
    const time = now / 1000;
    for (const { unit } of _visibleTianyans()) {
        const pos = unit.getVisualPos ? unit.getVisualPos() : unit.tile;
        const vx = pos.x, vy = pos.y;
        const pulse = (Math.sin(time * 2.1) + 1) / 2;

        ctx2d.save();
        ctx2d.globalAlpha = 0.42 + pulse * 0.12;
        ctx2d.shadowColor = 'rgba(75,190,255,0.65)';
        ctx2d.shadowBlur = 12 + pulse * 5;
        drawHexagonOutline(ctx2d, vx, vy, HEX_SIZE + 5 + pulse * 2, `rgba(100,210,255,${0.18 + pulse * 0.18})`, 1.6);
        ctx2d.setLineDash([5, 6]);
        drawHexagonOutline(ctx2d, vx, vy, HEX_SIZE * 0.74, `rgba(170,235,255,${0.18 + pulse * 0.15})`, 1.1);
        ctx2d.setLineDash([]);

        const sweepA = time * 1.7;
        const r = HEX_SIZE + 8;
        ctx2d.beginPath();
        ctx2d.moveTo(vx, vy);
        ctx2d.arc(vx, vy, r, sweepA - 0.18, sweepA + 0.18);
        ctx2d.closePath();
        const sweep = ctx2d.createRadialGradient(vx, vy, 0, vx, vy, r);
        sweep.addColorStop(0, 'rgba(120,220,255,0.16)');
        sweep.addColorStop(1, 'rgba(120,220,255,0)');
        ctx2d.fillStyle = sweep;
        ctx2d.fill();
        ctx2d.restore();

        _drawPennantScan(ctx2d, unit, vx, vy, now);
    }
}

function _drawDroneLineIcon(ctx2d, x, y, size, alpha) {
    ctx2d.save();
    ctx2d.translate(x, y);
    ctx2d.globalAlpha = alpha;
    ctx2d.strokeStyle = 'rgba(190,240,255,0.95)';
    ctx2d.fillStyle = 'rgba(120,215,255,0.75)';
    ctx2d.lineWidth = Math.max(1, size * 0.08);
    ctx2d.lineCap = 'round';
    ctx2d.lineJoin = 'round';

    const r = size * 0.35;
    ctx2d.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 3;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        if (i === 0) ctx2d.moveTo(px, py);
        else ctx2d.lineTo(px, py);
    }
    ctx2d.closePath();
    ctx2d.stroke();

    ctx2d.beginPath();
    ctx2d.moveTo(0, -size * 0.34);
    ctx2d.lineTo(size * 0.15, -size * 0.05);
    ctx2d.lineTo(size * 0.43, size * 0.06);
    ctx2d.moveTo(0, -size * 0.34);
    ctx2d.lineTo(-size * 0.15, -size * 0.05);
    ctx2d.lineTo(-size * 0.43, size * 0.06);
    ctx2d.moveTo(0, -size * 0.28);
    ctx2d.lineTo(0, size * 0.34);
    ctx2d.moveTo(-size * 0.22, size * 0.27);
    ctx2d.lineTo(size * 0.22, size * 0.27);
    ctx2d.stroke();

    ctx2d.beginPath();
    ctx2d.arc(-size * 0.43, size * 0.06, size * 0.075, 0, Math.PI * 2);
    ctx2d.arc(size * 0.43, size * 0.06, size * 0.075, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.restore();
}

function _drawScanNoise(ctx2d, radius, time, seed, alpha = 1) {
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.arc(0, 0, radius, 0, Math.PI * 2);
    ctx2d.clip();
    const flicker = Math.floor(time * 32 + seed) % 5;
    for (let y = -radius; y <= radius; y += 4) {
        const a = (0.05 + ((y + flicker) % 9 === 0 ? 0.13 : 0.045)) * alpha;
        ctx2d.fillStyle = `rgba(150,230,255,${a})`;
        ctx2d.fillRect(-radius, y + flicker * 0.45, radius * 2, 1.2);
    }
    for (let i = 0; i < 12; i++) {
        const n = Math.sin(seed * 12.9898 + i * 78.233 + Math.floor(time * 24) * 4.3) * 43758.5453;
        const f = n - Math.floor(n);
        const px = (f * 2 - 1) * radius;
        const py = (((f * 7.17) % 1) * 2 - 1) * radius;
        if (px * px + py * py > radius * radius) continue;
        ctx2d.fillStyle = `rgba(210,245,255,${0.08 * alpha})`;
        ctx2d.fillRect(px, py, 1.2, 1.2);
    }
    ctx2d.restore();
}

function _drawDroneBadge(ctx2d, x, y, unit, now, opts = {}) {
    const time = now / 1000;
    const scale = opts.scale || 1;
    const alpha = opts.alpha == null ? 1 : opts.alpha;
    const floatY = opts.float === false ? 0 : Math.sin(time * 2.5) * 3;
    const disoriented = !!(unit && unit._disoriented);
    const coreAlpha = alpha * (disoriented ? 0.62 : 1);
    const badgeR = 13.2 * scale;

    ctx2d.save();
    ctx2d.translate(x, y);
    ctx2d.globalAlpha = coreAlpha;

    if (opts.particles !== false) {
        const orbitR = 20 * scale;
        for (let i = 0; i < 10; i++) {
            const a = time * 1.45 + i * Math.PI * 2 / 10;
            const px = Math.cos(a) * orbitR;
            const py = Math.sin(a) * orbitR * 0.68;
            const front = Math.sin(a) > 0 ? 1 : 0.65;
            ctx2d.globalAlpha = coreAlpha * (0.28 + front * 0.22);
            ctx2d.fillStyle = i % 3 === 0 ? '#d8f6ff' : '#71d7ff';
            ctx2d.shadowColor = 'rgba(90,200,255,0.8)';
            ctx2d.shadowBlur = 6 * scale;
            ctx2d.beginPath();
            ctx2d.arc(px, py, (1.25 + (i % 2) * 0.45) * scale, 0, Math.PI * 2);
            ctx2d.fill();
        }
    }

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

    ctx2d.save();
    ctx2d.translate(0, floatY);
    _drawScanNoise(ctx2d, badgeR - 1.5 * scale, time, unit ? unit.id : 7, coreAlpha);
    ctx2d.shadowBlur = 8 * scale;
    ctx2d.shadowColor = 'rgba(140,225,255,0.9)';
    _drawDroneLineIcon(ctx2d, 0, 0, 24 * scale, coreAlpha);
    ctx2d.restore();

    ctx2d.globalAlpha = coreAlpha * 0.5;
    ctx2d.setLineDash([4 * scale, 4 * scale]);
    ctx2d.lineDashOffset = -time * 18;
    ctx2d.strokeStyle = 'rgba(130,225,255,0.7)';
    ctx2d.lineWidth = 1 * scale;
    ctx2d.beginPath();
    ctx2d.arc(0, 0, badgeR + 4 * scale, 0, Math.PI * 2);
    ctx2d.stroke();
    ctx2d.setLineDash([]);

    ctx2d.restore();
}

function _drawDroneBadges(ctx2d, now) {
    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || !u._isDrone || u.hp <= 0 || !_isUnitVisible(tile)) continue;
        const pos = u.getVisualPos ? u.getVisualPos() : tile;
        _drawDroneBadge(ctx2d, pos.x, pos.y + 1, u, now);
    }
}

function _drawHologramRing(ctx2d, fx, elapsed, now) {
    const p = clamp01(elapsed / 500);
    const ep = easeOutCubic(p);
    const r = HEX_SIZE * (0.12 + ep * 0.94);
    const alpha = elapsed < 760 ? 0.78 : Math.max(0, 0.78 * (1 - (elapsed - 760) / 320));

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

        const hexAppear = easeOutCubic((elapsed - 160) / 260);
        const condense = easeInOut((elapsed - 470) / 360);
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

        const badgeP = easeOutCubic((elapsed - 560) / 320);
        if (badgeP > 0) {
            const pop = 0.45 + badgeP * 0.72 + Math.sin(Math.min(1, badgeP) * Math.PI) * 0.08;
            _drawDroneBadge(ctx2d, fx.x, fx.y + 1, { id: fx.unitId || 11 }, now, {
                scale: pop,
                alpha: Math.min(1, badgeP) * (1 - Math.max(0, t - 0.88) / 0.12),
                particles: true
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
    registerFxLayer('underUnits', _drawTianyanRadar, 20);
    registerFxLayer('aboveUnits', _drawDroneBadges, 45);
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
            duration: 1180
        });
    });
    registerFxUpdate(_updateDeployEffects);
}
