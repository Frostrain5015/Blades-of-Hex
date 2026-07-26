// 【天基支援协议·轨道补给】独有后半段：亮屏后各将领向天基平台上行业绩数据流，
// 平台完成战果核算，中心迸发六角金环与补给金币喷泉，并在结算节拍向棋盘发放金币雨与 +$ 浮字。
import { LOGICAL_H, LOGICAL_W } from '../config.js';
import { emit } from '../eventBus.js';

const FRAME_INTERVAL_MS = 1000 / 40;
const UPLINK_WINDOW_MS = 700;    // 数据上行窗口（相对后半段起点）
const SETTLE_OFFSET_MS = 560;    // 上行完成后到金币迸发的间隔

function toViewportPoint(x, y, stageRect) {
    return {
        x: stageRect.left + x / LOGICAL_W * stageRect.width,
        y: stageRect.top + y / LOGICAL_H * stageRect.height
    };
}

function createUplinkBit(source, center, index, startMs, color) {
    return {
        source,
        center,
        delay: startMs + (index % 5) * 60 + Math.random() * 220,
        life: 380 + Math.random() * 240,
        bow: (Math.random() - 0.5) * 90,
        size: 1.6 + Math.random() * 2.4,
        color
    };
}

function createCoin(center, settleAt, color) {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.9;
    const speed = 120 + Math.random() * 200;
    return {
        center,
        delay: settleAt + Math.random() * 320,
        life: 850 + Math.random() * 450,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        size: 2.4 + Math.random() * 3.2,
        squash: 0.45 + Math.random() * 0.55,
        spin: Math.random() * Math.PI,
        color
    };
}

function drawUplinkBit(context, bit, elapsed) {
    const progress = (elapsed - bit.delay) / bit.life;
    if (progress <= 0 || progress >= 1) return 0;
    const eased = 1 - Math.pow(1 - progress, 2.2);
    const dx = bit.center.x - bit.source.x;
    const dy = bit.center.y - bit.source.y;
    // 垂直方向弓形偏移：让数据流走弧线而不是直线
    const norm = Math.hypot(dx, dy) || 1;
    const bowX = -dy / norm * bit.bow * Math.sin(progress * Math.PI);
    const bowY = dx / norm * bit.bow * Math.sin(progress * Math.PI);
    const x = bit.source.x + dx * eased + bowX;
    const y = bit.source.y + dy * eased + bowY;
    const alpha = Math.sin(progress * Math.PI);
    context.save();
    context.globalAlpha = alpha * 0.9;
    context.fillStyle = bit.color;
    context.shadowColor = bit.color;
    context.shadowBlur = 6;
    context.fillRect(x - bit.size / 2, y - bit.size / 2, bit.size, bit.size);
    // 短尾迹
    context.globalAlpha = alpha * 0.35;
    context.fillRect(x - dx / norm * bit.size * 3 - bit.size / 2, y - dy / norm * bit.size * 3 - bit.size / 2, bit.size, bit.size);
    context.restore();
    return eased > 0.92 ? 1 : 0;
}

