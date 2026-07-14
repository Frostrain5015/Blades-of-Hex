import { canUnitOccupyTile } from '../rules/movement.js';

export const RECRUITMENT_OPTIONS = Object.freeze([
    Object.freeze({ type: 'infantry', buttonId: 'recruitInfantry', glyph: '⚔️', label: '步兵', shortcut: '1' }),
    Object.freeze({ type: 'cavalry', buttonId: 'recruitCavalry', glyph: '🐎', label: '骑兵', shortcut: '2' }),
    Object.freeze({ type: 'archer', buttonId: 'recruitArcher', glyph: '🎯', label: '炮兵', shortcut: '3' }),
    Object.freeze({ type: 'warship', buttonId: 'recruitWarship', glyph: '🚢', label: '战舰', shortcut: '4', portOnly: true })
]);

/**
 * Structural recruitment legality shared by the DOM state and its tests.
 * Cost, turn ownership, mechanic switches and temporary city disablement are
 * intentionally handled by the button-state layer.
 */
export function canRecruitTypeAtSelectedCity(type, tile, state, currentCamp = state?.currentCamp) {
    return !!tile
        && tile.isCity === true
        && !tile.unit
        && tile.camp === currentCamp
        && canUnitOccupyTile(type, tile, state);
}

export function shouldShowRecruitmentOption(option, tile, state, currentCamp = state?.currentCamp) {
    if (!option?.portOnly) return tile?.isVillage !== true;
    return canRecruitTypeAtSelectedCity(option.type, tile, state, currentCamp);
}
