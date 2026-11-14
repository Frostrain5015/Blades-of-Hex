import { FACTION_RULE_MODES } from './cultures.js';

export const FACTION_RULE_MODE_LABELS = Object.freeze({
    [FACTION_RULE_MODES.NONE]: '常规模式',
    [FACTION_RULE_MODES.CULTURE]: '历史模式',
    [FACTION_RULE_MODES.SYNERGY]: '奇幻模式'
});

export const FACTION_ABILITY_LABELS = Object.freeze({
    passive: '阵营被动',
    skill: '阵营技能'
});
