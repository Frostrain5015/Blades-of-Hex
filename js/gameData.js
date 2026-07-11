// ============================================================================
// 兼容层（已废弃）：游戏数据已按归属拆分到 rules/ 目录。
// ============================================================================
//
// - 数值与定义请改 rules/{constants,units,camps,terrain,cards,commanders}.js
// - 文案与符号请改 rules/{uiText,symbols}.js
// - 新代码请直接从 rules/ 导入；本文件只为遗留导入路径保留原有导出名，
//   不要在这里新增任何数据或逻辑。
// ============================================================================

export { EMOJI_FONT_STACK, EMOJI } from '../rules/symbols.js';
export { BOARD_RULES, GAME_RULES, COMBAT_BALANCE } from '../rules/constants.js';
export { UNIT_CONFIG, COUNTER_RELATION } from '../rules/units.js';
export { CAMP_DATA, CAMP_FLAG_COLORS } from '../rules/camps.js';
export { TERRAIN_CONFIG, FORTIFICATION_CONFIG, MORALE_CONFIG, WEATHER_CONFIG } from '../rules/terrain.js';
export { TACTICAL_CARD_DATA, COLONEL_CARD_DATA } from '../rules/cards.js';
export { COMMANDER_CONFIG } from '../rules/commanders.js';
export { FRONTEND_TEXT } from '../rules/uiText.js';
