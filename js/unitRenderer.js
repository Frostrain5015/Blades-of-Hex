// Unit canvas rendering and visual interpolation. This module intentionally owns all Canvas/effect imports.
import { HEX_SIZE, ctx, drawHexagonOutline, settings, frameInfo, MORALE_CONFIG, roundRectPath } from './config.js';
import { getCommander } from './commanderInterface.js';
import { isNetworkGame, getMyRole } from './network.js';
import { iconEffects, getRecoilOffset, getChargeOffset } from './effects.js';

import { getRelationToViewer, RELATION_META } from '../rules/diplomacy.js';
import { getRoleCamp } from '../rules/diplomacy.js';
import { campToKey, getFlagColors } from '../rules/camps.js';
import { getSurfaceBaseColor, getTileSurface, isWaterTile } from '../rules/surfaces.js';
import { UNIT_FLAG_LAYOUT } from './flagLayout.js';
import { areCommanderMechanicsSuppressed } from '../rules/movement.js';
import { getUnitStatusIcons } from './unitStatusIcons.js';
import {
    UNIT_BADGE_CENTER_Y,
    UNIT_BADGE_RADIUS,
    UNIT_HUD_OUTER_RADIUS,
    drawUnitBadge,
    resolveUnitBadgeGlyph
} from './unitBadgeRenderer.js';

// Shared read-only visual metrics. Interaction previews must anchor to these
// values instead of duplicating the local badge geometry or adding rule fields
// to Unit/network snapshots.
export { UNIT_BADGE_RADIUS, UNIT_BADGE_CENTER_Y, UNIT_HUD_OUTER_RADIUS };

function isHumanTurn(gameState) {
    if (gameState.campaignMode) return gameState.factions?.[campToKey(gameState.currentCamp)]?.controller === 'human';
    if (isNetworkGame()) {
        return campToKey(gameState.currentCamp) === campToKey(getRoleCamp(gameState, getMyRole()));
    }
    if (gameState.gameMode === 'pve' && gameState.aiOpponentCamp) {
        return campToKey(gameState.currentCamp) !== 'neutral' && gameState.currentCamp !== gameState.aiOpponentCamp;
    }
    return campToKey(gameState.currentCamp) !== 'neutral';
}

export function getUnitVisualPos(unit) {
        const baseX = unit.tile.x, baseY = unit.tile.y;
        let vx = baseX, vy = baseY;

        if (unit.movePath) {
            const path = unit.movePath;
            const elapsed = frameInfo.now - unit.movePathStart;
            if (elapsed >= unit.movePathDuration) {
                vx = path[path.length - 1].x;
                vy = path[path.length - 1].y;
            } else {
                const segs = [];
                let totalLen = 0;
                for (let i = 1; i < path.length; i++) {
                    const dx = path[i].x - path[i-1].x;
                    const dy = path[i].y - path[i-1].y;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    segs.push({ from: path[i-1], to: path[i], len, acc: totalLen });
                    totalLen += len;
                }
                if (totalLen === 0) {
                    vx = baseX; vy = baseY;
                } else {
                    const tTotal = elapsed / unit.movePathDuration;
                    const target = tTotal * totalLen;
                    let found = false;
                    for (const seg of segs) {
                        if (target <= seg.acc + seg.len) {
                            const t = Math.max(0, Math.min(1, (target - seg.acc) / seg.len));
                            const eased = 1 - Math.pow(1 - t, 3);
                            vx = seg.from.x + (seg.to.x - seg.from.x) * eased;
                            vy = seg.from.y + (seg.to.y - seg.from.y) * eased;
                            found = true;
                            break;
                        }
                    }
                    if (!found) { vx = baseX; vy = baseY; }
                }
            }
        }

        // 后坐力偏移（炮兵开火时）
        const recoil = getRecoilOffset(baseX, baseY, frameInfo.now);
        if (recoil) {
            vx += recoil.x;
            vy += recoil.y;
        }

        // 近战突进偏移（撞击目标）
        const charge = getChargeOffset(unit.id, frameInfo.now);
        if (charge) {
            vx += charge.x;
            vy += charge.y;
        }

        return { x: vx, y: vy };
    }

