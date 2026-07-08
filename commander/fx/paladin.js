// 圣骑士全套视觉模块：勇气灵光光环 + 誓言金色光束 + 环绕剑 + 至圣斩弹射
import { HEX_SIZE, HEX_NEIGHBORS, drawHexagonOutline, hexPath, settings, ctx } from '../../js/config.js';
import { gameState } from '../../js/state.js';
import { VisualParticle, particles, attackFlashes, goldenBeams, paladinOrbitBeams, paladinBeamProjectiles } from '../../js/effects.js';
import { registerFxLayer, registerFxUpdate } from '../../js/fxRegistry.js';

// ===== 勇气灵光环（ground 图层） =====
function _drawCourageAura(now) {
    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u) continue;
        const pos = u.getVisualPos();
        const vx = pos.x, vy = pos.y;
        if (u.commander === 'paladin') {
            ctx.save();
            const cp = (Math.sin(now / 400) + 1) / 2;
            const g = ctx.createRadialGradient(vx, vy, HEX_SIZE * 0.15, vx, vy, HEX_SIZE);
            g.addColorStop(0, 'rgba(255,215,0,0)');
            g.addColorStop(0.5, `rgba(255,215,0,${0.03 + cp * 0.05})`);
            g.addColorStop(1, `rgba(255,215,0,${0.12 + cp * 0.14})`);
            ctx.fillStyle = g; hexPath(ctx, vx, vy, HEX_SIZE); ctx.fill();
            const ca = 0.30 + cp * 0.40;
            ctx.shadowColor = `rgba(255,215,0,${ca * 0.8})`; ctx.shadowBlur = 16;
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 2, `rgba(255,215,0,${ca})`, 3.5);
            ctx.restore();
        } else if (u.camp && gameState.tileMap) {
            let hasPaladin = false;
            for (const [dq, dr] of HEX_NEIGHBORS) {
                const nb = gameState.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                if (nb && nb.unit && nb.unit.commander === 'paladin' && nb.unit.camp === u.camp) {
                    hasPaladin = true; break;
                }
            }
            if (hasPaladin) {
                ctx.save();
                const cp = (Math.sin(now / 400) + 1) / 2;
                const ca = 0.22 + cp * 0.30;
                ctx.shadowColor = `rgba(255,215,0,${ca * 0.6})`; ctx.shadowBlur = 10;
                drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 1, `rgba(255,215,0,${ca})`, 2.5);
                ctx.restore();
            }
        }
    }
}

// ===== 金色誓言 beam =====
function _updateGoldenBeams(now) {
    for (let i = goldenBeams.length - 1; i >= 0; i--) {
        if (now - goldenBeams[i].startTime > goldenBeams[i].duration) goldenBeams.splice(i, 1);
    }
}

function _drawGoldenBeams(ctx2d, now) {
    for (const b of goldenBeams) {
        const elapsed = now - b.startTime;
        const alpha = elapsed < 80 ? elapsed / 80 : Math.max(0, 1 - (elapsed - 80) / (b.duration - 80));
        ctx2d.save();
        ctx2d.globalAlpha = alpha;
        ctx2d.strokeStyle = '#ffd700'; ctx2d.lineWidth = 5; ctx2d.shadowColor = '#ffd700'; ctx2d.shadowBlur = 18;
        ctx2d.beginPath(); ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
        for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
        ctx2d.stroke();
        ctx2d.strokeStyle = '#ffee88'; ctx2d.lineWidth = 2.5; ctx2d.shadowColor = '#ffee88'; ctx2d.shadowBlur = 8;
        ctx2d.beginPath(); ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
        for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
        ctx2d.stroke();
        ctx2d.strokeStyle = '#ffffff'; ctx2d.lineWidth = 1.2; ctx2d.shadowBlur = 0;
        ctx2d.beginPath(); ctx2d.moveTo(b.segments[0].x1, b.segments[0].y1);
        for (const seg of b.segments) ctx2d.lineTo(seg.x2, seg.y2);
        ctx2d.stroke();
        ctx2d.restore();
    }
}

// ===== 环绕剑 =====
function _updateOrbitBeams(now, getUnitPos) {
    for (let i = paladinOrbitBeams.length - 1; i >= 0; i--) {
        const b = paladinOrbitBeams[i];
        const pos = getUnitPos ? getUnitPos(b.unitId) : null;
        if (!pos) { paladinOrbitBeams.splice(i, 1); continue; }
        b.x = pos.x; b.y = pos.y;
        b.angle += b.orbitSpeed * 0.016;
    }
}

