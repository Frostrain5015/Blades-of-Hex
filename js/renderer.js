import { HEX_SIZE, LOGICAL_W, LOGICAL_H, ctx, cardCanvas, cardCtx, hexPath, drawHexagonOutline, roundRectPath, COUNTER_RELATION, frameInfo, MORALE_CONFIG, CAMP, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, HEX_NEIGHBORS, pulseSine, getRoundIndex, COLONEL_CARDS, hexDistance } from './config.js';
import { getCommander, allCommanders as COMMANDER_CONFIG } from '../commander/index.js';
import { getPortrait, getTransparentPortrait } from './portraitLoader.js';
import { gameState } from './state.js';
import { isNetworkGame, getMyRole } from './network.js';
import { drawAllBorders, drawDistrictBorders, drawCampBorders } from './HexTile.js';
import { isColonelTargetBlocked, getColonelUnit, isAntiAirUnit, COLONEL_AIR_RANGE, ANTIAIR_RADIUS } from './gameLogic.js';
import {
    particles, attackFlashes, confettiPieces, screenShake, turnFlash,
    drawAttackFlashes, drawSlashMarks, drawSoftFlashes, drawConfetti, updateConfetti,
    VisualParticle, moraleEffects, rankUpEffects, drawMeleeSlashes,
    rainParticles, splashParticles, fogBlobs, windStreaks, spawnWeatherParticles,
    commanderSkillEffects, commanderFlash,
    factionMoraleFlash,
    drawProjectiles, updateProjectiles,
    bloodDrains, updateBloodDrains,
    lightningBolts, updateLightningBolts, drawLightningBolts,
    gongxinRipples, updateGongxinRipples, drawGongxinRipples,
    ministerRings, updateMinisterRings, drawMinisterRings,
    coinParticles, updateCoinParticles, drawCoinParticles,
    cardUseEffects, airstrikeEffects,
    goldenBeams, updateGoldenBeams, drawGoldenBeams,
    healingChains, updateHealingChains, drawHealingChains,
    paladinOrbitBeams, updatePaladinOrbitBeams, drawPaladinOrbitBeamsBack, drawPaladinOrbitBeamsFront,
    paladinBeamProjectiles, updatePaladinBeamProjectiles, drawPaladinBeamProjectiles
} from './effects.js';
import { isTileVisible, getTileVisibilityState, getTileVisibilityStateByCoord, getFogAlpha } from './fogOfWar.js';
import { getViewingCamp } from './state.js';

let lastTime = performance.now();
let _lastParticleSpawn = 0;

function _lerpColor(aHex, bHex, t) {
    const ar = parseInt(aHex.slice(1, 3), 16), ag = parseInt(aHex.slice(3, 5), 16), ab = parseInt(aHex.slice(5, 7), 16);
    const br = parseInt(bHex.slice(1, 3), 16), bg = parseInt(bHex.slice(3, 5), 16), bb = parseInt(bHex.slice(5, 7), 16);
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const b = Math.round(ab + (bb - ab) * t);
    return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
}

function _drawBorderGlow(ctx, color, bw, w, h) {
    const gTop = ctx.createLinearGradient(0, 0, 0, bw);
    gTop.addColorStop(0, color); gTop.addColorStop(1, 'transparent');
    ctx.fillStyle = gTop; ctx.fillRect(0, 0, w, bw);
    const gBot = ctx.createLinearGradient(0, h, 0, h - bw);
    gBot.addColorStop(0, color); gBot.addColorStop(1, 'transparent');
    ctx.fillStyle = gBot; ctx.fillRect(0, h - bw, w, bw);
    const gL = ctx.createLinearGradient(0, 0, bw, 0);
    gL.addColorStop(0, color); gL.addColorStop(1, 'transparent');
    ctx.fillStyle = gL; ctx.fillRect(0, 0, bw, h);
    const gR = ctx.createLinearGradient(w, 0, w - bw, 0);
    gR.addColorStop(0, color); gR.addColorStop(1, 'transparent');
    ctx.fillStyle = gR; ctx.fillRect(w - bw, 0, bw, h);
}

