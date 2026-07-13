import { HEX_SIZE, LOGICAL_W, LOGICAL_H, ctx, cardCanvas, cardCtx, hexPath, drawHexagonOutline, roundRectPath, COUNTER_RELATION, frameInfo, MORALE_CONFIG, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, HEX_NEIGHBORS, pulseSine, getRoundIndex, COLONEL_CARDS, COLONEL_CARD_GOLD, hexDistance } from './config.js';
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
    droneProjectiles, updateDroneProjectiles, drawDroneProjectiles,
    droneSuicideFlak, updateDroneSuicideFlak, drawDroneSuicideFlak,
    droneDives, updateDroneDives, drawDroneDives,
    lightningBolts, updateLightningBolts, drawLightningBolts,
    cardUseEffects,
    spawnCardCopyEffect,
    coinParticles, updateCoinParticles, drawCoinParticles,
    airstrikeEffects, airliftEffects
} from './effects.js';
import { isTileVisible, getTileVisibilityState, getTileVisibilityStateByCoord, getFogAlpha } from './fogOfWar.js';
import { isMechanicEnabled } from '../rules/mechanics.js';
import { campToKey } from '../rules/camps.js';
import { getViewingCamp } from './state.js';
import { getRoleCamp } from '../rules/diplomacy.js';
import { drawFxLayer, updateFxFns } from './fxRegistry.js';
import { drawBattlefieldFlags } from './flagRenderer.js';
import { drawUnitFlagFinial } from './unitRenderer.js';
import { resolveActiveObjectiveHighlightTiles } from '../campaign/runtime/objectiveHighlights.js';

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

