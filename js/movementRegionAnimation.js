// Pure timing helpers for the connected movement-field reveal.  The animation
// is deliberately independent from Canvas/Pixi so both backends can share the
// same distance wave without moving any rule logic into a renderer.

export const MOVEMENT_REGION_REVEAL = Object.freeze({
    stepDelayMs: 34,
    tileDurationMs: 250,
    startScale: 0.7,
    settledScale: 1.008,
    settledAlpha: 0.13
});

function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
}

export function axialDistance(a, b) {
    if (!a || !b) return 0;
    const dq = Number(b.q) - Number(a.q);
    const dr = Number(b.r) - Number(a.r);
    const ds = -dq - dr;
    return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

/**
 * Resolve the fill-only jelly wave for one reachable tile.
 * No per-tile outline is produced by this contract; the region renderer owns
 * the single exterior border separately.
 */
export function resolveMovementTileReveal(origin, tile, nowMs, selectionTimeMs, options = {}) {
    const config = { ...MOVEMENT_REGION_REVEAL, ...options };
    if (options.reducedMotion || !Number.isFinite(selectionTimeMs) || selectionTimeMs <= 0) {
        return Object.freeze({
            distance: axialDistance(origin, tile),
            progress: 1,
            scale: config.settledScale,
            alpha: config.settledAlpha
        });
    }

    const distance = axialDistance(origin, tile);
    const elapsed = Math.max(0, Number(nowMs) - selectionTimeMs - distance * config.stepDelayMs);
    const progress = clamp01(elapsed / config.tileDurationMs);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    // A small damped overshoot keeps the old selection ripple's tactile feel
    // without making each cell read as an independently outlined aperture.
    const jelly = easeOut + Math.sin(progress * Math.PI * 2.25) * (1 - progress) * 0.075;
    const scale = config.startScale + (config.settledScale - config.startScale) * jelly;
    const alpha = config.settledAlpha * clamp01(progress * 1.65);
    return Object.freeze({ distance, progress, scale, alpha });
}
