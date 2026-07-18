// 【同一个誓言】独有后半段：亮屏后由救援者向被救者飞线，并播放双方 HP 浮字。
import { LOGICAL_H, LOGICAL_W } from '../config.js';
import { emit } from '../eventBus.js';

const PARTICLE_FRAME_INTERVAL_MS = 1000 / 40;

function toViewportPoint(x, y, stageRect) {
    return {
        x: stageRect.left + x / LOGICAL_W * stageRect.width,
        y: stageRect.top + y / LOGICAL_H * stageRect.height
    };
}

function setFocusPosition(element, point) {
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
}

function drawPetal(context, x, y, size, angle, color, alpha) {
    context.save();
    context.translate(x, y);
    context.rotate(angle);
    context.scale(1, 1.16);
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, -size);
    context.bezierCurveTo(size * 0.74, -size * 0.42, size * 0.52, size * 0.66, 0, size);
    context.bezierCurveTo(-size * 0.62, size * 0.48, -size * 0.68, -size * 0.38, 0, -size);
    context.fill();
    context.restore();
}

function createRescueParticle(source, target, index, startMs, colors) {
    return {
        source,
        target,
        delay: startMs + Math.random() * 250,
        life: 900 + Math.random() * 400,
        phase: Math.random() * Math.PI * 2,
        turns: 2.5 + Math.random() * 2.8,
        curl: (18 + Math.random() * 38) * (index % 3 === 0 ? -1 : 1),
        size: 2.2 + Math.random() * 4.5,
        lift: (Math.random() - 0.5) * 120,
        color: index % 4 === 0 ? colors[0] : colors[1]
    };
}

function createFollowupElements(container) {
    container.innerHTML = [
        '<svg class="rescue-link-thread" aria-hidden="true" preserveAspectRatio="none"><path></path></svg>',
        '<canvas class="rescue-link-particles" aria-hidden="true"></canvas>',
        '<div class="rescue-link-focus rescue-link-focus-donor"><i></i></div>',
        '<div class="rescue-link-focus rescue-link-focus-rescued"><i></i></div>'
    ].join('');
    return {
        svg: container.querySelector('.rescue-link-thread'),
        path: container.querySelector('.rescue-link-thread path'),
        particleCanvas: container.querySelector('.rescue-link-particles'),
        donorFocus: container.querySelector('.rescue-link-focus-donor'),
        rescuedFocus: container.querySelector('.rescue-link-focus-rescued')
    };
}

function configurePath(elements, rescuer, rescued, stageRect, viewport) {
    const distance = Math.hypot(rescued.x - rescuer.x, rescued.y - rescuer.y);
    const bendLift = Math.min(stageRect.height * 0.12, Math.max(28, distance * 0.18));
    const bendY = Math.min(rescuer.y, rescued.y) - bendLift;
    elements.svg.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
    elements.path.setAttribute('pathLength', '1');
    elements.path.setAttribute('d', [
        `M ${rescuer.x} ${rescuer.y}`,
        `C ${rescuer.x + (rescued.x - rescuer.x) * 0.34} ${bendY},`,
        `${rescuer.x + (rescued.x - rescuer.x) * 0.66} ${bendY},`,
        `${rescued.x} ${rescued.y}`
    ].join(' '));
}

function emitHpDeltaTexts(event) {
    const damage = Math.max(0, Math.round(event.rescuerHpBefore - event.rescuerHpAfter));
    const healing = Math.max(0, Math.round(event.rescuedHpAfter - event.rescuedHpBefore));
    emit('fx:hpDeltaTexts', {
        damage: damage > 0 ? { x: event.rescuerX, y: event.rescuerY, value: damage } : null,
        healing: healing > 0 ? { x: event.rescuedX, y: event.rescuedY, value: healing } : null
    });
}

export function createRescueLinkFollowup({ root, event, presentation, stageRect }) {
    const hasCoordinates = Number.isFinite(event.rescuerX) && Number.isFinite(event.rescuerY)
        && Number.isFinite(event.rescuedX) && Number.isFinite(event.rescuedY);
    const container = root.querySelector('.faction-synergy-followup');
    if (!container || !hasCoordinates) return null;

    const elements = createFollowupElements(container);
    const viewport = root.getBoundingClientRect();
    const rescuer = toViewportPoint(event.rescuerX, event.rescuerY, stageRect);
    const rescued = toViewportPoint(event.rescuedX, event.rescuedY, stageRect);
    const startMs = Number(presentation.followupStartMs) || 3650;
    const durationMs = Number(presentation.durationMs) || 5600;
    const followup = presentation.followup || {};
    const colors = followup.particleColors?.length >= 2
        ? followup.particleColors
        : ['#f3d68b', '#d89b62'];
    const particleCount = Math.max(0, Number(followup.particleCount) || 18);

    root.style.setProperty('--rescue-link-focus-size', `${Math.min(96, Math.max(58, stageRect.width * 0.094))}px`);
    setFocusPosition(elements.donorFocus, rescuer);
    setFocusPosition(elements.rescuedFocus, rescued);
    configurePath(elements, rescuer, rescued, stageRect, viewport);

    let particleFrame = 0;
    let hpTextTimer = 0;

    function animateParticles(startedAt) {
        const particleCanvas = elements.particleCanvas;
        particleCanvas.width = Math.max(1, Math.round(viewport.width));
        particleCanvas.height = Math.max(1, Math.round(viewport.height));
        const context = particleCanvas.getContext('2d');
        if (!context) return;
        const particles = Array.from({ length: particleCount }, (_, index) =>
            createRescueParticle(rescuer, rescued, index, startMs, colors));

        const drawParticle = (particle, elapsed) => {
            const progress = (elapsed - particle.delay) / particle.life;
            if (progress <= 0 || progress >= 1) return;
            const eased = 1 - Math.pow(1 - progress, 3);
            const baseX = particle.source.x + (particle.target.x - particle.source.x) * eased;
            const baseY = particle.source.y + (particle.target.y - particle.source.y) * eased;
            const envelope = Math.sin(progress * Math.PI);
            const angle = particle.phase + progress * Math.PI * particle.turns;
            const x = baseX + Math.cos(angle) * particle.curl * envelope;
            const y = baseY + Math.sin(angle) * particle.curl * envelope + particle.lift * envelope;
            drawPetal(context, x, y, particle.size, angle + progress * 5, particle.color,
                Math.pow(envelope, 0.7) * 0.88);
        };

        let lastDrawAt = 0;
        const draw = now => {
            const elapsed = now - startedAt;
            if (elapsed < startMs - PARTICLE_FRAME_INTERVAL_MS) {
                particleFrame = requestAnimationFrame(draw);
                return;
            }
            if (now - lastDrawAt < PARTICLE_FRAME_INTERVAL_MS) {
                particleFrame = requestAnimationFrame(draw);
                return;
            }
            lastDrawAt = now;
            context.clearRect(0, 0, viewport.width, viewport.height);
            for (const particle of particles) drawParticle(particle, elapsed);
            if (elapsed < durationMs) particleFrame = requestAnimationFrame(draw);
        };
        particleFrame = requestAnimationFrame(draw);
    }

    return {
        start(startedAt) {
            root.classList.add('has-rescue-link');
            animateParticles(startedAt);
            hpTextTimer = window.setTimeout(() => emitHpDeltaTexts(event), startMs);
        },
        stop() {
            cancelAnimationFrame(particleFrame);
            window.clearTimeout(hpTextTimer);
            root.classList.remove('has-rescue-link');
            container.replaceChildren();
        }
    };
}