export function renderGame() {
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    frameInfo.now = now;

    // 屏幕震动
    if (screenShake.time > 0) {
        screenShake.time -= 16;
        const intensity = screenShake.time / screenShake.duration;
        screenShake.x = (Math.random() - 0.5) * 8 * intensity;
        screenShake.y = (Math.random() - 0.5) * 8 * intensity;
    } else {
        screenShake.x = 0;
        screenShake.y = 0;
    }

    // Update territory fade
    const tiles = gameState.tiles;
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].updateFadeColor(now);

    ctx.save();
    ctx.translate(screenShake.x, screenShake.y);
    ctx.clearRect(-20, -20, LOGICAL_W + 40, LOGICAL_H + 40);

    // Draw tile bases (fill + star only, no borders)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawBase(ctx);

    // Borders — standalone per-edge pass
    drawAllBorders(ctx, tiles, gameState.tileMap);
    // District borders — slightly bolder than grid lines, within same camp
    drawDistrictBorders(ctx, gameState.districtBorderEdges);
    // Camp borders (national boundaries) — thick dashed lines along territory edges
    drawCampBorders(ctx, gameState.campBorderEdges);
    // Flag poles (before units)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawFlagPole();
    // Overlays (hover/selection)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawOverlay();
    // 缚足色层（停滞者）—— 在单位之前绘制，避免单位变暗
    drawStallerZone(now);
    // 铁卫灵光（7格集群外边界）—— 地块六边形特效，在立绘之前
    drawIronGuardAura(now);
    // 单位六边形辉光（堕天使/铁卫/狂暴/禁锢/圣骑士/治愈灵光）—— 在立绘之前
    drawUnitHexAuras(now);
    drawSoulMarks(now);
    // 将领透明底立绘（先锋旗）— 在单位之下，旗帜/徽章/标识全部覆盖立绘
    drawCommanderPennants();
    // 圣骑士誓言剑环绕 — 更新位置 + 后半圈（被徽章遮挡）
    updatePaladinOrbitBeams(now, (unitId) => {
        for (const tile of gameState.tiles) {
            if (tile.unit && tile.unit.id === unitId) return { x: tile.x, y: tile.y };
        }
        return null;
    });
    drawPaladinOrbitBeamsBack(ctx, now);
    // Units — 全部绘制，非可见地块会在后续迷雾阶段被地形覆绘+遮罩覆盖
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawUnit();
    // City disabled indicator (same layer as Iron Guard shield)
    for (let i = 0, len = tiles.length; i < len; i++) {
        const tile = tiles[i];
        if (!tile.isCity || !tile._cityDisabledUntil || tile._cityDisabledUntil <= getRoundIndex(gameState)) continue;
        const pulse = (Math.sin(now / 400) + 1) / 2;
        ctx.save();
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(255,80,80,${0.6 + pulse * 0.4})`;
        ctx.fillText('🚫', tile.x, tile.y - HEX_SIZE - 16);
        ctx.restore();
    }
    // Flag finials + cloth (after units, overlays the badge)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawFlagFinialAndCloth();

    // 士气变化动画
    drawMoraleEffects(now);
    // 晋升动画
    drawRankUpEffects(now);

    // 将领技能触发特效
    drawCommanderSkillEffects(now);

    // 圣骑士誓言剑环绕 — 前半圈（遮挡徽章）
    drawPaladinOrbitBeamsFront(ctx, now);

    // 士气状态持续标识（▲/▼）
    drawMoraleIndicators();

    // 范围光圈
    drawRangeApertures(now);

    // 文字特效
    drawDamageTexts(now);
    drawHealTexts(now);
    drawGoldTexts(now);
    drawCounterText();

    // 选中高亮
    drawSelectionHighlights();

    // 对策卡手牌 — 独立 canvas 渲染（见 drawCardCanvas）
    // 暗角 — 仅雨天生效
    if (gameState.weather === 'rain') {
        const vignetteGrad = ctx.createRadialGradient(
            LOGICAL_W / 2, LOGICAL_H / 2, LOGICAL_H * 0.3,
            LOGICAL_W / 2, LOGICAL_H / 2, LOGICAL_H * 0.8
        );
        vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
        vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
        ctx.fillStyle = vignetteGrad;
        ctx.fillRect(-20, -20, LOGICAL_W + 40, LOGICAL_H + 40);
    }

    // 部署阶段横幅 / 部署完成后一次性UI重置
    if (gameState.commanderPhase === 'deployment') {
        const alpha = 0.55 + Math.sin(now / 600) * 0.08;
        // 联机模式以玩家自身阵营为准
        const myCamp = isNetworkGame() ? (getMyRole() === 'player1' ? CAMP.player1 : getMyRole() === 'player2' ? CAMP.player2 : CAMP.player3) : gameState.currentCamp;
        const iAmDeployed = myCamp === CAMP.player1 ? gameState.commanderP1Deployed : myCamp === CAMP.player2 ? gameState.commanderP2Deployed : gameState.commanderP3Deployed;
        ctx.save();
        // 逐格暗色蒙层：跳过己方可部署单位（已部署则全屏暗色）
        for (const tile of gameState.tiles) {
            const u = tile.unit;
            if (!iAmDeployed && u && u.camp === myCamp) continue;
            hexPath(ctx, tile.x, tile.y, HEX_SIZE);
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            ctx.fill();
        }
        // 横幅文字
        ctx.fillStyle = `rgba(255,215,0,${alpha})`;
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'center';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = 8;
        if (iAmDeployed) {
            ctx.fillText('⏳ 已部署，等待对方...', LOGICAL_W / 2, 36);
        } else {
            ctx.fillText('⚑ 部署阶段 — 点击己方单位挂载将领', LOGICAL_W / 2, 36);
        }
        ctx.restore();
    }

    // 回合切换闪光
    if (turnFlash.alpha > 0) {
        ctx.save();
        ctx.fillStyle = turnFlash.color;
        ctx.globalAlpha = turnFlash.alpha;
        ctx.fillRect(-20, -20, LOGICAL_W + 40, LOGICAL_H + 40);
        ctx.restore();
        turnFlash.alpha = Math.max(0, turnFlash.alpha - 0.008);
    }

    // 将领技能金色辉光（画布四周边框向内闪烁）
    if (commanderFlash.alpha > 0.001) {
        ctx.save();
        ctx.globalAlpha = commanderFlash.alpha;
        _drawBorderGlow(ctx, '#ffd700', 55, LOGICAL_W, LOGICAL_H);
        ctx.restore();
        commanderFlash.alpha *= 0.97;
    }

    // 斩杀将领全军士气辉光
    if (factionMoraleFlash.alpha > 0.001) {
        ctx.save();
        ctx.globalAlpha = factionMoraleFlash.alpha;
        _drawBorderGlow(ctx, '#ffd700', 65, LOGICAL_W, LOGICAL_H);
        ctx.restore();
        factionMoraleFlash.alpha *= 0.96;
    }

    // 环境粒子 — throttle to ~3/sec（非雨天）
    if (gameState.weather !== 'rain' && now - _lastParticleSpawn > 330 && particles.length < 60) {
        _lastParticleSpawn = now;
        particles.push(new VisualParticle(
            Math.random() * LOGICAL_W, LOGICAL_H + 5,
            (Math.random() - 0.5) * 20, -(30 + Math.random() * 50),
            `rgba(255,255,200,${0.1 + Math.random() * 0.2})`,
            1 + Math.random() * 2,
            3 + Math.random() * 4
        ));
    }

    // 天气粒子生成
    spawnWeatherParticles(now, gameState.weather, LOGICAL_W, LOGICAL_H);

    // 粒子
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!p.update(dt)) { particles.splice(i, 1); continue; }
        p.draw(ctx);
    }

    // ── 雨天渲染 ──
    if (gameState.weather === 'rain') {
        // 雨滴更新与绘制
        for (let i = rainParticles.length - 1; i >= 0; i--) {
            const r = rainParticles[i];
            r.x += r.vx * dt; r.y += r.vy * dt;
            if (r.y > LOGICAL_H + 20) {
                // 落地溅射
                if (splashParticles.length < 80) {
                    for (let s = 0; s < 3; s++) {
                        splashParticles.push({
                            x: r.x, y: LOGICAL_H,
                            vx: -20 + Math.random() * 40,
                            vy: -(30 + Math.random() * 50),
                            life: 0.3 + Math.random() * 0.2,
                            maxLife: 0.5,
                            size: 2 + Math.random() * 2
                        });
                    }
                }
                rainParticles.splice(i, 1); continue;
            }
            ctx.save();
            ctx.globalAlpha = r.alpha;
            ctx.strokeStyle = '#b4c8f0';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(r.x, r.y);
            ctx.lineTo(r.x, r.y + r.length);
            ctx.stroke();
            ctx.restore();
        }
        // 溅射粒子
        for (let i = splashParticles.length - 1; i >= 0; i--) {
            const s = splashParticles[i];
            s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 200 * dt;
            s.life -= dt;
            if (s.life <= 0) { splashParticles.splice(i, 1); continue; }
            const alpha = s.life / s.maxLife;
            ctx.save();
            ctx.globalAlpha = alpha * 0.6;
            ctx.fillStyle = '#78a0ff';
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // ── 雾天渲染 ──
    if (gameState.weather === 'fog') {
        // 底层薄雾（呼吸）
        const t = now / 1000;
        const baseAlpha = 0.16 + Math.sin(t * 0.3) * 0.05;
        ctx.save();
        ctx.fillStyle = `rgba(200,210,220,${baseAlpha})`;
        ctx.fillRect(-20, -20, LOGICAL_W + 40, LOGICAL_H + 40);
        ctx.restore();
        // 雾团
        for (let i = fogBlobs.length - 1; i >= 0; i--) {
            const b = fogBlobs[i];
            b.x += b.vx * dt; b.y += b.vy * dt;
            const elapsed = (now - b.born) / 1000;
            if (elapsed > b.maxLife) { fogBlobs.splice(i, 1); continue; }
            let a = b.alpha;
            if (elapsed < 1.5) a *= elapsed / 1.5;
            else if (elapsed > b.maxLife - 1.5) a *= (b.maxLife - elapsed) / 1.5;
            if (a <= 0) continue;
            ctx.save();
            // 用多个错位柔光斑拼出不规则雾团
            const seed = b.born;
            const n = 3 + Math.floor(((seed * 7) % 100) / 25);  // 3-5 个斑
            for (let k = 0; k < n; k++) {
                const kx = (seed * (13 + k * 7)) % 100 / 100;
                const ky = (seed * (17 + k * 11)) % 100 / 100;
                const kr = 0.45 + ((seed * (23 + k * 3)) % 100) / 200;  // 0.45-0.95
                const cx = b.x + (kx - 0.5) * b.rx * 1.2;
                const cy = b.y + (ky - 0.5) * b.ry * 1.2;
                const cr = b.rx * kr;
                const spotGrad = ctx.createRadialGradient(cx, cy, cr * 0.1, cx, cy, cr);
                spotGrad.addColorStop(0, `rgba(210,220,230,${a * 0.7})`);
                spotGrad.addColorStop(0.3, `rgba(210,220,230,${a * 0.4})`);
                spotGrad.addColorStop(0.6, `rgba(210,220,230,${a * 0.1})`);
                spotGrad.addColorStop(1, 'rgba(210,220,230,0)');
                ctx.fillStyle = spotGrad;
                ctx.beginPath();
                ctx.arc(cx, cy, cr, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    // ── 风天渲染 ──
    if (gameState.weather === 'wind') {
        for (let i = windStreaks.length - 1; i >= 0; i--) {
            const w = windStreaks[i];
            w.x += w.speed * dt; w.y += w.vy * dt;
            w.life -= dt;
            if (w.life <= 0 || w.x > LOGICAL_W + 60) { windStreaks.splice(i, 1); continue; }
            const alpha = (w.life / w.maxLife) * w.alpha;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.strokeStyle = '#c8dcc8';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(w.x, w.y);
            ctx.lineTo(w.x + w.length, w.y + w.vy * 0.02);
            ctx.stroke();
            ctx.restore();
        }
    }

    // 攻击闪光
    drawAttackFlashes(ctx, now);

    // 炮弹飞行特效
    updateProjectiles(now);
    drawProjectiles(ctx, now);

    // 圣骑士至圣斩光束弹射
    updatePaladinBeamProjectiles(now);
    drawPaladinBeamProjectiles(ctx, now);

    // 斩击标记
    drawSlashMarks(ctx, now);
    drawMeleeSlashes(ctx, now);

    // 治疗 / 招募光环
    drawSoftFlashes(ctx, now);

    // 吸血鬼血流粒子
    if (bloodDrains.length > 0) {
        for (const b of bloodDrains) {
            const rawT = 1 - b.life / b.maxLife;
            if (rawT < b.delay) continue;
            const t = (rawT - b.delay) / (1 - b.delay);
            const alpha = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.8) / 0.2);
            if (alpha <= 0) continue;
            // 拖尾
            if (b.trail.length > 1) {
                for (let j = 1; j < b.trail.length; j++) {
                    const trailAlpha = alpha * 0.3 * (j / b.trail.length);
                    ctx.save();
                    ctx.globalAlpha = trailAlpha;
                    ctx.strokeStyle = '#ff4444';
                    ctx.lineWidth = b.size * 0.6 * (j / b.trail.length);
                    ctx.shadowColor = '#cc1111';
                    ctx.shadowBlur = 2;
                    ctx.beginPath();
                    ctx.moveTo(b.trail[j - 1].x, b.trail[j - 1].y);
                    ctx.lineTo(b.trail[j].x, b.trail[j].y);
                    ctx.stroke();
                    ctx.restore();
                }
            }
            // 外层辉光
            ctx.save();
            ctx.globalAlpha = alpha * 0.5;
            ctx.fillStyle = '#ff2222';
            ctx.shadowColor = '#ff4444';
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.size * 1.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            // 核心亮点
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#ff8888';
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.size * 0.45, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            // 粒子本体
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#ff3333';
            ctx.shadowColor = '#cc0000';
            ctx.shadowBlur = 4;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.size * 0.85, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // 谋士闪电
    updateLightningBolts(now);
    drawLightningBolts(ctx, now);
    // 圣骑士誓言金色光束
    updateGoldenBeams(now);
    drawGoldenBeams(ctx, now);
    // 牧师圣链治疗特效
    updateHealingChains(now);
    drawHealingChains(ctx, now);
    // 攻心波纹
    updateGongxinRipples(now);
    drawGongxinRipples(ctx, now);
    // 尚书统御光环
    updateMinisterRings(now);
    drawMinisterRings(ctx, now);

    // 尚书屯田特效
    if (coinParticles.length > 0) drawCoinParticles(ctx);

    // 战争迷雾遮罩（遭遇战模式）—— 在所有 VFX 之后绘制，防止特效穿透暴露位置
    if (gameState.skirmishFog) {
        const viewingCamp = getViewingCamp();
        const nowPerf = performance.now();
        for (let i = 0, len = tiles.length; i < len; i++) {
            const tile = tiles[i];
            const { alpha, state } = getFogAlpha(tile, viewingCamp, gameState, nowPerf);
            if (alpha <= 0) continue;
            if (state === 'unexplored') {
                // 径向渐变：全不透明，边缘略深
                hexPath(ctx, tile.x, tile.y, HEX_SIZE);
                const grad = ctx.createRadialGradient(tile.x, tile.y, HEX_SIZE * 0.1, tile.x, tile.y, HEX_SIZE * 1.05);
                const a = Math.min(1, alpha);
                grad.addColorStop(0, `rgba(6,7,14,${a})`);
                grad.addColorStop(0.6, `rgba(8,9,17,${a})`);
                grad.addColorStop(1, `rgba(12,13,22,${a * 0.95})`);
                ctx.fillStyle = grad;
                ctx.fill();
            } else {
                // explored：覆绘地形基底遮盖部队/特效，再叠加暗色遮罩
                tile.drawBase(ctx);
                hexPath(ctx, tile.x, tile.y, HEX_SIZE);
                const grad = ctx.createRadialGradient(tile.x, tile.y, HEX_SIZE * 0.3, tile.x, tile.y, HEX_SIZE * 1.05);
                grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
                grad.addColorStop(1, `rgba(0,0,0,${alpha * 0.7})`);
                ctx.fillStyle = grad;
                ctx.fill();
            }
        }
        // 迷雾覆绘会盖住之前画的国界线/行政区界线 —— 对已探索（无视野）地块的边线重绘
        if (gameState.campBorderEdges && gameState.campBorderEdges.length > 0) {
            for (const edge of gameState.campBorderEdges) {
                const sA = getTileVisibilityStateByCoord(edge.qa, edge.ra, viewingCamp, gameState);
                const sB = getTileVisibilityStateByCoord(edge.qb, edge.rb, viewingCamp, gameState);
                if (sA === 'unexplored' || sB === 'unexplored') continue;
                const bothExplored = sA !== 'visible' && sB !== 'visible';
                const alpha = bothExplored ? 0.25 : 1.0;
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.shadowColor = 'rgba(80,80,80,0.5)';
                ctx.shadowBlur = 6;
                ctx.setLineDash([12, 7]);
                ctx.lineWidth = 5;
                ctx.strokeStyle = 'rgba(60,60,60,0.85)';
                ctx.beginPath();
                ctx.moveTo(edge.x0, edge.y0);
                ctx.lineTo(edge.x1, edge.y1);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.lineDashOffset = 3;
                ctx.lineWidth = 2.5;
                ctx.strokeStyle = 'rgba(120,120,120,0.7)';
                ctx.beginPath();
                ctx.moveTo(edge.x0, edge.y0);
                ctx.lineTo(edge.x1, edge.y1);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        }
        if (gameState.districtBorderEdges && gameState.districtBorderEdges.length > 0) {
            for (const edge of gameState.districtBorderEdges) {
                const sA = getTileVisibilityStateByCoord(edge.qa, edge.ra, viewingCamp, gameState);
                const sB = getTileVisibilityStateByCoord(edge.qb, edge.rb, viewingCamp, gameState);
                if (sA === 'unexplored' || sB === 'unexplored') continue;
                const bothExplored = sA !== 'visible' && sB !== 'visible';
                ctx.save();
                ctx.globalAlpha = bothExplored ? 0.2 : 1.0;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.setLineDash([8, 5]);
                ctx.lineWidth = 2.3;
                ctx.strokeStyle = 'rgba(50,50,50,0.5)';
                ctx.beginPath();
                ctx.moveTo(edge.x0, edge.y0);
                ctx.lineTo(edge.x1, edge.y1);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        }
    }

    ctx.restore();

    // 彩纸（不跟随震动）
    if (confettiPieces.length > 0) {
        updateConfetti(dt);
        drawConfetti(ctx);
    }

    // 烧牌动画 + 空袭特效 — 最高图层
    drawCardUseAnimation(now);
    drawAirstrikeEffects(now);

    // 不跟随震动的粒子更新
    if (bloodDrains.length > 0) updateBloodDrains(dt);
    if (coinParticles.length > 0) updateCoinParticles(dt);
}

function drawMoraleEffects(now) {
    for (let i = moraleEffects.length - 1; i >= 0; i--) {
        const fx = moraleEffects[i];
        const elapsed = now - fx.startTime;
        if (elapsed > fx.duration) { moraleEffects.splice(i, 1); continue; }

        const mc = MORALE_CONFIG[fx.morale];
        const phase1 = elapsed < fx.phaseDuration;
        const cornerX = fx.x + HEX_SIZE * 0.55 + (fx.morale === 0 ? 2 : 0);
        const cornerY = fx.y - HEX_SIZE * 0.35;

        if (phase1) {
            const t = elapsed / fx.phaseDuration;
            const alpha = Math.min(1, t * 4) * 0.75;
            const size = 28 + t * 6;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = mc.color;
            ctx.font = `bold ${size}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = mc.color;
            ctx.shadowBlur = 16 + t * 8;
            ctx.fillText(mc.icon, fx.x, fx.y);
            ctx.restore();
        } else {
            const t = (elapsed - fx.phaseDuration) / (fx.duration - fx.phaseDuration);
            const x = fx.x + (cornerX - fx.x) * t;
            const y = fx.y + (cornerY - fx.y) * t;
            const size = 34 - 23 * t;
            const alpha = 0.75 * (1 - t * 0.5);

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = mc.color;
            ctx.font = `bold ${size}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0,0,0,0.6)';
            ctx.shadowBlur = 4 + 4 * (1 - t);
            ctx.fillText(mc.icon, x, y + 1);
            ctx.restore();
        }
    }
}

function drawRankUpEffects(now) {
    for (let i = rankUpEffects.length - 1; i >= 0; i--) {
        const fx = rankUpEffects[i];
        const elapsed = now - fx.startTime;
        if (elapsed > fx.duration) { rankUpEffects.splice(i, 1); continue; }

        const phase1 = elapsed < fx.phaseDuration;
        const cornerX = fx.x + HEX_SIZE * 0.48;
        const cornerY = fx.y + HEX_SIZE * 0.38;

        if (phase1) {
            const t = elapsed / fx.phaseDuration;
            const alpha = Math.min(1, t * 4) * 0.85;
            if (fx.rank >= 4) {
                const size = 28 + t * 6;
                _drawRankStar(fx.x, fx.y, size, alpha, '#ffd700', 14 + t * 8);
            } else {
                const scale = 2.5 + t * 1.0;
                _drawChevrons(fx.x, fx.y, fx.rank, scale, alpha, '#ffd700', 14 + t * 8);
            }
        } else {
            const t = (elapsed - fx.phaseDuration) / (fx.duration - fx.phaseDuration);
            const x = fx.x + (cornerX - fx.x) * t;
            const y = fx.y + (cornerY - fx.y) * t;
            const alpha = 0.85 * (1 - t * 0.5);
            if (fx.rank >= 4) {
                const size = 32 - 22 * t;
                _drawRankStar(x, y, size, alpha, '#ffd700', 4 + 4 * (1 - t));
            } else {
                const scale = 3.5 - 2.5 * t;
                _drawChevrons(x, y, fx.rank, scale, alpha, '#ffd700', 4 + 4 * (1 - t));
            }
        }
    }
}

function _drawChevrons(cx, cy, rank, scale, alpha, color, glow) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2 * scale;
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    const halfW = 5.5 * scale;
    const h = 3.5 * scale;
    const gap = 5 * scale;
    const totalH = (rank - 1) * gap;
    for (let lv = 0; lv < rank; lv++) {
        const dy = lv * gap - totalH / 2;
        ctx.beginPath();
        ctx.moveTo(cx - halfW, cy + h * 0.5 + dy);
        ctx.lineTo(cx,          cy - h + dy);
        ctx.lineTo(cx + halfW, cy + h * 0.5 + dy);
        ctx.stroke();
    }
    ctx.restore();
}

function _drawRankStar(cx, cy, size, alpha, color, glow) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.font = `bold ${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.fillText('★', cx, cy);
    ctx.restore();
}

function drawMoraleIndicators() {
    const tiles = gameState.tiles;
    const animIds = new Set();
    for (let i = 0; i < moraleEffects.length; i++) animIds.add(moraleEffects[i].unitId);
    for (let i = 0, len = tiles.length; i < len; i++) {
        const unit = tiles[i].unit;
        if (!unit || unit.morale === 2 || unit.morale === 0) continue;
        if (animIds.has(unit.id)) continue;

        const mc = MORALE_CONFIG[unit.morale];
        const cornerX = unit.tile.x + HEX_SIZE * 0.55;
        const cornerY = unit.tile.y - HEX_SIZE * 0.35;

        ctx.save();
        ctx.fillStyle = mc.color;
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 4;
        ctx.fillText(mc.icon, cornerX, cornerY);
        ctx.restore();
    }
}

// 判断当前回合是否为人类玩家（用于隐藏 AI/中立回合的光圈等）
function _isHumanTurn() {
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

function drawSelectionHighlights() {
    if (!_isHumanTurn() && gameState.commanderPhase !== 'deployment') return;
    const highlightTile = gameState.selectedTile;
    if (!highlightTile) return;

    // Follow visual position during movement animation
    let cx = highlightTile.x, cy = highlightTile.y;
    if (gameState.selectedUnit === highlightTile.unit && highlightTile.unit) {
        const pos = highlightTile.unit.getVisualPos();
        cx = pos.x; cy = pos.y;
    }

    const isDeploy = gameState.commanderPhase === 'deployment';

    if (isDeploy) {
        // 部署阶段预选中：仅当前阵营可见辉光脉冲
        const selUnit = gameState.selectedUnit;
        if (!selUnit || selUnit.camp !== gameState.currentCamp) return;
        const pulse = (Math.sin(frameInfo.now / 350) + 1) / 2;
        const glowAlpha = 0.25 + pulse * 0.3;
        hexPath(ctx, cx, cy, HEX_SIZE);
        ctx.fillStyle = `rgba(255,215,0,${glowAlpha})`;
        ctx.fill();
        drawHexagonOutline(ctx, cx, cy, HEX_SIZE + 1, `rgba(255,215,0,${0.5 + pulse * 0.4})`, 2.5);
        drawHexagonOutline(ctx, cx, cy, HEX_SIZE + 5, `rgba(255,255,200,${0.15 + pulse * 0.2})`, 2);
    } else {
        hexPath(ctx, cx, cy, HEX_SIZE);
        ctx.fillStyle = 'rgba(255,215,0,0.15)';
        ctx.fill();
        drawHexagonOutline(ctx, cx, cy, HEX_SIZE + 2, 'rgba(200,160,20,0.55)', 2);
    }
}

// ===== 克制/被克提示文字 =====================
function drawCounterText() {
    if (gameState.aiActing || !_isHumanTurn()) return;
    if (!gameState.selectedUnit || !gameState.selectedUnit.canAct) return;

    gameState.attackableTiles.forEach(tile => {
        const targetUnit = tile.unit;
        if (!targetUnit) return;

        const counterCoeff = COUNTER_RELATION[gameState.selectedUnit.type][targetUnit.type];
        let text = '';
        let color = '';
        let icon = '';
        if (counterCoeff > 1) {
            icon = '⬆';
            text = '克制';
            color = '#44ff44';
        } else if (counterCoeff < 1) {
            icon = '⬇';
            text = '被克';
            color = '#ff4444';
        } else {
            return;
        }

        ctx.save();
        const labelText = `${icon} ${text}`;
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'center';
        const metrics = ctx.measureText(labelText);
        const labelW = metrics.width + 16;
        const labelH = 22;
        const labelX = tile.x - labelW / 2;
        const labelY = tile.y - HEX_SIZE - 20;

        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        roundRectPath(ctx, labelX, labelY, labelW, labelH, 4);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        roundRectPath(ctx, labelX, labelY, labelW, labelH, 4);
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.textBaseline = 'middle';
        ctx.fillText(labelText, tile.x, labelY + labelH / 2);
        ctx.shadowBlur = 0;
        ctx.restore();
    });
}

// ===== 将领技能触发特效（军功章） =====================
function drawCommanderSkillEffects(now) {
    for (let i = commanderSkillEffects.length - 1; i >= 0; i--) {
        const fx = commanderSkillEffects[i];
        const elapsed = now - fx.startTime;
        if (elapsed > fx.duration) { commanderSkillEffects.splice(i, 1); continue; }

        const t = elapsed / fx.duration;
        const isShield = fx.glyph === '🛡';

        if (isShield) {
            // 护盾：原地变大淡出，凸显抵挡感
            const scale = 0.4 + t * 1.8;
            const alpha = t < 0.3 ? 1 : Math.max(0, 1 - (t - 0.3) / 0.7);
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = '#e0e8ff';
            ctx.font = `bold ${Math.round(32 * scale)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#aaccff';
            ctx.shadowBlur = 18 + t * 10;
            ctx.fillText('🛡', fx.x, fx.y);
            ctx.restore();
        } else {
            const ease = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85; // 快速弹出 → 缓慢衰减
            const scale = 0.3 + ease * 1.6;  // 0.3 → 1.9 → 0.3
            const alpha = t < 0.2 ? t / 0.2 : Math.max(0, 1 - (t - 0.2) / 0.8);

            ctx.save();
            ctx.globalAlpha = alpha;

            // Layer 1: 扩散光环
            const ringR = HEX_SIZE * (0.4 + t * 1.4);
            const ringAlpha = alpha * (1 - t);
            ctx.beginPath();
            ctx.arc(fx.x, fx.y, ringR, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,215,0,${ringAlpha})`;
            ctx.lineWidth = 2.5 * (1 - t);
            ctx.stroke();

            // Layer 2: 中心星标
            ctx.fillStyle = '#ffd700';
            ctx.font = `bold ${Math.round(28 * scale)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = 20 + ease * 16;
            ctx.fillText(fx.glyph || '🎖️', fx.x, fx.y);

            // Layer 3: 技能名文字上浮
            if (fx.label) {
                const labelY = fx.y - 16 - t * 30;
                const labelAlpha = t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.25) / 0.75);
                ctx.fillStyle = `rgba(255,220,80,${labelAlpha})`;
                ctx.font = 'bold 13px "Noto Serif SC", "Noto Serif CJK SC", "Microsoft YaHei", serif';
                ctx.shadowColor = 'rgba(0,0,0,0.75)';
                ctx.shadowBlur = 4;
                // 文字描边增强可读性
                ctx.strokeStyle = `rgba(0,0,0,${labelAlpha * 0.6})`;
                ctx.lineWidth = 2.5;
                ctx.strokeText(fx.label, fx.x, labelY);
                ctx.fillText(fx.label, fx.x, labelY);
            }

            ctx.restore();
        }
    }
}

// ===== 铁卫灵光（7格集群外边界） =====================
function drawIronGuardAura(now) {
    const pulse = (Math.sin(now / 400) + 1) / 2;

    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || u.commander !== 'ironGuard' || u._shield <= 0) continue;
        const shieldRatio = Math.min(1, u._shield / Math.max(u._shieldMax, 1));
        const alpha = (0.45 + pulse * 0.30) * shieldRatio;
        const fillAlpha = (0.04 + pulse * 0.04) * shieldRatio;
        const clr = `rgba(100,180,255,${alpha})`;

        // use visual position for smooth movement transition
        const vp = u.getVisualPos();
        const auraX = vp.x, auraY = vp.y;
        const offX = auraX - tile.x;
        const offY = auraY - tile.y;

        // 收集自身+6邻格的所有六边形顶点，筛选外边界
        const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
        const vertCount = new Map(); // key: "x,y" → count
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
        // 外边界顶点：出现1~2次（排除被中心+2邻格共享的内部点cnt=3）
        const outer = [];
        for (const [vk, cnt] of vertCount) {
            if (cnt < 3) {
                const [vx, vy] = vk.split(',').map(Number);
                outer.push({ x: vx, y: vy });
            }
        }
        if (outer.length < 6) continue;
        // 按角度排序
        const gx = tile.x, gy = tile.y;
        outer.sort((a, b) => Math.atan2(a.y - gy, a.x - gx) - Math.atan2(b.y - gy, b.x - gx));

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(outer[0].x, outer[0].y);
        for (let i = 1; i < outer.length; i++) ctx.lineTo(outer[i].x, outer[i].y);
        ctx.closePath();
        // 半透明填充
        ctx.fillStyle = clr.replace(/[\d.]+\)$/, `${fillAlpha})`);
        ctx.fill();
        // 外发光宽描边
        ctx.strokeStyle = clr;
        ctx.lineWidth = 1 + shieldRatio * 2.5;
        ctx.shadowColor = clr;
        ctx.shadowBlur = (14 + pulse * 6) * shieldRatio;
        ctx.stroke();
        ctx.restore();
    }
}

// ===== 单位六边形辉光（堕天使/铁卫/狂暴/禁锢）—— 立绘之前 =====================
function drawUnitHexAuras(now) {
    const time = now / 1000;
    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u) continue;
        const pos = u.getVisualPos();
        const vx = pos.x, vy = pos.y;

        // 禁锢光环
        if (u._imprisoned) {
            ctx.save();
            const pulse = (Math.sin(now / 300) + 1) / 2;
            ctx.strokeStyle = `rgba(255,136,68,${0.4 + pulse * 0.4})`;
            ctx.lineWidth = 3;
            hexPath(ctx, vx, vy, HEX_SIZE + 4);
            ctx.stroke();
            ctx.restore();
        }

        // 堕天使形态辉光（仅六边形外轮廓）
        if (u.commander === 'fallenAngel') {
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

        // 狂战士血怒辉光（已损生命值越多越明显，上限50层=75%HP损失）
        if (u.commander === 'berserker' && u.hp < u.maxHp) {
            const hpLostPct = ((u.maxHp - u.hp) / u.maxHp) * 100;
            const stacks = Math.min(50, Math.floor(hpLostPct / 1.5));
            if (stacks > 0) {
                ctx.save();
                const intensity = stacks / 50; // 0~1
                const ragePulse = (Math.sin(time * 6 * Math.PI) + 1) / 2;
                const rageAlpha = (0.15 + ragePulse * 0.25) * intensity;
                const rageR = HEX_SIZE + 3 + ragePulse * 5 * intensity;
                drawHexagonOutline(ctx, vx, vy, rageR, `rgba(255,40,0,${rageAlpha})`, 2 + intensity);
                drawHexagonOutline(ctx, vx, vy, rageR + 3, `rgba(255,100,40,${rageAlpha * 0.5})`, 1 + intensity * 0.5);
                ctx.restore();
            }
        }

        // 铁卫护盾基底环（仅六边形外轮廓，glyph 保留在 Unit.draw 中）
        if (u.commander === 'ironGuard' && u._shield > 0) {
            ctx.save();
            const shieldRatio = Math.min(1, u._shield / Math.max(u._shieldMax, 1));
            const shieldPulse = (Math.sin(time * 3 * Math.PI) + 1) / 2;
            const inFlash = performance.now() < u._shieldPulseUntil;
            const flashT = inFlash ? 1 - (u._shieldPulseUntil - performance.now()) / 800 : 0;
            const baseAlpha = shieldRatio * (inFlash ? 0.25 + flashT * 0.3 : 0.12 + shieldPulse * 0.12);
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 2,
                `rgba(100,160,220,${baseAlpha})`, 1 + shieldRatio);
            ctx.restore();
        }

        // 圣骑士勇气灵光 — 金色六边形光环 + 地面辉光（自身及相邻友军）
        if (u.commander === 'paladin') {
            ctx.save();
            const couragePulse = (Math.sin(now / 400) + 1) / 2;
            // 地面辉光填充
            const glow = ctx.createRadialGradient(vx, vy, HEX_SIZE * 0.15, vx, vy, HEX_SIZE);
            glow.addColorStop(0, 'rgba(255,215,0,0)');
            glow.addColorStop(0.5, `rgba(255,215,0,${0.03 + couragePulse * 0.05})`);
            glow.addColorStop(1, `rgba(255,215,0,${0.12 + couragePulse * 0.14})`);
            ctx.fillStyle = glow;
            hexPath(ctx, vx, vy, HEX_SIZE);
            ctx.fill();
            // 金色光环
            const courageAlpha = 0.30 + couragePulse * 0.40;
            ctx.shadowColor = `rgba(255,215,0,${courageAlpha * 0.8})`;
            ctx.shadowBlur = 16;
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 2,
                `rgba(255,215,0,${courageAlpha})`, 3.5);
            ctx.restore();
        } else if (u.camp && gameState.tileMap) {
            // 相邻友军受勇气灵光影响
            let hasPaladinNeighbor = false;
            for (const [dq, dr] of HEX_NEIGHBORS) {
                const nb = gameState.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                if (nb && nb.unit && nb.unit.commander === 'paladin' && nb.unit.camp === u.camp) {
                    hasPaladinNeighbor = true;
                    break;
                }
            }
            if (hasPaladinNeighbor) {
                ctx.save();
                const couragePulse = (Math.sin(now / 400) + 1) / 2;
                const courageAlpha = 0.22 + couragePulse * 0.30;
                ctx.shadowColor = `rgba(255,215,0,${courageAlpha * 0.6})`;
                ctx.shadowBlur = 10;
                drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 1,
                    `rgba(255,215,0,${courageAlpha})`, 2.5);
                ctx.restore();
            }
        }

        // 牧师治愈灵光 — 绿色六边形光环 + 向内辐射辉光（单格）
        if (u._healingAura > 0) {
            ctx.save();
            const healPulse = (Math.sin(now / 300) + 1) / 2;
            const healAlpha = 0.35 + healPulse * 0.45;
            // 向内辐射：径向渐变，边缘亮、中心透明
            const innerGlow = ctx.createRadialGradient(vx, vy, HEX_SIZE * 0.15, vx, vy, HEX_SIZE);
            innerGlow.addColorStop(0, 'rgba(144,255,180,0)');
            innerGlow.addColorStop(0.45, 'rgba(144,255,180,0.06)');
            innerGlow.addColorStop(0.75, `rgba(144,255,180,${0.12 + healPulse * 0.10})`);
            innerGlow.addColorStop(1, `rgba(144,255,180,${0.25 + healPulse * 0.15})`);
            ctx.fillStyle = innerGlow;
            hexPath(ctx, vx, vy, HEX_SIZE);
            ctx.fill();
            // 外光环：浅亮绿色
            ctx.shadowColor = `rgba(144,255,180,${healAlpha * 0.7})`;
            ctx.shadowBlur = 14;
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 1,
                `rgba(144,255,200,${healAlpha})`, 3);
            ctx.restore();
        }

        // E3 纵横家连横金虚线（在敌方行政区内时）
        if (u.commander === 'diplomat' && u.hp > 0 && u.tile && u.tile.camp !== u.camp) {
            ctx.save();
            const dipPulse = (Math.sin(time * 3 * Math.PI) + 1) / 2;
            const dipAlpha = 0.2 + dipPulse * 0.15;
            ctx.setLineDash([4, 4]);
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 3, `rgba(255,200,50,${dipAlpha})`, 2);
            ctx.setLineDash([]);
            ctx.restore();
        }

        // E1 占星者星光力场（3格范围内友军淡蓝色星光罩）
        if (u.commander === 'astrologer' && u.hp > 0 && gameState.tileMap) {
            ctx.save();
            const starPulse = (Math.sin(time * 2 * Math.PI) + 1) / 2;
            // 占星者自身：金色星辰轨迹环绕
            const starCount = 5;
            for (let i = 0; i < starCount; i++) {
                const angle = time * 0.5 + (i / starCount) * Math.PI * 2;
                const r = HEX_SIZE * 0.7;
                const sx = vx + Math.cos(angle) * r;
                const sy = vy + Math.sin(angle) * r * 0.6;
                ctx.fillStyle = `rgba(255,215,100,${0.5 + starPulse * 0.3})`;
                ctx.font = '8px serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('✦', sx, sy);
            }
            ctx.restore();
        }
        // 星光力场内友军：淡蓝色六边形星光罩
        if (u.commander !== 'astrologer' && u.hp > 0 && gameState.tileMap) {
            const astrologerDef = getCommander('astrologer');
            if (astrologerDef && astrologerDef.isInWeatherShield &&
                astrologerDef.isInWeatherShield(tile, u.camp, gameState.tileMap)) {
                ctx.save();
                const shieldPulse = (Math.sin(time * 2.5 * Math.PI) + 1) / 2;
                const shieldAlpha = 0.08 + shieldPulse * 0.06;
                drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 2,
                    `rgba(100,150,255,${shieldAlpha})`, 1.5);
                ctx.restore();
            }
        }
    }
}

// E2 亡灵法师——亡魂标记渲染
function drawSoulMarks(now) {
    if (!gameState._soulMarks || gameState._soulMarks.length === 0) return;
    const time = now / 1000;
    for (const mark of gameState._soulMarks) {
        const tile = gameState.tileMap && gameState.tileMap.get(`${mark.q},${mark.r}`);
        if (!tile) continue;
        const vx = tile.x, vy = tile.y;
        const alpha = 0.4 + Math.sin(time * 2 + mark.q) * 0.2;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '18px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('👻', vx, vy);
        ctx.restore();
        // 绿色鬼火粒子（简化为闪烁圆形）
        ctx.save();
        const glowAlpha = 0.15 + Math.sin(time * 3) * 0.1;
        ctx.fillStyle = `rgba(68,255,136,${glowAlpha})`;
        ctx.beginPath();
        ctx.arc(vx, vy - 2, HEX_SIZE * 0.25, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// ===== 缚足色层（停滞者） =====================
function drawStallerZone(now) {
    const ring1 = new Set(); // 距离 0-1
    const ring2 = new Set(); // 距离 2
    const stallerData = [];
    const dirs1 = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
    // 距离2偏移（不含距离0/1）
    const dirs2 = [[2,0],[2,-1],[2,-2],[1,-2],[1,1],[0,2],[0,-2],[-1,2],[-1,-1],[-2,0],[-2,1],[-2,2]];

    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || u.commander !== 'staller' || u.hp <= 0) continue;
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
    // ring2 中去掉已被 ring1 覆盖的
    for (const t of ring1) ring2.delete(t);

    const breathe = 0.5 + 0.5 * Math.sin(now / 1200 * Math.PI * 2);

    // ── 第1圈：荆棘边框 + 底色 ──
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

    // ── 第2圈：较淡的锁链边框 + 浅底色 ──
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

    // ── 停滞者光环 + 触须（仅第1圈邻格） ──
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
            // 触须末端超出邻格中心 12%
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

    // ── 殉道者自爆预警光环（2格范围） ──
    for (const tile of gameState.tiles) {
        if (!tile.unit || !tile.unit._martyrPrimed || tile.unit.hp <= 0) continue;
        const mx = tile.x, my = tile.y;
        const pulse = (Math.sin(now / 200) + 1) / 2;

        // 2格危险范围
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

        // 醒目光环
        ctx.save();
        ctx.strokeStyle = `rgba(255,60,0,${0.5 + pulse * 0.4})`;
        ctx.lineWidth = 3 + pulse * 2;
        ctx.shadowColor = '#ff2200';
        ctx.shadowBlur = 10 + pulse * 8;
        hexPath(ctx, mx, my, HEX_SIZE + 3);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 倒计时文字
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('💥', mx, my - HEX_SIZE * 0.7);
        ctx.restore();
    }
}

// 逐格描出六边形区域外边界（行进虚线）。
// insideFn(q,r) 判定某格是否属于该区域；邻格出界(地图边界)→不描，避免沿地图边缘画线。
// 顶点角 60i-30，边 k(0..5) 连接顶点 k、k+1，朝向 60k°；轴向邻向→边序号见 NB。
function _strokeHexRegionBorder(tiles, insideFn, now, pulse, outer, inner) {
    const NB = [[1, 0, 0], [0, 1, 1], [-1, 1, 2], [-1, 0, 3], [0, -1, 4], [1, -1, 5]];
    ctx.save();
    ctx.beginPath();
    for (const ht of tiles) {
        for (const [ndq, ndr, ek] of NB) {
            const nq = ht.q + ndq, nr = ht.r + ndr;
            if (!gameState.tileMap.has(`${nq},${nr}`)) continue; // 出界 → 地图边界不描
            if (insideFn(nq, nr)) continue;                       // 区域内 → 内部边不描
            const a0 = (Math.PI / 180) * (60 * ek - 30);
            const a1 = (Math.PI / 180) * (60 * (ek + 1) - 30);
            ctx.moveTo(ht.x + HEX_SIZE * Math.cos(a0), ht.y + HEX_SIZE * Math.sin(a0));
            ctx.lineTo(ht.x + HEX_SIZE * Math.cos(a1), ht.y + HEX_SIZE * Math.sin(a1));
        }
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([14, 9]);
    ctx.lineDashOffset = -(now / 22) % 23; // 行进虚线（marching ants）
    ctx.strokeStyle = outer.color;
    ctx.lineWidth = outer.w;
    ctx.shadowColor = outer.glow;
    ctx.shadowBlur = outer.blur;
    ctx.stroke();
    if (inner) {
        ctx.strokeStyle = inner.color;
        ctx.lineWidth = inner.w;
        ctx.shadowBlur = 0;
        ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
}

// ===== 范围涟漪展开 =====================
function drawRangeApertures(now) {
    if (gameState.aiActing || !_isHumanTurn()) return;

    const deselecting = gameState.deselecting;
    if (!deselecting && !gameState.cardTargeting && (!gameState.selectedUnit || !gameState.selectedUnit.canAct || gameState.selectedUnit.isNewRecruit)) return;

    const pulse = (Math.sin(now / 300) + 1) / 2;
    const ease = p => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2);

    const stepDelay = 70;
    const hexExpandDuration = 100;
    const elapsed = now - gameState.selectionTime;

    // 对策卡选择目标高亮
    if (gameState.cardTargeting) {
        const pulse = (Math.sin(now / 280) + 1) / 2;
        const baseAlpha = 0.35 + pulse * 0.55;
        const ct = gameState.cardTargeting;
        const myCamp = isNetworkGame() ? (getMyRole() === 'player1' ? CAMP.player1 : getMyRole() === 'player2' ? CAMP.player2 : CAMP.player3) : gameState.currentCamp;
        const isColTargeting = !!COLONEL_CARDS[ct.cardId] || ct.cardId === 'airlift_dest';
        const isHeal = ct.targeting === 'friendlyAny' || ct.targeting === 'anyUnit';
        const isShield = ct.targeting === 'shieldTarget';
        const isEmpty = ct.targeting === 'emptyTile' || ct.targeting === 'emptyFriendlyNonCityNonMountain' || ct.targeting === 'emptyFriendlyLandmine';
        const isFriendly = ct.targeting === 'friendlyAlive' || ct.targeting === 'friendlyAny' || isShield;

        // E4 上校空军卡：航程/防空覆盖层——画在目标高亮【之下】，避免边界目标与蓝圈叠加冲突
        if (isColTargeting) {
            const colonel = getColonelUnit(myCamp);
            if (colonel && colonel.tile) {
                const AR = ANTIAIR_RADIUS;
                // 防空区并集（"q,r" 键）
                const aaSet = new Set();
                for (const t of gameState.tiles) {
                    const u = t.unit;
                    if (!u || u.camp === myCamp || !isAntiAirUnit(u)) continue;
                    for (let dq = -AR; dq <= AR; dq++) {
                        for (let dr = Math.max(-AR, -dq - AR); dr <= Math.min(AR, -dq + AR); dr++) {
                            const nb = gameState.tileMap.get(`${t.q + dq},${t.r + dr}`);
                            if (nb) aaSet.add(`${nb.q},${nb.r}`);
                        }
                    }
                }
                // 红色防空区填充
                ctx.save();
                ctx.globalAlpha = 0.10 + pulse * 0.06;
                ctx.fillStyle = '#ff4636';
                const aaTiles = [];
                for (const key of aaSet) {
                    const nb = gameState.tileMap.get(key);
                    if (nb) { aaTiles.push(nb); hexPath(ctx, nb.x, nb.y, HEX_SIZE + 1); ctx.fill(); }
                }
                ctx.restore();
                // 红色防空区外边界线
                _strokeHexRegionBorder(aaTiles, (q, r) => aaSet.has(`${q},${r}`), now, pulse,
                    { color: `rgba(255,80,70,${0.85 + pulse * 0.15})`, w: 3, glow: 'rgba(255,60,50,0.95)', blur: 12 + pulse * 6 },
                    { color: `rgba(255,225,215,${0.5 + pulse * 0.3})`, w: 1.2 });
                // 蓝色航程外边界线（地图边界处不描）
                const R = COLONEL_AIR_RANGE, cq = colonel.tile.q, cr = colonel.tile.r;
                const rangeTiles = [];
                for (let dq = -R; dq <= R; dq++) {
                    for (let dr = Math.max(-R, -dq - R); dr <= Math.min(R, -dq + R); dr++) {
                        const ht = gameState.tileMap.get(`${cq + dq},${cr + dr}`);
                        if (ht) rangeTiles.push(ht);
                    }
                }
                const inRangeFn = (q, r) => Math.max(Math.abs(q - cq), Math.abs(r - cr), Math.abs((q + r) - (cq + cr))) <= R;
                _strokeHexRegionBorder(rangeTiles, inRangeFn, now, pulse,
                    { color: `rgba(120,200,255,${0.62 + pulse * 0.13})`, w: 2.6, glow: 'rgba(90,180,255,0.55)', blur: 7 + pulse * 4 },
                    { color: `rgba(230,245,255,${0.4 + pulse * 0.2})`, w: 1 });
            }
        }

        for (const tile of gameState.tiles) {
            if (ct.targeting === 'enemyGlobal') {
                if (!tile.unit) continue;
                if (tile.unit.camp === myCamp) continue;
            } else if (ct.targeting === 'enemyCity') {
                if (!tile.isCity || tile.camp === myCamp) continue;
            } else if (ct.targeting === 'friendlyAlive') {
                if (!tile.unit || !tile.unit.canAct || tile.unit.camp !== myCamp) continue;
            } else if (ct.targeting === 'friendlyAny') {
                if (!tile.unit || tile.unit.camp !== myCamp) continue;
            } else if (ct.targeting === 'anyUnit') {
                if (!tile.unit) continue;
            } else if (ct.targeting === 'shieldTarget') {
                if (!tile.unit) continue;
            } else if (ct.targeting === 'emptyTile') {
                if (tile.unit) continue;
            } else if (ct.targeting === 'emptyFriendlyNonCityNonMountain') {
                if (tile.unit || tile.isCity || tile.terrain === 'mountain' || tile.camp !== myCamp) continue;
            } else if (ct.targeting === 'emptyFriendlyLandmine') {
                if (tile.unit || tile.isCity || tile.camp !== myCamp) continue;
            } else if (ct.targeting === 'anyTileGlobal') {
                // 侦察卡：全图任何地块都可选
            } else { continue; }

            // 遭遇战迷雾：对策卡仅高亮视野内目标（侦察卡除外）
            if (gameState.skirmishFog && ct.targeting !== 'anyTileGlobal') {
                const viewingCamp = getViewingCamp();
                if (!isTileVisible(tile, viewingCamp, gameState)) continue;
            }

            // E4 上校空军卡：超出航程的目标不高亮（含空运；防空区仍高亮，只是降伤）
            if (isColTargeting && isColonelTargetBlocked(tile, myCamp)) continue;
            // E4 空运：不能运送上校自己
            if (ct.cardId === 'airlift' && tile.unit && tile.unit.commander === 'colonel') continue;

            let r, g, b;
            if (isHeal)       { r = 80;  g = 255; b = 100; }
            else if (isShield) { r = 100; g = 180; b = 255; } // light blue for shield
            else if (ct.targeting === 'enemyCity') { r = 255; g = 120; b = 30; } // orange for airstrike
            else if (ct.targeting === 'anyTileGlobal') { r = 160; g = 200; b = 255; } // light cyan for scout
            else if (isEmpty) { r = 100; g = 200; b = 255; } // blue for deploy/landmine
            else if (isFriendly) { r = 255; g = 200; b = 50; } // gold for friendly
            else              { r = 255; g = 50;  b = 50; } // red for enemy

            const fillA = baseAlpha * 0.25;
            const strokeA = baseAlpha * (0.3 + 0.7);
            ctx.save();
            hexPath(ctx, tile.x, tile.y, HEX_SIZE);
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${fillA})`;
            ctx.fill();
            hexPath(ctx, tile.x, tile.y, HEX_SIZE);
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${strokeA})`;
            ctx.lineWidth = 3;
            ctx.stroke();
            hexPath(ctx, tile.x, tile.y, HEX_SIZE + 3);
            ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${strokeA * 0.3})`;
            ctx.lineWidth = 2;
            ctx.stroke();
            // X / + marker
            if (!isFriendly && !isEmpty) {
                const mA = 0.2 + pulse * 0.55;
                ctx.strokeStyle = `rgba(255, 0, 0, ${mA})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(tile.x - 8, tile.y - 8);
                ctx.lineTo(tile.x + 8, tile.y + 8);
                ctx.moveTo(tile.x + 8, tile.y - 8);
                ctx.lineTo(tile.x - 8, tile.y + 8);
                ctx.stroke();
            } else if (isEmpty) {
                const pA = 0.2 + pulse * 0.55;
                ctx.strokeStyle = `rgba(100, 200, 255, ${pA})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(tile.x - 8, tile.y); ctx.lineTo(tile.x + 8, tile.y);
                ctx.moveTo(tile.x, tile.y - 8); ctx.lineTo(tile.x, tile.y + 8);
                ctx.stroke();
            } else if (isHeal) {
                const pA = 0.2 + pulse * 0.55;
                ctx.strokeStyle = `rgba(80, 255, 100, ${pA})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(tile.x - 8, tile.y); ctx.lineTo(tile.x + 8, tile.y);
                ctx.moveTo(tile.x, tile.y - 8); ctx.lineTo(tile.x, tile.y + 8);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    // 无选中单位 → 跳过正常范围涟漪
    if (!gameState.selectedUnit) return;

    let startTile, moveTiles, atkTiles;
    let shrinkP = 0;

    if (deselecting) {
        const shrinkDuration = 350;
        shrinkP = Math.min(1, (now - gameState.deselectionTime) / shrinkDuration);
        if (shrinkP >= 1) {
            gameState.deselecting = false;
            gameState.deselectMoveTiles = [];
            gameState.deselectAtkTiles = [];
            gameState.deselectOrigin = null;
            return;
        }
        startTile = gameState.deselectOrigin;
        moveTiles = gameState.deselectMoveTiles;
        atkTiles = gameState.deselectAtkTiles;
    } else {
        startTile = gameState.selectedUnit.tile;
        moveTiles = gameState.selectedUnit.remainingMP > 0 ? gameState.movableTiles : [];
        atkTiles = gameState.attackableTiles;
    }

    function getHexProgress(tile) {
        const dist = (Math.abs(tile.q - startTile.q) + Math.abs(tile.r - startTile.r) + Math.abs(tile.s - startTile.s)) / 2;
        if (deselecting) return 1;
        const delay = dist * stepDelay;
        const raw = (elapsed - delay) / hexExpandDuration;
        return Math.max(0, Math.min(raw, 1));
    }

    function drawExpandingHex(tile, r, g, b, baseAlpha) {
        let p = getHexProgress(tile);
        if (p <= 0) return;

        let ep = ease(p);
        if (deselecting) ep *= (1 - ease(shrinkP));
        if (ep <= 0.001) return;

        const currentSize = HEX_SIZE * ep;
        const fillA = baseAlpha * 0.25 * ep;
        const strokeA = baseAlpha * (0.3 + 0.7 * ep);
        const lineW = 1 + ep * 2;

        ctx.save();
        hexPath(ctx, tile.x, tile.y, currentSize);
        ctx.fillStyle = `rgba(${r},${g},${b},${fillA})`;
        ctx.fill();

        hexPath(ctx, tile.x, tile.y, currentSize);
        ctx.strokeStyle = `rgba(${r},${g},${b},${strokeA})`;
        ctx.lineWidth = lineW;
        ctx.stroke();

        if (ep > 0.7) {
            const glowA = strokeA * (ep - 0.7) / 0.3 * 0.3;
            hexPath(ctx, tile.x, tile.y, currentSize + 3);
            ctx.strokeStyle = `rgba(${r},${g},${b},${glowA})`;
            ctx.lineWidth = 2;
            ctx.stroke();
        }
        ctx.restore();
    }

    for (const tile of moveTiles) {
        drawExpandingHex(tile, 0, 200, 255, 0.6 + pulse * 0.15);
    }

    for (const tile of atkTiles) {
        drawExpandingHex(tile, 255, 50, 50, 0.6 + pulse * 0.15);
        if (tile.unit) {
            const p = getHexProgress(tile);
            if (p > 0) {
                const ep = ease(p) * (deselecting ? (1 - ease(shrinkP)) : 1);
                if (ep <= 0.001) continue;
                const xAlpha = 0.2 + 0.4 * ep;
                ctx.save();
                ctx.strokeStyle = `rgba(255, 0, 0, ${xAlpha})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(tile.x - 8, tile.y - 8);
                ctx.lineTo(tile.x + 8, tile.y + 8);
                ctx.moveTo(tile.x + 8, tile.y - 8);
                ctx.lineTo(tile.x - 8, tile.y + 8);
                ctx.stroke();
                ctx.restore();
            }
        }
    }

}

