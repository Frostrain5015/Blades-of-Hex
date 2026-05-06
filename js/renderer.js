import { HEX_SIZE, LOGICAL_W, LOGICAL_H, ctx, hexPath, drawHexagonOutline, roundRectPath, COUNTER_RELATION, frameInfo, MORALE_CONFIG } from './config.js';
import { gameState } from './state.js';
import { drawAllBorders } from './HexTile.js';
import {
    particles, attackFlashes, confettiPieces, screenShake, turnFlash,
    drawAttackFlashes, drawSlashMarks, drawSoftFlashes, drawConfetti, updateConfetti,
    VisualParticle, moraleEffects, drawMeleeSlashes
} from './effects.js';

let lastTime = Date.now();
let _lastParticleSpawn = 0;

export function renderGame() {
    const now = Date.now();
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
    // City flags (animated, above hex bases)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawCityFlag();
    // Overlays (hover/selection)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawOverlay();
    // Units
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawUnit();

    // 士气变化动画
    drawMoraleEffects(now);

    // 范围光圈
    drawRangeApertures(now);

    // 文字特效
    drawDamageTexts(now);
    drawHealTexts(now);
    drawGoldTexts(now);
    drawCounterText();

    // 选中高亮
    drawSelectionHighlights();

    // 暗角
    const vignetteGrad = ctx.createRadialGradient(
        LOGICAL_W / 2, LOGICAL_H / 2, LOGICAL_H * 0.3,
        LOGICAL_W / 2, LOGICAL_H / 2, LOGICAL_H * 0.8
    );
    vignetteGrad.addColorStop(0, 'rgba(0,0,0,0)');
    vignetteGrad.addColorStop(1, 'rgba(0,0,0,0.4)');
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(-20, -20, LOGICAL_W + 40, LOGICAL_H + 40);

    // 回合切换闪光
    if (turnFlash.alpha > 0) {
        ctx.save();
        ctx.fillStyle = turnFlash.color;
        ctx.globalAlpha = turnFlash.alpha;
        ctx.fillRect(-20, -20, LOGICAL_W + 40, LOGICAL_H + 40);
        ctx.restore();
        turnFlash.alpha = Math.max(0, turnFlash.alpha - 0.008);
    }

    // 环境粒子 — throttle to ~3/sec
    if (now - _lastParticleSpawn > 330 && particles.length < 60) {
        _lastParticleSpawn = now;
        particles.push(new VisualParticle(
            Math.random() * LOGICAL_W, LOGICAL_H + 5,
            (Math.random() - 0.5) * 20, -(30 + Math.random() * 50),
            `rgba(255,255,200,${0.1 + Math.random() * 0.2})`,
            1 + Math.random() * 2,
            3 + Math.random() * 4
        ));
    }

    // 粒子
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (!p.update(dt)) { particles.splice(i, 1); continue; }
        p.draw(ctx);
    }

    // 攻击闪光
    drawAttackFlashes(ctx, now);

    // 斩击标记
    drawSlashMarks(ctx, now);
    drawMeleeSlashes(ctx, now);

    // 治疗 / 招募光环
    drawSoftFlashes(ctx, now);

    ctx.restore();

    // 彩纸（不跟随震动）
    if (confettiPieces.length > 0) {
        updateConfetti(dt);
        drawConfetti(ctx);
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

            const dotAlpha = t * 0.55;
            ctx.save();
            ctx.globalAlpha = dotAlpha;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.beginPath();
            ctx.arc(cornerX, cornerY, 9, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.fillStyle = mc.color;
            ctx.font = `bold ${size}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = mc.color;
            ctx.shadowBlur = 8 * (1 - t);
            ctx.fillText(mc.icon, x, y + 1);
            ctx.restore();
        }
    }
}

function drawSelectionHighlights() {
    const highlightTile = gameState.selectedTile;
    if (!highlightTile) return;

    // Follow visual position during movement animation
    let cx = highlightTile.x, cy = highlightTile.y;
    if (gameState.selectedUnit === highlightTile.unit && highlightTile.unit) {
        const pos = highlightTile.unit.getVisualPos();
        cx = pos.x; cy = pos.y;
    }

    hexPath(ctx, cx, cy, HEX_SIZE);
    ctx.fillStyle = 'rgba(255,215,0,0.15)';
    ctx.fill();
    drawHexagonOutline(ctx, cx, cy, HEX_SIZE + 2, 'rgba(200,160,20,0.55)', 2);
}

// ===== 克制/被克提示文字 =====================
function drawCounterText() {
    if (!gameState.selectedUnit || !gameState.selectedUnit.canAct) return;

    gameState.attackableTiles.forEach(tile => {
        const targetUnit = tile.unit;
        if (!targetUnit) return;

        const counterCoeff = COUNTER_RELATION[gameState.selectedUnit.type][targetUnit.type];
        let text = '';
        let color = '';
        let icon = '';
        let desc = '';

        if (counterCoeff > 1) {
            icon = '⬆';
            text = '克制';
            color = '#44ff44';
            desc = '造成伤害+25%';
        } else if (counterCoeff < 1) {
            icon = '⬇';
            text = '被克';
            color = '#ff4444';
            desc = '造成伤害−25%';
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

        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '10px Arial';
        ctx.textBaseline = 'top';
        ctx.fillText(desc, tile.x, labelY + labelH + 2);
        ctx.restore();
    });
}

// ===== 范围涟漪展开 =====================
function drawRangeApertures(now) {
    if (!gameState.selectedUnit || !gameState.selectedUnit.canAct || gameState.selectedUnit.isNewRecruit) return;

    const elapsed = now - gameState.selectionTime;
    const stepDelay = 70;
    const hexExpandDuration = 100;
    const pulse = (Math.sin(now / 300) + 1) / 2;
    const startTile = gameState.selectedUnit.tile;

    const moveTiles = gameState.selectedUnit.remainingMP > 0 ? gameState.movableTiles : [];
    const atkTiles = gameState.attackableTiles;

    function getHexProgress(tile) {
        const dist = (Math.abs(tile.q - startTile.q) + Math.abs(tile.r - startTile.r) + Math.abs(tile.s - startTile.s)) / 2;
        const delay = dist * stepDelay;
        const raw = (elapsed - delay) / hexExpandDuration;
        return Math.max(0, Math.min(raw, 1));
    }

    function drawExpandingHex(tile, r, g, b, baseAlpha) {
        const p = getHexProgress(tile);
        if (p <= 0) return;

        const ep = (1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2));
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
                const ep = (1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2));
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

// ===== 伤害文本（增强版：弹跳+暴击特效） =====================
function drawDamageTexts(now) {
    gameState.damageTexts = gameState.damageTexts.filter(text => {
        text.timeLeft -= now - text.lastUpdate;
        text.lastUpdate = now;
        if (text.timeLeft <= 0) return false;

        const progress = 1 - text.timeLeft / 900;
        const bounce = Math.sin(progress * Math.PI) * 12;
        const alpha = Math.max(0, 1 - progress * 0.6);
        const scale = text.isCrit ? 1 + (1 - progress) * 0.5 : 1;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(text.x, text.y - 30 - bounce);
        ctx.scale(scale, scale);
        ctx.textAlign = 'center';
        ctx.font = text.isCrit ? 'bold 24px Arial' : 'bold 18px Arial';
        ctx.shadowColor = '#000';
        ctx.shadowBlur = text.isCrit ? 8 : 4;

        if (text.isCrit) {
            ctx.fillStyle = '#ff4400';
            ctx.shadowColor = '#ff4400';
            ctx.shadowBlur = 14;
            ctx.fillText(`💥 -${Math.round(text.value)}！`, 0, 0);
        } else {
            ctx.fillStyle = '#ff6666';
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

// ===== 金币文本（增强版：浮起效果） =====================
function drawGoldTexts(now) {
    gameState.goldTexts = gameState.goldTexts.filter(text => {
        text.timeLeft -= now - text.lastUpdate;
        text.lastUpdate = now;
        if (text.timeLeft <= 0) return false;

        const progress = 1 - text.timeLeft / 1000;
        const floatUp = progress * 15;
        const alpha = Math.max(0, 1 - progress);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = 'center';
        ctx.font = 'bold 17px Arial';
        ctx.shadowColor = '#aa8800';
        ctx.shadowBlur = 6;
        ctx.fillStyle = text.color;
        ctx.fillText(`${text.prefix}${Math.round(text.value)}g`, text.x, text.y - 25 - floatUp);
        ctx.restore();
        return true;
    });
}