function _drawOrbitSword(ctx2d, b, now) {
    const elapsed = (now - b.startTime) / 1000;
    const cx = b.x + Math.cos(b.angle) * b.orbitRadius;
    const cy = b.y + Math.sin(b.angle) * b.orbitRadius * 0.5 - Math.sin(elapsed * 1.8) * 6;
    const hw = b.size * 0.16, bladeLen = b.size * 0.85;
    const tipY = cy + bladeLen * 0.55, guardY = cy - bladeLen * 0.15, pommelY = cy - bladeLen * 0.45;
    ctx2d.save();
    ctx2d.shadowColor = '#ffd700'; ctx2d.shadowBlur = 10;
    ctx2d.fillStyle = '#ffd700';
    ctx2d.beginPath();
    ctx2d.moveTo(cx, tipY);
    ctx2d.lineTo(cx + hw, guardY + hw * 0.4); ctx2d.lineTo(cx + hw * 0.5, guardY);
    ctx2d.lineTo(cx + hw * 0.3, pommelY); ctx2d.lineTo(cx - hw * 0.3, pommelY);
    ctx2d.lineTo(cx - hw * 0.5, guardY); ctx2d.lineTo(cx - hw, guardY + hw * 0.4);
    ctx2d.closePath(); ctx2d.fill();
    ctx2d.fillStyle = '#ffe055';
    ctx2d.fillRect(cx - hw * 1.4, guardY - hw * 0.25, hw * 2.8, hw * 0.5);
    ctx2d.shadowBlur = 0;
    ctx2d.fillStyle = '#ffffff';
    ctx2d.beginPath();
    ctx2d.moveTo(cx, tipY - hw * 0.3); ctx2d.lineTo(cx + hw * 0.12, guardY + hw * 0.15);
    ctx2d.lineTo(cx, guardY - hw * 0.1); ctx2d.lineTo(cx - hw * 0.12, guardY + hw * 0.15);
    ctx2d.closePath(); ctx2d.fill();
    ctx2d.beginPath(); ctx2d.arc(cx, pommelY, hw * 0.5, 0, Math.PI * 2); ctx2d.fill();
    ctx2d.restore();
}

function _drawOrbitPass(ctx2d, now, pass) {
    for (const b of paladinOrbitBeams) {
        const elapsed = (now - b.startTime) / 1000;
        const cy = b.y + Math.sin(b.angle) * b.orbitRadius * 0.5 - Math.sin(elapsed * 1.8) * 6;
        if ((pass === 'front') !== (cy >= b.y)) continue;
        _drawOrbitSword(ctx2d, b, now);
    }
}

// ===== 至圣斩弹射飞剑 =====
function _updateBeamProjectiles(now) {
    for (let i = paladinBeamProjectiles.length - 1; i >= 0; i--) {
        if (now - paladinBeamProjectiles[i].startTime > paladinBeamProjectiles[i].duration + 300) {
            paladinBeamProjectiles.splice(i, 1);
        }
    }
}