// ===== 伤害文本（弹跳+强击特效） =====================
function drawDamageTexts(now) {
    gameState.damageTexts = gameState.damageTexts.filter(text => {
        text.timeLeft -= now - text.lastUpdate;
        text.lastUpdate = now;
        if (text.timeLeft <= 0) return false;

        const progress = 1 - text.timeLeft / 900;
        const bounce = Math.sin(progress * Math.PI) * 12;
        const alpha = Math.max(0, 1 - progress * 0.6);
        const isBig = text.isCrit || text.isTrueDmg;
        const scale = isBig ? 1 + (1 - progress) * 0.5 : 1;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(text.x, text.y - 30 - bounce);
        ctx.scale(scale, scale);
        ctx.textAlign = 'center';
        ctx.font = isBig ? 'bold 24px Arial' : 'bold 18px Arial';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = isBig ? 8 : 4;

        if (text.isTrueDmg) {
            ctx.fillStyle = '#ffe850';
            ctx.shadowColor = '#ffaa00';
            ctx.shadowBlur = 18;
            ctx.fillText(`-${Math.round(text.value)}`, 0, 0);
            // 二次绘制强化灼烧感
            ctx.shadowBlur = 8;
            ctx.fillText(`-${Math.round(text.value)}`, 0, 0);
        } else if (text.isCrit) {
            ctx.fillStyle = '#ff4400';
            ctx.shadowColor = '#ff4400';
            ctx.shadowBlur = 14;
            ctx.fillText(`-${Math.round(text.value)}`, 0, 0);
        } else {
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#000';
            ctx.shadowBlur = 5;
            ctx.fillText(`-${Math.round(text.value)}`, 0, 0);
        }
        ctx.restore();
        return true;
    });
}

