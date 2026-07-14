// Pure Canvas2D geometry for the production unit sphere and its outer HUD.
// Keeping this module DOM-free lets the real renderer and regression tests
// share exactly the same 2.5D body, ground shadow and gauge budget.

export const UNIT_BADGE_RADIUS = 15;
export const UNIT_BADGE_CENTER_Y = 1;
export const UNIT_HUD_OUTER_RADIUS = 20.2;
export const UNIT_SHIELD_RADIUS = 18.6;
export const UNIT_SHIELD_LINE_WIDTH = 1.5;
export const UNIT_GLYPH_FONT_SCALE = 1.12;

const START_ANGLE = -Math.PI / 2;
const SPHERE_PALETTE_CACHE = new Map();

export const UNIT_BADGE_GLYPHS = Object.freeze({
    infantry: '\u2694\uFE0E',
    cavalry: '\u265E',
    archer: '\u2316',
    mgNest: '\u25A3',
    drone: '\u2708\uFE0E',
    warship: '\u2693\uFE0E'
});

function clamp(value, minimum = 0, maximum = 1) {
    const number = Number(value);
    return Math.max(minimum, Math.min(maximum, Number.isFinite(number) ? number : minimum));
}

function normalizeHex(value, fallback) {
    if (typeof value !== 'string') return fallback;
    const compact = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(compact)) return compact.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(compact)) {
        return `#${compact.slice(1).split('').map(character => character.repeat(2)).join('')}`.toLowerCase();
    }
    return fallback;
}

function mixHex(left, right, amount) {
    const a = normalizeHex(left, '#777777');
    const b = normalizeHex(right, '#777777');
    const ratio = clamp(amount);
    const channel = offset => Math.round(
        Number.parseInt(a.slice(offset, offset + 2), 16) * (1 - ratio)
        + Number.parseInt(b.slice(offset, offset + 2), 16) * ratio
    ).toString(16).padStart(2, '0');
    return `#${channel(1)}${channel(3)}${channel(5)}`;
}

/**
 * Derive real light/mid/dark values even when a custom faction supplied one
 * flat colour for all three flag stops. The old renderer simply replayed
 * identical stops in that case, reducing the supposed sphere to a disc.
 */
export function createUnitSpherePalette(flagColors = {}) {
    const main = normalizeHex(flagColors.main, '#655b49');
    const suppliedLight = normalizeHex(flagColors.light, main);
    const suppliedDark = normalizeHex(flagColors.dark, main);
    const cacheKey = `${main}|${suppliedLight}|${suppliedDark}`;
    const cached = SPHERE_PALETTE_CACHE.get(cacheKey);
    if (cached) return cached;
    const palette = Object.freeze({
        highlight: mixHex(suppliedLight, '#fff1c9', 0.58),
        light: mixHex(suppliedLight, '#d9c89e', 0.18),
        main,
        dark: mixHex(suppliedDark, '#171713', 0.48),
        outline: mixHex(suppliedDark, '#080908', 0.68),
        glyph: '#f2dfad'
    });
    SPHERE_PALETTE_CACHE.set(cacheKey, palette);
    return palette;
}

export function resolveUnitBadgeGlyph(type, engineerScaffold = false) {
    if (engineerScaffold) return '\u25A7';
    return UNIT_BADGE_GLYPHS[type] || '?';
}

/**
 * Draw the complete local-space unit presentation. The caller owns world
 * translation and movement/drone interpolation. The ellipse is a deliberate
 * ground-plane shadow: it is the first spatial cue in the 2.5D presentation,
 * not a blur attached to the circular HUD.
 */
