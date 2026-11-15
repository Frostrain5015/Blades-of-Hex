import { getFlagColors } from '../rules/camps.js';
import { drawUnitBadge, getBadgeFlagImage, loadBadgeFlagImage } from './unitBadgeRenderer.js';

const canvasSignatures = new WeakMap();

export function paintFlagBadgeCanvas(canvas, { url, crop, color }, { size = 30, fallbackGlyph = '✦' } = {}) {
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
    const signature = JSON.stringify([url, crop, color, size, fallbackGlyph, ratio]);
    if (canvasSignatures.get(canvas) === signature) return;
    canvasSignatures.set(canvas, signature);
    canvas.width = canvas.height = Math.round(size * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;

    function paint(flagImage) {
        if (canvasSignatures.get(canvas) !== signature) return;
        context.setTransform(ratio, 0, 0, ratio, canvas.width / 2, canvas.height / 2);
        context.clearRect(-size / 2, -size / 2, size, size);
        drawUnitBadge(context, {
            centerY: 0, radius: size / 2 - 1, emblemOnly: true,
            flagImage, flagCrop: crop, flagColors: getFlagColors(color), glyph: fallbackGlyph
        });
    }

    const flagImage = getBadgeFlagImage(url);
    paint(flagImage);
    if (!flagImage && url) loadBadgeFlagImage(url).then(image => { if (image) paint(image); });
}
