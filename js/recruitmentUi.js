import { UNIT_CONFIG, canUnitBeRecruitedAtSite, countLivingUnitsOfType, getUniqueRecruitmentLimit } from '../rules/units.js';
import { getActiveCultureId, getCultureUniqueUnitType } from '../rules/cultures.js';
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

export function getUniqueRecruitmentOption(state, currentCamp = state?.currentCamp) {
    const cultureId = getActiveCultureId(state, currentCamp);
    const uniqueType = getCultureUniqueUnitType(cultureId);
    const cfg = uniqueType ? UNIT_CONFIG[uniqueType] : null;
    if (!cfg) return null;
    return Object.freeze({
        type: uniqueType,
        buttonId: 'recruitUnique',
        glyph: '⭐',
        label: cfg.name,
        shortcut: '7',
        isUnique: true,
        portOnly: isRegularNavalUnit(uniqueType)
    });
}

export function getRecruitmentOptionsForTile(tile, state, currentCamp = state?.currentCamp) {
    const site = getRecruitmentSiteKind(tile, state);
    if (!site) return [];
    const options = RECRUITMENT_OPTIONS.filter(option => option.site === site);
    const uniqueOption = getUniqueRecruitmentOption(state, currentCamp);
    if (uniqueOption && canUnitBeRecruitedAtSite(uniqueOption.type, site)) {
        options.push(uniqueOption);
    }
    return options;
}

/**
 * Structural recruitment legality shared by the DOM state and its tests.
 * Cost, turn ownership, mechanic switches and temporary city disablement are
 * intentionally handled by the button-state layer.
 */
export function canRecruitTypeAtSelectedCity(type, tile, state, currentCamp = state?.currentCamp) {
    const isStandard = RECRUITMENT_OPTIONS.some(option => option.type === type);
    const uniqueOption = getUniqueRecruitmentOption(state, currentCamp);
    if (!isStandard && uniqueOption?.type !== type) return false;
    if (!isStandard && countLivingUnitsOfType(state, currentCamp, type) >= getUniqueRecruitmentLimit(type)) return false;
    if (currentCamp?.canRecruit === false) return false;
    const site = getRecruitmentSiteKind(tile, state);
    if (!site || !canUnitBeRecruitedAtSite(type, site)) return false;
    const naval = isRegularNavalUnit(type);
    const siteReady = (site === RECRUITMENT_SITE.CITY && !naval)
        || (site === RECRUITMENT_SITE.PORT && isPortOperationalFor(tile, currentCamp, state));
    return !!tile
        && siteReady
        && !tile.unit
        && tile.camp === currentCamp
        && canUnitOccupyTile(type, tile, state);
}

export const canRecruitTypeAtSelectedSite = canRecruitTypeAtSelectedCity;

export function shouldShowRecruitmentOption(option, tile, state, currentCamp = state?.currentCamp) {
    const site = getRecruitmentSiteKind(tile, state);
    if (!option || !site) return false;
    if (option.isUnique) return canUnitBeRecruitedAtSite(option.type, site);
    return option.site === site;
}
