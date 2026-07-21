// 【神谕】独有后半段：亮屏后一道圣光自天幕垂落到神谕徽记，
// 光柱触底时爆发双重光环，光羽自光柱两侧飘散。音效统一放在后半段起点。
import { emit } from '../eventBus.js';

const FRAME_INTERVAL_MS = 1000 / 40;
const DESCENT_MS = 620;      // 光柱自天幕垂落到徽记的时长（相对后半段起点）
const BLOOM_MS = 900;        // 光环爆发时长

function createFeather(center, startMs, color, viewportHeight) {
    return {
        center,
        delay: startMs + Math.random() * 700,
        life: 1100 + Math.random() * 700,
        driftX: (Math.random() - 0.5) * 190,
        fall: 60 + Math.random() * viewportHeight * 0.18,
        sway: 14 + Math.random() * 26,
        phase: Math.random() * Math.PI * 2,
        size: 2 + Math.random() * 3.4,
        color
    };
}

function drawFeather(context, feather, elapsed) {
    const progress = (elapsed - feather.delay) / feather.life;
    if (progress <= 0 || progress >= 1) return;
    const x = feather.center.x + feather.driftX * progress
        + Math.sin(feather.phase + progress * Math.PI * 3) * feather.sway;
    const y = feather.center.y - 40 + feather.fall * progress;
    const alpha = Math.sin(progress * Math.PI) * 0.85;
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = feather.color;
    context.shadowColor = feather.color;
    context.shadowBlur = 8;
    context.beginPath();
    context.ellipse(x, y, feather.size * 0.55, feather.size, feather.phase + progress * 2, 0, Math.PI * 2);
    context.fill();
    context.restore();
}

export function createOracleDescentFollowup({ root, event, presentation, stageRect }) {
    const container = root.querySelector('.faction-synergy-followup');
    if (!container) return null;

    container.innerHTML = '<canvas class="oracle-descent-canvas" aria-hidden="true"></canvas>';
    const canvas = container.querySelector('.oracle-descent-canvas');
    const viewport = root.getBoundingClientRect();
    const center = {
        x: stageRect.left + stageRect.width / 2,
        y: stageRect.top + stageRect.height / 2
    };
    const startMs = Number(presentation.followupStartMs) || 3800;
    const durationMs = Number(presentation.durationMs) || 5800;
    const followup = presentation.followup || {};
    const [mainColor, coreColor, softColor] = followup.particleColors?.length >= 3
        ? followup.particleColors
        : ['#f5d76e', '#fff5d9', '#d4a84a'];
    const featherCount = Math.max(8, Number(followup.particleCount) || 24);

    let frame = 0;
    let soundTimer = 0;

    function animate(startedAt) {
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) return;
        const feathers = Array.from({ length: featherCount }, () =>
            createFeather(center, startMs + DESCENT_MS * 0.7, Math.random() < 0.4 ? coreColor : mainColor, viewport.height));

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

            // 阶段1：圣光自天幕垂落到徽记（光柱底端逐帧下探）
            const descentT = Math.max(0, Math.min(1, local / DESCENT_MS));
            const settleT = Math.max(0, (local - DESCENT_MS) / (durationMs - startMs - DESCENT_MS));
            const pillarAlpha = descentT < 1 ? 0.9 : Math.max(0, 0.9 - settleT * 1.1);
            if (pillarAlpha > 0.02) {
                const eased = 1 - Math.pow(1 - descentT, 2.6);
                const bottomY = eased * center.y;
                const width = 30 + Math.sin(Math.min(1, descentT) * Math.PI) * 10;
                const grad = context.createLinearGradient(center.x, 0, center.x, bottomY);
                grad.addColorStop(0, 'rgba(255, 250, 230, 0)');
                grad.addColorStop(0.5, `${mainColor}66`);
                grad.addColorStop(1, `${coreColor}e6`);
                context.save();
                context.globalAlpha = pillarAlpha;
                context.fillStyle = grad;
                context.fillRect(center.x - width / 2, 0, width, bottomY);
                // 核心细柱
                context.globalAlpha = pillarAlpha * 0.9;
                context.fillStyle = coreColor;
                context.fillRect(center.x - 2, 0, 4, bottomY);
                context.restore();
            }

            // 阶段2：触底光环双重扩散
            const bloomLocal = local - DESCENT_MS;
            if (bloomLocal > 0 && bloomLocal < BLOOM_MS) {
                const bloomT = bloomLocal / BLOOM_MS;
                context.save();
                context.strokeStyle = coreColor;
                context.lineWidth = 2.4;
                context.shadowColor = mainColor;
                context.shadowBlur = 16;
                context.globalAlpha = (1 - bloomT) * 0.9;
                context.beginPath();
                context.arc(center.x, center.y, 20 + bloomT * 170, 0, Math.PI * 2);
                context.stroke();
                if (bloomLocal > 160) {
                    const lateT = (bloomLocal - 160) / (BLOOM_MS - 160);
                    context.globalAlpha = (1 - lateT) * 0.6;
                    context.strokeStyle = softColor;
                    context.lineWidth = 1.4;
                    context.beginPath();
                    context.arc(center.x, center.y, 14 + lateT * 120, 0, Math.PI * 2);
                    context.stroke();
                }
                context.restore();
            }

            // 阶段3：光羽自光柱两侧飘散
            for (const feather of feathers) drawFeather(context, feather, elapsed);

            if (elapsed < durationMs) frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
    }

    return {
        start(startedAt) {
            root.classList.add('has-oracle-descent');
            animate(startedAt);
            // 统一两段式：音效放在后半段起点（圣光开始垂落时）
            soundTimer = window.setTimeout(() => {
                emit('audio:play', { soundName: 'commanderSkill' });
            }, startMs);
        },
        stop() {
            cancelAnimationFrame(frame);
            window.clearTimeout(soundTimer);
            root.classList.remove('has-oracle-descent');
            container.replaceChildren();
        }
    };
}
