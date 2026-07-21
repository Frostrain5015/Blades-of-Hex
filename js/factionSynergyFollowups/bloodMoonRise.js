// 【血月降临】独有后半段：暗红血月自锚点城市上方升起，全屏笼罩血色辉光。
import { emit } from '../eventBus.js';

const FRAME_INTERVAL_MS = 1000 / 40;
const RISE_MS = 900;          // 血月从地平线升起到锚点上方
const RADIANCE_MS = 1300;     // 血色辉光扩散到全屏
const DRIP_MS = 700;          // 血滴沉降时长

function createDrip(center, startMs, color, viewportH) {
    const offsetX = (Math.random() - 0.5) * 160;
    return {
        center,
        delay: startMs + Math.random() * RADIANCE_MS * 0.7,
        life: 800 + Math.random() * 600,
        startX: center.x + offsetX,
        startY: center.y - 40 + Math.random() * 30,
        fall: 80 + Math.random() * viewportH * 0.15,
        size: 1.5 + Math.random() * 3,
        color,
        phase: Math.random() * Math.PI * 2
    };
}

function drawDrip(context, drip, elapsed) {
    const progress = (elapsed - drip.delay) / drip.life;
    if (progress <= 0 || progress >= 1) return;
    const y = drip.startY + drip.fall * progress;
    const alpha = Math.sin(progress * Math.PI) * 0.6;
    const s = drip.size * (1 - progress * 0.4);
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = drip.color;
    context.shadowColor = drip.color;
    context.shadowBlur = 6;
    context.beginPath();
    context.ellipse(drip.startX, y, s * 0.4, s, drip.phase, 0, Math.PI * 2);
    context.fill();
    context.restore();
}

