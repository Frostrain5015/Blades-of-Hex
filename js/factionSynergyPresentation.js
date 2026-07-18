// 通用阵营协同 Hero 广播：只负责徽章共鸣、圆环扩散与标题。
// 技能独有的后半段通过 registerFactionSynergyFollowup() 注册，避免把分支写死在 Hero 层。
import { canvas } from './config.js';

const DUPLICATE_EVENT_WINDOW_MS = 12000;
const queue = [];
const recentEventTimes = new Map();
const followupFactories = new Map();
let playing = false;
let activeFollowup = null;

function resolveStageRect() {
    const stageElement = document.getElementById('canvasStage');
    const canvasRect = canvas?.getBoundingClientRect();
    const fallbackRect = stageElement?.getBoundingClientRect();
    return canvasRect?.width && canvasRect.height ? canvasRect : fallbackRect || {
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight
    };
}

function setTheme(root, theme) {
    const properties = {
        '--synergy-text': theme.text,
        '--synergy-bright-text': theme.brightText,
        '--synergy-accent': theme.accent,
        '--synergy-accent-soft': theme.accentSoft,
        '--synergy-faction': theme.faction,
        '--synergy-shadow': theme.shadow,
        '--synergy-backdrop-glow': theme.backdropGlow,
        '--synergy-backdrop-top': theme.backdropTop,
        '--synergy-backdrop-bottom': theme.backdropBottom
    };
    for (const [property, value] of Object.entries(properties)) {
        if (value) root.style.setProperty(property, value);
        else root.style.removeProperty(property);
    }
}

function renderEmblem(container, emblem) {
    if (!container) return;
    container.replaceChildren();
    container.removeAttribute('aria-label');
    if (emblem?.kind === 'image' && emblem.src) {
        const image = document.createElement('img');
        image.src = emblem.src;
        image.alt = emblem.label || '';
        container.appendChild(image);
        return;
    }
    container.textContent = emblem?.value || '✦';
    container.setAttribute('aria-label', emblem?.label || '阵营徽记');
}

function configureHero(root, entry) {
    const { event, presentation } = entry;
    const stageRect = resolveStageRect();
    const centerX = stageRect.left + stageRect.width / 2;
    const centerY = stageRect.top + stageRect.height / 2;
    const durationMs = Number(presentation.durationMs) || 5600;

    root.dataset.factionSynergy = presentation.id;
    root.style.setProperty('--synergy-duration', `${durationMs}ms`);
    root.style.setProperty('--synergy-core-x', `${centerX}px`);
    root.style.setProperty('--synergy-core-y', `${centerY}px`);
    root.style.setProperty('--synergy-caption-y', `${centerY + Math.min(170, stageRect.height * 0.215)}px`);
    setTheme(root, presentation.theme || {});

    const emblem = root.querySelector('.faction-synergy-emblem');
    const kicker = root.querySelector('.faction-synergy-caption small');
    const title = root.querySelector('.faction-synergy-caption strong');
    renderEmblem(emblem, presentation.emblem);
    if (kicker) kicker.textContent = presentation.kicker || '阵营协同';
    if (title) title.textContent = presentation.title || '';

    const followup = presentation.followup;
    const followupFactory = followup ? followupFactories.get(followup.kind) : null;
    activeFollowup = followupFactory
        ? followupFactory({ root, event, presentation, stageRect })
        : null;
    return durationMs;
}

function buildDedupeKey(event, presentation) {
    if (event?.presentationEventId != null) {
        return `${presentation.id}:${event.presentationEventId}`;
    }
    if (event?.rescuerUnitId != null && event?.rescuedUnitId != null) {
        return `${presentation.id}:${event.rescuerUnitId}:${event.rescuedUnitId}:${event.expiresAtRound ?? ''}`;
    }
    return null;
}

function playNext() {
    if (playing || queue.length === 0) return;
    const root = document.getElementById('factionSynergyCinematic');
    if (!root) {
        queue.length = 0;
        return;
    }
    if (root.parentElement !== document.body) document.body.appendChild(root);

    const entry = queue.shift();
    playing = true;
    root.hidden = false;
    root.classList.remove('is-playing');
    const durationMs = configureHero(root, entry);
    void root.offsetWidth;

    requestAnimationFrame(startedAt => {
        root.classList.add('is-playing');
        activeFollowup?.start?.(startedAt);
    });

    window.setTimeout(() => {
        activeFollowup?.stop?.();
        activeFollowup = null;
        root.classList.remove('is-playing');
        root.hidden = true;
        playing = false;
        playNext();
    }, durationMs + 120);
}

export function registerFactionSynergyFollowup(kind, factory) {
    if (!kind || typeof factory !== 'function') return;
    followupFactories.set(kind, factory);
}

export function playFactionSynergyPresentation(event, presentation) {
    if (!presentation?.id) return;
    const now = performance.now();
    const eventKey = buildDedupeKey(event, presentation);
    for (const [key, timestamp] of recentEventTimes) {
        if (now - timestamp > DUPLICATE_EVENT_WINDOW_MS) recentEventTimes.delete(key);
    }
    if (eventKey && recentEventTimes.has(eventKey)) return;
    if (eventKey) recentEventTimes.set(eventKey, now);
    queue.push({ event: event || {}, presentation });
    playNext();
}