function drawCoin(context, coin, elapsed) {
    const progress = (elapsed - coin.delay) / coin.life;
    if (progress <= 0 || progress >= 1) return;
    const t = progress * coin.life / 1000;
    const x = coin.center.x + coin.vx * t;
    const y = coin.center.y + coin.vy * t + 320 * t * t;
    const alpha = progress < 0.75 ? 1 : 1 - (progress - 0.75) / 0.25;
    const wobble = Math.abs(Math.sin(coin.spin + progress * Math.PI * 3));
    context.save();
    context.globalAlpha = alpha * 0.95;
    context.translate(x, y);
    context.scale(1, coin.squash + (1 - coin.squash) * wobble);
    context.fillStyle = coin.color;
    context.beginPath();
    context.arc(0, 0, coin.size, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = alpha * 0.5;
    context.strokeStyle = '#fff2c4';
    context.lineWidth = 1;
    context.beginPath();
    context.arc(0, 0, coin.size * 0.55, -Math.PI * 0.8, Math.PI * 0.15);
    context.stroke();
    context.restore();
}

function drawHexRing(context, center, radius, alpha, color, lineWidth) {
    context.save();
    context.globalAlpha = alpha;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.shadowColor = color;
    context.shadowBlur = 12;
    context.beginPath();
    for (let i = 0; i <= 6; i++) {
        const angle = Math.PI / 6 + i * Math.PI / 3;
        const px = center.x + Math.cos(angle) * radius;
        const py = center.y + Math.sin(angle) * radius;
        if (i === 0) context.moveTo(px, py);
        else context.lineTo(px, py);
    }
    context.stroke();
    context.restore();
}

function createFollowupElements(container, commanderCount) {
    const focusMarkup = Array.from({ length: commanderCount }, () =>
        '<div class="orbital-supply-focus" aria-hidden="true"><i></i></div>').join('');
    container.innerHTML = `<canvas class="orbital-supply-canvas" aria-hidden="true"></canvas>${focusMarkup}`;
    return {
        canvas: container.querySelector('.orbital-supply-canvas'),
        focuses: [...container.querySelectorAll('.orbital-supply-focus')]
    };
}

export function createOrbitalSupplyFollowup({ root, event, presentation, stageRect }) {
    const container = root.querySelector('.faction-synergy-followup');
    const commanders = (event.commanders || [])
        .filter(commander => Number.isFinite(commander.x) && Number.isFinite(commander.y));
    const cities = (event.cities || [])
        .filter(city => Number.isFinite(city.x) && Number.isFinite(city.y));
    if (!container || commanders.length === 0 || cities.length === 0 || !(event.goldAwarded > 0)) return null;

    const elements = createFollowupElements(container, commanders.length);
    const viewport = root.getBoundingClientRect();
    const points = commanders.map(commander => toViewportPoint(commander.x, commander.y, stageRect));
    const cityPoints = cities.map(city => toViewportPoint(city.x, city.y, stageRect));
    const uplinkRoutes = points.map(source => ({
        source,
        center: cityPoints.reduce((nearest, city) => {
            const distance = Math.hypot(city.x - source.x, city.y - source.y);
            return !nearest || distance < nearest.distance ? { city, distance } : nearest;
        }, null).city
    }));
    const startMs = Number(presentation.followupStartMs) || 2800;
    const durationMs = Number(presentation.durationMs) || 4600;
    const settleAt = startMs + UPLINK_WINDOW_MS + SETTLE_OFFSET_MS - UPLINK_WINDOW_MS * 0.4;
    const followup = presentation.followup || {};
    const [uplinkColor, coinColor] = followup.particleColors?.length >= 2
        ? followup.particleColors
        : ['#8fd8ff', '#f5d76e'];
    const bitCount = Math.max(6, Number(followup.particleCount) || 26);

    root.style.setProperty('--orbital-supply-focus-size', `${Math.min(84, Math.max(52, stageRect.width * 0.082))}px`);
    elements.focuses.forEach((focus, index) => {
        focus.style.left = `${points[index].x}px`;
        focus.style.top = `${points[index].y}px`;
    });

    let frame = 0;
    let payoutTimer = 0;

    function animate(startedAt) {
        const canvas = elements.canvas;
        canvas.width = Math.max(1, Math.round(viewport.width));
        canvas.height = Math.max(1, Math.round(viewport.height));
        const context = canvas.getContext('2d');
        if (!context) return;

        const bits = uplinkRoutes.flatMap(route =>
            Array.from({ length: Math.ceil(bitCount / uplinkRoutes.length) }, (_, index) =>
                createUplinkBit(route.source, route.center, index, startMs, uplinkColor)));
        const coins = Array.from({ length: Math.max(24, cityPoints.length * 10) }, (_, index) =>
            createCoin(cityPoints[index % cityPoints.length], settleAt, coinColor));

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

            // 阶段1：数据上行；抵达强度累积为鹰徽充能光晕
            let arrivals = 0;
            for (const bit of bits) arrivals += drawUplinkBit(context, bit, elapsed);
            if (arrivals > 0 && elapsed < settleAt) {
                const chargeAlpha = Math.min(0.5, arrivals * 0.06);
                for (const center of cityPoints) {
                    context.save();
                    context.globalAlpha = chargeAlpha;
                    const glow = context.createRadialGradient(center.x, center.y, 0, center.x, center.y, 46);
                    glow.addColorStop(0, uplinkColor);
                    glow.addColorStop(1, 'rgba(0,0,0,0)');
                    context.fillStyle = glow;
                    context.fillRect(center.x - 46, center.y - 46, 92, 92);
                    context.restore();
                }
            }

            // 阶段2：战果核算——六角金环两连扩散
            const settleElapsed = elapsed - settleAt;
            if (settleElapsed > 0 && settleElapsed < 900) {
                const ringProgress = settleElapsed / 900;
                for (const center of cityPoints) {
                    drawHexRing(context, center, 24 + ringProgress * 150, (1 - ringProgress) * 0.85, coinColor, 2);
                    if (settleElapsed > 180) {
                        const lateProgress = (settleElapsed - 180) / 720;
                        drawHexRing(context, center, 18 + lateProgress * 110, (1 - lateProgress) * 0.55, uplinkColor, 1.2);
                    }
                }
            }

            // 阶段3：金币喷泉
            for (const coin of coins) drawCoin(context, coin, elapsed);

            if (elapsed < durationMs) frame = requestAnimationFrame(draw);
        };
        frame = requestAnimationFrame(draw);
    }

    return {
        start(startedAt) {
            root.classList.add('has-orbital-supply');
            animate(startedAt);
            // 结算节拍：向棋盘发放金币雨与 +$ 浮字（由 visualEventBridge 落地）
            payoutTimer = window.setTimeout(() => emit('fx:eagleSupplyDrop', event), settleAt);
        },
        stop() {
            cancelAnimationFrame(frame);
            window.clearTimeout(payoutTimer);
            root.classList.remove('has-orbital-supply');
            container.replaceChildren();
        }
    };
}
