// 【日月天衡】独有后半段：从天衡徽记爆发出金色日珥，光芒四射覆盖全屏。
// 日珥扩散 + 光羽飘散 + 暖色辉光脉冲，象征"借来太阳之力"。
import { emit } from '../eventBus.js';

const FRAME_INTERVAL_MS = 1000 / 40;
const ERUPTION_MS = 600;      // 日珥爆发时长（相对后半段起点）
const RAY_MS = 1200;           // 光芒射线扩散时长
const AFTERGLOW_MS = 900;      // 余辉消退时长

function createPetal(center, startMs, color, viewportW, viewportH) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 80 + Math.random() * Math.min(viewportW, viewportH) * 0.35;
    return {
        center,
        delay: startMs + Math.random() * RAY_MS * 0.6,
        life: 1400 + Math.random() * 800,
        targetX: center.x + Math.cos(angle) * dist,
        targetY: center.y + Math.sin(angle) * dist,
        driftX: (Math.random() - 0.5) * 40,
        size: 3 + Math.random() * 5,
        color,
        phase: Math.random() * Math.PI * 2
    };
}

function drawPetal(context, petal, elapsed) {
    const progress = (elapsed - petal.delay) / petal.life;
    if (progress <= 0 || progress >= 1) return;
    const eased = 1 - Math.pow(1 - progress, 1.8);
    const x = petal.center.x + (petal.targetX - petal.center.x) * eased + petal.driftX * progress;
    const y = petal.center.y + (petal.targetY - petal.center.y) * eased - 60 * eased;
    const alpha = Math.sin(progress * Math.PI) * 0.7;
    const s = petal.size * (0.6 + 0.4 * (1 - progress));
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = petal.color;
    context.shadowColor = petal.color;
    context.shadowBlur = 12;
    context.beginPath();
    context.ellipse(x, y, s * 0.5, s, petal.phase + progress, 0, Math.PI * 2);
    context.fill();
    context.restore();
}

export function createBorrowDayFollowup({ root, event, presentation, stageRect }) {
    const container = root.querySelector('.faction-synergy-followup');
    if (!container) return null;

    container.innerHTML = '<canvas class="borrow-day-canvas" aria-hidden="true"></canvas>';
    const canvas = container.querySelector('.borrow-day-canvas');
    if (!canvas) return null;
    const viewport = root.getBoundingClientRect();
    const center = {
        x: stageRect.left + stageRect.width / 2,
        y: stageRect.top + stageRect.height / 2
    };
    const startMs = Number(presentation.followupStartMs) || 2500;
    const durationMs = Number(presentation.durationMs) || 4800;
    const followup = presentation.followup || {};
    const [coreColor, rayColor, softColor] = followup.particleColors?.length >= 3
        ? followup.particleColors
        : ['#ffd700', '#ffb347', '#fff8dc'];
    const petalCount = Math.max(8, Number(followup.particleCount) || 20);

    let frame = 0;
    let soundTimer = 0;

    function animate(startedAt) {
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) return;
        const petals = Array.from({ length: petalCount }, () =>
            createPetal(center, startMs, Math.random() < 0.3 ? coreColor : rayColor, viewport.width, viewport.height));

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

            // 阶段1：日珥爆发（中心亮核 → 金色日珥向外喷射）
            const eruptionT = Math.max(0, Math.min(1, local / ERUPTION_MS));
            if (eruptionT < 1 || local < RAY_MS) {
                const eased = Math.pow(eruptionT, 1.6);
                const rad = eased * Math.min(viewport.width, viewport.height) * 0.5;
                // 外层日珥辉光
                const glow = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, Math.max(rad, 20));
                glow.addColorStop(0, 'rgba(255, 215, 0, 0)');
                glow.addColorStop(0.3, `${coreColor}55`);
                glow.addColorStop(0.7, `${rayColor}33`);
                glow.addColorStop(1, 'rgba(255, 180, 70, 0)');
                context.save();
                context.globalAlpha = Math.min(1, 1.2 - eruptionT * 0.3);
                context.fillStyle = glow;
                context.fillRect(0, 0, viewport.width, viewport.height);
                context.restore();
            }

            // 阶段2：光芒射线 — 从中心向外的辐条
            const rayT = Math.max(0, Math.min(1, (local - ERUPTION_MS * 0.5) / RAY_MS));
            if (rayT > 0 && rayT < 1) {
                const rayCount = 16;
                const maxLen = Math.max(viewport.width, viewport.height) * 0.8;
                const len = rayT * maxLen;
                context.save();
                context.globalAlpha = (1 - rayT) * 0.25;
                context.strokeStyle = rayColor;
                context.lineWidth = 2 + (1 - rayT) * 6;
                context.shadowColor = coreColor;
                context.shadowBlur = 20;
                for (let i = 0; i < rayCount; i++) {
                    const angle = (i / rayCount) * Math.PI * 2 + rayT * 0.3;
                    context.beginPath();
                    context.moveTo(center.x, center.y);
                    context.lineTo(center.x + Math.cos(angle) * len, center.y + Math.sin(angle) * len);
                    context.stroke();
                }
                // 第二层细射线（交错）
                context.globalAlpha = (1 - rayT) * 0.15;
                context.lineWidth = 1;
                for (let i = 0; i < 32; i++) {
                    const angle = (i / 32) * Math.PI * 2 - rayT * 0.5;
                    const l = len * 0.8;
                    context.beginPath();
                    context.moveTo(center.x + Math.cos(angle) * 20, center.y + Math.sin(angle) * 20);
                    context.lineTo(center.x + Math.cos(angle) * l, center.y + Math.sin(angle) * l);
                    context.stroke();
                }
                context.restore();
            }

            // 阶段3：光羽/花瓣飘散
            for (const petal of petals) drawPetal(context, petal, elapsed);

            // 阶段4：余辉消退（全屏暖色脉冲淡出）
            if (local > RAY_MS) {
                const fadeT = Math.min(1, (local - RAY_MS) / AFTERGLOW_MS);
                const alpha = (1 - fadeT) * 0.15;
                if (alpha > 0.01) {
                    context.save();
                    context.globalAlpha = alpha;
                    context.fillStyle = softColor;
                    context.fillRect(0, 0, viewport.width, viewport.height);
                    context.restore();
                }
            }

            if (elapsed < durationMs) frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
    }

    return {
        start(startedAt) {
            root.classList.add('has-borrow-day');
            animate(startedAt);
            soundTimer = window.setTimeout(() => {
                emit('audio:play', { soundName: 'commanderSkill' });
            }, startMs);
        },
        stop() {
            cancelAnimationFrame(frame);
            window.clearTimeout(soundTimer);
            root.classList.remove('has-borrow-day');
            container.replaceChildren();
        }
    };
}