// ===== 治疗文本（增强版：浮起效果） =====================
function drawHealTexts(now) {
    gameState.healTexts = gameState.healTexts.filter(text => {
        text.timeLeft -= now - text.lastUpdate;
        text.lastUpdate = now;
        if (text.timeLeft <= 0) return false;

        const progress = 1 - text.timeLeft / 1000;
        const floatUp = progress * 20;
        const alpha = Math.max(0, 1 - progress);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.font = 'bold 18px Arial';
        ctx.shadowColor = '#00aa44';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#44ff88';
        ctx.fillText(`+${Math.round(text.value)}`, text.x, text.y - 30 - floatUp);
        ctx.restore();
        return true;
    });
}

// ===== 资金浮动文本 =====================
function drawGoldTexts(now) {
    gameState.goldTexts = gameState.goldTexts.filter(text => {
        text.timeLeft -= now - text.lastUpdate;
        text.lastUpdate = now;
        if (text.timeLeft <= 0) return false;
        if (text._duration === undefined) text._duration = text.timeLeft;

        const progress = 1 - text.timeLeft / text._duration;
        const floatUp = progress * 15;
        const alpha = Math.max(0, 1 - progress);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.font = 'bold 17px Arial';
        ctx.shadowColor = text.shadowColor || '#aa8800';
        ctx.shadowBlur = 6;
        ctx.fillStyle = text.color;
        ctx.fillText(`${text.prefix}$${Math.round(text.value)}`, text.x, text.y - 25 - floatUp);
        ctx.restore();
        return true;
    });
}

