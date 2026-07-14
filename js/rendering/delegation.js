// Runtime delegation state between the Canvas2D full renderer and the Pixi
// overlay. renderGame() must never gate on user *settings*: a Pixi preference
// can silently fall back to Canvas (missing WebGL, context lost, init failure),
// and gating on settings would then drop interaction hints or the whole
// terrain. main.js flips these flags only after the Pixi adapter is actually
// READY, and clears them on every fallback or renderer replacement.

export const battlefieldDelegation = {
    /** Pixi draws selection/hover interaction hints (ranges, routes, origin). */
    interactionHints: false,
    /** Pixi draws the static terrain slice; Canvas skips tile bases/materials. */
    terrain: false
};

export function setBattlefieldDelegation({ interactionHints = false, terrain = false } = {}) {
    battlefieldDelegation.interactionHints = Boolean(interactionHints);
    battlefieldDelegation.terrain = Boolean(terrain);
}