function _drawBeamProjectiles(ctx2d, now) {
    for (const p of paladinBeamProjectiles) {
        const elapsed = now - p.startTime;
        const t = Math.min(1, Math.max(0, elapsed / p.duration));
        const eased = 1 - Math.pow(1 - t, 2);
        const dx = p.toX - p.fromX, dy = p.toY - p.fromY;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const baseAngle = Math.atan2(dy, dx);
        const flightAngle = baseAngle + p.angleOff * (1 - t);
        const curX = p.fromX + dx * eased;
        const curY = p.fromY + dy * eased - Math.sin(t * Math.PI) * dist * 0.12;
        const s = 26;
        for (let j = 0; j < 6; j++) {
            const backT = Math.max(0, t - (0.015 + j * 0.04));
            if (backT <= 0) continue;
            const be = 1 - Math.pow(1 - backT, 2);
            const tx = p.fromX + dx * be, ty = p.fromY + dy * be - Math.sin(backT * Math.PI) * dist * 0.12;
            const ta = 0.5 - j * 0.07;
            if (ta <= 0) continue;
            ctx2d.save();
            ctx2d.globalAlpha = ta;
            ctx2d.fillStyle = j <= 1 ? '#ffffff' : '#ffd700';
            ctx2d.shadowColor = '#ffd700'; ctx2d.shadowBlur = 6;
            ctx2d.beginPath(); ctx2d.arc(tx, ty, 2.5 - j * 0.25, 0, Math.PI * 2); ctx2d.fill();
            ctx2d.restore();
        }
        ctx2d.save();
        ctx2d.translate(curX, curY); ctx2d.rotate(flightAngle);
        const hw = s * 0.16, bladeLen = s * 0.85;
        const tipX = bladeLen * 0.55, guardX = -bladeLen * 0.15, pommelX = -bladeLen * 0.45;
        ctx2d.shadowColor = '#ffd700'; ctx2d.shadowBlur = 10;
        ctx2d.fillStyle = '#ffd700';
        ctx2d.beginPath();
        ctx2d.moveTo(tipX, 0); ctx2d.lineTo(guardX + hw * 0.4, -hw); ctx2d.lineTo(guardX, -hw * 0.5);
        ctx2d.lineTo(pommelX, -hw * 0.3); ctx2d.lineTo(pommelX, hw * 0.3);
        ctx2d.lineTo(guardX, hw * 0.5); ctx2d.lineTo(guardX + hw * 0.4, hw);
        ctx2d.closePath(); ctx2d.fill();
        ctx2d.fillStyle = '#ffe055';
        ctx2d.fillRect(guardX - hw * 0.25, -hw * 1.4, hw * 0.5, hw * 2.8);
        ctx2d.shadowBlur = 0;
        ctx2d.fillStyle = '#ffffff';
        ctx2d.beginPath();
        ctx2d.moveTo(tipX - hw * 0.3, 0); ctx2d.lineTo(guardX + hw * 0.15, -hw * 0.15);
        ctx2d.lineTo(guardX - hw * 0.1, 0); ctx2d.lineTo(guardX + hw * 0.15, hw * 0.15);
        ctx2d.closePath(); ctx2d.fill();
        ctx2d.beginPath(); ctx2d.arc(pommelX, 0, hw * 0.5, 0, Math.PI * 2); ctx2d.fill();
        ctx2d.restore();
        if (t >= 0.88 && !p.impactSpawned) {
            p.impactSpawned = true;
            const n2 = Math.round(20 * settings.particleDensity);
            for (let k = 0; k < n2; k++) {
                const a = Math.random() * Math.PI * 2;
                const spd = 80 + Math.random() * 220;
                particles.push(new VisualParticle(p.toX, p.toY,
                    Math.cos(a) * spd, Math.sin(a) * spd * 0.7 - 30 - Math.random() * 40,
                    Math.random() < 0.3 ? '#ffffff' : '#ffd700', 1.5 + Math.random() * 3,
                    0.2 + Math.random() * 0.4, 80 + Math.random() * 120));
            }
            // 至圣斩命中扩散环 — 亮金色波纹
            attackFlashes.push({ x: p.toX, y: p.toY, startTime: performance.now(), duration: 300, maxRadius: HEX_SIZE * 1.6, isCrit: false });
        }
    }
}

// 环绕剑跟随单位（原 renderer 每帧传入的位置解析器）
function _resolveUnitPos(unitId) {
    for (const tile of gameState.tiles) {
        if (tile.unit && tile.unit.id === unitId) return { x: tile.x, y: tile.y };
    }
    return null;
}

export function register() {
    // 勇气灵光（原 drawUnitHexAuras 分支，立绘之前）
    registerFxLayer('ground', (c, now) => _drawCourageAura(now), 42);
    // 环绕剑后半圈（立绘之后、单位徽章之前）/ 前半圈（技能特效之后）
    registerFxLayer('underUnits', (c, now) => _drawOrbitPass(c, now, 'back'));
    registerFxLayer('overSkillFx', (c, now) => _drawOrbitPass(c, now, 'front'));
    // 至圣斩弹射飞剑（通用弹道之后、近战斩击之前）
    registerFxLayer('projectiles', _drawBeamProjectiles);
    // 誓言金色光束（雷击之后、迷雾遮罩之前）
    registerFxLayer('preFog', _drawGoldenBeams, 20);
    registerFxUpdate((dt, now) => {
        _updateOrbitBeams(now, _resolveUnitPos);
        _updateGoldenBeams(now);
        _updateBeamProjectiles(now);
    });
}