// ===== 对策卡手牌（独立 Canvas，横向叠放，hover 抽出 + 抽牌堆动画） =====================
let _slideTargets = [];   // per-card target: 0=collapsed, 1=slid out
let _slideCurrent = [];   // per-card current visual
const SLIDE_SPEED = 0.12; // lerp speed per frame (~60fps → completes in ~400ms)

// draw pile state
let _drawPileArmed = false;
let _fuelBtnRect = null; // E4: 燃料购买按钮区域 { x, y, w, h, canBuy }
let _drawPileArmTime = 0;
const DRAW_ARM_TIMEOUT = 3000;
let _flyingCard = null;
let _prevHandLen = 0;
let _shiftOffset = 0;  // lerps to 0: negative when card added, positive when removed
let _lastTurnCounter = -1;  // guard: detect turn change to reset draw pile UI

function _getMyCampForUI() {
    if (isNetworkGame()) {
        const role = getMyRole();
        return role === 'player1' ? CAMP.player1 : role === 'player2' ? CAMP.player2 : role === 'player3' ? CAMP.player3 : null;
    }
    if (gameState.gameMode === 'pve') return CAMP.player1;
    return gameState.currentCamp;
}

export function setCardHoveredIndex(idx) {
    // set all targets: 1 for the hovered card, 0 for others
    for (let i = 0; i < _slideTargets.length; i++) {
        _slideTargets[i] = (i === idx) ? 1 : 0;
    }
}

