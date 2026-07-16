import { canUnitOccupyTile } from '../rules/movement.js';
import { isWaterTile } from '../rules/surfaces.js';
import { isPortOperationalFor, isRegularNavalUnit } from '../rules/naval.js';

export const RECRUITMENT_OPTIONS = Object.freeze([
    Object.freeze({ type: 'infantry', buttonId: 'recruitInfantry', glyph: '⚔️', label: '步兵', shortcut: '1', site: 'city' }),
    Object.freeze({ type: 'cavalry', buttonId: 'recruitCavalry', glyph: '🐎', label: '骑兵', shortcut: '2', site: 'city' }),
    Object.freeze({ type: 'archer', buttonId: 'recruitArcher', glyph: '🎯', label: '炮兵', shortcut: '3', site: 'city' }),
    Object.freeze({ type: 'destroyer', buttonId: 'recruitDestroyer', glyph: '🛡', label: '驱逐舰', shortcut: '4', site: 'port', portOnly: true }),
    Object.freeze({ type: 'warship', buttonId: 'recruitWarship', glyph: '🚢', label: '巡洋舰', shortcut: '5', site: 'port', portOnly: true }),
    Object.freeze({ type: 'submarine', buttonId: 'recruitSubmarine', glyph: '⚓', label: '潜艇', shortcut: '6', site: 'port', portOnly: true })
]);

export const RECRUITMENT_SITE = Object.freeze({ CITY: 'city', PORT: 'port' });

export function getRecruitmentSiteKind(tile, state) {
    if (!tile) return null;
    if (tile.isPort === true && isWaterTile(tile)) return RECRUITMENT_SITE.PORT;
    if (tile.isCity === true) return RECRUITMENT_SITE.CITY;
    return null;
}

export function getRecruitmentOptionsForTile(tile, state) {
    const site = getRecruitmentSiteKind(tile, state);
    return site ? RECRUITMENT_OPTIONS.filter(option => option.site === site) : [];
}

/**
 * Structural recruitment legality shared by the DOM state and its tests.
 * Cost, turn ownership, mechanic switches and temporary city disablement are
 * intentionally handled by the button-state layer.
 */
export function canRecruitTypeAtSelectedCity(type, tile, state, currentCamp = state?.currentCamp) {
    if (!RECRUITMENT_OPTIONS.some(option => option.type === type)) return false;
    const site = getRecruitmentSiteKind(tile, state);
    const naval = isRegularNavalUnit(type);
    const requiredSite = naval
        ? site === RECRUITMENT_SITE.PORT && isPortOperationalFor(tile, currentCamp, state)
        : site === RECRUITMENT_SITE.CITY;
    return !!tile
        && requiredSite
        && !tile.unit
        && tile.camp === currentCamp
        && canUnitOccupyTile(type, tile, state);
}

export const canRecruitTypeAtSelectedSite = canRecruitTypeAtSelectedCity;

export function shouldShowRecruitmentOption(option, tile, state, currentCamp = state?.currentCamp) {
    return !!option && option.site === getRecruitmentSiteKind(tile, state);
}
