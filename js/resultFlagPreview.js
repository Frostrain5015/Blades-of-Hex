import { createFlagPreview } from './flagRenderer.js';

const previews = new Map();

function ensurePreview(container) {
    if (previews.has(container)) return previews.get(container);
    const canvas = container?.querySelector('canvas');
    if (!canvas) return null;
    try {
        const preview = createFlagPreview(canvas);
        previews.set(container, preview);
        return preview;
    } catch (error) {
        console.warn('[resultFlag] WebGL2 旗帜预览不可用:', error);
        previews.set(container, null);
        return null;
    }
}

/** Render the faction's authored/generated flag in a result overlay. */
export function setResultFlagPreview(container, faction) {
    if (!container) return;
    const canvas = container.querySelector('canvas');
    const image = container.querySelector('img');
    const fallback = container.querySelector('.result-flag-fallback');
    if (!faction) {
        container.hidden = true;
        if (canvas) canvas.hidden = true;
        if (image) image.removeAttribute('src');
        return;
    }

    container.hidden = false;
    container.setAttribute('aria-label', faction.flagAlt || `${faction.name || '胜利方'}旗帜`);
    const preview = ensurePreview(container);
    if (preview) {
        preview.setFaction(faction);
        if (canvas) canvas.hidden = false;
        if (image) image.hidden = true;
        if (fallback) fallback.hidden = true;
        return;
    }

    if (image) {
        if (faction.flagUrl) {
            image.src = faction.flagUrl;
            image.alt = faction.flagAlt || `${faction.name || '胜利方'}旗帜`;
            image.hidden = false;
        } else {
            image.removeAttribute('src');
            image.alt = '';
            image.hidden = true;
        }
    }
    if (fallback) {
        fallback.textContent = faction.flag || '⚑';
        fallback.hidden = !!faction.flagUrl;
    }
}

/** Render result flags from the same always-running frame clock as the commander preview. */
export function renderResultFlagPreviews(now) {
    for (const [container, preview] of previews) {
        if (preview && container.isConnected && !container.hidden) preview.render(now);
    }
}