function armDrawPile() { _drawPileArmed = true; _drawPileArmTime = performance.now(); }
function disarmDrawPile() { _drawPileArmed = false; }
export function triggerFlyingCard(cardId, sx, sy, ex, ey) {
    _flyingCard = { cardId, startX: sx, startY: sy, endX: ex, endY: ey, t0: performance.now(), dur: 400 };
}

function getCardSlideCurrent(i) {
    return _slideCurrent[i] || 0;
}

function _ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

function _drawPokerCard(cctx, cx, cy, cardW, cardH, cfg, opts = {}) {
    const { disabled, isTargeting, isDeploy, alreadyDeployed, isHovered, alpha, isCopyCard } = opts;
    cctx.save();
    if (alpha !== undefined) cctx.globalAlpha = alpha;
    cctx.translate(cx, cy);

    cctx.shadowColor = 'rgba(0,0,0,0.5)';
    cctx.shadowBlur = isHovered ? 10 : 6;
    cctx.shadowOffsetX = 2; cctx.shadowOffsetY = 3;

    cctx.fillStyle = disabled ? 'rgba(30,25,20,0.7)' : (isDeploy ? '#1a1208' : '#14100a');
    cctx.strokeStyle = isTargeting ? '#ff5555' : (isDeploy ? '#e0b840' : (isHovered ? '#d0a030' : '#b09050'));
    cctx.lineWidth = isTargeting ? 3 : 2;
    cctx.beginPath();
    cctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
    cctx.fill();

    cctx.shadowColor = 'transparent'; cctx.shadowBlur = 0; cctx.shadowOffsetX = 0; cctx.shadowOffsetY = 0;
    cctx.strokeStyle = isTargeting ? '#ff5555' : (isDeploy ? '#c09830' : '#8a6a38');
    cctx.lineWidth = 1;
    cctx.beginPath();
    cctx.roundRect(-cardW / 2 + 5, -cardH / 2 + 5, cardW - 10, cardH - 10, 6);
    cctx.stroke();

    cctx.strokeStyle = isTargeting ? '#ff5555' : (isDeploy ? '#e0b840' : (isHovered ? '#d0a030' : '#b09050'));
    cctx.lineWidth = isTargeting ? 3 : 2;
    cctx.beginPath();
    cctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
    cctx.stroke();

    const deployPortrait = (isDeploy && opts.commanderId) ? getPortrait(opts.commanderId) : null;

    if (deployPortrait) {
        // 圆形将领头像替代 emoji 图标
        cctx.save();
        cctx.imageSmoothingQuality = 'high';
        cctx.beginPath();
        cctx.arc(0, -14, 26, 0, Math.PI * 2);
        cctx.clip();
        // 裁切原图顶部正方形区域（头部聚焦），等比缩放
        const iw = deployPortrait.naturalWidth;
        const ih = deployPortrait.naturalHeight;
        const cropSize = ih * 0.40;
        const sx = (iw - cropSize) / 2;
        const sy = ih * 0.03;
        cctx.drawImage(deployPortrait, sx, sy, cropSize, cropSize, -26, -40, 52, 52);
        cctx.restore();
        // 圆形金色边框
        cctx.strokeStyle = disabled ? '#666' : '#e0b840';
        cctx.lineWidth = 2;
        cctx.beginPath();
        cctx.arc(0, -14, 26, 0, Math.PI * 2);
        cctx.stroke();
    } else {
        cctx.fillStyle = disabled ? '#666' : '#ffd700';
        cctx.font = '36px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
        cctx.fillText(cfg.icon, 0, -12);
    }

    cctx.fillStyle = disabled ? '#777' : '#eee';
    cctx.font = 'bold 13px "Noto Serif SC", "Noto Serif CJK SC", serif';
    cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
    cctx.fillText(cfg.name, 0, 28);

    if (isDeploy && alreadyDeployed) {
        cctx.fillStyle = '#ffd700';
        cctx.font = 'bold 16px "Noto Serif SC", "Noto Serif CJK SC", serif';
        cctx.fillText('✓', 0, 48);
    }
    if (isCopyCard) {
        cctx.fillStyle = '#ffd700';
        cctx.font = 'bold 10px "Noto Serif SC", "Noto Serif CJK SC", serif';
        cctx.textAlign = 'right'; cctx.textBaseline = 'top';
        cctx.fillText('副本', cardW / 2 - 4, -cardH / 2 + 4);
        cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
    }
    cctx.restore();
}

