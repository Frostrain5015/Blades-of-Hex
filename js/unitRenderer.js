// Unit canvas rendering and visual interpolation. This module intentionally owns all Canvas/effect imports.
import { HEX_SIZE, ctx, drawHexagonOutline, CAMP, settings, frameInfo, CAMP_FLAG_COLORS, getFlagColors, MORALE_CONFIG, roundRectPath, getRoundIndex } from './config.js';
import { getCommander } from './commanderInterface.js';
import { isNetworkGame, getMyRole } from './network.js';
import { moraleEffects, getRecoilOffset, getChargeOffset } from './effects.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';
import { getRelationToViewer, RELATION_META } from '../rules/diplomacy.js';
import { campToKey } from '../rules/camps.js';

function isHumanTurn(gameState) {
    if (gameState.campaignMode) return gameState.factions?.[campToKey(gameState.currentCamp)]?.controller === 'human';
    if (isNetworkGame()) {
        const role = getMyRole();
        if (role === 'player1') return gameState.currentCamp === CAMP.player1;
        if (role === 'player2') return gameState.currentCamp === CAMP.player2;
        if (role === 'player3') return gameState.currentCamp === CAMP.player3;
        return false;
    }
    if (gameState.gameMode === 'pve' && gameState.aiOpponentCamp) {
        return gameState.currentCamp !== CAMP.neutral && gameState.currentCamp !== gameState.aiOpponentCamp;
    }
    return gameState.currentCamp !== CAMP.neutral;
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

        const key = campToKey(unit.camp);
        const campKey = key === 'player1' ? 'p1' : key === 'player2' ? 'p2' : key === 'player3' ? 'p3' : key === 'neutral' ? 'neu' : key;
        const cc = campKey === 'neu' ? CAMP_FLAG_COLORS.neu : getFlagColors(unit.camp?.color);

        ctx.save();
        ctx.translate(visualX, visualY);

        // ── Flag (below badge and ring) ──
        if (!unit.tile.isCity && !unit.tile.isVillage) {
            const poleX = -13;
            const poleTop = -30;
            const poleBottom = 2;
            ctx.beginPath();
            ctx.moveTo(poleX, poleTop);
            ctx.lineTo(poleX, poleBottom);
            ctx.strokeStyle = '#bbb';
            ctx.lineWidth = 1.5;
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(poleX, poleTop, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffd700';
            ctx.fill();

            const idSeed = typeof unit.id === 'number' ? unit.id : [...String(unit.id)].reduce((a, c) => a + c.charCodeAt(0), 0);
            const wave = Math.sin(time * 7 + idSeed * 1.3) * 2.0;
            const flagLeft = poleX + 1;
            const flagRight = flagLeft + 10;
            const flagTop = poleTop + 2;
            const flagMid = flagTop + 4;
            const flagBot = flagTop + 10;
            ctx.beginPath();
            ctx.moveTo(flagLeft, flagTop);
            ctx.quadraticCurveTo(flagLeft + 3, flagMid - 2 + wave, flagRight, flagMid + wave);
            ctx.lineTo(flagRight, flagBot + wave * 0.7);
            ctx.quadraticCurveTo(flagLeft + 3, flagMid + 2 + wave * 0.7, flagLeft, flagBot);
            ctx.closePath();
            const flagGrad = ctx.createLinearGradient(flagLeft, 0, flagRight, 0);
            flagGrad.addColorStop(0, cc.main);
            flagGrad.addColorStop(1, cc.dark);
            ctx.fillStyle = flagGrad;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 0.6;
            ctx.stroke();

            // 将领星标（跟随旗帜飘动+扭曲）
            if (unit.commander) {
                ctx.save();
                ctx.translate(flagLeft + 5, flagTop + 5 + wave * 0.5);
                const waveTilt = Math.cos(time * 7 + idSeed * 1.3) * 0.14;
                ctx.rotate(waveTilt);
                ctx.fillStyle = '#ffd700';
                ctx.font = 'bold 9px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = 5;
                ctx.fillText('★', 0, 0);
                ctx.restore();
            }
        }

        // ── Badge ──
        // ── Floating shadow for entire badge+ring group ──
        ctx.save();
        if (unit._isDrone || unit.type === 'drone') {
            ctx.translate(0, Math.sin(time * 2.5) * 3);
        }
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetY = 2;

        const badgeR = 15;
        const badgeY = 1;
        ctx.beginPath();
        ctx.arc(0, badgeY, badgeR, 0, Math.PI * 2);
        const badgeGrad = ctx.createRadialGradient(-1, badgeY - 2, badgeR * 0.05, 0, badgeY, badgeR);
        badgeGrad.addColorStop(0, cc.light);
        badgeGrad.addColorStop(1, cc.dark);
        ctx.fillStyle = badgeGrad;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // ── Unit type character ──
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 15px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const glyphs = { infantry: '⚔', cavalry: '🐎', archer: '🎯', mgNest: '🏰', drone: '✈' };
        ctx.fillText(unit._engineerScaffold ? '🧱' : (glyphs[unit.type] || '?'), 0, badgeY + 1);

        // ── Ring HP bar ──
        const lerpFactor = 0.18;
        unit.displayHp += (unit.hp - unit.displayHp) * lerpFactor;
        if (Math.abs(unit.hp - unit.displayHp) < 0.3) unit.displayHp = unit.hp;
        unit._displayShield += (unit._shield - unit._displayShield) * lerpFactor;
        if (Math.abs(unit._shield - unit._displayShield) < 0.3) unit._displayShield = unit._shield;
        unit._displayShield += (unit._shield - unit._displayShield) * lerpFactor;
        if (Math.abs(unit._shield - unit._displayShield) < 0.3) unit._displayShield = unit._shield;

        unit.displaySpeed += (unit.remainingMP - unit.displaySpeed) * lerpFactor;
        if (Math.abs(unit.remainingMP - unit.displaySpeed) < 0.3) unit.displaySpeed = unit.remainingMP;

        const hpRatio = unit.displayHp / unit.maxHp;
        const ringR = badgeR;
        const ringW = 3.5;
        const startAngle = -Math.PI / 2;
        const sweepAngle = hpRatio * Math.PI * 2;

        // Background ring
        ctx.beginPath();
        ctx.arc(0, badgeY, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.lineWidth = ringW;
        ctx.stroke();

        // HP arc
        if (hpRatio > 0.005) {
            let hpColor;
            if (gameState.campaignMode) {
                const relation = getRelationToViewer(gameState, unit.camp);
                hpColor = (RELATION_META[relation] || RELATION_META.unknown).color;
            } else if (hpRatio > 0.7) hpColor = '#4CAF50';
            else if (hpRatio > 0.35) hpColor = '#FFC107';
            else hpColor = '#f44336';

            ctx.beginPath();
            ctx.arc(0, badgeY, ringR, startAngle, startAngle + sweepAngle);
            ctx.strokeStyle = hpColor;
            ctx.lineWidth = ringW;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        // Shield overlay arc
        const shieldRatio = unit._displayShield > 0.5 ? unit._displayShield / unit.maxHp : 0;
        if (shieldRatio > 0.003) {
            const shieldSweep = shieldRatio * Math.PI * 2;
            const shieldStart = startAngle;
            ctx.beginPath();
            ctx.arc(0, badgeY, ringR + 4, shieldStart, shieldStart + shieldSweep);
            ctx.strokeStyle = '#66bbff';
            ctx.lineWidth = 2.4;
            ctx.lineCap = 'round';
            ctx.stroke();
        }

        ctx.restore(); // end floating shadow group

        // Morale marker — hex corner badge (top-right)
        const hasMoraleAnim = moraleEffects.some(fx => fx.unitId === unit.id);
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

        // Imprisoned lock — same position as Iron Guard shield
        if (unit._imprisoned) {
            ctx.fillStyle = '#ff8844';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 3;
            ctx.fillText('🔒', 0, -HEX_SIZE * 0.82);
            ctx.shadowColor = 'transparent';
            ctx.shadowBlur = 0;
        }

        ctx.restore();

        // ── 工程师脚手架：建造中标记（🚧 + 剩余回合） ──
        if (unit._engineerScaffold) {
            ctx.save();
            const buildPulse = (Math.sin(time * 2.5 * Math.PI) + 1) / 2;
            const bY = visualY - HEX_SIZE * 0.6;
            ctx.font = 'bold 13px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.globalAlpha = 0.65 + buildPulse * 0.35;
            ctx.shadowColor = '#ffcc44'; ctx.shadowBlur = 5;
            ctx.fillText('🔨', visualX, bY);
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 0;
            const turns = unit._engineerScaffold.turnsRemaining || 1;
            ctx.fillStyle = '#ffd54a';
            ctx.font = 'bold 10px Arial';
            ctx.fillText(`${turns}`, visualX + HEX_SIZE * 0.5, bY);
            ctx.restore();
        }

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

        // ── Berserker blood rage glow（已损HP越多越明显） ──
        if (unit.commander === 'berserker' && unit.hp < unit.maxHp) {
            const balance = COMMANDER_CONFIG.berserker.balance;
            const hpLostRatio = (unit.maxHp - unit.hp) / unit.maxHp;
            const stacks = Math.min(balance.maxStacks, Math.floor(hpLostRatio / balance.hpLossPerStackPct));
            if (stacks > 0) {
                ctx.save();
                const intensity = stacks / balance.maxStacks;
                const ragePulse = (Math.sin(time * 6 * Math.PI) + 1) / 2;
                ctx.fillStyle = `rgba(255,80,20,${(0.4 + ragePulse * 0.4) * intensity})`;
                ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = '#ff4400'; ctx.shadowBlur = 4 + 4 * intensity;
                ctx.fillText('💢', visualX, visualY - HEX_SIZE * 0.55);
                ctx.shadowBlur = 0;
                ctx.restore();
            }
        }

        // ── Iron Guard shield marker (above flag, same layer as berserker rage) ──
        if (unit.commander === 'ironGuard') {
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

            // shield glyph — 强度随护盾比例
            const glyphAlpha = shieldRatio * (inFlash ? 0.9 + flashT * 0.1 : 0.7 + shieldPulse * 0.3);
            ctx.fillStyle = `rgba(130,200,255,${glyphAlpha})`;
            const glyphSize = 13 * (0.6 + 0.4 * shieldRatio);
            ctx.font = `bold ${Math.round(glyphSize)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = inFlash ? '#aaddff' : '#5599cc';
            ctx.shadowBlur = shieldRatio * (inFlash ? 8 + flashT * 8 : 5);
            ctx.fillText('🛡', visualX, shieldY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── Paladin smite ready marker ──
        if (unit._smiteReady) {
            ctx.save();
            const smitePulse = (Math.sin(time * 5 * Math.PI) + 1) / 2;
            const smiteY = visualY - HEX_SIZE * 0.55;
            ctx.fillStyle = `rgba(255,215,0,${0.7 + smitePulse * 0.3})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 6;
            ctx.fillText('✗', visualX, smiteY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── Priest healing aura glow ──
        if (unit._healingAura > 0) {
            ctx.save();
            const healPulse = (Math.sin(time * 4 * Math.PI) + 1) / 2;
            const healY = visualY - HEX_SIZE * 0.55;
            ctx.fillStyle = `rgba(68,221,136,${0.5 + healPulse * 0.3})`;
            ctx.font = 'bold 11px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#44dd88'; ctx.shadowBlur = 5;
            ctx.fillText('\u{1F54A}\u{FE0F}', visualX, healY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── E3 纵横家标记 📜 ──
        if (unit.commander === 'diplomat') {
            ctx.save();
            const dipY = visualY - HEX_SIZE * 0.55;
            const inEnemyTerritory = unit.tile && unit.tile.camp !== unit.camp;
            const dipPulse = inEnemyTerritory ? (Math.sin(time * 4 * Math.PI) + 1) / 2 : 0.5;
            ctx.fillStyle = `rgba(255,200,50,${0.5 + dipPulse * 0.3})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#ffd700'; ctx.shadowBlur = inEnemyTerritory ? 8 : 3;
            ctx.fillText('📜', visualX, dipY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── E1 占星者标记 🔮（仅天气锁定期展示） ──
        if (unit.commander === 'astrologer' && gameState && gameState.weatherLockUntil > 0
            && getRoundIndex(gameState) < gameState.weatherLockUntil) {
            ctx.save();
            const astroPulse = (Math.sin(time * 3 * Math.PI) + 1) / 2;
            const astroY = visualY - HEX_SIZE * 0.55;
            ctx.fillStyle = `rgba(180,160,255,${0.5 + astroPulse * 0.3})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#ffd700'; ctx.shadowBlur = 6;
            ctx.fillText('🔮', visualX, astroY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── E3 纵横家连横提示 ⚡（仅处于非己方地块时展示） ──
        if (unit.commander === 'diplomat' && unit.tile && unit.tile.camp !== unit.camp) {
            ctx.save();
            const dipY = visualY - HEX_SIZE * 0.55;
            const dipPulse = (Math.sin(time * 2.5 * Math.PI) + 1) / 2;
            ctx.fillStyle = `rgba(255,215,80,${0.5 + dipPulse * 0.3})`;
            ctx.font = 'bold 12px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#d4a017'; ctx.shadowBlur = 5;
            ctx.fillText('⚡', visualX, dipY);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── New recruit label ──
        if (unit.isNewRecruit) {
            ctx.save();
            ctx.fillStyle = 'rgba(255,255,120,0.75)';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('NEW', visualX, visualY - badgeR - 2);
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
        if (unit.commander) {
            const cmdCfg = getCommander(unit.commander);
            if (cmdCfg) {
                const cx = visualX - HEX_SIZE * 0.40;
                const cy = visualY + HEX_SIZE * 0.22;
                const text = cmdCfg.name;
                ctx.save();
                ctx.font = 'bold 7.5px Arial';
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
            // 骷髅图标（头顶上方）
            ctx.save();
            ctx.globalAlpha = 0.4 + Math.sin(time * 1.5) * 0.12;
            ctx.font = '20px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText('💀', 0, -HEX_SIZE * 0.8);
            ctx.restore();
        }
    }

    // ① 攻击力乘区：基础面板 ×（1+「攻击力提高xx%」）+「攻击力+xx」固定加成
    //    百分比只作用于基础面板；士气不乘入攻击力，走 _resolveDamage 的增伤乘区