export function drawUnitBadge(context, options = {}) {
    if (!context || typeof context.save !== 'function') return;
    const radius = Math.max(1, Number(options.radius) || UNIT_BADGE_RADIUS);
    const centerY = Number.isFinite(options.centerY) ? options.centerY : UNIT_BADGE_CENTER_Y;
    const hpRatio = clamp(options.hpRatio);
    const shieldRatio = clamp(options.shieldRatio);
    const relationColor = typeof options.relationColor === 'string' ? options.relationColor : '#9e9e9e';
    const palette = createUnitSpherePalette(options.flagColors);
    const glyph = typeof options.glyph === 'string' && options.glyph ? options.glyph : '?';
    const waterColor = normalizeHex(options.waterColor, null);

    context.save();

    // Separate low ellipse: the body visibly sits above the board without
    // changing hit testing, rule coordinates or the shared badge radius.
    if (!waterColor) {
        context.save();
        context.beginPath();
        context.ellipse(radius * 0.10, centerY + radius * 0.82, radius * 1.24, radius * 0.36, 0, 0, Math.PI * 2);
        context.fillStyle = 'rgba(18,15,11,0.42)';
        context.shadowColor = 'rgba(8,8,7,0.28)';
        context.shadowBlur = radius * 0.18;
        context.fill();
        context.restore();
    }

    // Strong off-centre illumination: warm upper-left highlight, faction mid
    // tone, then a compressed lower-right shadow.
    const sphereGradient = context.createRadialGradient(
        -radius * 0.34,
        centerY - radius * 0.43,
        radius * 0.055,
        radius * 0.08,
        centerY + radius * 0.09,
        radius * 1.19
    );
    sphereGradient.addColorStop(0, palette.highlight);
    sphereGradient.addColorStop(0.22, palette.light);
    sphereGradient.addColorStop(0.62, palette.main);
    sphereGradient.addColorStop(1, palette.dark);
    context.beginPath();
    context.arc(0, centerY, radius, 0, Math.PI * 2);
    context.fillStyle = sphereGradient;
    context.shadowColor = 'rgba(0,0,0,0.34)';
    context.shadowBlur = radius * 0.22;
    context.shadowOffsetY = radius * 0.10;
    context.fill();
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;
    context.strokeStyle = palette.outline;
    context.lineWidth = Math.max(0.9, radius * 0.075);
    context.stroke();

    // Specular cap and lower shade reinforce curvature at the production 30px
    // diameter where the radial gradient alone can otherwise read as flat.
    context.beginPath();
    context.ellipse(-radius * 0.31, centerY - radius * 0.39, radius * 0.25, radius * 0.115, -0.48, 0, Math.PI * 2);
    context.fillStyle = 'rgba(255,246,215,0.31)';
    context.fill();
    context.beginPath();
    context.arc(0, centerY, radius * 0.82, Math.PI * 0.12, Math.PI * 0.88);
    context.strokeStyle = 'rgba(8,9,8,0.19)';
    context.lineWidth = radius * 0.16;
    context.lineCap = 'round';
    context.stroke();

    // Monochrome military-map symbols preserve unit type without flattening
    // the material treatment with coloured emoji.
    context.font = `700 ${Math.round(radius * UNIT_GLYPH_FONT_SCALE)}px "Segoe UI Symbol", "Noto Sans Symbols 2", "Microsoft YaHei", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(20,17,12,0.76)';
    context.lineWidth = Math.max(1, radius * 0.105);
    if (typeof context.strokeText === 'function') context.strokeText(glyph, 0, centerY + radius * 0.055);
    context.fillStyle = palette.glyph;
    context.fillText(glyph, 0, centerY + radius * 0.055);

    if (waterColor) {
        // Water units displace the surface instead of casting a land shadow.
        // The filled lower cap is bounded by the sphere silhouette; a small
        // asymmetric foam crest makes the waterline read even at 30px.
        const waterlineY = centerY + radius * 0.47;
        context.beginPath();
        context.moveTo(-radius * 0.88, waterlineY);
        context.bezierCurveTo(
            -radius * 0.44, waterlineY - radius * 0.10,
            -radius * 0.12, waterlineY + radius * 0.08,
            radius * 0.18, waterlineY
        );
        context.bezierCurveTo(
            radius * 0.43, waterlineY - radius * 0.07,
            radius * 0.68, waterlineY + radius * 0.05,
            radius * 0.88, waterlineY - radius * 0.02
        );
        context.arc(0, centerY, radius * 0.91, Math.PI * 0.17, Math.PI * 0.83);
        context.closePath();
        context.fillStyle = waterColor;
        context.globalAlpha = 0.90;
        context.fill();
        context.globalAlpha = 1;

        context.beginPath();
        context.moveTo(-radius * 0.88, waterlineY);
        context.bezierCurveTo(
            -radius * 0.44, waterlineY - radius * 0.10,
            -radius * 0.12, waterlineY + radius * 0.08,
            radius * 0.18, waterlineY
        );
        context.bezierCurveTo(
            radius * 0.43, waterlineY - radius * 0.07,
            radius * 0.68, waterlineY + radius * 0.05,
            radius * 0.88, waterlineY - radius * 0.02
        );
        context.strokeStyle = 'rgba(210,238,232,0.78)';
        context.lineWidth = Math.max(0.8, radius * 0.075);
        context.shadowColor = 'rgba(176,225,220,0.38)';
        context.shadowBlur = radius * 0.08;
        context.stroke();
        context.shadowColor = 'transparent';
        context.shadowBlur = 0;
    }

    // Metal bezel, low-brightness relation track and bright health arc. The
    // track never disappears at low HP, so diplomacy remains readable.
    context.lineCap = 'round';
    context.beginPath();
    context.arc(0, centerY, radius, 0, Math.PI * 2);
    context.strokeStyle = 'rgba(13,14,12,0.92)';
    context.lineWidth = radius * 0.24;
    context.stroke();

    context.save();
    context.globalAlpha = 0.34;
    context.beginPath();
    context.arc(0, centerY, radius, 0, Math.PI * 2);
    context.strokeStyle = relationColor;
    context.lineWidth = radius * 0.156;
    context.stroke();
    context.restore();

    if (hpRatio > 0.005) {
        context.beginPath();
        context.arc(0, centerY, radius, START_ANGLE, START_ANGLE + Math.PI * 2 * hpRatio);
        context.strokeStyle = relationColor;
        context.lineWidth = radius * 0.164;
        context.shadowColor = relationColor;
        context.shadowBlur = radius * 0.08;
        context.stroke();
        context.shadowColor = 'transparent';
        context.shadowBlur = 0;
    }

    context.strokeStyle = 'rgba(245,228,188,0.34)';
    context.lineWidth = Math.max(0.55, radius * 0.036);
    for (let index = 0; index < 4; index++) {
        const angle = START_ANGLE + index * Math.PI / 2;
        context.beginPath();
        context.arc(0, centerY, radius, angle - 0.016, angle + 0.016);
        context.stroke();
    }

    if (shieldRatio > 0.003) {
        context.beginPath();
        context.arc(0, centerY, UNIT_SHIELD_RADIUS, START_ANGLE, START_ANGLE + Math.PI * 2 * shieldRatio);
        context.strokeStyle = '#76e7ff';
        context.lineWidth = UNIT_SHIELD_LINE_WIDTH;
        context.shadowColor = '#76e7ff';
        context.shadowBlur = radius * 0.09;
        context.stroke();
    }

    context.restore();
}