export function createBloodMoonRiseFollowup({ root, event, presentation, stageRect }) {
    const container = root.querySelector('.faction-synergy-followup');
    if (!container) return null;

    container.innerHTML = '<canvas class="blood-moon-rise-canvas" aria-hidden="true"></canvas>';
    const canvas = container.querySelector('.blood-moon-rise-canvas');
    if (!canvas) return null;
    const viewport = root.getBoundingClientRect();
    const center = {
        x: stageRect.left + stageRect.width / 2,
        y: stageRect.top + stageRect.height / 2
    };
    // 如果有棋盘锚点坐标，将血月对齐到锚点上方；否则显示在屏幕中央
    const anchor = event?.anchor || null;
    const moonCenter = anchor && Number.isFinite(anchor.x) && Number.isFinite(anchor.y)
        ? { x: anchor.x, y: anchor.y - 80 }
        : { x: center.x, y: center.y - 60 };

    const startMs = Number(presentation.followupStartMs) || 3200;
    const durationMs = Number(presentation.durationMs) || 4800;
    const followup = presentation.followup || {};
    const [coreColor, glowColor, dripColor] = followup.particleColors?.length >= 3
        ? followup.particleColors
        : ['#cc1122', '#661122', '#440011'];
    const dripCount = Math.max(6, Number(followup.particleCount) || 16);

    let frame = 0;
    let soundTimer = 0;

    function animate(startedAt) {
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) return;
        const drips = Array.from({ length: dripCount }, () =>
            createDrip(moonCenter, startMs, Math.random() < 0.3 ? coreColor : dripColor, viewport.height));

        let lastDrawAt = 0;
        const draw = now => {
            const elapsed = now - startedAt;
            if (elapsed < startMs - FRAME_INTERVAL_MS) {
                frame = requestAnimationFrame(draw);
                return;
            }
            if (now - lastDrawAt < FRAME_INTERVAL_MS) {
                frame = requestAnimationFrame(draw);
                return;
            }
            lastDrawAt = now;
            context.clearRect(0, 0, viewport.width, viewport.height);
            const local = elapsed - startMs;

            // 阶段1：血月从下方升起
            const riseT = Math.max(0, Math.min(1, local / RISE_MS));
            const riseEased = 1 - Math.pow(1 - riseT, 2.2);
            const moonY = moonCenter.y + 120 * (1 - riseEased);
            const moonRadius = 28 + riseEased * 8;

            if (riseT > 0.05) {
                // 月晕
                const halo = context.createRadialGradient(moonCenter.x, moonY, 0, moonCenter.x, moonY, moonRadius * 3.5);
                halo.addColorStop(0, `${coreColor}44`);
                halo.addColorStop(0.5, `${glowColor}22`);
                halo.addColorStop(1, 'rgba(40,0,6,0)');
                context.save();
                context.globalAlpha = Math.min(1, riseT * 1.5);
                context.fillStyle = halo;
                context.fillRect(0, 0, viewport.width, viewport.height);
                context.restore();

                // 血月本体
                context.save();
                context.shadowColor = coreColor;
                context.shadowBlur = 30 + Math.sin(elapsed / 400) * 8;
                context.globalAlpha = 0.85 + 0.1 * Math.sin(elapsed / 500);
                context.fillStyle = coreColor;
                context.beginPath();
                context.arc(moonCenter.x, moonY, moonRadius, 0, Math.PI * 2);
                context.fill();
                // 暗纹（血月表面纹理）
                context.globalAlpha = 0.3;
                context.fillStyle = '#220005';
                context.beginPath();
                context.arc(moonCenter.x - 6, moonY - 4, moonRadius * 0.3, 0, Math.PI * 2);
                context.fill();
                context.beginPath();
                context.arc(moonCenter.x + 5, moonY + 3, moonRadius * 0.2, 0, Math.PI * 2);
                context.fill();
                context.restore();
            }

            // 阶段2：血色辉光扩散
            const radT = Math.max(0, Math.min(1, (local - RISE_MS * 0.5) / RADIANCE_MS));
            if (radT > 0) {
                const radEased = Math.min(1, radT * 1.5);
                const glow = context.createRadialGradient(moonCenter.x, moonY, moonRadius, moonCenter.x, moonY, moonRadius + radEased * Math.max(viewport.width, viewport.height) * 0.6);
                glow.addColorStop(0, `${coreColor}33`);
                glow.addColorStop(0.5, `${glowColor}18`);
                glow.addColorStop(1, 'rgba(40,0,6,0)');
                context.save();
                context.globalAlpha = radEased * 0.5;
                context.fillStyle = glow;
                context.fillRect(0, 0, viewport.width, viewport.height);
                context.restore();

                // 细辐射条
                if (radT < 0.8) {
                    const rayCount = 12;
                    const rayLen = radEased * 300;
                    context.save();
                    context.globalAlpha = (1 - radT) * 0.12;
                    context.strokeStyle = coreColor;
                    context.lineWidth = 1.5;
                    context.shadowBlur = 0;
                    for (let i = 0; i < rayCount; i++) {
                        const angle = (i / rayCount) * Math.PI * 2 + Math.sin(elapsed / 1200) * 0.2;
                        context.beginPath();
                        context.moveTo(moonCenter.x + Math.cos(angle) * moonRadius, moonY + Math.sin(angle) * moonRadius);
                        context.lineTo(moonCenter.x + Math.cos(angle) * rayLen, moonY + Math.sin(angle) * rayLen);
                        context.stroke();
                    }
                    context.restore();
                }
            }

            // 阶段3：血滴飘落
            for (const drip of drips) drawDrip(context, drip, elapsed);

            if (elapsed < durationMs) frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
    }

    return {
        start(startedAt) {
            root.classList.add('has-blood-moon-rise');
            animate(startedAt);
            soundTimer = window.setTimeout(() => {
                emit('audio:play', { soundName: 'commanderSkill' });
            }, startMs);
        },
        stop() {
            cancelAnimationFrame(frame);
            window.clearTimeout(soundTimer);
            root.classList.remove('has-blood-moon-rise');
            container.replaceChildren();
        }
    };
}
