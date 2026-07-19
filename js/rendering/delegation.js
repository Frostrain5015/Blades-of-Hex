// Runtime delegation state between the registered battlefield backend and the
// auxiliary Canvas layers. These flags describe layer ownership only; they do
// not select an engine, so future renderer adapters can use the same boundary.

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
