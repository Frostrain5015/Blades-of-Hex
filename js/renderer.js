import { HEX_SIZE, LOGICAL_W, LOGICAL_H, ctx, cardCanvas, cardCtx, hexPath, drawHexagonOutline, roundRectPath, COUNTER_RELATION, frameInfo, MORALE_CONFIG, TACTICAL_CARD_CONFIG, CARD_SYSTEM_CONFIG, HEX_NEIGHBORS, pulseSine, COLONEL_CARDS, COLONEL_CARD_GOLD, settings } from './config.js';
import { getCommander, allCommanders as COMMANDER_CONFIG } from '../commander/index.js';
import { getPortrait, getTransparentPortrait } from './portraitLoader.js';
import { gameState } from './state.js';
import { flushFloatTexts } from './floatTexts.js';
import { isNetworkGame, getMyRole } from './network.js';
import {
    drawAllBorders, drawDistrictBorders, drawCampBorders, computeCampBorders
} from './HexTile.js';
import {
    getBorderlessBoundaryTopology, getBorderlessVisualGrid, drawVisualFillerTile, drawVisualFillerTiles
} from './militaryMap.js';
import { resolveAntiAirCoverage } from '../rules/antiAir.js';
import { isCityDisabled, isSiegeableCityTile } from '../rules/citySiege.js';
import {
    particles, attackFlashes, confettiPieces, screenShake, turnFlash,
    drawAttackFlashes, drawSlashMarks, drawSoftFlashes, drawConfetti, updateConfetti,
    VisualParticle, iconEffects, borderFlash, drawMeleeSlashes,
    rainParticles, splashParticles, fogBlobs, windStreaks, spawnWeatherParticles,
    drawProjectiles, updateProjectiles,
    drawTorpedoes, updateTorpedoes,
    droneProjectiles, updateDroneProjectiles, drawDroneProjectiles,
    droneSuicideFlak, updateDroneSuicideFlak, drawDroneSuicideFlak,
    droneDives, updateDroneDives, drawDroneDives,
    lightningBolts, updateLightningBolts, drawLightningBolts,
    updateOrbitalBeams, drawOrbitalBeams,
    cardUseEffects,
    spawnCardCopyEffect,
    coinParticles, updateCoinParticles, drawCoinParticles,
    airstrikeEffects, airliftEffects, celestineOracleBeams,
    drawLaserBeams,
    bloodMoonSlashes, updateBloodMoonSlashes, drawBloodMoonSlashes
} from './effects.js';
import {
    getFogAlpha,
    getPresentedTileVisibilityState,
    getTileVisibilityState,
    getTileVisibilityStateByCoord,
    hasActiveFogPresentationHold,
    isTileVisible
} from './fogOfWar.js';
import { isMechanicEnabled } from '../rules/mechanics.js';
import { campToKey } from '../rules/camps.js';
import { hexDistance } from '../rules/hex.js';
import { getViewingCamp } from './state.js';
import { getRoleCamp } from '../rules/diplomacy.js';
import { drawFxLayer, updateFxFns } from './fxRegistry.js';
import { drawBattlefieldFlags } from './flagRenderer.js';
import { drawUnitBadgeAboveFog, drawUnitFlagFinial, getUnitVisualPos, UNIT_BADGE_RADIUS, UNIT_HUD_OUTER_RADIUS } from './unitRenderer.js';
import { resolveActiveObjectiveHighlightTiles } from '../campaign/runtime/objectiveHighlights.js';
import {
    drawOperationOrigin,
    drawOperationPreview,
    OPERATION_PREVIEW_ACTIONS
} from './operationPreviewRenderer.js';
import { getDiveStrafePlanePosition, operationArrowStyleForAttacker } from '../rules/attackPresentation.js';
import {
    resolveTargetingPreview,
    TARGET_INTENTS,
    TARGET_SHAPES,
    targetingTileKey
} from '../rules/targeting.js';
import {
    drawHologramMotif,
    renderTargetingPreview
} from './targetingPreviewRenderer.js';
import { resolveMovementTileReveal } from './movementRegionAnimation.js';
import { CanvasBattlefieldLayers } from './canvasBattlefieldLayers.js';
import { battlefieldDelegation } from './rendering/delegation.js';
import { areCommanderMechanicsSuppressed, sharedHexEdgeSegmentKey } from '../rules/movement.js';
import { hasAureliaOathEffect } from '../rules/aurelia.js';
import { getOracleStatueAnchor, hasCelestineSynergyActive, getCelestineOracleState } from '../rules/celestine.js';
import { measure, perfEnabled } from './perf.js';

let lastTime = performance.now();
let _lastParticleSpawn = 0;

// ── 每帧稳定结果缓存：国界/区划的河段过滤与无边模式 filler 边界 ──
// 输入数组在占领/河流拓扑变化时才被整体替换，可用引用同一性做缓存键。
const _riverFilteredEdgeCache = new WeakMap();

function _filterEdgesSkippingRivers(edges, riverSegments) {
    if (!riverSegments || !edges.length) return edges;
    const cached = _riverFilteredEdgeCache.get(edges);
    if (cached?.riverSegments === riverSegments) return cached.result;
    const result = edges.filter(edge => {
        const key = sharedHexEdgeSegmentKey(
            { q: edge.qa, r: edge.ra },
            { q: edge.qb, r: edge.rb }
        );
        return !key || !riverSegments.has(key);
    });
    _riverFilteredEdgeCache.set(edges, { riverSegments, result });
    return result;
}

const FLAT_TILE_BASE_OPTIONS = Object.freeze({ drawShadow: false });
const LAYERED_TILE_BASE_OPTIONS = Object.freeze({ drawLegacyMapDetails: false });
const FLAT_LAYERED_TILE_BASE_OPTIONS = Object.freeze({
    drawShadow: false,
    drawLegacyMapDetails: false
});
const canvasBattlefieldLayers = new CanvasBattlefieldLayers({ hexSize: HEX_SIZE });
let canvasFrameIsBorderless = null;

function syncCanvasFrameStyle(isBorderless) {
    if (canvasFrameIsBorderless === isBorderless) return;
    canvasFrameIsBorderless = isBorderless;
    ctx.canvas.parentElement?.classList.toggle('borderless-board', isBorderless);
}

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

