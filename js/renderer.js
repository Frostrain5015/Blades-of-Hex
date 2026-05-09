import { HEX_SIZE, LOGICAL_W, LOGICAL_H, ctx, hexPath, drawHexagonOutline, roundRectPath, COUNTER_RELATION, frameInfo, MORALE_CONFIG, CAMP } from './config.js';
import { gameState } from './state.js';
import { isNetworkGame, getMyRole } from './network.js';
import { drawAllBorders } from './HexTile.js';
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
    coinParticles, updateCoinParticles, drawCoinParticles
} from './effects.js';

let lastTime = Date.now();
let _lastParticleSpawn = 0;

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
    // Flag poles (before units)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawFlagPole();
    // Overlays (hover/selection)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawOverlay();
    // 缚足色层（停滞者）—— 在单位之前绘制，避免单位变暗
    drawStallerZone(now);
    // Units
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawUnit();
    // Flag finials + cloth (after units, overlays the badge)
    for (let i = 0, len = tiles.length; i < len; i++) tiles[i].drawFlagFinialAndCloth();

    // 士气变化动画
    drawMoraleEffects(now);
    // 晋升动画
    drawRankUpEffects(now);

    // 将领技能触发特效
    drawCommanderSkillEffects(now);

    // 士气状态持续标识（▲/▼）
    drawMoraleIndicators();

    // 范围光圈
    drawRangeApertures(now);

    // 铁卫灵光
    drawIronGuardAura(now);

    // 文字特效
    drawDamageTexts(now);
    drawHealTexts(now);
    drawGoldTexts(now);
    drawCounterText();

    // 选中高亮
    drawSelectionHighlights();

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
        const myCamp = isNetworkGame() ? (getMyRole() === 'player1' ? CAMP.player1 : CAMP.player2) : gameState.currentCamp;
        const iAmDeployed = myCamp === CAMP.player1 ? gameState.commanderP1Deployed : gameState.commanderP2Deployed;
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
    // 攻心波纹
    updateGongxinRipples(now);
    drawGongxinRipples(ctx, now);

    // 尚书金币
    if (coinParticles.length > 0) drawCoinParticles(ctx);

    ctx.restore();

    // 彩纸（不跟随震动）
    if (confettiPieces.length > 0) {
        updateConfetti(dt);
        drawConfetti(ctx);
    }

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
    for (let i = 0, len = tiles.length; i < len; i++) {
        const unit = tiles[i].unit;
        if (!unit || unit.morale === 2 || unit.morale === 0) continue;

        // 如果正在播放动画，跳过（动画已包含该标识）
        if (moraleEffects.some(fx => fx.unitId === unit.id)) continue;

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
        return getMyRole() === 'player1' ? gameState.currentCamp === CAMP.player1 : gameState.currentCamp === CAMP.player2;
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
                ctx.font = 'bold 13px "Microsoft YaHei", Arial, sans-serif';
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
    const alpha = 0.45 + pulse * 0.30;
    const fillAlpha = 0.04 + pulse * 0.04;

    for (const tile of gameState.tiles) {
        const u = tile.unit;
        if (!u || u.commander !== 'ironGuard' || u.hp <= 0) continue;
        const isP1 = u.camp.name === '红军';
        const clr = isP1 ? `rgba(255,80,80,${alpha})` : `rgba(80,80,255,${alpha})`;

        // 收集自身+6邻格的所有六边形顶点，筛选外边界
        const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
        const vertCount = new Map(); // key: "x,y" → count
        for (const [dq, dr] of dirs) {
            const ht = gameState.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (!ht) continue;
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 180) * (60 * i - 30);
                const vx = ht.x + HEX_SIZE * Math.cos(angle);
                const vy = ht.y + HEX_SIZE * Math.sin(angle);
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
        ctx.lineWidth = 3.5;
        ctx.shadowColor = clr;
        ctx.shadowBlur = 14 + pulse * 6;
        ctx.stroke();
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
        for (const [dq, dr] of [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]) {
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

    // 对策卡选择目标高亮 — 复用攻击目标渲染（无克制标签）
    if (gameState.cardTargeting) {
        const pulse = (Math.sin(now / 280) + 1) / 2;
        const baseAlpha = 0.35 + pulse * 0.55;
        const ct = gameState.cardTargeting;
        const myCamp = isNetworkGame() ? (getMyRole() === 'player1' ? CAMP.player1 : CAMP.player2) : gameState.currentCamp;
        const isFriendly = ct.targeting === 'friendlyAlive';
        for (const tile of gameState.tiles) {
            if (ct.targeting === 'enemyGlobal') {
                if (!tile.unit) continue;
                if (tile.unit.camp === myCamp) continue;
            } else if (ct.targeting === 'friendlyAlive') {
                if (!tile.unit || !tile.unit.canAct || tile.unit.camp !== myCamp) continue;
            } else { continue; }

            const r = isFriendly ? 255 : 255;
            const g = isFriendly ? 200 : 50;
            const b = isFriendly ? 50 : 50;
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
            // X 标记仅敌方目标
            if (!isFriendly) {
                const xA = 0.2 + pulse * 0.55;
                ctx.strokeStyle = `rgba(255, 0, 0, ${xA})`;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(tile.x - 8, tile.y - 8);
                ctx.lineTo(tile.x + 8, tile.y + 8);
                ctx.moveTo(tile.x + 8, tile.y - 8);
                ctx.lineTo(tile.x - 8, tile.y + 8);
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
            ctx.fillStyle = '#e8f0ff';
            ctx.shadowColor = '#4499ff';
            ctx.shadowBlur = 16;
            ctx.fillText(`-${Math.round(text.value)}`, 0, 0);
            // 二次绘制强化电光感
            ctx.shadowBlur = 6;
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
