// rules/uiText.js — 兵种被动、效果栏文案与图标映射。
// 这里改动会同时影响选择面板和悬浮详情；数值全部引用规则键派生，没有第二份数字。

import { deepFreeze } from './freeze.js';
import { percent } from './format.js';
import { EMOJI } from './symbols.js';
import { COMMANDER_CONFIG } from './commanders.js';

export const FRONTEND_TEXT = deepFreeze({
    // v2 起常规兵种的 0 阶不再有兵种被动；专精被动文案由 rules/units.js 的
    // UNIT_SPECIALIZATION_CONFIG 派生。这里只保留建筑单位的结构性说明。
    unitPassives: {
        shoreBattery: { name: '制海', desc: '对舰船伤害提高30%，对陆军伤害降低60%，可侦测2格内的潜艇' }
    },
    effectDescriptions: {
        courageAura: `攻击力提高${percent(COMMANDER_CONFIG.paladin.balance.auraAttackBonus)}，士气不会下降`,
        healingAura: `每回合回复${percent(COMMANDER_CONFIG.priest.balance.auraHealPct)}最大生命值，受致命一击时提前释放全部剩余治疗量，仍不足则保底${percent(COMMANDER_CONFIG.priest.balance.minimumHpPct)}生命`,
        imprisoned: '本回合无法移动',
        immobile: '该单位无法移动',
        signalLost: `超出天眼${COMMANDER_CONFIG.tianyan.balance.signalRange}格信号范围，当前无法行动；回到信号范围后恢复。`,
        guardianSelf: `防御力提高${percent(COMMANDER_CONFIG.ironGuard.balance.auraDefenseBonus)}`,
        guardianAlly: `防御力提高${percent(COMMANDER_CONFIG.ironGuard.balance.auraDefenseBonus)}，伤害由铁卫护盾承担`
    },
    icons: {
        unitPassive: { infantry: '⚔️', cavalry: '🐎', archer: '🎯', shoreBattery: '🏯', destroyer: '🛡', warship: '💥', submarine: '🌊', carrier: '✈️', drone: EMOJI.commander.drone },
        commander: {
            advisor: '🧠', astrologer: '🔮', berserker: EMOJI.commander.qixue, centurion: '🏛️', colonel: '🛩️', diplomat: '🤝', engineer: '🛠️', fallenAngel: '😇', ironGuard: '🛡️', magician: '🎩', martyr: '🔥', minister: '📜', necromancer: '💀', paladin: '✝️', priest: '🙏', staller: '🕳️', tianyan: '🛰️', vampire: '🧛'
        },
        skill: {
            '坚守': '🏰', '冲锋': '🐎', '远射': '🎯', '攻心': '🧠', '守护': '✨', '守护灵光': EMOJI.commander.guardianAura, '勇气灵光': EMOJI.commander.courageAura, '誓言': '⚔️', '至圣斩': '✝️', '挽歌': EMOJI.commander.qixue, '幻形': '🎭', '乘胜': '🏆', '制空': '✈️', '老练': '⭐', '留魂': EMOJI.commander.soul, '回魂': '💀', '治愈灵光': EMOJI.commander.healingAura, '夜观': '🌟', '堕天使·白': '🤍', '堕天使·黑': '🖤', '血怒': '💢', '泣血': EMOJI.commander.qixue, '殉道': '💀', '屯田': EMOJI.terrain.plains, '迟滞力场': '🌀', '连横': '🃏', '合纵': '🎴'
        },
        effect: {
            '城市': '🏙️', '村庄': '🏘️', '平原': EMOJI.terrain.plains, '森林': EMOJI.terrain.forest, '山地': EMOJI.terrain.mountain, '战壕': EMOJI.fortification.trenchBadge, '高射机枪': EMOJI.fortification.flak, '碉堡': '🏰', '士气上升': EMOJI.moraleBadge.up, '士气下降': EMOJI.moraleBadge.down, '混乱': EMOJI.moraleBadge.confused, '禁锢': '🔒', '不可移动': '🚫', '运输状态': '⚓', '勇气灵光': EMOJI.commander.courageAura, '治愈灵光': EMOJI.commander.healingAura, '守护灵光': EMOJI.commander.guardianAura, '夜观': '🌟', '亡魂': EMOJI.commander.soul, '合纵': '🎴', '连横': '🃏', '缚足': '🕸️', '施工中': '🚧', '脚手架': '🏗️', '泣血': EMOJI.commander.qixue, '星移': '🔮'
        }
    }
});