export function drawCardCanvas(now) {
    if (!cardCanvas || !cardCtx) return;
    const myCamp = _getMyCampForUI();
    if (!myCamp) { cardCanvas.style.display = 'none'; return; }
    if (gameState.commanderPhase !== 'done' || gameState.gameOver) { cardCanvas.style.display = 'none'; return; }

    const campKey = myCamp === CAMP.player1 ? 'player1' : myCamp === CAMP.player2 ? 'player2' : 'player3';
    const hand = gameState.playerHands[campKey] || [];
    const isNeutralTurn = gameState.currentCamp === CAMP.neutral && !isNetworkGame();

    // ---- per-card slide animation (lerp toward target each frame) ----
    const n = hand.length;
    while (_slideTargets.length < n) { _slideTargets.push(0); _slideCurrent.push(0); }
    while (_slideTargets.length > n) { _slideTargets.pop(); _slideCurrent.pop(); }
    for (let i = 0; i < n; i++) {
        // 选中的目标手牌锁定在抽出状态
        if (gameState.cardTargeting && gameState.cardTargeting.cardId === hand[i]) {
            _slideTargets[i] = 1;
            _slideCurrent[i] = 1;
            continue;
        }
        _slideCurrent[i] += (_slideTargets[i] - _slideCurrent[i]) * SLIDE_SPEED;
        if (Math.abs(_slideCurrent[i] - _slideTargets[i]) < 0.001) _slideCurrent[i] = _slideTargets[i];
    }

    // ---- draw pile auto-disarm ----
    if (_drawPileArmed && now - _drawPileArmTime > DRAW_ARM_TIMEOUT) {
        _drawPileArmed = false;
    }

    // ---- DPR ----
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = cardCanvas.clientWidth || 360;
    const cssH = cardCanvas.clientHeight || 620;
    if (cardCanvas.width !== cssW * dpr || cardCanvas.height !== cssH * dpr) {
        cardCanvas.width = cssW * dpr; cardCanvas.height = cssH * dpr;
    }
    const cctx = cardCtx;
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cctx.clearRect(0, 0, cssW, cssH);
    const W = cssW, H = cssH;
    cardCanvas.style.display = 'block';

    // guard: reset draw pile state on turn change to prevent stale UI
    if (gameState.turnCounter !== _lastTurnCounter) {
        _lastTurnCounter = gameState.turnCounter;
        _drawPileArmed = false;
    }

    const cardW = 90, cardH = 130, peekW = 72;
    const liftAmount = 25; // how far hovered card rises upward

    const isMyTurn = isNetworkGame()
        ? (getMyRole() === 'player1' ? gameState.currentCamp === CAMP.player1 : getMyRole() === 'player2' ? gameState.currentCamp === CAMP.player2 : gameState.currentCamp === CAMP.player3)
        : (gameState.gameMode === 'pve'
            ? (gameState.currentCamp === CAMP.player1 && !isNeutralTurn)
            : (gameState.currentCamp === myCamp && !isNeutralTurn));
    const currentDrawCost = gameState.playerDrawsThisTurn[campKey] === 0 ? CARD_SYSTEM_CONFIG.drawCost : CARD_SYSTEM_CONFIG.drawCost * 2;
    const canDraw = isMyTurn && !gameState.cardTargeting
        && hand.length < CARD_SYSTEM_CONFIG.maxHandSize
        && gameState.playerDrawsThisTurn[campKey] < CARD_SYSTEM_CONFIG.maxDrawsPerTurn
        && gameState.playerGold[campKey] >= currentDrawCost;

    // ---- draw pile (top-right, same size/style as hand cards) ----
    const pileW = cardW, pileH = cardH, pileX = W - pileW - 8, pileY = 8;
    const pileCount = gameState.cardDrawPile.length;
    const pileActive = (isMyTurn || isNeutralTurn) && canDraw && !gameState.cardTargeting;

    const pileDepth = Math.min(pileCount, 5);
    const isArmed = _drawPileArmed && pileActive;
    // Blink factor: pulses 0→1 when active (gold充足+己方回合) and not yet armed
    const blinkT = (pileActive && !isArmed) ? 0.5 + 0.5 * Math.sin(now * 0.006) : 0;

    for (let d = pileDepth - 1; d >= 0; d--) {
        const ox = pileX - d * 2, oy = pileY + d * 2;

        let fillCol, borderCol, innerCol, crossCol;
        if (isArmed) {
            fillCol = '#14100a';
            borderCol = '#ffd700';
            innerCol = '#ffd700';
            crossCol = '#ffd70066';
        } else if (pileActive) {
            fillCol = '#14100a';
            borderCol = _lerpColor('#b09050', '#ffd700', blinkT);
            innerCol = _lerpColor('#8a6a38', '#ffd700', blinkT);
            crossCol = _lerpColor('#8a6a3833', '#ffd70066', blinkT);
        } else {
            // 不可用状态使用旧可用样式
            fillCol = '#14100a';
            borderCol = '#b09050';
            innerCol = '#8a6a38';
            crossCol = '#8a6a3833';
        }

        cctx.fillStyle = fillCol;
        cctx.strokeStyle = borderCol;
        cctx.lineWidth = isArmed ? 2.5 : 2;
        cctx.beginPath();
        cctx.roundRect(ox, oy, pileW, pileH, 10);
        cctx.fill();
        cctx.stroke();
        if (d === 0) {
            cctx.strokeStyle = innerCol;
            cctx.lineWidth = 1;
            cctx.beginPath();
            cctx.roundRect(ox + 5, oy + 5, pileW - 10, pileH - 10, 6);
            cctx.stroke();
            // price on card back
            const cxP = ox + pileW / 2, cyP = oy + pileH / 2;
            cctx.fillStyle = pileActive ? '#ffd700' : '#8a6a38';
            cctx.font = 'bold 18px "Noto Serif SC", "Noto Serif CJK SC", serif';
            cctx.textAlign = 'center';
            cctx.textBaseline = 'middle';
            cctx.shadowColor = pileActive ? 'rgba(255,215,0,0.6)' : 'rgba(0,0,0,0)';
            cctx.shadowBlur = pileActive ? 8 : 0;
            cctx.fillText(`$${currentDrawCost}`, cxP, cyP);
            cctx.shadowBlur = 0;
        }
    }

    // guard: when draw pile is empty, render a faint placeholder outline so the area is never invisible
    if (pileCount === 0) {
        cctx.save();
        cctx.strokeStyle = 'rgba(68,68,68,0.35)';
        cctx.lineWidth = 1;
        cctx.setLineDash([3, 5]);
        cctx.beginPath();
        cctx.roundRect(pileX, pileY, pileW, pileH, 10);
        cctx.stroke();
        cctx.setLineDash([]);
        cctx.restore();
    }

    // E4 空军上校：燃料购买按钮替换抽牌堆
    const isColonel = gameState['commander' + (campKey === 'player1' ? 'P1' : campKey === 'player2' ? 'P2' : 'P3')] === 'colonel';
    _fuelBtnRect = null;
    if (isColonel) {
        const fuelBtnX = pileX, fuelBtnY = pileY, fuelBtnW = pileW, fuelBtnH = pileH;
        const fuel = gameState._fuel?.[campKey] || 0;
        const canBuyFuel = isMyTurn && gameState.playerGold[campKey] >= 3 && !gameState.cardTargeting;
        cctx.fillStyle = '#14100a';
        cctx.strokeStyle = canBuyFuel ? '#ff6600' : '#553322';
        cctx.lineWidth = 2;
        cctx.beginPath();
        cctx.roundRect(fuelBtnX, fuelBtnY, fuelBtnW, fuelBtnH, 10);
        cctx.fill();
        cctx.stroke();
        const cxF = fuelBtnX + fuelBtnW / 2, cyF = fuelBtnY + fuelBtnH / 2 - 10;
        cctx.fillStyle = canBuyFuel ? '#ff8844' : '#553322';
        cctx.font = '28px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
        cctx.fillText('🔥', cxF, cyF);
        cctx.font = 'bold 16px "Noto Serif SC", "Noto Serif CJK SC", serif';
        cctx.fillStyle = '#ff6600';
        cctx.fillText(`${fuel}`, cxF, cyF + 24);
        if (canBuyFuel) {
            cctx.fillStyle = 'rgba(255,102,0,0.12)';
            cctx.beginPath();
            cctx.roundRect(fuelBtnX + 4, fuelBtnY + fuelBtnH - 26, fuelBtnW - 8, 20, 4);
            cctx.fill();
            cctx.fillStyle = '#ff6600';
            cctx.font = 'bold 10px "Noto Serif SC", "Noto Serif CJK SC", serif';
            cctx.fillText('$3 +2🔥', cxF, fuelBtnY + fuelBtnH - 17);
        }
        _fuelBtnRect = { x: fuelBtnX, y: fuelBtnY, w: fuelBtnW, h: fuelBtnH, canBuy: canBuyFuel };
    }

    if (n === 0) return;

    const usesUsed = gameState.playerUsesThisTurn[campKey] || 0;
    const canUse = usesUsed < CARD_SYSTEM_CONFIG.maxUsesPerTurn && !gameState.cardTargeting && !isNeutralTurn;

    const cxBase = 8; // left-aligned stack
    const cyBase = H - 120;

    // smooth shift when hand size changes
    if (n > _prevHandLen) {
        _shiftOffset = -peekW; // existing cards start at old positions, lerp right
    } else if (n < _prevHandLen) {
        _shiftOffset = peekW;  // existing cards start too far right, lerp left
    }
    _prevHandLen = n;
    if (Math.abs(_shiftOffset) > 0.5) {
        _shiftOffset += (0 - _shiftOffset) * 0.12;
        if (Math.abs(_shiftOffset) < 0.5) _shiftOffset = 0;
    }

    let targetCardData = null; // 选中目标的手牌，最后渲染（顶层）

    for (let i = 0; i < n; i++) {
        const cardEntry = hand[i];
        const cardId = typeof cardEntry === 'object' ? cardEntry.id : cardEntry;
        const isCopyCard = typeof cardEntry === 'object' && cardEntry._copy;
        if (_flyingCard && i === n - 1 && cardId === _flyingCard.cardId) continue;
        let cfg = TACTICAL_CARD_CONFIG[cardId] || COLONEL_CARDS[cardId];
        if (!cfg) continue;
        // 部署将领显示所选将领名 + 头像
        let deployCmdId = null;
        if (cardId === 'commanderDeploy') {
            deployCmdId = myCamp === CAMP.player1 ? gameState.commanderP1 : myCamp === CAMP.player2 ? gameState.commanderP2 : gameState.commanderP3;
            const cmdCfg = COMMANDER_CONFIG[deployCmdId];
            if (cmdCfg) cfg = { ...cfg, name: cmdCfg.name };
        }
        const baseX = cxBase + (n - 1 - i) * peekW + _shiftOffset;
        const lift = (_slideCurrent[i] || 0) * liftAmount;
        const x = baseX + cardW / 2;
        const y = cyBase - lift + cardH / 2;

        const isTargeting = gameState.cardTargeting && gameState.cardTargeting.cardId === cardId;
        const isDeploy = cardId === 'commanderDeploy';
        const alreadyDeployed = isDeploy && (myCamp === CAMP.player1 ? gameState.commanderP1Deployed : myCamp === CAMP.player2 ? gameState.commanderP2Deployed : gameState.commanderP3Deployed);
        const isHovered = _slideCurrent[i] > 0.3;
        const drawOpts = { disabled: false, isTargeting: false, isDeploy, alreadyDeployed, isHovered, commanderId: deployCmdId, isCopyCard };

        if (isTargeting) {
            targetCardData = { x, y, cfg, drawOpts: { ...drawOpts, isTargeting: true } };
            continue;
        }

        const disabled = !canUse || (isDeploy && alreadyDeployed);
        drawOpts.disabled = disabled;
        _drawPokerCard(cctx, x, y, cardW, cardH, cfg, drawOpts);
    }

    // 顶层渲染选中的目标卡片
    if (targetCardData) {
        const { x, y, cfg, drawOpts } = targetCardData;
        _drawPokerCard(cctx, x, y, cardW, cardH, cfg, drawOpts);
    }

    // ---- flying card animation ----
    if (_flyingCard) {
        const fc = _flyingCard;
        const elapsed = now - fc.t0;
        const t = Math.min(1, elapsed / fc.dur);
        if (t >= 1) { _flyingCard = null; }
        else {
            const eased = _ease(t);
            const fx = fc.startX + (fc.endX - fc.startX) * eased;
            const fy = fc.startY + (fc.endY - fc.startY) * eased;
            const cfg = TACTICAL_CARD_CONFIG[fc.cardId];
            if (cfg) {
                cctx.save();
                cctx.globalAlpha = 1 - t * 0.2;
                _drawPokerCard(cctx, fx, fy, cardW, cardH, cfg, {});
                cctx.restore();
            }
        }
    }
}