// EasyTech 式任务信标：低饱和金色内环负责定位，两道外扩波纹负责吸引余光。
// 它独立于对白教学高亮，只由“进行中”的目标状态驱动。
function drawCampaignObjectiveHighlights(now) {
    if (!gameState.campaignMode || gameState.gameOver) return;
    const config = gameState._campaignFactionConfig;
    const targets = resolveActiveObjectiveHighlightTiles(config, gameState.objectiveStates, gameState.tileMap);
    if (!targets.length) return;

    const baseRadius = HEX_SIZE * 0.78;
    const cycle = 1700;
    for (let index = 0; index < targets.length; index++) {
        const tile = targets[index];
        const breathe = (Math.sin(now / 430 + index * 0.7) + 1) / 2;
        ctx.save();

        const glow = ctx.createRadialGradient(tile.x, tile.y, baseRadius * 0.35, tile.x, tile.y, baseRadius * 1.12);
        glow.addColorStop(0, 'rgba(255,214,100,0)');
        glow.addColorStop(0.72, `rgba(255,196,64,${0.025 + breathe * 0.025})`);
        glow.addColorStop(1, 'rgba(255,183,48,0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(tile.x, tile.y, baseRadius * 1.15, 0, Math.PI * 2);
        ctx.fill();

        ctx.beginPath();
        ctx.arc(tile.x, tile.y, baseRadius + breathe * 1.8, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,218,118,${0.62 + breathe * 0.2})`;
        ctx.lineWidth = 2.1 + breathe * 0.7;
        ctx.shadowColor = 'rgba(255,177,42,0.72)';
        ctx.shadowBlur = 7 + breathe * 5;
        ctx.stroke();

        for (const offset of [0, 0.5]) {
            const wave = ((now / cycle) + offset + index * 0.11) % 1;
            ctx.beginPath();
            ctx.arc(tile.x, tile.y, baseRadius + 3 + wave * 15, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,195,62,${(1 - wave) * 0.48})`;
            ctx.lineWidth = 2.2 - wave * 1.1;
            ctx.shadowBlur = 3 + (1 - wave) * 5;
            ctx.stroke();
        }
        ctx.restore();
    }
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

    // Draw tile bases
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawBase(ctx);
    // Faction-tinted military-map city outline stays below every object, but
    // remains visible around a unit that covers the central castle glyph.
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawCityMapMarker();
    // Flag poles (before pennants and borders)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawFlagPole();
    // Overlays (hover/selection)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawOverlay();

    // ── 将领特效图层：ground（地块覆盖层之后、先锋旗立绘之前）──
    drawFxLayer('ground', ctx, now);

    // 单位六边形辉光（禁锢光环 + 铁卫护盾基底环）
    drawUnitHexAuras(now);
    // 将领透明底立绘（先锋旗）— 在单位之下，旗帜/徽章/标识全部覆盖立绘
    drawCommanderPennants();
    // 国界线/区划线（先锋旗之下、单位之上）
    drawAllBorders(ctx, tiles, gameState.tileMap);
    drawDistrictBorders(ctx, gameState.districtBorderEdges);
    drawCampBorders(ctx, gameState.campBorderEdges);
    // ── 将领特效图层：underUnits（立绘之后、单位徽章之前；圣骑士剑环后半圈）──
    drawFxLayer('underUnits', ctx, now);
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
    // Every cloth surface is deformed in one WebGL2 batch. Canvas2D finials
    // are deliberately composited afterwards so the cloth cannot cover them.
    drawBattlefieldFlags(ctx, gameState, now);
    for (let i = 0, len = tiles.length; i < len; i++) {
        const tile = tiles[i];
        tile.drawFlagFinial();
        if (tile.unit) drawUnitFlagFinial(tile.unit);
    }

    // ── 将领特效图层：aboveUnits（单位与旗帜之后）──
    drawFxLayer('aboveUnits', ctx, now);

    // 士气变化动画
    drawMoraleEffects(now);
    // 晋升动画
    drawRankUpEffects(now);

    // 将领技能触发特效
    drawCommanderSkillEffects(now);

    // ── 将领特效图层：overSkillFx（技能特效之后；圣骑士剑环前半圈）──
    drawFxLayer('overSkillFx', ctx, now);

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
        const myCamp = isNetworkGame() ? getRoleCamp(gameState, getMyRole()) : gameState.currentCamp;
        const myKey = campToKey(myCamp);
        const iAmDeployed = myKey === 'player1' ? gameState.commanderP1Deployed : myKey === 'player2' ? gameState.commanderP2Deployed : gameState.commanderP3Deployed;
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
    // ── 将领特效图层：weatherOverlay（天气粒子之后；占星者星光力场覆绘）──
    drawFxLayer('weatherOverlay', ctx, now);

    // 攻击闪光
    drawAttackFlashes(ctx, now);

    // 炮弹飞行特效
    updateProjectiles(now);
    drawProjectiles(ctx, now);
    // 无人机弹道
    updateDroneProjectiles(now);
    drawDroneProjectiles(ctx, now);
    // 无人机自爆AA子弹流
    updateDroneSuicideFlak(now);
    drawDroneSuicideFlak(ctx, now);
    // 无人机自爆俯冲
    updateDroneDives(now);
    drawDroneDives(ctx, now);

    // ── 将领特效图层：projectiles（通用弹道之后；至圣斩弹射飞剑）──
    drawFxLayer('projectiles', ctx, now);

    // 斩击标记
    drawSlashMarks(ctx, now);
    drawMeleeSlashes(ctx, now);

    // 治疗 / 招募光环
    drawSoftFlashes(ctx, now);

    // ── 将领特效图层：combatFx（治疗光环之后、雷击之前；吸血鬼血流）──
    drawFxLayer('combatFx', ctx, now);

    // 雷击对策卡通用特效
    updateLightningBolts(now);
    drawLightningBolts(ctx, now);

    // ── 将领特效图层：preFog（雷击之后、迷雾遮罩之前；金光/圣链/攻心波纹/统御环）──
    drawFxLayer('preFog', ctx, now);

    // 金币雨（通用城市/村庄收入特效）
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

    // 任务信标是作者主动公开的导航信息：覆在战争迷雾之上，但只画光圈，
    // 不穿透显示目标格内的地形或单位。
    drawCampaignObjectiveHighlights(now);

    ctx.restore();

    // 彩纸（不跟随震动）
    if (confettiPieces.length > 0) {
        updateConfetti(dt);
        drawConfetti(ctx);
    }

    // 烧牌动画 + 空袭/空运特效（通用对策卡，常驻最高图层）
    drawCardUseAnimation(now);
    drawAirstrikeEffects(now);
    drawAirliftEffects(now);

    // ── 将领特效图层：top（最高图层；魂卒回魂黑烟）──
    drawFxLayer('top', ctx, now);

    // 不跟随震动的粒子更新
    if (coinParticles.length > 0) updateCoinParticles(dt);
    // 将领特效模块的每帧 update（粒子寿命、弹道、环绕剑跟随等）
    updateFxFns(dt, now);
}

