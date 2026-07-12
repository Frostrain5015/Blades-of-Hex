// Legacy import facade. New modules must import from rules/, canvasRuntime, or settingsRuntime by ownership.
// Keeping this facade avoids a risky all-at-once migration of existing browser modules.

import { BOARD_RULES } from '../rules/constants.js';

export const LOG_LIMIT = BOARD_RULES.logLimit;

export { UNIT_CONFIG, COUNTER_RELATION } from '../rules/units.js';
export { CAMP, CAMP_FLAG_COLORS, FACTION_PALETTE, getPaletteEntry, getFlagColors, campToKey } from '../rules/camps.js';
export { TERRAIN_CONFIG, FORTIFICATION_CONFIG, MORALE_CONFIG, WEATHER_CONFIG } from '../rules/terrain.js';
export { HEX_NEIGHBORS, hexDistance } from '../rules/hex.js';
export { getFactionCount, getRoundIndex, getRound } from '../rules/turns.js';
export {
    calcIncome,
    VILLAGE_GOLD,
    VILLAGE_MIN_DIST,
    COMMANDER_REROLL_COST,
    CARD_SYSTEM_CONFIG,
    WEATHER_CYCLE,
    DECK_COMPOSITION,
    SKIRMISH_EXTRAS,
    BOARD_RULES,
    COMBAT_BALANCE
} from '../rules/constants.js';
export { TACTICAL_CARD_CONFIG, COLONEL_CARDS, COLONEL_CARD_GOLD } from '../rules/cards.js';

export {
    HEX_SIZE,
    LOGICAL_W,
    LOGICAL_H,
    canvas,
    ctx,
    cardCanvas,
    cardCtx,
    HEX_WIDTH,
    initCanvas,
    boardDirty,
    invalidateBoard,
    frameInfo,
    hexToRgb,
    rgbToHex,
    hexPath,
    hexEdge,
    drawHexagonOutline,
    pulseSine,
    roundRectPath
} from './canvasRuntime.js';

export { settings, loadSettings, saveSettings } from './settingsRuntime.js';