function drawOwnedMineMarkers(now) {
    const viewerKey = campToKey(getViewingCamp());
    const omniscient = gameState.omniscientView === true;
    for (const tile of gameState.tiles) {
        if (!tile._minePlanted || (!omniscient && tile._mineCampKey !== viewerKey)) continue;
        const water = tile._mineType === 'water';
        const pulse = 0.72 + Math.sin(now / 420 + tile.q * 0.7 + tile.r) * 0.16;
        ctx.save();
        ctx.translate(tile.x + 11, tile.y + 11);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = water ? 'rgba(80,190,210,0.92)' : 'rgba(226,180,72,0.92)';
        ctx.strokeStyle = 'rgba(15,24,26,0.86)';
        ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.arc(0, 0, 5.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#102126';
        ctx.font = 'bold 8px "Segoe UI Symbol", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(water ? '≈' : '×', 0, 0.3);
        ctx.restore();
    }
}

/**
 * 塞莱斯廷圣国【神谕】神像绘制：金色半透明带翼人形，悬浮于圣国控制的
 * 城市锚点上方（无城市则跳过）。光晕半径/alpha 随 stage 1→3 递增（神谕封顶 3 阶）。
 * 神像在战争迷雾之上绘制，全图可见。
 */
function drawCelestineOracleStatues(now) {
    const factionKeys = Object.keys(gameState.factions || {});
    for (const campKey of factionKeys) {
        if (campKey === 'neutral') continue;
        if (!hasCelestineSynergyActive(gameState, campKey)) continue;
        const anchor = getOracleStatueAnchor(gameState, campKey);
        if (!anchor) continue;
        const oracleState = getCelestineOracleState(gameState, campKey);
        if (!oracleState) continue;

        const stage = oracleState.stage;
        const alpha = 0.45 + stage * 0.10; // 3 阶封顶：0.55 → 0.75
        const glowRadius = 20 + stage * 13; // 3 阶封顶：33 → 59
        const floatOffset = Math.sin(now / 600 + campKey.charCodeAt(0)) * 4;

        ctx.save();
        ctx.translate(anchor.x, anchor.y - 24 + floatOffset);
        ctx.globalAlpha = Math.min(alpha, 0.75);

        // 阶段光晕
        const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, glowRadius);
        grad.addColorStop(0, 'rgba(245, 215, 110, 0.6)');
        grad.addColorStop(0.4, 'rgba(245, 215, 110, 0.2)');
        grad.addColorStop(1, 'rgba(245, 215, 110, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, glowRadius, 0, Math.PI * 2);
        ctx.fill();

        // 人形剪影（简单十字形）
        ctx.shadowColor = 'rgba(245, 215, 110, 0.5)';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = '#f5d76e';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        // 头部
        ctx.arc(0, -10, 4, 0, Math.PI * 2);
        ctx.stroke();
        // 身体
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(0, 8);
        ctx.stroke();
        // 双臂
        ctx.beginPath();
        ctx.moveTo(-8, -2);
        ctx.lineTo(8, -2);
        ctx.stroke();
        // 双翼
        const wingSpread = 16 + stage * 2;
        const wingAngle = 0.35 + stage * 0.04;
        ctx.strokeStyle = 'rgba(245, 215, 110, 0.7)';
        ctx.lineWidth = 1.8;
        // 左翼
        ctx.beginPath();
        ctx.moveTo(-4, -4);
        ctx.quadraticCurveTo(-wingSpread, -12 - stage, -wingSpread * 0.7, 8);
        ctx.stroke();
        // 右翼
        ctx.beginPath();
        ctx.moveTo(4, -4);
        ctx.quadraticCurveTo(wingSpread, -12 - stage, wingSpread * 0.7, 8);
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.restore();
    }
}

/**
 * 神谕指引光束绘制（战争迷雾之上）。两段式：
 * 蓄力（神像处光环胀缩）→ 光束头沿弧线飞向目标（亮头+渐隐尾迹）→
 * 弹着（目标处双环爆发 + 竖直光柱）+ 整束余辉淡出。
 */
function drawCelestineOracleBeams(now) {
    for (let i = celestineOracleBeams.length - 1; i >= 0; i--) {
        const fx = celestineOracleBeams[i];
        const elapsed = now - fx.startTime;
        if (elapsed < 0) continue; // 错峰升空（赐福晚于神罚）
        const impactAt = fx.chargeMs + fx.travelMs;
        const total = impactAt + fx.lingerMs;
        if (elapsed > total) { celestineOracleBeams.splice(i, 1); continue; }

        const isSmite = fx.kind === 'smite';
        const coreColor = isSmite ? '#fff6d8' : '#f4fbff';
        const mainColor = isSmite ? '#f5d76e' : '#bfe3ff';
        const rimColor = isSmite ? '#ffb84d' : '#8fd0ff';

        const fromX = fx.fromX, fromY = fx.fromY - 24; // 与神像悬浮高度对齐
        const toX = fx.toX, toY = fx.toY;
        const dist = Math.hypot(toX - fromX, toY - fromY) || 1;
        const lift = Math.min(64, 26 + dist * 0.14);
        const ctrlX = (fromX + toX) / 2;
        const ctrlY = Math.min(fromY, toY) - lift;
        const pointAt = t => ({
            x: (1 - t) * (1 - t) * fromX + 2 * (1 - t) * t * ctrlX + t * t * toX,
            y: (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * ctrlY + t * t * toY
        });

        ctx.save();

        // ── 蓄力：神像处光环胀缩 + 升起的辉点 ──
        if (elapsed < impactAt) {
            const chargeT = Math.min(1, elapsed / fx.chargeMs);
            const ringR = 8 + chargeT * 20;
            ctx.globalAlpha = 0.7 * Math.sin(chargeT * Math.PI * 0.5 + 0.2);
            ctx.strokeStyle = mainColor;
            ctx.lineWidth = 2;
            ctx.shadowColor = mainColor;
            ctx.shadowBlur = 14;
            ctx.beginPath();
            ctx.arc(fromX, fromY, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // ── 飞行：光束头沿弧线推进，尾迹为渐亮线段 ──
        const travelT = Math.max(0, Math.min(1, (elapsed - fx.chargeMs) / fx.travelMs));
        const fadeT = elapsed > impactAt ? (elapsed - impactAt) / fx.lingerMs : 0;
        const beamAlpha = elapsed > impactAt ? (1 - fadeT) : travelT > 0 ? 0.55 + travelT * 0.45 : 0;
        if (travelT > 0 && beamAlpha > 0) {
            const eased = 1 - Math.pow(1 - travelT, 2.4);
            const segments = 26;
            const headIdx = Math.max(1, Math.round(segments * eased));
            // 光晕层 + 核心层双描边
            for (const [width, color, alphaScale, blur] of [
                [7, rimColor, 0.35, 18],
                [3.2, mainColor, 0.8, 10],
                [1.4, coreColor, 1, 4]
            ]) {
                ctx.globalAlpha = Math.min(1, beamAlpha * alphaScale);
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                ctx.lineCap = 'round';
                ctx.shadowColor = color;
                ctx.shadowBlur = blur;
                ctx.beginPath();
                const start = pointAt(0);
                ctx.moveTo(start.x, start.y);
                for (let s = 1; s <= headIdx; s++) {
                    const p = pointAt(s / headIdx * eased);
                    ctx.lineTo(p.x, p.y);
                }
                ctx.stroke();
            }
            // 光束头彗核
            if (elapsed <= impactAt) {
                const head = pointAt(eased);
                const headGrad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 12);
                headGrad.addColorStop(0, coreColor);
                headGrad.addColorStop(0.45, mainColor);
                headGrad.addColorStop(1, 'rgba(245, 215, 110, 0)');
                ctx.globalAlpha = 0.95;
                ctx.shadowBlur = 0;
                ctx.fillStyle = headGrad;
                ctx.beginPath();
                ctx.arc(head.x, head.y, 12, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // ── 弹着：目标处双环爆发 + 竖直光柱 ──
        if (elapsed > impactAt) {
            const burstT = Math.min(1, fadeT / 0.6);
            ctx.shadowBlur = 0;
            // 双环
            for (const [delayFrac, color, width] of [[0, coreColor, 2.6], [0.22, rimColor, 1.6]]) {
                const ringT = Math.max(0, Math.min(1, (fadeT - delayFrac) / (1 - delayFrac)));
                if (ringT <= 0 || ringT >= 1) continue;
                ctx.globalAlpha = (1 - ringT) * 0.85;
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                ctx.shadowColor = color;
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(toX, toY, 6 + ringT * 44, 0, Math.PI * 2);
                ctx.stroke();
            }
            // 竖直光柱（自目标上空垂落的圣光）
            const pillarAlpha = (1 - fadeT) * 0.55;
            if (pillarAlpha > 0.02) {
                const pillarW = 16 * (1 - burstT * 0.4);
                const pillarGrad = ctx.createLinearGradient(toX, toY - 120, toX, toY + 6);
                pillarGrad.addColorStop(0, 'rgba(255, 250, 230, 0)');
                pillarGrad.addColorStop(0.55, isSmite ? 'rgba(245, 215, 110, 0.55)' : 'rgba(191, 227, 255, 0.5)');
                pillarGrad.addColorStop(1, isSmite ? 'rgba(255, 246, 216, 0.9)' : 'rgba(244, 251, 255, 0.85)');
                ctx.globalAlpha = pillarAlpha;
                ctx.shadowBlur = 0;
                ctx.fillStyle = pillarGrad;
                ctx.fillRect(toX - pillarW / 2, toY - 120, pillarW, 126);
            }
        }

        ctx.restore();
    }
}

// Shared terrain-material pass: tile bases, ground, waterways, relief and
// deferred details in the canonical order. Draws into any 2D context so the
// Pixi terrain snapshot is produced by exactly the same code as direct
// Canvas rendering — the two backends can never diverge visually.
function _drawTerrainMaterials(targetCtx, now, { tiles, visualGrid, layeredTerrain, materialOptions, tileBaseOptions }) {
    if (visualGrid) drawVisualFillerTiles(targetCtx, visualGrid.fillers);
    for (let i = 0, len = tiles.length; i < len; i++) {
        tiles[i].drawBase(targetCtx, tileBaseOptions);
    }
    // Fixed map-material order: neutral water, terrain floor, coast/river,
    // terrain relief, then fortifications/bridges/ports. Every phase shares
    // the cached real-board clip (plus render-only fillers in borderless mode).
    canvasBattlefieldLayers.renderGround(targetCtx, materialOptions);
    canvasBattlefieldLayers.renderWaterways(targetCtx, materialOptions);
    canvasBattlefieldLayers.renderRelief(targetCtx, materialOptions);
    canvasBattlefieldLayers.renderDetails(targetCtx, materialOptions);
    if (layeredTerrain) {
        for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawDeferredMapDetails(targetCtx);
    }
}

/**
 * Paint the full terrain slice into an offscreen 2D context for the Pixi
 * terrain texture. Assumes renderGame() has already synced
 * canvasBattlefieldLayers this frame (it runs unconditionally each frame).
 *
 * options.finalizeFades: paint every fading tile at its fade TARGET color.
 * Used as the far end of the GPU terrain crossfade — the texture must show
 * the post-capture state while on-screen tiles are still mid-transition.
 */
export function renderTerrainSnapshot(targetCtx, now, pixelRatio = 1, options = undefined) {
    const tiles = gameState.tiles;
    const visualGrid = gameState.boardLayout === 'borderless'
        ? getBorderlessVisualGrid(tiles, gameState.tileMap)
        : null;
    const layeredTerrain = canvasBattlefieldLayers.terrainActive;
    const materialOptions = { now, reducedMotion: settings.reducedMotion === true };
    const tileBaseOptions = layeredTerrain
        ? (visualGrid ? FLAT_LAYERED_TILE_BASE_OPTIONS : LAYERED_TILE_BASE_OPTIONS)
        : (visualGrid ? FLAT_TILE_BASE_OPTIONS : undefined);
    // 临时把渐变中的地块推到目标色再绘制；filler 地块经 getter 代理
    // 源地块的 currentColor，同样被覆盖。绘制后原样恢复。
    const restore = options?.finalizeFades === true ? [] : null;
    if (restore) {
        for (let i = 0, len = tiles.length; i < len; i++) {
            const tile = tiles[i];
            if (tile.fadeStartTime && tile.targetColor && tile.currentColor !== tile.targetColor) {
                restore.push(tile, tile.currentColor);
                tile.currentColor = tile.targetColor;
            }
        }
    }
    try {
        targetCtx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        targetCtx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);
        _drawTerrainMaterials(targetCtx, now, { tiles, visualGrid, layeredTerrain, materialOptions, tileBaseOptions });
    } finally {
        if (restore) {
            for (let i = 0; i < restore.length; i += 2) restore[i].currentColor = restore[i + 1];
        }
    }
}

export function renderGame() {
    return perfEnabled() ? measure('renderGame', _renderGame) : _renderGame();
}
function _renderGame() {
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
    const visualGrid = gameState.boardLayout === 'borderless'
        ? getBorderlessVisualGrid(tiles, gameState.tileMap)
        : null;
    syncCanvasFrameStyle(Boolean(visualGrid));
    const borderTiles = visualGrid?.tiles || tiles;
    const borderTileMap = visualGrid?.tileMap || gameState.tileMap;
    const visualBoundaries = getBorderlessBoundaryTopology(visualGrid);
    const campBorderEdges = visualBoundaries?.campEdges || gameState.campBorderEdges;
    const districtBorderEdges = visualBoundaries?.districtEdges || gameState.districtBorderEdges;
    const coastEdges = visualBoundaries?.coastEdges || gameState.coastEdges;
    canvasBattlefieldLayers.sync({
        playableTiles: tiles,
        renderTiles: borderTiles,
        tileMap: gameState.tileMap,
        coastEdges,
        rivers: gameState.rivers,
        riverCrossings: gameState.riverCrossings,
        riverTopology: gameState.riverTopology,
        ports: gameState.ports
    });
    const layeredTerrain = canvasBattlefieldLayers.terrainActive;

    ctx.save();
    ctx.translate(screenShake.x, screenShake.y);
    ctx.clearRect(-20, -20, LOGICAL_W + 40, LOGICAL_H + 40);

    // Terrain materials are skipped only while the Pixi adapter actually owns
    // the static terrain slice (never inferred from settings, which can point
    // at a backend that failed to initialize or has fallen back mid-game).
    const materialOptions = { now, reducedMotion: settings.reducedMotion === true };
    const tileBaseOptions = layeredTerrain
        ? (visualGrid ? FLAT_LAYERED_TILE_BASE_OPTIONS : LAYERED_TILE_BASE_OPTIONS)
        : (visualGrid ? FLAT_TILE_BASE_OPTIONS : undefined);
    if (!battlefieldDelegation.terrain) {
        _drawTerrainMaterials(ctx, now, { tiles, visualGrid, layeredTerrain, materialOptions, tileBaseOptions });
    }
    // Faction-tinted military-map city outline stays below every object, but
    // remains visible around a unit that covers the central castle glyph.
    // City markers, flag poles and hover/selection overlays have no Pixi
    // equivalent, so they stay on Canvas in every delegation mode.
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawCityMapMarker();
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawFlagPole();
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawOverlay();

    // ── 将领特效图层：ground（地块覆盖层之后、先锋旗立绘之前）──
    drawFxLayer('ground', ctx, now);

    // 单位六边形辉光（禁锢光环 + 铁卫护盾基底环）
    drawUnitHexAuras(now);
    // 将领透明底立绘（先锋旗）— 在单位之下，旗帜/徽章/标识全部覆盖立绘
    drawCommanderPennants();
    // 国界线/区划线（先锋旗之下、单位之上）
    if (settings.showGrid !== false) drawAllBorders(ctx, borderTiles, borderTileMap);
    const riverSegments = gameState?.riverTopology?.segmentsByKey;
    drawDistrictBorders(ctx, _filterEdgesSkippingRivers(districtBorderEdges, riverSegments));
    // 跳过与河段重合的国界：(qa,ra)↔(qb,rb) 边上有河流则跳过，让河段视觉清晰。
    const campNoRiver = _filterEdgesSkippingRivers(campBorderEdges, riverSegments);
    drawCampBorders(ctx, campNoRiver);
    // ── 将领特效图层：underUnits（立绘之后、单位徽章之前；圣骑士剑环后半圈）──
    drawFxLayer('underUnits', ctx, now);
    // 纯本地操作预览先画到单位之下，球体自然遮住路线内部，避免起终点断口。
    // 委托 Pixi 时由 PixiBattlefieldRenderer 绘制，跳过 Canvas 版本避免双重绘制。
    if (!battlefieldDelegation.interactionHints) drawOperationInteractionRoute(now);
    // Units — 全部绘制，非可见地块会在后续迷雾阶段被地形覆绘+遮罩覆盖
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawUnit();
    // 延迟击杀残影：飞行类攻击（鱼雷/舰载机弹流）击杀的单位保留绘制到弹着爆炸时刻
    const deathGhosts = gameState.unitDeathGhosts;
    if (deathGhosts?.length) {
        for (let i = deathGhosts.length - 1; i >= 0; i--) {
            if (now >= deathGhosts[i].until) deathGhosts.splice(i, 1);
            else deathGhosts[i].unit.draw();
        }
    }
    // Fortification foreground: front trench banks and flak parapets seat the
    // sphere inside the terrain instead of letting it float above the whole
    // emplacement. These paths remain board-clipped and contain no game state.
    if (!settings.pixiTerrainMode) {
        canvasBattlefieldLayers.renderForeground(ctx, materialOptions);
        if (layeredTerrain) {
            for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawForegroundMapDetails(ctx);
        }
    }
    // 城市燃烧城墙框 + 瘫痪标识：全渲染模式统一在 Canvas 覆盖层绘制
    // （Pixi 地形纹理由同一份 Canvas 地形代码烘焙，几何天然对齐）。
    _drawCityWallFrames(ctx, now);
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
    drawAureliaGuardPetals(now);

    // 统一“符号+标签”宣告特效（技能/士气/晋升）
    drawIconEffects(now);

    // ── 将领特效图层：overSkillFx（技能特效之后；圣骑士剑环前半圈）──
    drawFxLayer('overSkillFx', ctx, now);

    // 范围光圈
    drawRangeApertures(now);

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

    // 诺克提斯【血月】：全屏血红色调 + 暗角，脉动呼吸感。
    if (gameState.weather === 'bloodMoon') {
        const pulse = 0.10 + Math.sin(now / 900) * 0.03;
        ctx.save();
        ctx.fillStyle = `rgba(150,10,25,${pulse})`;
        ctx.fillRect(-20, -20, LOGICAL_W + 40, LOGICAL_H + 40);
        const vg = ctx.createRadialGradient(
            LOGICAL_W / 2, LOGICAL_H / 2, LOGICAL_H * 0.25,
            LOGICAL_W / 2, LOGICAL_H / 2, LOGICAL_H * 0.85
        );
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(40,0,6,0.5)');
        ctx.fillStyle = vg;
        ctx.fillRect(-20, -20, LOGICAL_W + 40, LOGICAL_H + 40);
        ctx.restore();

        // 血月本体：在锚点城市上方绘制红色血月
        const anchor = gameState._bloodMoonAnchor;
        if (anchor && Number.isFinite(anchor.x)) {
            const mx = anchor.x, my = anchor.y - 80;
            const moonPulse = 0.85 + 0.1 * Math.sin(now / 500);
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            // 月晕
            const halo = ctx.createRadialGradient(mx, my, 0, mx, my, 100);
            halo.addColorStop(0, 'rgba(200, 20, 40, 0.25)');
            halo.addColorStop(0.6, 'rgba(100, 10, 25, 0.12)');
            halo.addColorStop(1, 'rgba(40, 0, 6, 0)');
            ctx.fillStyle = halo;
            ctx.fillRect(mx - 100, my - 100, 200, 200);
            // 月面
            ctx.shadowColor = '#cc1122';
            ctx.shadowBlur = 25 + 8 * Math.sin(now / 400);
            ctx.globalAlpha = moonPulse * 0.8;
            ctx.fillStyle = '#cc1122';
            ctx.beginPath();
            ctx.arc(mx, my, 26 + 3 * Math.sin(now / 600), 0, Math.PI * 2);
            ctx.fill();
            // 暗纹
            ctx.globalAlpha = 0.3;
            ctx.shadowBlur = 0;
            ctx.fillStyle = '#330005';
            ctx.beginPath();
            ctx.arc(mx - 5, my - 3, 8, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(mx + 4, my + 2, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
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

    // 边框辉光（统一机制：技能宣告/斩将士气等共用，颜色由触发方指定）
    if (borderFlash.alpha > 0.001) {
        ctx.save();
        ctx.globalAlpha = borderFlash.alpha;
        _drawBorderGlow(ctx, borderFlash.color || '#ffd700', 60, LOGICAL_W, LOGICAL_H);
        ctx.restore();
        borderFlash.alpha *= 0.96;
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
    // 鱼雷与水柱在单位上方表现，确保低对比度水下轨迹仍可辨识。
    updateTorpedoes(now);
    drawTorpedoes(ctx, now);
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

    // 天基打击轨道光束（天鹰协同奖励卡特效）
    updateOrbitalBeams(now);
    drawOrbitalBeams(ctx, now);

    // 诺克提斯【血月】月蚀环形斩击
    updateBloodMoonSlashes(now);
    drawBloodMoonSlashes(ctx, now);

    // ── 将领特效图层：preFog（雷击之后、迷雾遮罩之前；金光/圣链/攻心波纹/统御环）──
    drawFxLayer('preFog', ctx, now);

    // 金币雨（通用城市/村庄收入特效）
    if (coinParticles.length > 0) drawCoinParticles(ctx);

    // 文字特效（在所有 VFX 之后绘制，确保不被光束/光环等特效遮挡）
    drawDamageTexts(now);
    drawHealTexts(now);
    drawShieldTexts(now);
    drawGoldTexts(now);

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
                tile.drawBase(ctx, tileBaseOptions);
                hexPath(ctx, tile.x, tile.y, HEX_SIZE);
                const grad = ctx.createRadialGradient(tile.x, tile.y, HEX_SIZE * 0.3, tile.x, tile.y, HEX_SIZE * 1.05);
                grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
                grad.addColorStop(1, `rgba(0,0,0,${alpha * 0.7})`);
                ctx.fillStyle = grad;
                ctx.fill();
            }
        }
        if (visualGrid) {
            for (const tile of visualGrid.fillers) {
                const { alpha, state } = getFogAlpha(tile.sourceTile, viewingCamp, gameState, nowPerf);
                if (alpha <= 0) continue;
                if (state === 'unexplored') {
                    hexPath(ctx, tile.x, tile.y, HEX_SIZE);
                    const grad = ctx.createRadialGradient(tile.x, tile.y, HEX_SIZE * 0.1, tile.x, tile.y, HEX_SIZE * 1.05);
                    const a = Math.min(1, alpha);
                    grad.addColorStop(0, `rgba(6,7,14,${a})`);
                    grad.addColorStop(0.6, `rgba(8,9,17,${a})`);
                    grad.addColorStop(1, `rgba(12,13,22,${a * 0.95})`);
                    ctx.fillStyle = grad;
                    ctx.fill();
                } else {
                    drawVisualFillerTile(ctx, tile);
                    hexPath(ctx, tile.x, tile.y, HEX_SIZE);
                    const grad = ctx.createRadialGradient(tile.x, tile.y, HEX_SIZE * 0.3, tile.x, tile.y, HEX_SIZE * 1.05);
                    grad.addColorStop(0, `rgba(0,0,0,${alpha})`);
                    grad.addColorStop(1, `rgba(0,0,0,${alpha * 0.7})`);
                    ctx.fillStyle = grad;
                    ctx.fill();
                }
            }
        }
        const visibilityStateForCoord = (q, r) => {
            const visualTile = visualGrid?.tileMap.get(`${q},${r}`) || gameState.tileMap.get(`${q},${r}`);
            if (visualTile?.isVisualFiller) {
                return getPresentedTileVisibilityState(visualTile.sourceTile, viewingCamp, gameState, nowPerf);
            }
            if (visualTile) return getPresentedTileVisibilityState(visualTile, viewingCamp, gameState, nowPerf);
            return getTileVisibilityStateByCoord(q, r, viewingCamp, gameState);
        };
        // 迷雾覆绘会盖住之前画的国界线/行政区界线 —— 对已探索（无视野）地块的边线重绘
        if (campBorderEdges && campBorderEdges.length > 0) {
            for (const edge of campBorderEdges) {
                const sA = visibilityStateForCoord(edge.qa, edge.ra);
                const sB = visibilityStateForCoord(edge.qb, edge.rb);
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
        if (districtBorderEdges && districtBorderEdges.length > 0) {
            for (const edge of districtBorderEdges) {
                const sA = visibilityStateForCoord(edge.qa, edge.ra);
                const sB = visibilityStateForCoord(edge.qb, edge.rb);
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
        // Navigation affordance is public interaction information, not map
        // intelligence. Keep only the fog-safe region and the moving friendly
        // badge above the mask; attack frames, terrain and occupants stay below.
        drawFogSafeMovementPreview(now, viewingCamp);
        drawFogMovementScout(now, viewingCamp);
    }

    // 任务信标是作者主动公开的导航信息：覆在战争迷雾之上，但只画光圈，
    // 不穿透显示目标格内的地形或单位。
    drawCampaignObjectiveHighlights(now);
    // 己方布雷信息属于私有战术标记：覆在迷雾之上，但只向所属阵营或显式全知视角显示。
    drawOwnedMineMarkers(now);

    // 塞莱斯廷圣国【神谕】神像：金色半透明带翼人形，悬浮于圣国控制的城市上方
    drawCelestineOracleStatues(now);
    // 神谕指引光束（神像→神罚/赐福目标）：与神像同层，覆于战争迷雾之上
    drawCelestineOracleBeams(now);
    // 激光塔【集束激光】齐射光束（塔位→命中目标）：与神谕光束同层，覆于战争迷雾之上
    drawLaserBeams(ctx, now);

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
// 覆盖源缓存：一次空袭动画(~2s)期间防空布局基本不变，200ms 内复用同一组覆盖源，
// 避免每帧对整个 tileMap 跑规则引擎扫描 + Set/数组分配。过期条目随空袭结束自然淘汰。
const _aaFlakCoverageCache = new Map(); // key -> { at, tiles }
const _AA_FLAK_CACHE_MS = 200;

function _aaFlakSourceTiles(targetTile, friendlyCamp) {
    const key = `${targetTile.q},${targetTile.r}|${friendlyCamp?.id ?? friendlyCamp ?? ''}`;
    const now = performance.now();
    const hit = _aaFlakCoverageCache.get(key);
    if (hit && now - hit.at < _AA_FLAK_CACHE_MS) return hit.tiles;
    const coverage = resolveAntiAirCoverage(targetTile, friendlyCamp, gameState.tileMap, {
        state: gameState,
        includeSources: true
    });
    const sourceKeys = new Set(coverage.sources.map(source => source.tileKey));
    const tiles = [...sourceKeys].map(k => gameState.tileMap.get(k)).filter(Boolean);
    if (_aaFlakCoverageCache.size > 64) _aaFlakCoverageCache.clear();
    _aaFlakCoverageCache.set(key, { at: now, tiles });
    return tiles;
}

function _renderAAFlak(planeX, planeY, targetQ, targetR, t, seed, friendlyCamp) {
    const targetTile = gameState.tileMap.get(`${targetQ},${targetR}`);
    if (!targetTile) return;
    const _sources = _aaFlakSourceTiles(targetTile, friendlyCamp);
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
            const plane = getDiveStrafePlanePosition(cx, cy, elapsed);
            const px = plane.x;
            const py = plane.y;
            // 飞行方向角；🛩️ 此字体默认朝向右上方（+π/4），补正后机头对准航向
            const ang = plane.angle;

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

        // 目标相对航线：投弹/爆炸时刻不再随目标屏幕横坐标漂移，
        // 与 AIR_COMMAND_IMPACT_DELAY_MS 的延迟扣血时刻保持对齐
        const flyStartX = cx - 560;
        const flyEndX = cx + 640;
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
        // 航线不再必然飞出屏幕，收尾淡出避免战机凭空消失
        ctx.globalAlpha = t < 0.88 ? 1 : Math.max(0, 1 - (t - 0.88) / 0.12);
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
                _renderAAFlak(px, py, fx.q, fx.r, t, seed, _alc);
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

/**
 * 绘制城市燃烧城墙框：全城共享血池的 HP 映射到城郭外轮廓边界边上，
 * 从顶部绕城顺时针逐段点亮（石黄→焦褐），空段由暗色基线遮盖地形城墙。
 * 替代旧的单格六边形 HP 环，天然支持大型城市；所有渲染模式统一在
 * Canvas 覆盖层绘制（Pixi 地形纹理由同一份 Canvas 地形代码烘焙，几何对齐）。
 */
function _drawCityWallFrames(ctx, now) {
    const tileMap = gameState.tileMap;
    if (!tileMap) return;
    // 按 urbanCenterKey 分组城内格（中心格 isCity 同时带 isUrban 标记）
    const groups = new Map();
    for (const tile of gameState.tiles) {
        if (!tile.isUrban || !tile.urbanCenterKey) continue;
        const group = groups.get(tile.urbanCenterKey);
        if (group) group.push(tile);
        else groups.set(tile.urbanCenterKey, [tile]);
    }
    const lineW = Math.max(2, HEX_SIZE * 0.13);
    const normTop = ang => ((ang + Math.PI / 2) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
    for (const [centreKey, groupTiles] of groups) {
        const pool = tileMap.get(centreKey);
        const maxHp = Number(pool?.maxHp) || 0;
        if (maxHp <= 0) continue;
        const hpRatio = Math.max(0, Math.min(1, (Number(pool?.hp) || 0) / maxHp));
        // 质心：绕城排序的参照点
        let centroidX = 0, centroidY = 0;
        for (const tile of groupTiles) { centroidX += tile.x; centroidY += tile.y; }
        centroidX /= groupTiles.length; centroidY /= groupTiles.length;
        // 外轮廓边界边：邻居不在同城即城墙段（缺失邻居=棋盘边缘裁切，跳过）
        const edges = [];
        for (const tile of groupTiles) {
            for (let n = 0; n < HEX_NEIGHBORS.length; n++) {
                const [dq, dr] = HEX_NEIGHBORS[n];
                const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                if (!neighbor) continue;
                if (neighbor.isUrban && neighbor.urbanCenterKey === tile.urbanCenterKey) continue;
                // EDGE_TO_NEIGHBOR_INDEX = [5,4,3,2,1,0] 的逆映射：邻居方向 n 对应边 5-n
                const edgeIndex = 5 - n;
                const a1 = Math.PI / 3 * (edgeIndex + 0.5);
                const a2 = Math.PI / 3 * (edgeIndex + 1.5);
                const inset = HEX_SIZE * 0.91;  // 与 canvasTerrainRenderer 的城墙线同一几何
                const fromX = tile.x + Math.cos(a1) * inset, fromY = tile.y + Math.sin(a1) * inset;
                const toX = tile.x + Math.cos(a2) * inset, toY = tile.y + Math.sin(a2) * inset;
                edges.push({
                    fromX, fromY, toX, toY,
                    angle: Math.atan2((fromY + toY) / 2 - centroidY, (fromX + toX) / 2 - centroidX)
                });
            }
        }
        // 从顶部起绕城顺时针排序，血掉则按同一顺序逐段熄灭
        edges.sort((a, b) => normTop(a.angle) - normTop(b.angle));

        ctx.save();
        ctx.lineCap = 'round';
        // 暗色基线：遮盖地形里的整条城墙，空段不泄漏旧墙线
        ctx.strokeStyle = 'rgba(26,24,22,0.55)';
        ctx.lineWidth = lineW + 2;
        ctx.beginPath();
        for (const edge of edges) {
            ctx.moveTo(edge.fromX, edge.fromY);
            ctx.lineTo(edge.toX, edge.toY);
        }
        ctx.stroke();

        // 燃烧段：满血石黄 → 残血焦褐，与 HUD 城防血条同一套配色
        const total = edges.length;
        const filled = Math.floor(hpRatio * total);
        const partial = hpRatio * total - filled;
        const t = 1 - hpRatio;
        const r = Math.round(180 - t * 100);
        const g = Math.round(158 - t * 108);
        const b = Math.round(120 - t * 90);
        for (let i = 0; i < total; i++) {
            let frac = 0;
            if (i < filled) frac = 1;
            else if (i === filled) frac = partial;
            if (frac <= 0) continue;
            const edge = edges[i];
            ctx.beginPath();
            ctx.moveTo(edge.fromX, edge.fromY);
            ctx.lineTo(edge.fromX + (edge.toX - edge.fromX) * frac, edge.fromY + (edge.toY - edge.fromY) * frac);
            ctx.strokeStyle = `rgb(${r},${g},${b})`;
            ctx.lineWidth = lineW;
            ctx.stroke();
            if (frac >= 1) {
                // 内侧高光
                ctx.beginPath();
                ctx.moveTo(edge.fromX, edge.fromY);
                ctx.lineTo(edge.toX, edge.toY);
                ctx.strokeStyle = `rgba(255,230,180,${0.10 + hpRatio * 0.08})`;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }
        ctx.restore();

        // 瘫痪标识：血池归零时标记在城市中心格上方
        if (pool && isCityDisabled(pool)) {
            const pulse = (Math.sin(now / 400) + 1) / 2;
            ctx.save();
            ctx.font = '18px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = `rgba(255,80,80,${0.6 + pulse * 0.4})`;
            ctx.fillText('🚫', pool.x, pool.y - HEX_SIZE - 16);
            ctx.restore();
        }
    }
}

// 判断当前回合是否为人类玩家（用于隐藏 AI/中立回合的光圈等）
// 同时供 main.js 注入战场快照，保证 Pixi 交互提示遵守同一条规则。
export function isHumanTurnForInteractionHints() {
    return _isHumanTurn();
}

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

function _reconstructPreviewPath(startTile, targetTile) {
    if (!startTile || !targetTile || !(gameState.moveParents instanceof Map)) return [];
    const reversed = [];
    const visited = new Set();
    let current = targetTile;
    while (current && !visited.has(current)) {
        visited.add(current);
        reversed.push({ x: current.x, y: current.y });
        if (current === startTile) return reversed.reverse();
        current = gameState.moveParents.get(current)?.parent || null;
    }
    return [];
}

function _drawAttackRouteSegment(now, attacker, source, targetUnitOrTile) {
    const style = operationArrowStyleForAttacker(attacker);
    // 目标可能是真实单位，也可能是无驻军的攻城目标地块（只有单位带 .tile 引用，地块本身没有）。
    const target = targetUnitOrTile?.tile
        ? getUnitVisualPos(targetUnitOrTile)
        : { x: targetUnitOrTile.x, y: targetUnitOrTile.y };
    drawOperationPreview(ctx, {
        action: style === 'fire'
            ? OPERATION_PREVIEW_ACTIONS.RANGED
            : OPERATION_PREVIEW_ACTIONS.MELEE,
        source,
        target,
        unitRadius: UNIT_BADGE_RADIUS,
        time: now / 1000,
        color: '#e95b50',
        trajectory: 'arc'
    });
}

function drawOperationInteractionRoute(now) {
    if (!_isHumanTurn() || gameState.aiActing || gameState.cardTargeting) return;
    const unit = gameState.selectedUnit;
    if (!unit?.tile || !unit.canAct || unit.isNewRecruit) return;

    const source = getUnitVisualPos(unit);
    const hovered = gameState.hoveredTile;
    const moveAnimating = Boolean(unit.movePath) && (now - unit.movePathStart < unit.movePathDuration);

    // 连招执行中：攻击线固定锚在落点 B，单位滑向 B 时线不跟着抖
    const pending = gameState.pendingChainAttack;
    if (pending?.unit === unit && pending.targetUnit?.tile?.unit === pending.targetUnit) {
        _drawAttackRouteSegment(now, unit, { x: pending.viaTile.x, y: pending.viaTile.y }, pending.targetUnit);
        return;
    }

    if (hovered && gameState.movableTiles.includes(hovered) && !hovered.unit) {
        const bfsPath = _reconstructPreviewPath(unit.tile, hovered);
        if (bfsPath.length >= 2) {
            drawOperationPreview(ctx, {
                action: OPERATION_PREVIEW_ACTIONS.MOVE,
                source,
                target: { x: hovered.x, y: hovered.y },
                bfsPath,
                unitRadius: UNIT_BADGE_RADIUS,
                time: now / 1000,
                color: '#58c9b3'
            });
            return;
        }
    }

    // 预演连招目标：拼接 A→B 行进线 + B→C 红色攻击线
    if (!moveAnimating && hovered?.unit && gameState.chainAttackTiles?.includes(hovered)) {
        const viaTile = gameState.chainAttackPlans?.get(hovered);
        if (viaTile) {
            const bfsPath = _reconstructPreviewPath(unit.tile, viaTile);
            if (bfsPath.length >= 2) {
                drawOperationPreview(ctx, {
                    action: OPERATION_PREVIEW_ACTIONS.MOVE,
                    source,
                    target: { x: viaTile.x, y: viaTile.y },
                    bfsPath,
                    unitRadius: UNIT_BADGE_RADIUS,
                    time: now / 1000,
                    color: '#58c9b3'
                });
            }
            _drawAttackRouteSegment(now, unit, { x: viaTile.x, y: viaTile.y }, hovered.unit);
            return;
        }
    }

    if (hovered && gameState.attackableTiles.includes(hovered)
        && (hovered.unit || isSiegeableCityTile(unit, hovered, gameState))) {
        // 移动动画未走完时锚定逻辑落点：行进线不会突变成从半路射出的攻击线
        const attackSource = moveAnimating ? { x: unit.tile.x, y: unit.tile.y } : source;
        _drawAttackRouteSegment(now, unit, attackSource, hovered.unit || hovered);
        return;
    }

    drawOperationOrigin(ctx, {
        center: source,
        unitRadius: UNIT_BADGE_RADIUS,
        color: '#58c9b3',
        action: OPERATION_PREVIEW_ACTIONS.MOVE,
        time: now / 1000
    });
}

// ===== 将领技能触发特效（军功章） =====================


// ===== 统一“符号+标签”宣告特效绘制（技能/士气/晋升共用一条管线） =====
function drawIconEffects(now) {
    for (let i = iconEffects.length - 1; i >= 0; i--) {
        const fx = iconEffects[i];
        const elapsed = now - fx.startTime;
        if (elapsed > fx.duration) { iconEffects.splice(i, 1); continue; }
        if (fx.kind === 'morale') _drawMoraleIconEffect(fx, elapsed);
        else if (fx.kind === 'rankUp') _drawRankUpIconEffect(fx, elapsed);
        else _drawSkillIconEffect(fx, elapsed);
    }
}

function _withAlpha(color, alpha) {
    if (typeof color === 'string' && color.startsWith('#')) {
        let hex = color.slice(1);
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const n = parseInt(hex, 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
    }
    return color;
}

function _strokeLabel(text, x, y, color, alpha) {
    ctx.fillStyle = _withAlpha(color, alpha);
    ctx.font = 'bold 13px "Noto Serif SC", "Noto Serif CJK SC", "Microsoft YaHei", serif';
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 4;
    ctx.strokeStyle = `rgba(0,0,0,${alpha * 0.6})`;
    ctx.lineWidth = 2.5;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
}

// 技能宣告：扩散环 + 图标弹性缩放 + 技能名上浮（🛡 特例为原地变大淡出）
function _drawSkillIconEffect(fx, elapsed) {
    const t = elapsed / fx.duration;
    if (fx.kind === 'shield') {
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
        return;
    }
    const ease = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85; // 快速弹出 → 缓慢衰减
    const scale = 0.3 + ease * 1.6;  // 0.3 → 1.9 → 0.3
    const alpha = t < 0.2 ? t / 0.2 : Math.max(0, 1 - (t - 0.2) / 0.8);
    ctx.save();
    ctx.globalAlpha = alpha;
    if (fx.ring) {
        const ringR = HEX_SIZE * (0.4 + t * 1.4);
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = _withAlpha(fx.color, alpha * (1 - t));
        ctx.lineWidth = 2.5 * (1 - t);
        ctx.stroke();
    }
    ctx.fillStyle = fx.color;
    ctx.font = `bold ${Math.round(28 * scale)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = fx.color;
    ctx.shadowBlur = 20 + ease * 16;
    ctx.fillText(fx.glyph || '🎖️', fx.x, fx.y);
    if (fx.label) {
        const labelAlpha = t < 0.12 ? t / 0.12 : Math.max(0, 1 - (t - 0.25) / 0.75);
        _strokeLabel(fx.label, fx.x, fx.y - 16 - t * 30, fx.color, labelAlpha);
    }
    ctx.restore();
}

// 士气变化：大图标+文字标签弹出 → 缩小飞回右上士气角（持续角标由 unitRenderer 常驻）
function _drawMoraleIconEffect(fx, elapsed) {
    const phase1 = elapsed < fx.phaseDuration;
    const cornerX = fx.x + HEX_SIZE * 0.55 + (fx.morale === 0 ? 2 : 0);
    const cornerY = fx.y - HEX_SIZE * 0.35;
    ctx.save();
    if (phase1) {
        const t = elapsed / fx.phaseDuration;
        const alpha = Math.min(1, t * 4) * 0.75;
        const size = 28 + t * 6;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fx.color;
        ctx.font = `bold ${size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = fx.color;
        ctx.shadowBlur = 16 + t * 8;
        ctx.fillText(fx.glyph, fx.x, fx.y);
        if (fx.label) _strokeLabel(fx.label, fx.x, fx.y - 24 - t * 12, fx.color, Math.min(1, t * 3) * 0.9);
    } else {
        const t = (elapsed - fx.phaseDuration) / (fx.duration - fx.phaseDuration);
        const x = fx.x + (cornerX - fx.x) * t;
        const y = fx.y + (cornerY - fx.y) * t;
        const size = 34 - 23 * t;
        ctx.globalAlpha = 0.75 * (1 - t * 0.5);
        ctx.fillStyle = fx.color;
        ctx.font = `bold ${size}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur = 4 + 4 * (1 - t);
        ctx.fillText(fx.glyph, x, y + 1);
    }
    ctx.restore();
}

// 晋升：V 杠/金星弹出（无标签）→ 缩小飞回右下军衔角
function _drawRankUpIconEffect(fx, elapsed) {
    const phase1 = elapsed < fx.phaseDuration;
    const cornerX = fx.x + HEX_SIZE * 0.48;
    const cornerY = fx.y + HEX_SIZE * 0.38;
    if (phase1) {
        const t = elapsed / fx.phaseDuration;
        const alpha = Math.min(1, t * 4) * 0.85;
        if (fx.rank >= 4) {
            _drawRankStar(fx.x, fx.y, 28 + t * 6, alpha, '#ffd700', 14 + t * 8);
        } else {
            _drawChevrons(fx.x, fx.y, fx.rank, 2.5 + t * 1.0, alpha, '#ffd700', 14 + t * 8);
        }
    } else {
        const t = (elapsed - fx.phaseDuration) / (fx.duration - fx.phaseDuration);
        const x = fx.x + (cornerX - fx.x) * t;
        const y = fx.y + (cornerY - fx.y) * t;
        const alpha = 0.85 * (1 - t * 0.5);
        if (fx.rank >= 4) {
            _drawRankStar(x, y, 32 - 22 * t, alpha, '#ffd700', 4 + 4 * (1 - t));
        } else {
            _drawChevrons(x, y, fx.rank, 3.5 - 2.5 * t, alpha, '#ffd700', 4 + 4 * (1 - t));
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


        if (u._poison) {
            ctx.save();
            const pulse = (Math.sin(now / 360) + 1) / 2;
            ctx.strokeStyle = `rgba(135,196,66,${0.28 + pulse * 0.24})`;
            ctx.lineWidth = 2;
            ctx.setLineDash([3, 5]);
            ctx.lineDashOffset = -now / 90;
            hexPath(ctx, vx, vy, HEX_SIZE + 1);
            ctx.stroke();
            ctx.restore();
        }

        // 铁卫护盾基底环（仅六边形外轮廓，glyph 保留在 Unit.draw 中）
        if (u.commander === 'ironGuard' && !areCommanderMechanicsSuppressed(u) && u._shield > 0) {
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

function _stableUnitSeed(unitId) {
    const text = String(unitId ?? 'aurelia');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 4294967295;
}

function _drawAureliaPetal(x, y, size, angle, color, alpha) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.bezierCurveTo(size * 0.72, -size * 0.35, size * 0.45, size * 0.72, 0, size);
    ctx.bezierCurveTo(-size * 0.55, size * 0.42, -size * 0.64, -size * 0.45, 0, -size);
    ctx.fill();
    ctx.restore();
}

// 【鸢尾花的加护】持续期间：两名将领周身的柔和、非整齐轨道花瓣。
function drawAureliaGuardPetals(now) {
    const palette = ['#e4b962', '#b65d6f', '#9b6aa5', '#f0d797'];
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (!unit || !hasAureliaOathEffect(unit, gameState)) continue;
        const pos = unit.getVisualPos();
        const seed = _stableUnitSeed(unit.id);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (let index = 0; index < 9; index++) {
            const stagger = seed * 9.7 + index * 2.399;
            const direction = index % 3 === 0 ? -1 : 1;
            const speed = (0.00018 + (index % 4) * 0.000025) * direction;
            const angle = now * speed + stagger + Math.sin(now * 0.0007 + stagger) * 0.18;
            const radius = 37 + (index % 5) * 4.1 + Math.sin(now * 0.0011 + index) * 3.5;
            const x = pos.x + Math.cos(angle) * radius;
            const y = pos.y + Math.sin(angle) * radius * (0.58 + (index % 2) * 0.08)
                + Math.sin(now * 0.0014 + stagger) * 2.5;
            const pulse = 0.5 + Math.sin(now * 0.002 + index * 1.7) * 0.5;
            _drawAureliaPetal(
                x,
                y,
                2.7 + (index % 3) * 0.8,
                angle + now * 0.00045 * direction,
                palette[index % palette.length],
                0.28 + pulse * 0.42
            );
        }
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

let _targetingPreviewCache = null;

function _hexScreenShape(tile, size = HEX_SIZE) {
    const points = [];
    for (let index = 0; index < 6; index++) {
        const angle = (Math.PI / 180) * (60 * index - 30);
        points.push({
            x: tile.x + size * Math.cos(angle),
            y: tile.y + size * Math.sin(angle)
        });
    }
    return { center: { x: tile.x, y: tile.y }, size, points };
}

function _getTargetingBoardClipShapes() {
    const renderTiles = gameState.boardLayout === 'borderless'
        ? getBorderlessVisualGrid(gameState.tiles, gameState.tileMap).tiles
        : gameState.tiles;
    return renderTiles.map(tile => _hexScreenShape(tile, HEX_SIZE * 1.01));
}

function _getResolvedTargetingPreview(myCamp) {
    const cardTargeting = gameState.cardTargeting;
    const campKey = campToKey(myCamp);
    if (_targetingPreviewCache?.cardTargeting === cardTargeting
        && _targetingPreviewCache.campKey === campKey) {
        return _targetingPreviewCache.preview;
    }
    const preview = resolveTargetingPreview(gameState, cardTargeting, {
        myCamp,
        hoveredTile: null,
        isTileVisible
    });
    _targetingPreviewCache = { cardTargeting, campKey, preview };
    return preview;
}

function _targetingUnitKind(preview) {
    if (preview.intent === TARGET_INTENTS.HEAL) return 'heal';
    if (preview.intent === TARGET_INTENTS.MOBILITY) return 'mobility';
    if (preview.intent === TARGET_INTENTS.ATTACH) return 'attach';
    if (preview.intent === TARGET_INTENTS.SHIELD) return 'shield';
    if (preview.intent === TARGET_INTENTS.TRANSPORT) return 'paratrooper';
    return 'attack';
}

const TARGET_ENTRY_OPTIONS = Object.freeze({
    stepDelayMs: 26,
    tileDurationMs: 220,
    startScale: 0.82,
    settledScale: 1,
    settledAlpha: 1
});

function _targetEntry(originTile, tile, now, startedAt) {
    // Global cards have no battlefield source: their candidates enter together
    // and then continue with the renderer's stable per-tile breathing phase.
    const origin = originTile || tile;
    return resolveMovementTileReveal(origin, tile, now, startedAt, TARGET_ENTRY_OPTIONS);
}

function _signalRangeRegionOptions(now, alpha = 1) {
    const pulse = (Math.sin(now / 300) + 1) / 2;
    return {
        fill: 'rgba(0,0,0,0)',
        stroke: `rgba(120,200,255,${0.62 + pulse * 0.13})`,
        glow: 'rgba(90,180,255,0.55)',
        glowBlur: 7 + pulse * 4,
        inner: `rgba(230,245,255,${0.4 + pulse * 0.2})`,
        innerWidth: 1,
        alpha
    };
}

function _drawTargetingRegion(keys, now, options = {}) {
    if (!keys?.size) return;
    const tiles = [];
    ctx.save();
    ctx.globalAlpha *= Math.max(0, Math.min(1, options.alpha ?? 1));
    ctx.fillStyle = options.fill || 'rgba(255,80,70,0.09)';
    for (const key of keys) {
        const tile = gameState.tileMap.get(key);
        if (!tile) continue;
        tiles.push(tile);
        hexPath(ctx, tile.x, tile.y, HEX_SIZE * 0.96);
        ctx.fill();
    }
    const pulse = (Math.sin(now / 340) + 1) / 2;
    _strokeHexRegionBorder(
        tiles,
        (q, r) => keys.has(`${q},${r}`),
        now,
        pulse,
        {
            color: options.stroke || `rgba(255,96,80,${0.82 + pulse * 0.15})`,
            w: options.lineWidth || 2.6,
            glow: options.glow || 'rgba(255,70,55,0.68)',
            blur: options.glowBlur ?? (7 + pulse * 3)
        },
        { color: options.inner || 'rgba(255,235,225,0.62)', w: options.innerWidth || 0.9 }
    );
    ctx.restore();
}

function _drawAntiAirSourceMarkers(preview, now, entryAlpha = 1) {
    const sourceKeys = new Set();
    for (const sources of preview.air?.aaSourcesByTileKey?.values?.() || []) {
        for (const source of sources) sourceKeys.add(source.tileKey);
    }
    for (const key of sourceKeys) {
        const tile = gameState.tileMap.get(key);
        if (!tile) continue;
        const wave = (Math.sin(now / 460 + tile.q * 0.5) + 1) / 2;
        ctx.save();
        ctx.translate(tile.x, tile.y - HEX_SIZE * 0.77);
        ctx.fillStyle = '#ff6e61';
        ctx.strokeStyle = '#ffe0dc';
        ctx.lineWidth = 1.1;
        ctx.globalAlpha = entryAlpha * (0.78 + wave * 0.2);
        ctx.shadowColor = '#ff4636';
        ctx.shadowBlur = 4 + wave * 3;
        ctx.beginPath();
        ctx.moveTo(0, -4.5);
        ctx.lineTo(5.5, 4.3);
        ctx.lineTo(-5.5, 4.3);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -1.8);
        ctx.lineTo(0, 1.4);
        ctx.stroke();
        ctx.restore();
    }
}

function _drawAirliftDestinationLink(preview, hoveredTile) {
    if (preview.cardId !== 'airlift_dest' || !hoveredTile) return;
    const sourceId = preview.air?.transportSourceUnitId;
    const source = gameState.tiles.find(tile => tile.unit?.id === sourceId)?.unit;
    if (!source || !preview.candidateTileKeys.has(targetingTileKey(hoveredTile))) return;
    const from = getUnitVisualPos(source);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(hoveredTile.x, hoveredTile.y);
    ctx.strokeStyle = '#69c7e8';
    ctx.lineWidth = 2.6;
    ctx.setLineDash([5, 7]);
    ctx.lineDashOffset = -(frameInfo.now / 34) % 12;
    ctx.shadowColor = '#69c7e8';
    ctx.shadowBlur = 4;
    ctx.globalAlpha = 0.9;
    ctx.stroke();
    ctx.restore();
}

function drawCardTargetingPreview(now) {
    const cardTargeting = gameState.cardTargeting;
    if (!cardTargeting) return;
    const myCamp = isNetworkGame() ? getRoleCamp(gameState, getMyRole()) : gameState.currentCamp;
    const preview = _getResolvedTargetingPreview(myCamp);
    const hovered = gameState.hoveredTile;
    const hoveredKey = targetingTileKey(hovered);
    const activeKey = hoveredKey && preview.candidateTileKeys.has(hoveredKey) ? hoveredKey : null;
    const time = now / 1000;
    const boardClip = { shapes: _getTargetingBoardClipShapes() };
    const colonelUnit = preview.air?.colonelOriginUnitId
        ? gameState.tiles.find(tile => tile.unit?.id === preview.air.colonelOriginUnitId)?.unit
        : null;
    const transportSource = preview.air?.transportSourceUnitId
        ? gameState.tiles.find(tile => tile.unit?.id === preview.air.transportSourceUnitId)?.unit
        : null;
    const entryOriginTile = colonelUnit?.tile || transportSource?.tile || null;
    const entryStart = cardTargeting.startedAt;
    const groupEntry = _targetEntry(entryOriginTile, entryOriginTile || gameState.tiles[0], now, entryStart);
    const scene = {
        boardClip,
        antiAir: preview.air ? {
            cells: [...preview.air.aaLayersByTileKey.entries()].map(([key, level]) => {
                const tile = gameState.tileMap.get(key);
                if (!tile) return null;
                const entry = _targetEntry(entryOriginTile, tile, now, entryStart);
                return { ..._hexScreenShape(tile, HEX_SIZE), q: tile.q, r: tile.r, level, alpha: entry.alpha };
            }).filter(Boolean),
            size: HEX_SIZE,
            alpha: 0.96 * groupEntry.alpha,
            time,
            boardKeys: gameState.tileMap
        } : null,
        origins: [],
        tileDeployments: [],
        areaCenters: [],
        unitTargets: []
    };

    for (const tile of preview.candidateTiles) {
        const key = targetingTileKey(tile);
        const active = key === activeKey;
        const phase = tile.q * 0.43 + tile.r * 0.29;
        const entry = _targetEntry(entryOriginTile, tile, now, entryStart);
        if (preview.shape === TARGET_SHAPES.UNIT && tile.unit) {
            scene.unitTargets.push({
                center: getUnitVisualPos(tile.unit),
                size: UNIT_HUD_OUTER_RADIUS * 1.72 * entry.scale,
                kind: _targetingUnitKind(preview),
                active,
                time,
                phase,
                alpha: entry.alpha
            });
        } else if (preview.shape === TARGET_SHAPES.AREA_CENTER) {
            scene.areaCenters.push({
                center: { x: tile.x, y: tile.y },
                size: HEX_SIZE * entry.scale,
                active,
                time,
                phase,
                color: preview.cardId === 'scout' ? '#9ad8ff' : '#e95b50',
                alpha: entry.alpha
            });
        } else {
            scene.tileDeployments.push({
                ..._hexScreenShape(tile, HEX_SIZE),
                size: HEX_SIZE * entry.scale,
                active,
                time,
                phase,
                alpha: entry.alpha,
                showStructure: cardTargeting.cardId === 'mgNest' || cardTargeting.cardId === 'engineer_bunker'
            });
        }
    }

    if (preview.air?.colonelOriginUnitId) {
        const colonel = colonelUnit;
        if (colonel) {
            scene.origins.push({
                center: getUnitVisualPos(colonel),
                size: UNIT_BADGE_RADIUS * 2 * groupEntry.scale,
                time,
                color: '#69c7e8',
                alpha: groupEntry.alpha
            });
        }
    }

    if (preview.cardId === 'airlift_dest' && preview.air?.transportSourceUnitId) {
        const source = transportSource;
        if (source) {
            scene.unitTargets.push({
                center: getUnitVisualPos(source),
                size: UNIT_HUD_OUTER_RADIUS * 1.72 * groupEntry.scale,
                kind: 'paratrooper',
                active: true,
                time,
                alpha: 0.95 * groupEntry.alpha
            });
        }
    }

    renderTargetingPreview(ctx, scene);

    // 上校专属卡才有真实棋盘起点；普通空袭/空降不得伪造飞机位置。
    if (preview.air?.colonelOriginUnitId) {
        const colonel = colonelUnit;
        if (colonel) drawHologramMotif(ctx, {
            center: getUnitVisualPos(colonel),
            size: UNIT_BADGE_RADIUS * 1.75 * groupEntry.scale,
            kind: 'plane',
            active: true,
            time,
            color: '#9bdcff',
            alpha: groupEntry.alpha
        });
    }

    // 空降与空运落点在地块插槽中央复用同一伞兵徽章。
    if (preview.cardId === 'airdrop' || preview.cardId === 'airlift_dest') {
        for (const tile of preview.candidateTiles) {
            const entry = _targetEntry(entryOriginTile, tile, now, entryStart);
            drawHologramMotif(ctx, {
                center: { x: tile.x, y: tile.y },
                size: HEX_SIZE * 0.72 * entry.scale,
                kind: 'paratrooper',
                active: targetingTileKey(tile) === activeKey,
                time,
                phase: tile.q * 0.43 + tile.r * 0.29,
                color: '#69c7e8',
                alpha: 0.86 * entry.alpha
            });
        }
    }

    if (preview.air?.rangeTileKeys?.size) {
        _drawTargetingRegion(
            preview.air.rangeTileKeys,
            now,
            _signalRangeRegionOptions(now, groupEntry.alpha)
        );
    }

    if (activeKey && (preview.cardId === 'airstrike' || preview.cardId === 'carpetBomb' || preview.cardId === 'scout')) {
        const affectedKeys = new Set([activeKey]);
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const key = `${hovered.q + dq},${hovered.r + dr}`;
            if (gameState.tileMap.has(key)) affectedKeys.add(key);
        }
        _drawTargetingRegion(affectedKeys, now, preview.cardId === 'scout' ? {
            fill: 'rgba(120,190,255,0.07)',
            stroke: 'rgba(155,220,255,0.86)',
            glow: 'rgba(100,190,255,0.55)',
            inner: 'rgba(235,250,255,0.55)',
            alpha: groupEntry.alpha
        } : { alpha: groupEntry.alpha });
    }

    _drawAirliftDestinationLink(preview, hovered);
    _drawAntiAirSourceMarkers(preview, now, groupEntry.alpha);
}

function _drawDeselectingActionPreview(now) {
    const elapsed = now - gameState.deselectionTime;
    if (elapsed >= 220) {
        gameState.deselecting = false;
        gameState.deselectMoveTiles = [];
        gameState.deselectAtkTiles = [];
        gameState.deselectOrigin = null;
        return;
    }
    const exitAlpha = Math.max(0, 1 - elapsed / 220);
    const origin = gameState.deselectOrigin;
    const moveTiles = gameState.deselectMoveTiles || [];
    if (origin && moveTiles.length) {
        const moveKeys = new Set(moveTiles.map(targetingTileKey).filter(Boolean));
        moveKeys.add(targetingTileKey(origin));
        ctx.save();
        ctx.fillStyle = '#41cdb9';
        ctx.globalAlpha = 0.13 * exitAlpha;
        for (const tile of moveTiles) {
            hexPath(ctx, tile.x, tile.y, HEX_SIZE * 1.008);
            ctx.fill();
        }
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = exitAlpha;
        _strokeHexRegionBorder(
            [origin, ...moveTiles],
            (q, r) => moveKeys.has(`${q},${r}`),
            now,
            0,
            { color: 'rgba(80,225,205,0.78)', w: 2.6, glow: 'rgba(60,205,185,0.42)', blur: 6 },
            { color: 'rgba(215,255,248,0.34)', w: 0.75 }
        );
        ctx.restore();
    }

    const attackTiles = (gameState.deselectAtkTiles || []).filter(tile => tile?.unit);
    if (attackTiles.length) {
        renderTargetingPreview(ctx, {
            boardClip: { shapes: _getTargetingBoardClipShapes() },
            unitTargets: attackTiles.map(tile => ({
                center: getUnitVisualPos(tile.unit),
                size: UNIT_HUD_OUTER_RADIUS * 1.72 * (0.86 + exitAlpha * 0.14),
                kind: 'attack',
                active: false,
                time: now / 1000,
                phase: tile.q * 0.43 + tile.r * 0.29,
                color: '#e95b50',
                alpha: exitAlpha
            }))
        });
    }
}

function drawUnitActionTargetingPreview(now, deselecting) {
    if (deselecting) {
        _drawDeselectingActionPreview(now);
        return;
    }
    const unit = gameState.selectedUnit;
    if (!unit?.tile || !unit.canAct || unit.isNewRecruit) return;

    if (unit.type === 'carrier') {
        const range = unit.getEffectiveRange?.() ?? unit.config.range;
        const airRangeKeys = new Set(
            gameState.tiles
                .filter(tile => hexDistance(unit.tile, tile) <= range)
                .map(targetingTileKey)
                .filter(Boolean)
        );
        _drawTargetingRegion(airRangeKeys, now, _signalRangeRegionOptions(now));
    }

    const moveTiles = unit.remainingMP > 0 ? gameState.movableTiles : [];
    if (moveTiles.length) {
        const moveKeys = new Set(moveTiles.map(targetingTileKey).filter(Boolean));
        moveKeys.add(targetingTileKey(unit.tile));
        ctx.save();
        // Reuse the old distance ripple as a fill-only jelly reveal.  Adjacent
        // cells overlap when settled, so no internal honeycomb survives; only
        // _strokeHexRegionBorder owns a thick outline.
        ctx.fillStyle = '#41cdb9';
        for (const tile of moveTiles) {
            const reveal = resolveMovementTileReveal(
                unit.tile,
                tile,
                now,
                gameState.selectionTime
            );
            if (reveal.alpha <= 0) continue;
            ctx.save();
            ctx.globalAlpha = reveal.alpha;
            hexPath(ctx, tile.x, tile.y, HEX_SIZE * reveal.scale);
            ctx.fill();
            ctx.restore();
        }
        ctx.restore();
        const pulse = (Math.sin(now / 420) + 1) / 2;
        const regionEntry = _targetEntry(unit.tile, unit.tile, now, gameState.selectionTime);
        ctx.save();
        ctx.globalAlpha = regionEntry.alpha;
        _strokeHexRegionBorder(
            [unit.tile, ...moveTiles],
            (q, r) => moveKeys.has(`${q},${r}`),
            now,
            pulse,
            {
                color: `rgba(80,225,205,${0.72 + pulse * 0.14})`,
                w: 2.6,
                glow: 'rgba(60,205,185,0.42)',
                blur: 6 + pulse * 2.5
            },
            { color: 'rgba(215,255,248,0.34)', w: 0.75 }
        );
        ctx.restore();
    }

    const attackTiles = gameState.attackableTiles.filter(tile => tile.unit || isSiegeableCityTile(unit, tile, gameState));
    const chainTiles = (gameState.chainAttackTiles || []).filter(tile => tile.unit);
    if (!attackTiles.length && !chainTiles.length) return;
    const hovered = gameState.hoveredTile;
    renderTargetingPreview(ctx, {
        boardClip: { shapes: _getTargetingBoardClipShapes() },
        unitTargets: [
            ...attackTiles.map(tile => {
                const entry = _targetEntry(unit.tile, tile, now, gameState.selectionTime);
                return {
                    center: tile.unit ? getUnitVisualPos(tile.unit) : { x: tile.x, y: tile.y },
                    size: UNIT_HUD_OUTER_RADIUS * 1.72 * entry.scale,
                    kind: 'attack',
                    active: tile === hovered,
                    time: now / 1000,
                    phase: tile.q * 0.43 + tile.r * 0.29,
                    color: '#e95b50',
                    alpha: entry.alpha
                };
            }),
            // 连招预演目标：同为红色敌意框，缩小+降透明度示意"移动后可达"
            ...chainTiles.map(tile => {
                const entry = _targetEntry(unit.tile, tile, now, gameState.selectionTime);
                return {
                    center: getUnitVisualPos(tile.unit),
                    size: UNIT_HUD_OUTER_RADIUS * 1.52 * entry.scale,
                    kind: 'attack',
                    active: tile === hovered,
                    time: now / 1000,
                    phase: tile.q * 0.43 + tile.r * 0.29,
                    color: '#e95b50',
                    alpha: entry.alpha * (tile === hovered ? 1 : 0.62)
                };
            })
        ]
    });
}

// ===== 范围涟漪展开 =====================
function drawFogMovementScout(now, viewingCamp) {
    if (!hasActiveFogPresentationHold(gameState, viewingCamp, now)) return;
    const viewingKey = campToKey(viewingCamp);
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (!unit?.movePath || campToKey(unit.camp) !== viewingKey) continue;
        // Only the player's moving counter crosses the fog. Terrain, flags and
        // occupants remain below it until the presentation hold is released.
        drawUnitBadgeAboveFog(unit, gameState);
    }
}

function drawFogSafeMovementPreview(now, viewingCamp) {
    if (gameState.aiActing || !_isHumanTurn() || gameState.cardTargeting) return;
    const unit = gameState.selectedUnit;
    const preview = gameState._fogSafeMovablePreview;
    if (!unit?.canAct || unit.isNewRecruit || preview?.unitId !== unit.id) return;
    const tiles = (preview.tiles || []).filter(tile =>
        getPresentedTileVisibilityState(tile, viewingCamp, gameState, now) !== 'visible');
    if (!tiles.length) return;

    const keys = new Set(tiles.map(targetingTileKey).filter(Boolean));
    ctx.save();
    ctx.fillStyle = '#55d8c6';
    for (const tile of tiles) {
        const reveal = resolveMovementTileReveal(unit.tile, tile, now, gameState.selectionTime);
        if (reveal.alpha <= 0) continue;
        ctx.save();
        ctx.globalAlpha = 0.2 * reveal.alpha;
        hexPath(ctx, tile.x, tile.y, HEX_SIZE * reveal.scale);
        ctx.fill();
        ctx.restore();
    }
    const pulse = (Math.sin(now / 420) + 1) / 2;
    _strokeHexRegionBorder(
        tiles,
        (q, r) => keys.has(`${q},${r}`),
        now,
        pulse,
        {
            color: `rgba(100,235,218,${0.62 + pulse * 0.12})`,
            w: 2.2,
            glow: 'rgba(70,215,195,0.32)',
            blur: 5 + pulse * 2
        },
        { color: 'rgba(225,255,250,0.28)', w: 0.7 }
    );
    ctx.restore();
}

function drawRangeApertures(now) {
    if (gameState.aiActing || !_isHumanTurn()) return;

    const deselecting = gameState.deselecting;
    if (!deselecting && !gameState.cardTargeting && (!gameState.selectedUnit || !gameState.selectedUnit.canAct || gameState.selectedUnit.isNewRecruit)) return;

    if (gameState.cardTargeting) {
        // 卡牌交互（结构预览/伞兵徽章/防空来源标/溅射范围等）视觉最复杂且低频，
        // 始终由 Canvas 绘制以保证与单机表现逐像素一致。
        drawCardTargetingPreview(now);
        return;
    }

    // 选中/悬停热路径（移动范围、攻击目标框、退选淡出）可委托给 Pixi。
    if (battlefieldDelegation.interactionHints) return;
    drawUnitActionTargetingPreview(now, deselecting);
}
// ===== 伤害文本（弹跳+强击特效） =====================
function drawDamageTexts(now) {
    flushFloatTexts(now);
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

        if (text.isCityHeal) {
            // 城市脱战回复：浅绿 +N
            ctx.fillStyle = '#8fe3b0';
            ctx.shadowColor = '#1d5c38';
            ctx.shadowBlur = 8;
            ctx.fillText(`+${Math.round(text.value)}`, 0, 0);
        } else if (text.isTrueDmg) {
            ctx.fillStyle = '#ffe850';
            ctx.shadowColor = '#ffaa00';
            ctx.shadowBlur = 18;
            ctx.fillText(`-${Math.round(text.value)}`, 0, 0);
            // 二次绘制强化灼烧感
            ctx.shadowBlur = 8;
            ctx.fillText(`-${Math.round(text.value)}`, 0, 0);
        } else if (text.isCityDamage) {
            ctx.fillStyle = text.isCrit ? '#ff7a32' : '#ffc45c';
            ctx.shadowColor = text.isCrit ? '#ff3d00' : '#8a3f0b';
            ctx.shadowBlur = text.isCrit ? 15 : 10;
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

// ===== 护盾文本（淡蓝，样式仿治疗浮字） =====================
function drawShieldTexts(now) {
    if (!gameState.shieldTexts) gameState.shieldTexts = [];
    gameState.shieldTexts = gameState.shieldTexts.filter(text => {
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
        ctx.shadowColor = '#0d5a75';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#76e7ff';
        ctx.fillText(`${text.sign || '-'}${Math.round(text.value)}`, text.x, text.y - 30 - floatUp);
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
    // 上校与其他将领一样使用标准对策牌（initCardDeck）；专属空军卡为金币门控、单独结算。
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
export function getCommanderPennantCrop(imageWidth, imageHeight) {
    const size = Math.min(imageHeight * 0.60, imageWidth);
    return { x: (imageWidth - size) / 2, y: 0, width: size, height: size };
}

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

        // 先锋旗统一使用源图顶部的正方形头肩裁片。目标尺寸必须跟随裁片比例，
        // 不能跟随整张立绘比例：NPC 兜底立绘是 2:3，按整图比例会把方形裁片纵向拉伸。
        const crop = getCommanderPennantCrop(iw, ih);
        const cropW = crop.width;
        const cropH = crop.height;
        const ph = pw * (cropH / cropW);
        const cutIn = 16 * scale;
        const pointExtend = 7 * scale;
        const pX = vx - pw / 2;
        const pY = vy - ph - 14;

        // 裁剪源图顶部方形区域（折中：头肩半身）
        const sx = crop.x;
        const sy = crop.y;

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