// 通用防空炮火特效：从AA单位射向飞行器的曳光弹流
function _renderAAFlak(planeX, planeY, targetQ, targetR, t, seed, friendlyCamp) {
    const targetS = -(targetQ + targetR);
    const _sources = [];
    for (const _t of gameState.tiles) {
        const _u = _t.unit;
        if (!_u || !_u.camp || _u.camp === friendlyCamp || !isAntiAirUnit(_u)) continue;
        if (hexDistance(_t, { q: targetQ, r: targetR, s: targetS }) > ANTIAIR_RADIUS) continue;
        _sources.push(_t);
    }
    // 高射机枪工事：目标格自身作为防空源（仅覆盖自身1格），敌方空军来袭时照常射出曳光弹流
    const _flakTile = gameState.tileMap.get(`${targetQ},${targetR}`);
    if (_flakTile && _flakTile.fortification === 'flak' && _flakTile.unit
        && _flakTile.unit.camp !== friendlyCamp && !_sources.includes(_flakTile)) {
        _sources.push(_flakTile);
    }
    for (const _t of _sources) {
        ctx.save();
        const sx2 = _t.x, sy2 = _t.y;
        const dx = planeX - sx2, dy = planeY - sy2;
        for (let tr = 0; tr < 3; tr++) {
            const phase = (t * 6 + tr * 0.5 + (seed || 0) * 0.02) % 1;
            const tp = phase < 0.7 ? phase / 0.7 : (1 - phase) / 0.3;
            const tx = sx2 + dx * tp;
            const ty = sy2 + dy * tp;
            const ta = 0.8 * (1 - tp);
            ctx.shadowColor = 'rgba(255,200,60,0.7)';
            ctx.shadowBlur = 5;
            ctx.fillStyle = `rgba(255,230,120,${ta})`;
            ctx.beginPath();
            ctx.arc(tx, ty, 1.8 + (1 - tp) * 1.5, 0, Math.PI * 2);
            ctx.fill();
            if (tp < 0.6) {
                ctx.shadowBlur = 2;
                ctx.strokeStyle = `rgba(255,220,80,${ta * 0.5})`;
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(tx, ty);
                ctx.lineTo(tx - dx * 0.04, ty - dy * 0.04);
                ctx.stroke();
            }
        }
        // 炮口闪光
        if (Math.sin(t * 14 + (seed || 0) * 0.5) > 0.4) {
            ctx.shadowBlur = 0;
            const flA = 0.3 + Math.random() * 0.2;
            ctx.fillStyle = `rgba(255,200,80,${flA})`;
            ctx.beginPath();
            ctx.arc(sx2 + (Math.random() - 0.5) * 10, sy2, 2.5 + Math.random() * 3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

function drawAirstrikeEffects(now) {
    const _ac = gameState.currentCamp;
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
            // 飞行方向角；🛩️ 此字体默认朝向右上方（+π/4），补正后机头对准航向
            const ang = Math.atan2(P1y - P0y, P1x - P0x);

            // 战机
            ctx.save();
            ctx.globalAlpha = t < 0.9 ? 1 : Math.max(0, 1 - (t - 0.9) / 0.1);
            ctx.fillStyle = '#000';
            ctx.translate(px, py);
            ctx.rotate(ang + Math.PI / 4);
            ctx.font = '46px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🛩️', 0, 0);
            ctx.restore();

            // 通用防空炮火：AA单位向俯冲战机射曳光弹流
            const flakStart = 0.12, flakEnd = 0.85;
            if (t >= flakStart && t <= flakEnd) {
                _renderAAFlak(px, py, fx.q, fx.r, t, (fx.x | 0) * 7 + (fx.y | 0) * 13, _ac);
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
        // 飞行烟迹
        for (let _t = 1; _t <= 3; _t++) {
            const _tp = t - _t * 0.02;
            if (_tp < 0) continue;
            const _tx = flyStartX + _tp * totalFlyDist;
            const _ty = cy - 80 - _t * 6;
            const _ta = (0.15 - _t * 0.04) * (1 - t);
            ctx.globalAlpha = Math.max(0, _ta);
            ctx.fillStyle = '#aaa';
            ctx.beginPath();
            ctx.arc(_tx, _ty, 4 - _t, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#000';
        ctx.translate(planeX, planeY);
        ctx.rotate(Math.PI / 4);
        ctx.font = '54px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = '#ff8844';
        ctx.shadowBlur = 8;
        ctx.fillText('✈️', 0, 0);
        ctx.shadowBlur = 0;
        ctx.restore();

        // 通用防空炮火（地毯轰炸 + 普通空袭 + 空降）
        if (fx.q != null && t > 0.15 && t < 0.85) {
            _renderAAFlak(planeX, planeY, fx.q, fx.r, t, (fx.x | 0) * 7 + (fx.y | 0) * 13, _ac);
        }

        // sequential drops: release times relative to when plane passes over target
        const tTarget = (cx - flyStartX) / totalFlyDist;
        const dropOffsets = isAirdrop ? [0] : [-0.06, 0, 0.06];
        const dropEmoji = isAirdrop ? '🪂' : '💥';
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
                // 爆炸光环
                const ringA = (1 - exT) * 0.6;
                ctx.save();
                ctx.strokeStyle = `rgba(255,200,80,${ringA})`;
                ctx.lineWidth = 2 + exT * 4;
                ctx.shadowColor = '#ff8800';
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(dropX, cy + 10, exT * 30, 0, Math.PI * 2);
                ctx.stroke();
                ctx.shadowBlur = 0;
                ctx.restore();
                for (let p = 0; p < 8; p++) {
                    const angle = (p / 8) * Math.PI * 2 + (exT * 2);
                    const dist = exT * 28;
                    const sparkA = (1 - exT) * 0.8;
                    ctx.fillStyle = `rgba(255,${150 + Math.random() * 105},0,${sparkA})`;
                    ctx.beginPath();
                    ctx.arc(dropX + Math.cos(angle) * dist, cy + 10 + Math.sin(angle) * dist, 2 + (1 - exT) * 2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
    }

}

// E4 空运：运输机自起点飞抵终点上空 → 降落伞垂直投放 → 落地扬尘（单位在 _airliftLandAt 时现身）
function drawAirliftEffects(now) {
    const _alc = gameState.currentCamp;
    for (let i = airliftEffects.length - 1; i >= 0; i--) {
        const fx = airliftEffects[i];
        const t = (now - fx.startTime) / fx.duration;
        if (t >= 1) { airliftEffects.splice(i, 1); continue; }

        const land = fx.landFrac;      // 单位落地时刻
        const flyEnd = land * 0.6;     // 运输机飞行阶段结束
        const H = 130;                 // 高空高度(px)
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (t < flyEnd) {
            // 阶段A：运输机（载着单位）自起点上空飞往终点上空
            const p = _ease(t / flyEnd);
            const px = fx.fromX + (fx.toX - fx.fromX) * p;
            const py = (fx.fromY + (fx.toY - fx.fromY) * p) - H;
            const dir = fx.toX >= fx.fromX ? 1 : -1;
            ctx.save();
            ctx.translate(px, py);
            ctx.scale(dir, 1);
            ctx.fillStyle = '#000';
            ctx.font = '42px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
            ctx.fillText('🛩️', 0, 0);
            ctx.restore();

            // 防空炮火（空运阶段A）
            if (fx.q != null && p > 0.1 && p < 0.9) {
                const seed = (fx.fromX | 0) * 7 + (fx.toY | 0) * 13;
                const as = -(fx.q + fx.r);
                for (const _t of gameState.tiles) {
                    const _u = _t.unit;
                    if (!_u || !_u.camp || _u.camp === _alc || !isAntiAirUnit(_u)) continue;
                    if (hexDistance(_t, { q: fx.q, r: fx.r, s: as }) > ANTIAIR_RADIUS) continue;
                    ctx.save();
                    const sx2 = _t.x, sy2 = _t.y;
                    const dx = px - sx2, dy = py - sy2;
                    for (let tr = 0; tr < 3; tr++) {
                        const phase = (t * 6 + tr * 0.5 + seed * 0.02) % 1;
                        const tp = phase < 0.7 ? phase / 0.7 : (1 - phase) / 0.3;
                        const tx = sx2 + dx * tp;
                        const ty = sy2 + dy * tp;
                        const ta = 0.8 * (1 - tp);
                        ctx.shadowColor = 'rgba(255,200,60,0.7)';
                        ctx.shadowBlur = 5;
                        ctx.fillStyle = `rgba(255,230,120,${ta})`;
                        ctx.beginPath();
                        ctx.arc(tx, ty, 1.8 + (1 - tp) * 1.5, 0, Math.PI * 2);
                        ctx.fill();
                        if (tp < 0.6) {
                            ctx.strokeStyle = `rgba(255,200,60,${ta * 0.6})`;
                            ctx.lineWidth = 1.5;
                            ctx.beginPath();
                            ctx.moveTo(tx, ty);
                            ctx.lineTo(tx - dx * 0.06, ty - dy * 0.06);
                            ctx.stroke();
                        }
                    }
                    ctx.shadowBlur = 0;
                    ctx.restore();
                }
            }
        } else if (t < land) {
            // 阶段B：降落伞自终点上空垂直下降
            const p = _ease((t - flyEnd) / (land - flyEnd));
            const py = (fx.toY - H) + H * p;
            // 阵营色微光提示
            ctx.save();
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = fx.color;
            ctx.shadowColor = fx.color;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(fx.toX, py + 14, 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
            ctx.fillStyle = '#000';
            ctx.font = '34px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
            ctx.fillText('🪂', fx.toX, py);
        } else {
            // 阶段C：落地扬尘环
            const p = (t - land) / (1 - land);
            ctx.globalAlpha = (1 - p) * 0.55;
            ctx.strokeStyle = 'rgba(190,178,150,0.9)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.ellipse(fx.toX, fx.toY + 6, 8 + p * 28, 4 + p * 13, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }
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
    if (gameState.campaignMode) return gameState.factions?.[campToKey(gameState.currentCamp)]?.controller === 'human';
    if (isNetworkGame()) {
        return campToKey(gameState.currentCamp) === campToKey(getRoleCamp(gameState, getMyRole()));
    }
    if (gameState.gameMode === 'pve' && gameState.aiOpponentCamp) {
        return campToKey(gameState.currentCamp) !== 'neutral' && gameState.currentCamp !== gameState.aiOpponentCamp;
    }
    return campToKey(gameState.currentCamp) !== 'neutral';
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
        const counterCoeff = COUNTER_RELATION[gameState.selectedUnit.type]?.[targetUnit.type] ?? 1;
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

// ===== 单位六边形辉光（禁锢光环 + 铁卫护盾）—— 立绘之前 =====================
function drawUnitHexAuras(now) {
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

        // 铁卫护盾基底环（仅六边形外轮廓，glyph 保留在 Unit.draw 中）
        if (u.commander === 'ironGuard' && u._shield > 0) {
            ctx.save();
            const shieldRatio = Math.min(1, u._shield / Math.max(u._shieldMax, 1));
            const shieldPulse = (Math.sin(now / 953) + 1) / 2;
            const inFlash = performance.now() < u._shieldPulseUntil;
            const flashT = inFlash ? 1 - (u._shieldPulseUntil - performance.now()) / 800 : 0;
            const baseAlpha = shieldRatio * (inFlash ? 0.25 + flashT * 0.3 : 0.12 + shieldPulse * 0.12);
            drawHexagonOutline(ctx, vx, vy, HEX_SIZE + 2,
                `rgba(100,160,220,${baseAlpha})`, 1 + shieldRatio);
            ctx.restore();
        }

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
        const myCamp = isNetworkGame() ? getRoleCamp(gameState, getMyRole()) : gameState.currentCamp;
        const isAirCardTargeting = !!COLONEL_CARDS[ct.cardId] || ct.cardId === 'airlift_dest' || ct.cardId === 'airstrike' || ct.cardId === 'airdrop' || ct.cardId === 'drone_suicide';
        const isColTargeting = !!COLONEL_CARDS[ct.cardId] || ct.cardId === 'airlift_dest';
        const time = now / 1000;
        const isHeal = ct.targeting === 'friendlyAny' || ct.targeting === 'anyUnit';
        const isShield = ct.targeting === 'shieldTarget';
        const isEmpty = ct.targeting === 'emptyTile' || ct.targeting === 'emptyFriendlyNonCityNonMountain'
            || ct.targeting === 'emptyFriendlyNonCity' || ct.targeting === 'emptyFriendlyLandmine' || ct.cardId === 'engineer_bunker';
        const isFriendly = ct.targeting === 'friendlyAlive' || ct.targeting === 'friendlyAny' || isShield;
        const skipsFogTargeting = ct.targeting === 'anyTileGlobal' && ct.cardId !== 'drone_suicide';

        // 空军卡（上校/空袭/空降）：防空覆盖层——画在目标高亮【之下】
        if (isAirCardTargeting) {
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
            // 敌方高射机枪工事：防空圈仅覆盖自身1格
            for (const t of gameState.tiles) {
                if (t.fortification === 'flak' && t.unit && t.unit.camp !== myCamp) aaSet.add(`${t.q},${t.r}`);
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
            // 上校专属：蓝色航程 + 起飞位标志
            if (isColTargeting) {
                const colonel = getColonelUnit(myCamp);
                if (colonel && colonel.tile) {
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
                    // 上校起飞位标志
                    ctx.save();
                    const colCx = colonel.tile.x, colCy = colonel.tile.y;
                    const colPulse = (Math.sin(time * 2.5 * Math.PI) + 1) / 2;
                    ctx.globalAlpha = 0.7 + colPulse * 0.25;
                    ctx.shadowColor = 'rgba(100,180,255,0.6)'; ctx.shadowBlur = 14 + colPulse * 6;
                    ctx.font = '36px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.fillText('✈️', colCx, colCy);
                    ctx.shadowBlur = 0;
                    ctx.globalAlpha = 0.3 + colPulse * 0.15;
                    ctx.strokeStyle = 'rgba(100,200,255,0.5)';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 5]);
                    ctx.beginPath();
                    ctx.arc(colCx, colCy, HEX_SIZE * 0.85, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    ctx.restore();
                }
            }
            // 防空单位标志（每个敌方炮兵/碉堡/停滞者）
            ctx.save();
            ctx.font = '20px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            for (const t of gameState.tiles) {
                    const u = t.unit;
                    const isFlakTile = t.fortification === 'flak' && u && u.camp !== myCamp;
                    if (!isFlakTile && (!u || u.camp === myCamp || !isAntiAirUnit(u))) continue;
                    const aaPulse = (Math.sin(time * 2.0 + t.q) + 1) / 2;
                    ctx.globalAlpha = 0.6 + aaPulse * 0.3;
                    ctx.shadowColor = 'rgba(255,60,40,0.5)'; ctx.shadowBlur = 10 + aaPulse * 5;
                    ctx.fillText('⚠️', t.x, t.y);
                }
                ctx.shadowBlur = 0;
                ctx.restore();
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
            } else if (ct.cardId === 'drone_deploy') {
                if (tile.unit || tile.isCity || tile.terrain === 'mountain') continue;
                const _ty = gameState.tiles.reduce((f, tx) => f || (tx.unit && tx.unit.commander === 'tianyan' && tx.unit.camp === myCamp && tx.unit.hp > 0 ? tx.unit : null), null);
                if (!_ty || hexDistance(_ty.tile, tile) > 1) continue;
            } else if (ct.cardId === 'drone_suicide') {
                const drone = gameState.tiles.reduce((f, tx) => f || (tx.unit && tx.unit.id === ct.droneId ? tx.unit : null), null);
                if (!drone || !drone._isDrone || !drone.tile) continue;
                if (!tile.unit || tile.unit.camp === myCamp) continue;
                if (hexDistance(drone.tile, tile) > 3) continue;
            } else if (ct.cardId === 'engineer_bunker') {
                if (tile.unit || tile.isCity || tile.isVillage) continue;
                const _eng = gameState.tiles.reduce((f, tx) => f || (tx.unit && tx.unit.id === ct.engineerUnitId ? tx.unit : null), null);
                if (!_eng || !_eng.tile || hexDistance(_eng.tile, tile) > 1) continue;
            } else if (ct.targeting === 'emptyTile') {
            } else if (ct.targeting === 'emptyFriendlyNonCityNonMountain') {
                if (tile.unit || tile.isCity || tile.terrain === 'mountain' || tile.camp !== myCamp) continue;
            } else if (ct.targeting === 'emptyFriendlyNonCity') {
                if (tile.unit || tile.isCity || tile.camp !== myCamp) continue;
            } else if (ct.targeting === 'emptyFriendlyLandmine') {
                if (tile.unit || tile.isCity || tile.camp !== myCamp) continue;
            } else if (ct.targeting === 'anyTileGlobal') {
                // 侦察卡：全图任何地块都可选
            } else { continue; }

            // 遭遇战迷雾：对策卡仅高亮视野内目标（侦察卡除外）
            if (gameState.skirmishFog && !skipsFogTargeting) {
                const viewingCamp = getViewingCamp();
                if (!isTileVisible(tile, viewingCamp, gameState)) continue;
            }

            // E4 上校空军卡：超出航程的目标不高亮（含空运；防空区仍高亮，只是降伤）
            if (isColTargeting && isColonelTargetBlocked(tile, myCamp)) continue;
            // E4 空运：不能运送上校自己，且被禁锢的单位不可被空运
            if (ct.cardId === 'airlift' && tile.unit && (tile.unit.commander === 'colonel' || tile.unit._imprisoned)) continue;

            let r, g, b;
            if (isHeal)       { r = 80;  g = 255; b = 100; }
            else if (isShield) { r = 100; g = 180; b = 255; } // light blue for shield
            else if (ct.targeting === 'enemyCity') { r = 255; g = 120; b = 30; } // orange for airstrike
            else if (ct.targeting === 'anyTileGlobal' && ct.cardId !== 'drone_suicide') { r = 160; g = 200; b = 255; } // light cyan for scout
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
let _displayFuel = 0;    // E4: 燃料数字平滑过渡显示值
let _drawPileArmTime = 0;
const DRAW_ARM_TIMEOUT = 3000;
let _flyingCard = null;
let _prevHandLen = 0;
let _shiftOffset = 0;  // lerps to 0: negative when card added, positive when removed
let _lastTurnCounter = -1;  // guard: detect turn change to reset draw pile UI

function _getMyCampForUI() {
    if (gameState.campaignMode) return getViewingCamp();
    if (isNetworkGame()) return getRoleCamp(gameState, getMyRole());
    if (gameState.gameMode === 'pve') return Object.values(gameState.factions || {}).find(faction => faction.controller === 'human') || gameState.currentCamp;
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
    } else if (opts.goldCost) {
        cctx.fillStyle = '#ffd700';
        cctx.font = 'bold 11px "Noto Serif SC", "Noto Serif CJK SC", sans-serif';
        cctx.textAlign = 'right'; cctx.textBaseline = 'top';
        cctx.fillText('$' + opts.goldCost, cardW / 2 - 4, -cardH / 2 + 4);
        cctx.textAlign = 'center'; cctx.textBaseline = 'middle';
    }
    cctx.restore();
}

export function drawCardCanvas(now) {
    if (!cardCanvas || !cardCtx) return;
    if (gameState.campaignMode && !isMechanicEnabled(gameState, 'tacticalCards')) { cardCanvas.style.display = 'none'; return; }
    const myCamp = _getMyCampForUI();
    if (!myCamp) { cardCanvas.style.display = 'none'; return; }
    if (gameState.commanderPhase !== 'done' || gameState.gameOver) { cardCanvas.style.display = 'none'; return; }

    const campKey = campToKey(myCamp);
    const hand = gameState.playerHands[campKey] || [];
    const isNeutralTurn = campToKey(gameState.currentCamp) === 'neutral' && !isNetworkGame();

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

    const isMyTurn = gameState.campaignMode
        ? (campToKey(gameState.currentCamp) === campKey && gameState.factions?.[campKey]?.controller === 'human')
        : isNetworkGame()
            ? (campToKey(gameState.currentCamp) === campToKey(getRoleCamp(gameState, getMyRole())))
            : (gameState.gameMode === 'pve'
                ? (campToKey(gameState.currentCamp) === campKey && !isNeutralTurn)
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
    // 空军上校无普通抽牌（专属空军卡为金币消耗、常驻手牌）→ 右上角留空
    const isColonelPile = gameState['commander' + (campKey === 'player1' ? 'P1' : campKey === 'player2' ? 'P2' : 'P3')] === 'colonel';

    const pileDepth = isColonelPile ? 0 : Math.min(pileCount, 5);
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
    if (pileCount === 0 && !isColonelPile) {
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

    // E4 空军上校：空军卡改金币消耗，右上角不再有燃料购买按钮（抽牌堆亦已在上方对上校跳过）
    _fuelBtnRect = null;

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
            const primaryKey = campToKey(myCamp) === 'player1' ? 'commanderP1' : campToKey(myCamp) === 'player2' ? 'commanderP2' : 'commanderP3';
            deployCmdId = typeof cardEntry === 'object' ? cardEntry.commanderId : null;
            deployCmdId ||= gameState[primaryKey];
            const cmdCfg = COMMANDER_CONFIG[deployCmdId];
            if (cmdCfg) cfg = { ...cfg, name: cmdCfg.name };
        }
        const baseX = cxBase + (n - 1 - i) * peekW + _shiftOffset;
        const lift = (_slideCurrent[i] || 0) * liftAmount;
        const x = baseX + cardW / 2;
        const y = cyBase - lift + cardH / 2;

        const isTargeting = gameState.cardTargeting && gameState.cardTargeting.cardId === cardId
            && (gameState.cardTargeting.handIndex == null || gameState.cardTargeting.handIndex === i);
        const isDeploy = cardId === 'commanderDeploy';
        const primaryKey = campToKey(myCamp) === 'player1' ? 'commanderP1' : campToKey(myCamp) === 'player2' ? 'commanderP2' : 'commanderP3';
        const deployedKey = deployCmdId && gameState[`${primaryKey}Secondary`] === deployCmdId
            ? `${primaryKey}SecondaryDeployed`
            : `${primaryKey}Deployed`;
        const alreadyDeployed = isDeploy && gameState[deployedKey];
        const isHovered = _slideCurrent[i] > 0.3;
        const isColCard = !!COLONEL_CARDS[cardId];
        const drawOpts = { disabled: false, isTargeting: false, isDeploy, alreadyDeployed, isHovered, commanderId: deployCmdId, isCopyCard, goldCost: isColCard ? (COLONEL_CARD_GOLD[cardId] || 0) : 0 };

        if (isTargeting) {
            targetCardData = { x, y, cfg, drawOpts: { ...drawOpts, isTargeting: true } };
            continue;
        }

        // E4 上校空军卡：金币不足时禁用
        const goldCost = COLONEL_CARD_GOLD[cardId] || 0;
        const hasGold = !isColCard || (gameState.playerGold?.[campKey] || 0) >= goldCost;
        const disabled = !canUse || (isDeploy && alreadyDeployed) || (isColCard && !hasGold);
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
            const baseBurnLine = cardH / 2 - burnT * cardH * 1.05; // moves topward from bottom

            // --- irregular burn line: add per-x noise ---
            const burnNoise = new Array(Math.ceil(cardW) + 2);
            for (let bx = 0; bx < burnNoise.length; bx++) {
                const n1 = Math.sin(bx * 0.35 + burnT * 9) * 5;
                const n2 = Math.sin(bx * 0.7 + burnT * 13) * 3;
                const n3 = Math.sin(bx * 0.15 + burnT * 5) * 8;
                burnNoise[bx] = baseBurnLine + n1 + n2 + n3;
            }

            // --- clamp burn line so it never rises above card top ---
            const effectiveTop = -cardH / 2;
            for (let bx = 0; bx < burnNoise.length; bx++) {
                burnNoise[bx] = Math.max(effectiveTop - 2, burnNoise[bx]);
            }

            // --- ambient glow behind burn area ---
            const glowAlpha = 0.15 + burnT * 0.1;
            const glowGrad = ctx.createRadialGradient(0, baseBurnLine + 10, 2, 0, baseBurnLine + 10, cardH * 0.6);
            glowGrad.addColorStop(0, `rgba(255,160,20,${glowAlpha})`);
            glowGrad.addColorStop(0.4, `rgba(255,60,10,${glowAlpha * 0.6})`);
            glowGrad.addColorStop(1, 'rgba(255,30,0,0)');
            ctx.fillStyle = glowGrad;
            ctx.fillRect(-cardW / 2 - 10, -cardH / 2 - 10, cardW + 20, cardH + 20);

            // --- card below burn line is visible; above = gone ---
            ctx.save();
            ctx.beginPath();
            // Clip to the min burn line across all x
            const minBurn = Math.min(...burnNoise);
            ctx.rect(-cardW / 2 - 1, -cardH / 2 - 1, cardW + 2, minBurn - (-cardH / 2) + 1);
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

            // --- paper charring: darken/brown just below burn line ---
            const charH = 10 + burnT * 8;
            for (let bx = 1; bx < burnNoise.length - 1; bx++) {
                const bl = burnNoise[bx];
                if (bl <= effectiveTop) continue;
                const prevBl = burnNoise[bx - 1];
                const nextBl = burnNoise[bx + 1];
                const localBl = (prevBl + bl + nextBl) / 3;
                const charGrad = ctx.createLinearGradient(0, localBl - charH, 0, localBl + 2);
                charGrad.addColorStop(0, 'rgba(60,20,5,0)');
                charGrad.addColorStop(0.5, `rgba(35,12,2,${0.5 + burnT * 0.3})`);
                charGrad.addColorStop(1, 'rgba(255,100,20,0.15)');
                ctx.fillStyle = charGrad;
                ctx.fillRect(-cardW / 2 + bx - 1, localBl - charH, 2, charH + 2);
            }

            // --- edge glow on card below burn line ---
            for (let bx = 1; bx < burnNoise.length - 1; bx++) {
                const bl = burnNoise[bx];
                if (bl <= effectiveTop) continue;
                const edgeGlow = ctx.createRadialGradient(0, bl, 1, 0, bl, 8);
                edgeGlow.addColorStop(0, `rgba(255,200,50,${(0.4 + burnT * 0.2) * (0.8 + 0.2 * Math.sin(bx * 2.3 + burnT * 15))})`);
                edgeGlow.addColorStop(0.5, `rgba(255,80,10,${(0.25 + burnT * 0.15) * (0.7 + 0.3 * Math.sin(bx * 1.7 + burnT * 11))})`);
                edgeGlow.addColorStop(1, 'rgba(255,40,0,0)');
                ctx.fillStyle = edgeGlow;
                ctx.fillRect(-cardW / 2 + bx - 3, bl - 8, 6, 16);
            }

            // --- flame tongues (multi-layer for depth) ---
            const flameLayers = [
                { count: 9, heightMul: 1.0, widthMul: 1.0, alphaMul: 1.0, yOff: 0, seedOff: 0 },
                { count: 5, heightMul: 0.7, widthMul: 0.6, alphaMul: 1.6, yOff: -4, seedOff: 100 }
            ];
            for (const layer of flameLayers) {
                for (let f = 0; f < layer.count; f++) {
                    const seed = f + layer.seedOff;
                    const fxP = -cardW / 2 - 4 + ((seed + 0.5) / layer.count) * (cardW + 8) + Math.sin(seed * 2.7 + burnT * 6) * 5;
                    const fhBase = 18 + burnT * 28;
                    const fh = fhBase * layer.heightMul
                        + Math.sin(seed * 3.7 + burnT * 14) * 8 * layer.heightMul
                        + Math.sin(seed * 8.1 + burnT * 22) * 4 * layer.heightMul;
                    const fw = (8 + Math.sin(seed * 5.1 + burnT * 10) * 4) * layer.widthMul;

                    // Per-flame burn line from noise
                    const normX = Math.max(0, Math.min(1, (fxP + cardW / 2) / cardW));
                    const noiseIdx = Math.floor(normX * (burnNoise.length - 1));
                    const localBurn = burnNoise[Math.min(noiseIdx, burnNoise.length - 1)];

                    const flGrad = ctx.createLinearGradient(fxP, localBurn + fh, fxP, localBurn);
                    const a = (0.95 - burnT * 0.35) * layer.alphaMul;
                    flGrad.addColorStop(0, `rgba(255,240,60,${a})`);
                    flGrad.addColorStop(0.15, `rgba(255,200,30,${a * 0.95})`);
                    flGrad.addColorStop(0.35, `rgba(255,120,10,${a * 0.8})`);
                    flGrad.addColorStop(0.6, `rgba(255,50,5,${a * 0.65})`);
                    flGrad.addColorStop(0.85, `rgba(120,15,0,${a * 0.5})`);
                    flGrad.addColorStop(1, `rgba(40,4,0,${a * 0.2})`);
                    ctx.fillStyle = flGrad;
                    ctx.beginPath();
                    ctx.moveTo(fxP - fw, localBurn);
                    ctx.quadraticCurveTo(fxP - fw * 0.25, localBurn + fh * 0.6, fxP * 0.9 + (fxP * 0.1), localBurn + fh);
                    ctx.quadraticCurveTo(fxP + fw * 0.25, localBurn + fh * 0.6, fxP + fw, localBurn);
                    ctx.fill();
                }
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
        if (!unit || !unit.isCommanderUnit) continue;
        if (gameState.skirmishFog && !isTileVisible(tile, viewingCamp, gameState)) continue;
        const portrait = getTransparentPortrait(unit.getCommanderPortraitId());
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




// E2 亡灵法师 —— 魂卒召回：黑烟团从法师位置飞向目标位置