export function startUnitMovePath(unit, path) {
        if (!path || path.length < 2) return;
        unit.movePath = path;
        unit.movePathStart = frameInfo.now;
        unit.movePathDuration = (path.length - 1) * 120 / (settings.animationSpeed || 1);
    }

// Draw after the WebGL cloth composite so the finial always caps the fabric
// instead of being partially covered by it.
export function drawUnitFlagFinial(unit) {
    if (!unit || unit._airdropWaiting || unit.tile.isCity || unit.tile.isVillage || unit.tile.isPort) return;
    const now = frameInfo.now;
    if ((unit._airliftLandAt && now < unit._airliftLandAt)
        || (unit._soulRecallLandAt && now < unit._soulRecallLandAt)) return;
    const pos = getUnitVisualPos(unit);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.beginPath();
    ctx.arc(UNIT_FLAG_LAYOUT.poleX, UNIT_FLAG_LAYOUT.poleTop, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd700';
    ctx.fill();
    ctx.restore();
}

function resolveUnitHudColor(gameState, unit, hpRatio) {
    if (gameState.campaignMode) {
        const relation = getRelationToViewer(gameState, unit.camp);
        return (RELATION_META[relation] || RELATION_META.unknown).color;
    }
    if (hpRatio > 0.7) return '#4CAF50';
    if (hpRatio > 0.35) return '#FFC107';
    return '#f44336';
}

/** Draw only the friendly moving counter above a held fog mask. */
export function drawUnitBadgeAboveFog(unit, gameState) {
    if (!unit || unit._airdropWaiting || !unit.tile) return;
    const pos = getUnitVisualPos(unit);
    const hpRatio = unit.displayHp / unit.maxHp;
    const shieldRatio = unit._displayShield > 0.5 ? unit._displayShield / unit.maxHp : 0;
    const flagColors = getFlagColors(unit.camp?.colorId || unit.camp?.color);

    ctx.save();
    ctx.translate(pos.x, pos.y);
    if (unit._isDrone || unit.type === 'drone') {
        ctx.translate(0, Math.sin(frameInfo.now / 1000 * 2.5) * 3);
    }
    drawUnitBadge(ctx, {
        radius: UNIT_BADGE_RADIUS,
        centerY: UNIT_BADGE_CENTER_Y,
        flagColors,
        relationColor: resolveUnitHudColor(gameState, unit, hpRatio),
        hpRatio,
        shieldRatio,
        waterColor: isWaterTile(unit.tile) ? getSurfaceBaseColor(getTileSurface(unit.tile)) : null,
        glyph: resolveUnitBadgeGlyph(unit.type, Boolean(unit._engineerScaffold))
    });
    ctx.restore();
}

export function drawUnit(unit, gameState) {
        if (unit._airdropWaiting) return; // invisible until parachute lands
        if (unit._airliftLandAt) {         // E4 空运途中：落地前隐藏，落地时现身
            if (frameInfo.now < unit._airliftLandAt) return;
            unit._airliftLandAt = 0;
        }
        if (unit._soulRecallLandAt) {      // E2 魂卒召回：黑烟飞抵后才现身
            if (frameInfo.now < unit._soulRecallLandAt) return;
            unit._soulRecallLandAt = 0;
        }
        const now = frameInfo.now;
        const pos = getUnitVisualPos(unit);
        let visualX = pos.x, visualY = pos.y;
        if (unit.movePath) {
            if (now - unit.movePathStart >= unit.movePathDuration) {
                unit.movePath = null;
            }
        }

        const gs = gameState;
        const time = now / 1000;
        const cc = getFlagColors(unit.camp?.colorId || unit.camp?.color);

        ctx.save();
        ctx.translate(visualX, visualY);

        // ── Flag pole. Cloth is rendered for all units in one WebGL batch. ──
        if (!unit.tile.isCity && !unit.tile.isVillage) {
            const { poleX, poleTop, poleBottom } = UNIT_FLAG_LAYOUT;
            ctx.beginPath();
            ctx.moveTo(poleX, poleTop);
            ctx.lineTo(poleX, poleBottom);
            ctx.strokeStyle = '#bbb';
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.stroke();

        }

        // ── Production 2.5D sphere + outer instrument ──
        ctx.save();
        if (unit._isDrone || unit.type === 'drone') {
            ctx.translate(0, Math.sin(time * 2.5) * 3);
        }

        const badgeR = UNIT_BADGE_RADIUS;
        const lerpFactor = 0.18;
        unit.displayHp += (unit.hp - unit.displayHp) * lerpFactor;
        if (Math.abs(unit.hp - unit.displayHp) < 0.3) unit.displayHp = unit.hp;
        unit._displayShield += (unit._shield - unit._displayShield) * lerpFactor;
        if (Math.abs(unit._shield - unit._displayShield) < 0.3) unit._displayShield = unit._shield;

        unit.displaySpeed += (unit.remainingMP - unit.displaySpeed) * lerpFactor;
        if (Math.abs(unit.remainingMP - unit.displaySpeed) < 0.3) unit.displaySpeed = unit.remainingMP;

        const hpRatio = unit.displayHp / unit.maxHp;
        const shieldRatio = unit._displayShield > 0.5 ? unit._displayShield / unit.maxHp : 0;
        const hpColor = resolveUnitHudColor(gameState, unit, hpRatio);

        drawUnitBadge(ctx, {
            radius: badgeR,
            centerY: UNIT_BADGE_CENTER_Y,
            flagColors: cc,
            relationColor: hpColor,
            hpRatio,
            shieldRatio,
            waterColor: isWaterTile(unit.tile) ? getSurfaceBaseColor(getTileSurface(unit.tile)) : null,
            glyph: resolveUnitBadgeGlyph(unit.type, Boolean(unit._engineerScaffold))
        });

        ctx.restore();

        // Morale marker — hex corner badge (top-right)
        const hasMoraleAnim = iconEffects.some(fx => fx.kind === 'morale' && fx.unitId === unit.id);
        if (unit.morale !== 2 && !hasMoraleAnim) {
            const mc = MORALE_CONFIG[unit.morale];
            const mx = HEX_SIZE * 0.55 + (unit.morale === 0 ? 2 : 0);
            const my = -HEX_SIZE * 0.35;
            ctx.fillStyle = mc.color;
            ctx.font = unit.morale === 0 ? 'bold 14px Arial' : 'bold 11px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 3;
            ctx.fillText(mc.icon, mx, my + 1);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }

        // ── 状态图标行：徽章上方居中一字排开（js/unitStatusIcons.js 注册管线。
        // 军衔/士气为固定角标不走此管线；禁锢/缚足/中毒等由效果队列派生）──
        const statusIcons = getUnitStatusIcons(unit, gs, time);
        if (statusIcons.length) {
            const spacing = 17;
            const rowY = -HEX_SIZE * 0.86;
            const startX = -((statusIcons.length - 1) * spacing) / 2;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let i = 0; i < statusIcons.length; i++) {
                const icon = statusIcons[i];
                const ix = startX + i * spacing;
                ctx.save();
                if (icon.alpha != null) ctx.globalAlpha = icon.alpha;
                if (icon.color) ctx.fillStyle = icon.color;
                ctx.font = icon.font || 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
                ctx.shadowColor = icon.shadowColor || 'rgba(0,0,0,0.6)';
                ctx.shadowBlur = icon.shadowBlur != null ? icon.shadowBlur : 3;
                ctx.fillText(icon.glyph, ix, rowY);
                if (icon.count) {
                    ctx.shadowBlur = 2;
                    ctx.fillStyle = icon.countColor || '#ffd54a';
                    ctx.font = 'bold 8px Arial';
                    ctx.fillText(icon.count, ix + 7, rowY + 7);
                }
                ctx.restore();
            }
        }

        ctx.restore();

        // ── Actionable glow（仅己方回合显示）──
        if (unit.canAct && gs && unit.camp === gs.currentCamp && !unit.isNewRecruit && isHumanTurn(gs)) {
            ctx.save();
            const pulse = (Math.sin(time * 3.2 * Math.PI) + 1) / 2;
            const alpha1 = 0.18 + pulse * 0.45;
            const alpha2 = 0.08 + (1 - pulse) * 0.25;
            const r1 = HEX_SIZE + 2 + pulse * 3;
            const r2 = HEX_SIZE + 6 + (1 - pulse) * 4;
            drawHexagonOutline(ctx, visualX, visualY, r1, `rgba(255,215,0,${alpha1})`, 2.5);
            drawHexagonOutline(ctx, visualX, visualY, r2, `rgba(255,255,200,${alpha2})`, 1.5);
            ctx.restore();
        }

        // ── Iron Guard shield marker (above flag, same layer as berserker rage) ──
        if (unit.commander === 'ironGuard' && !areCommanderMechanicsSuppressed(unit)) {
            ctx.save();
            const shieldRatio = Math.min(1, unit._shield / Math.max(unit._shieldMax, 1));
            const shieldPulse = (Math.sin(time * 3 * Math.PI) + 1) / 2;
            const shieldY = visualY - HEX_SIZE * 0.82;
            const inFlash = performance.now() < unit._shieldPulseUntil;
            const flashT = inFlash ? 1 - (unit._shieldPulseUntil - performance.now()) / 800 : 0;

            // 承伤扩散环（呼吸灯式向外扩散）— 强度随护盾比例
            if (inFlash) {
                const ringR = HEX_SIZE * 0.2 + flashT * HEX_SIZE * 1.5;
                const ringAlpha = (1 - flashT) * 0.7 * shieldRatio;
                ctx.beginPath();
                ctx.arc(visualX, shieldY, ringR, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(140,200,255,${ringAlpha})`;
                ctx.lineWidth = (3 * (1 - flashT) + 1) * shieldRatio;
                ctx.stroke();
                const ring2R = ringR + HEX_SIZE * 0.25;
                const ring2Alpha = (1 - flashT) * 0.35 * shieldRatio;
                ctx.beginPath();
                ctx.arc(visualX, shieldY, ring2R, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(180,220,255,${ring2Alpha})`;
                ctx.lineWidth = (2 * (1 - flashT)) * shieldRatio;
                ctx.stroke();
            }

            // 🛡 状态图标已并入头顶图标行（守护灵光效果项），此处只保留承伤扩散环
            ctx.restore();
        }

        // ── Rank insignia ──
        if (unit._rank > 0) {
            ctx.save();
            const chX = visualX + HEX_SIZE * 0.48, chY = visualY + HEX_SIZE * 0.38;
            if (unit._rank >= 4) {
                const outerR = 7, innerR = outerR * 0.382;
                ctx.beginPath();
                for (let i = 0; i < 5; i++) {
                    const aOut = -Math.PI / 2 + i * 2 * Math.PI / 5;
                    const aIn = aOut + Math.PI / 5;
                    if (i === 0) ctx.moveTo(chX + outerR * Math.cos(aOut), chY + outerR * Math.sin(aOut));
                    else ctx.lineTo(chX + outerR * Math.cos(aOut), chY + outerR * Math.sin(aOut));
                    ctx.lineTo(chX + innerR * Math.cos(aIn), chY + innerR * Math.sin(aIn));
                }
                ctx.closePath();
                ctx.fillStyle = '#ffd700';
                ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 1.5; ctx.shadowOffsetY = 1;
                ctx.fill();
                ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 0;
                ctx.fill();
            } else {
                ctx.strokeStyle = '#ffd700'; ctx.lineWidth = 2;
                ctx.lineCap = 'round'; ctx.lineJoin = 'round';
                for (let lv = 0; lv < unit._rank; lv++) {
                    const dy = lv * 5;
                    ctx.beginPath();
                    ctx.moveTo(chX - 5.5, chY + 2 + dy);
                    ctx.lineTo(chX,       chY - 2 + dy);
                    ctx.lineTo(chX + 5.5, chY + 2 + dy);
                    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 1.5; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 1;
                    ctx.stroke();
                    ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 2.5; ctx.shadowOffsetY = 0;
                    ctx.stroke();
                }
            }
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            ctx.restore();
        }

        // ── Commander name badge ──
        if (unit.isCommanderUnit) {
            const text = unit.getCommanderDisplayName();
            if (text) {
                const cx = visualX - HEX_SIZE * 0.40;
                const cy = visualY + HEX_SIZE * 0.22;
                ctx.save();
                let fontSize = 7.5;
                ctx.font = `bold ${fontSize}px "Noto Serif SC", "Microsoft YaHei", serif`;
                while (ctx.measureText(text).width > 48 && fontSize > 5.5) {
                    fontSize -= 0.5;
                    ctx.font = `bold ${fontSize}px "Noto Serif SC", "Microsoft YaHei", serif`;
                }
                const m = ctx.measureText(text);
                const bw = m.width + 8;
                const bh = 13;
                const bx = cx - bw / 2;
                const by = cy;
                ctx.fillStyle = 'rgba(0,0,0,0.78)';
                roundRectPath(ctx, bx, by, bw, bh, 3);
                ctx.fill();
                ctx.strokeStyle = cc.main;
                ctx.lineWidth = 1.2;
                roundRectPath(ctx, bx, by, bw, bh, 3);
                ctx.stroke();
                ctx.fillStyle = cc.main;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, cx, cy + bh / 2);
                ctx.restore();

            }
        }

        // ── 天眼无人机 ──
        if (unit._isDrone) {
            ctx.save();
            const dy = visualY - HEX_SIZE * 0.75;
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.shadowColor = unit.morale === 0 ? 'rgba(255,50,50,0.5)' : 'rgba(100,200,255,0.5)';
            ctx.shadowBlur = 0;
            const bw = 24, bh = 4, bx = -bw / 2, by = dy + 12;
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bx, by, bw, bh);
            const r = unit.hp / unit.maxHp;
            ctx.fillStyle = r > 0.5 ? '#4CAF50' : (r > 0.25 ? '#FF9800' : '#f44336');
            ctx.fillRect(bx, by, bw * r, bh);
            if (unit.morale === 0) { ctx.fillStyle = '#ff6666'; ctx.font = 'bold 10px sans-serif'; ctx.fillText('混乱', visualX, dy - 14); }
            ctx.restore();
        }

        // 魂卒：黑烟缭绕粒子（亡灵法师本人不显示） + 头顶骷髅标志
        if (unit._isSoulMinion && unit.commander !== 'necromancer') {
            ctx.save();
            const seed = unit.id || 1;
            // 多股黑烟绕身盘旋上升
            for (let i = 0; i < 5; i++) {
                const angle = time * 0.6 + (i / 5) * Math.PI * 2 + seed * 0.07;
                const drift = Math.sin(time * 1.1 + i + seed) * 0.4;
                const rise = (time * 0.8 + i * 1.3 + seed) % 3;
                const px = Math.cos(angle) * (10 + rise * 4 + drift * 6);
                const py = -rise * 12 + drift * 4;
                const r = 3 + rise * 2.5 + Math.sin(time + i) * 0.8;
                const alpha = Math.max(0, 0.3 - rise * 0.1 + Math.sin(time * 1.5 + i * 2) * 0.05);
                ctx.fillStyle = `rgba(15,10,25,${alpha})`;
                ctx.shadowColor = 'rgba(40,20,60,0.3)';
                ctx.shadowBlur = 6 + rise * 2;
                ctx.beginPath();
                ctx.arc(px, py, r, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.shadowBlur = 0;
            ctx.restore();
            // 💀 骷髅图标已并入头顶图标行
        }
    }

    // ① 攻击力乘区：基础面板 ×（1+「攻击力提高xx%」）+「攻击力+xx」固定加成
    //    百分比只作用于基础面板；士气不乘入攻击力，走 _resolveDamage 的增伤乘区