// ===== 烧牌动画 =====================
function drawCardUseAnimation(now) {
    const cardW = 90, cardH = 130;
    for (let i = cardUseEffects.length - 1; i >= 0; i--) {
        const fx = cardUseEffects[i];
        const elapsed = now - fx.startTime;
        if (elapsed > fx.duration) { cardUseEffects.splice(i, 1); continue; }

        const entEnd = fx.phaseDuration;
        const pauseEnd = entEnd + (fx.pauseDuration || 500);
        const burnStart = pauseEnd;
        const burnDur = fx.duration - burnStart;
        const phase = elapsed < entEnd ? 0 : (elapsed < burnStart ? 1 : 2);
        const phaseT = phase === 0 ? Math.min(1, elapsed / entEnd) : (phase === 2 ? Math.min(1, (elapsed - burnStart) / burnDur) : 0);
        const easedEntrance = _ease(phaseT);

        let cx, cy, scale;
        if (phase === 0) {
            if (fx.isLocal) {
                cx = fx.fromX + (fx.x - fx.fromX) * easedEntrance;
                cy = fx.fromY + (fx.y - fx.fromY) * easedEntrance;
                scale = 0.4 + easedEntrance * 0.9;
            } else {
                cx = fx.x; cy = fx.y;
                scale = easedEntrance * 1.3;
            }
        } else {
            cx = fx.x; cy = fx.y; scale = 1.3;
        }

        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);

        const isDeploy = fx.cardId === 'commanderDeploy';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = phase === 2 ? 6 : 8;
        ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;

        if (phase !== 2) {
            // Phase 0 (entrance) + Phase 1 (pause): intact card
            // Entrance phase: card intact
            ctx.fillStyle = isDeploy ? '#1a1208' : '#14100a';
            ctx.beginPath();
            ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
            ctx.fill();

            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
            ctx.strokeStyle = isDeploy ? '#c09830' : '#8a6a38';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(-cardW / 2 + 5, -cardH / 2 + 5, cardW - 10, cardH - 10, 6);
            ctx.stroke();

            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
            ctx.stroke();

            ctx.fillStyle = '#ffd700';
            ctx.font = '36px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(fx.icon, 0, -12);

            ctx.fillStyle = '#eee';
            ctx.font = 'bold 13px "Noto Serif SC", "Noto Serif CJK SC", serif';
            ctx.fillText(fx.name, 0, 28);
        } else {
            // Phase 2: fire at bottom, burns upward (faster)
            const burnT = (elapsed - burnStart) / burnDur;
            const burnLine = cardH / 2 - burnT * cardH * 1.05; // moves topward from bottom

            // --- card below burn line is visible; above = gone ---
            ctx.save();
            ctx.beginPath();
            ctx.rect(-cardW / 2 - 1, -cardH / 2 - 1, cardW + 2, burnLine - (-cardH / 2) + 1);
            ctx.clip();

            // card body (only visible portion remains above burn line)
            ctx.fillStyle = isDeploy ? '#1a1208' : '#14100a';
            ctx.beginPath();
            ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
            ctx.fill();

            // inner border
            ctx.strokeStyle = isDeploy ? '#c09830' : '#8a6a38';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(-cardW / 2 + 5, -cardH / 2 + 5, cardW - 10, cardH - 10, 6);
            ctx.stroke();

            // outer border
            ctx.strokeStyle = isDeploy ? '#e0b840' : '#b09050';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 10);
            ctx.stroke();

            // icon + name
            ctx.fillStyle = '#ffd700';
            ctx.font = '36px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(fx.icon, 0, -12);

            ctx.fillStyle = '#eee';
            ctx.font = 'bold 13px "Noto Serif SC", "Noto Serif CJK SC", serif';
            ctx.fillText(fx.name, 0, 28);

            ctx.restore();

            // --- scorch mark just above burn line ---
            const scorchH = 6;
            const scorchGrad = ctx.createLinearGradient(0, burnLine - scorchH, 0, burnLine + scorchH);
            scorchGrad.addColorStop(0, 'rgba(20,10,5,0)');
            scorchGrad.addColorStop(0.5, 'rgba(30,10,0,0.7)');
            scorchGrad.addColorStop(1, 'rgba(255,100,0,0)');
            ctx.fillStyle = scorchGrad;
            ctx.fillRect(-cardW / 2, burnLine - scorchH, cardW, scorchH * 2);

            // --- flame tongues ---
            for (let f = 0; f < 7; f++) {
                const fxP = -cardW / 2 + 5 + (f / 6) * (cardW - 10);
                const fh = 14 + Math.sin(f * 3.7 + burnT * 12) * 10 + burnT * 22;
                const fw = 7 + Math.sin(f * 5.1 + burnT * 8) * 4;

                const flGrad = ctx.createLinearGradient(fxP, burnLine + fh, fxP, burnLine);
                flGrad.addColorStop(0, `rgba(255,220,30,${0.9 - burnT * 0.4})`);
                flGrad.addColorStop(0.3, `rgba(255,150,0,${0.85 - burnT * 0.3})`);
                flGrad.addColorStop(0.7, `rgba(255,40,0,${0.7 - burnT * 0.4})`);
                flGrad.addColorStop(1, 'rgba(40,5,0,0.95)');
                ctx.fillStyle = flGrad;
                ctx.beginPath();
                ctx.moveTo(fxP - fw, burnLine);
                ctx.quadraticCurveTo(fxP - fw * 0.3, burnLine + fh * 0.5, fxP, burnLine + fh);
                ctx.quadraticCurveTo(fxP + fw * 0.3, burnLine + fh * 0.5, fxP + fw, burnLine);
                ctx.fill();
            }

            // --- embers rising ---
            for (let p = 0; p < 14; p++) {
                const px = -cardW / 2 + Math.random() * cardW;
                const py = burnLine - Math.random() * 50 - burnT * 30;
                const size = 1 + Math.random() * 2.5;
                ctx.fillStyle = `rgba(255,${180 + Math.random() * 75},${Math.random() * 40},${0.8 - burnT * 0.5})`;
                ctx.beginPath();
                ctx.arc(px, py, size, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();
    }
}

// ===== 空袭 / 空降飞机特效 =====================
// ===== 将领透明底立绘（先锋旗） =====================
function drawCommanderPennants() {
    const viewingCamp = getViewingCamp();
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (!unit || !unit.commander) continue;
        if (gameState.skirmishFog && !isTileVisible(tile, viewingCamp, gameState)) continue;
        const portrait = getTransparentPortrait(unit.commander);
        if (!portrait) continue;

        // 部署过渡动画：1600ms 内淡入+缩放
        const now = performance.now();
        const assignedAt = unit._cmdrAssignedAt || 0;
        const elapsed = now - assignedAt;
        const TRANSITION_MS = 1600;
        const appearT = assignedAt > 0 ? Math.min(1, elapsed / TRANSITION_MS) : 1;
        if (appearT <= 0) continue;

        const pos = unit.getVisualPos();
        const vx = pos.x, vy = pos.y;
        // 铁卫头部占比小，放大比例
        const scale = unit.commander === 'ironGuard' ? 1.25 : 1.0;
        const pw = 55 * scale;
        const iw = portrait.naturalWidth;
        const ih = portrait.naturalHeight;
        const ph = pw * (ih / iw);
        const cutIn = 16 * scale;
        const pointExtend = 7 * scale;
        const pX = vx - pw / 2;
        const pY = vy - ph - 14;

        // 裁剪源图顶部方形区域（折中：头肩半身），60%高度裁为正方形
        const cropH = ih * 0.60;
        const cropW = cropH; // square crop for square headshot
        const sx = (iw - cropW) / 2;
        const sy = 0;

        // 部署过渡：从底部尖端缩放展开 + 淡入
        const anchorX = pX + pw / 2;
        const anchorY = pY + ph + pointExtend;
        const easeT = 1 - Math.pow(1 - appearT, 3); // ease-out cubic
        const drawScale = 0.6 + 0.4 * easeT;

        ctx.save();
        ctx.globalAlpha = easeT;
        ctx.translate(anchorX, anchorY);
        ctx.scale(drawScale, drawScale);
        ctx.translate(-anchorX, -anchorY);
        ctx.imageSmoothingQuality = 'high';
        ctx.beginPath();
        ctx.moveTo(pX, pY);
        ctx.lineTo(pX + pw, pY);
        ctx.lineTo(pX + pw, pY + ph - cutIn);
        ctx.lineTo(pX + pw / 2, pY + ph + pointExtend);
        ctx.lineTo(pX, pY + ph - cutIn);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(portrait, sx, sy, cropW, cropH, pX, pY, pw, ph);
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = easeT;
        ctx.strokeStyle = '#e0b840';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(pX, pY + ph - cutIn);
        ctx.lineTo(pX + pw / 2, pY + ph + pointExtend);
        ctx.lineTo(pX + pw, pY + ph - cutIn);
        ctx.stroke();
        ctx.restore();
    }
}

function drawAirstrikeEffects(now) {
    for (let i = airstrikeEffects.length - 1; i >= 0; i--) {
        const fx = airstrikeEffects[i];
        const elapsed = now - fx.startTime;
        if (elapsed > fx.duration) { airstrikeEffects.splice(i, 1); continue; }

        const t = elapsed / fx.duration;
        const cx = fx.x, cy = fx.y;

        // E4 俯冲扫射：战机俯冲 + 机炮扫射曳光弹（区别于投弹空袭）
        if (fx.type === 'diveStrafe') {
            // 俯冲航线：自左上俯冲掠过目标上方，再拉起飞向右下
            const P0x = cx - 380, P0y = cy - 300;
            const P1x = cx + 340, P1y = cy + 20;
            const p = Math.min(1, t / 0.9);
            const px = P0x + (P1x - P0x) * p;
            const py = P0y + (P1y - P0y) * p;
            const ang = Math.atan2(P1y - P0y, P1x - P0x);

            // 战机
            ctx.save();
            ctx.globalAlpha = t < 0.9 ? 1 : Math.max(0, 1 - (t - 0.9) / 0.1);
            ctx.fillStyle = '#000';
            ctx.translate(px, py);
            ctx.rotate(ang);
            ctx.font = '46px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🛩️', 0, 0);
            ctx.restore();

            // 扫射窗口：曳光弹随机炮口 → 地面弹着点沿目标横线行走
            const fireStart = 0.45, fireEnd = 0.80;
            if (t >= fireStart && t <= fireEnd) {
                const fp = (t - fireStart) / (fireEnd - fireStart);
                const impactX = cx - 50 + fp * 100;
                const impactY = cy + 6;
                const noseX = px + Math.cos(ang) * 24;
                const noseY = py + Math.sin(ang) * 24;
                ctx.save();
                // 曳光弹（外亮内白）
                ctx.strokeStyle = 'rgba(255,225,90,0.9)';
                ctx.lineWidth = 2.6;
                ctx.shadowColor = '#ffcc33';
                ctx.shadowBlur = 9;
                ctx.beginPath(); ctx.moveTo(noseX, noseY); ctx.lineTo(impactX, impactY); ctx.stroke();
                ctx.strokeStyle = 'rgba(255,255,255,0.85)';
                ctx.lineWidth = 1;
                ctx.shadowBlur = 0;
                ctx.beginPath(); ctx.moveTo(noseX, noseY); ctx.lineTo(impactX, impactY); ctx.stroke();
                // 炮口闪光
                ctx.fillStyle = `rgba(255,220,120,${0.5 + Math.random() * 0.5})`;
                ctx.beginPath(); ctx.arc(noseX, noseY, 3 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
                // 弹着火花
                for (let s = 0; s < 7; s++) {
                    const a = Math.random() * Math.PI * 2;
                    const d = Math.random() * 16;
                    ctx.fillStyle = `rgba(255,${(160 + Math.random() * 90) | 0},50,0.85)`;
                    ctx.beginPath();
                    ctx.arc(impactX + Math.cos(a) * d, impactY + Math.sin(a) * d - Math.random() * 7, 1.4 + Math.random() * 2, 0, Math.PI * 2);
                    ctx.fill();
                }
                // 弹着扬尘（随行走渐隐残留）
                ctx.fillStyle = `rgba(120,110,90,${0.25 * (1 - fp)})`;
                ctx.beginPath(); ctx.arc(impactX, impactY, 6 + fp * 10, 0, Math.PI * 2); ctx.fill();
                ctx.restore();
            }
            continue;
        }

        const isAirdrop = fx.type === 'airdrop';

        // plane always flies from off-screen left to off-screen right
        const flyStartX = -120;
        const flyEndX = LOGICAL_W + 120;
        const totalFlyDist = flyEndX - flyStartX;
        const planeX = flyStartX + t * totalFlyDist;
        const planeY = cy - 80;

        ctx.save();
        ctx.globalAlpha = 1;
        // 彩色 emoji 会乘上 fillStyle 的 alpha 通道（Chromium），必须显式给一个不透明值
        ctx.fillStyle = '#000';
        ctx.translate(planeX, planeY);
        ctx.rotate(Math.PI / 4); // 45° upward pitch
        ctx.font = '48px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('✈️', 0, 0);
        ctx.restore();

        // sequential drops: release times relative to when plane passes over target
        const tTarget = (cx - flyStartX) / totalFlyDist;
        const dropOffsets = isAirdrop ? [0] : [-0.06, 0, 0.06];
        const dropEmoji = isAirdrop ? '🪂' : '💣';
        const dropCount = isAirdrop ? 1 : 3;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let d = 0; d < dropCount; d++) {
            const dt = dropOffsets[d] != null ? tTarget + dropOffsets[d] : -1;
            if (dt < 0 || t < dt) continue;
            const dropT = (t - dt) / 0.3;
            if (dropT > 1) continue;
            const dropReleaseX = flyStartX + dt * totalFlyDist;
            // 空降降落伞直落到地块中心，与单位出生点完全重合
            const fallDist = isAirdrop ? 80 : 70;
            const landY = isAirdrop ? cy : cy + 10;
            const dropX = isAirdrop ? cx : dropReleaseX + dropT * 20;
            const dropY = cy - 80 + dropT * fallDist;
            // 上一颗炸弹的爆炸粒子会改掉 fillStyle，每次绘制 emoji 前都要重设
            ctx.fillStyle = '#000';
            ctx.fillText(dropEmoji, dropX, Math.min(landY, dropY));

            if (!isAirdrop && dropT > 0.7) {
                const exT = (dropT - 0.7) / 0.3;
                for (let p = 0; p < 5; p++) {
                    const angle = (p / 5) * Math.PI * 2;
                    const dist = exT * 25;
                    ctx.fillStyle = `rgba(255,${150 + Math.random() * 105},0,${1 - exT})`;
                    ctx.beginPath();
                    ctx.arc(dropX + Math.cos(angle) * dist, cy + 10 + Math.sin(angle) * dist, 2.5, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
    }

}
