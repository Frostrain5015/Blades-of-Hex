// rules/uiText.js — 兵种被动、效果栏文案与图标映射。
// 这里改动会同时影响选择面板和悬浮详情；数值全部引用规则键派生，没有第二份数字。

import { deepFreeze } from './freeze.js';
import { percent } from './format.js';
import { EMOJI } from './symbols.js';
import { COMMANDER_CONFIG } from './commanders.js';
import { CULTURE_CONFIG, GUERRILLA_PASSIVE_DESCRIPTION, SAMURAI_PASSIVE_DESCRIPTION } from './cultures.js';
import { NAVAL_RULES } from './naval.js';
import { CITY_SIEGE_CONFIG } from './citySiege.js';
import { DEFENSE_BUILDING_MIN_DISTANCE, MG_NEST_MACHINE_GUN_DAMAGE_BONUS, UNIT_CONFIG } from './units.js';
import { FORTIFICATION_CONFIG } from './terrain.js';
import { DEFENSE_CONSTRUCTION_SUPPORT_RANGE } from './construction.js';

export const FRONTEND_TEXT = deepFreeze({
    // v2 起常规兵种的 0 阶不再有兵种被动；专精被动文案由 rules/units.js 的
    // UNIT_SPECIALIZATION_CONFIG 派生。这里保留建筑单位及通用攻城特性说明。
    unitPassives: {
        shoreBattery: {
            name: '要塞炮',
            desc: `对舰船、火炮及处于水上的陆军单位（海军陆战队除外）伤害提高${percent(NAVAL_RULES.shoreBatteryVsTargetDamage)}，对其他单位伤害降低${percent(Math.abs(NAVAL_RULES.shoreBatteryVsOtherDamage))}，可侦测${NAVAL_RULES.detectorRadius}格内的潜艇`
        },
        cannonSiege: {
            name: '攻城火力',
            desc: `对仍有生命值的城市（含城内驻军与城郭）伤害提高${percent(CITY_SIEGE_CONFIG.cannonSiegeDamageBonus)}`
        },
        mgNest: { name: '机枪', desc: `对步兵/骑兵造成的伤害提高${percent(MG_NEST_MACHINE_GUN_DAMAGE_BONUS)}` },
        carrier: { name: '舰载机', desc: '目标生命每损失5%，攻击力提高1点（至多15点）' },
        us_marine: { name: '两栖登陆', desc: CULTURE_CONFIG.us.tier1.summary },
        gb_battleship: { name: '天佑女王', desc: CULTURE_CONFIG.gb.tier1.summary },
        fr_heavy_cannon: { name: '远程重炮', desc: CULTURE_CONFIG.fr.tier1.summary },
        ru_katyusha: { name: '火力覆盖', desc: CULTURE_CONFIG.ru.tier1.summary },
        kmt_training_brigade: { name: '同心同德', desc: CULTURE_CONFIG.kmt.tier1.summary },
        cpc_guerrilla: { name: '敌后游击', desc: GUERRILLA_PASSIVE_DESCRIPTION },
        jp_samurai: { name: '武士信条', desc: SAMURAI_PASSIVE_DESCRIPTION }
    },
    effectDescriptions: {
        courageAura: `造成的伤害提高${percent(COMMANDER_CONFIG.paladin.balance.auraDamageBonus)}，士气不会下降`,
        healingAura: `每回合回复${percent(COMMANDER_CONFIG.priest.balance.auraHealPct)}最大生命值，受致命一击时提前释放全部剩余治疗量，仍不足则保底${percent(COMMANDER_CONFIG.priest.balance.minimumHpPct)}生命`,
        imprisoned: '本回合无法移动',
        immobile: '该单位无法移动',
        signalLost: `超出天眼${COMMANDER_CONFIG.tianyan.balance.signalRange}格信号范围，当前无法行动；回到信号范围后恢复。`,
        guardianSelf: `防御力提高${percent(COMMANDER_CONFIG.ironGuard.balance.auraDefenseBonus)}`,
        guardianAlly: `防御力提高${percent(COMMANDER_CONFIG.ironGuard.balance.auraDefenseBonus)}，伤害由铁卫护盾承担`
    },
    icons: {
        unitPassive: {
            infantry: '⚔️', cavalry: '🐎', archer: '🎯', mgNest: EMOJI.fortification.flak, shoreBattery: '🏯', destroyer: '🛡', warship: '💥', submarine: '🌊', carrier: '🛫', drone: EMOJI.commander.drone,
            us_marine: '🦅', gb_battleship: '👑', fr_heavy_cannon: '💣', ru_katyusha: '🚀', kmt_training_brigade: '🛡️', cpc_guerrilla: '🚩', jp_samurai: '⛩️'
        },
        commander: {
            advisor: '🧠', astrologer: '🔮', berserker: EMOJI.commander.qixue, centurion: '🏛️', colonel: '🛩️', diplomat: '🤝', engineer: '🛠️', fallenAngel: '😇', ironGuard: '🛡️', magician: '🎩', martyr: '🔥', minister: '📜', necromancer: '💀', paladin: '✝️', priest: '🙏', staller: '🕳️', tianyan: '🛰️', vampire: '🧛'
        },
        skill: {
            '坚守': '🏰', '冲锋': '🐎', '远射': '🎯', '攻心': '🧠', '守护': '✨', '守护灵光': EMOJI.commander.guardianAura, '勇气灵光': EMOJI.commander.courageAura, '誓言': '⚔️', '至圣斩': '✝️', '挽歌': EMOJI.commander.qixue, '幻形': '🎭', '乘胜': '🏆', '制空': '✈️', '老练': '⭐', '留魂': EMOJI.commander.soul, '回魂': '💀', '治愈灵光': EMOJI.commander.healingAura, '夜观': '🌟', '堕天使·白': '🤍', '堕天使·黑': '🖤', '血怒': '💢', '泣血': EMOJI.commander.qixue, '殉道': '💀', '屯田': EMOJI.terrain.plains, '迟滞力场': '🌀', '连横': '🃏', '合纵': '🎴'
        },
        effect: {
            '城市': '🏙️', '村庄': '🏘️', '平原': EMOJI.terrain.plains, '森林': EMOJI.terrain.forest, '山地': EMOJI.terrain.mountain, '战壕': EMOJI.fortification.trenchBadge, '高射机枪': EMOJI.fortification.flak, '碉堡': '🏰', '士气上升': EMOJI.moraleBadge.up, '士气下降': EMOJI.moraleBadge.down, '混乱': EMOJI.moraleBadge.confused, '禁锢': '🔒', '不可移动': '🚫', '运输状态': '⚓', '勇气灵光': EMOJI.commander.courageAura, '治愈灵光': EMOJI.commander.healingAura, '守护灵光': EMOJI.commander.guardianAura, '夜观': '🌟', '亡魂': EMOJI.commander.soul, '合纵': '🎴', '连横': '🃏', '缚足': '🕸️', '施工中': '🚧', '脚手架': '🏗️', '泣血': EMOJI.commander.qixue, '星移': '🔮', '鸢尾花的加护': '⚜️'
        }
    }
});

/** 战场建设弹窗各工事的效果与建造规则文案（全部从规则常量派生）。 */
export function getConstructionChoiceContent(kind, { engineer = false } = {}) {
    switch (kind) {
        case 'trench':
            return {
                effect: `效果：${FORTIFICATION_CONFIG.trench.desc}。`,
                placement: '建造：可建于任意己方行政区陆地，或己方部队所处的非己方行政区陆地；该格不得已有工事。'
            };
        case 'flak':
            return {
                effect: `效果：${FORTIFICATION_CONFIG.flak.desc}（对近战、炮击与舰炮无防御加成）。`,
                placement: '建造：可建于任意己方行政区陆地，或己方部队所处的非己方行政区陆地；该格不得已有工事。'
            };
        case 'bunker': {
            const cfg = UNIT_CONFIG.mgNest;
            return {
                effect: `效果：固定防御要塞（${cfg.hp}生命 / ${cfg.attack}攻击 / ${percent(cfg.defense)}防御 / ${cfg.range}射程），${FRONTEND_TEXT.unitPassives.mgNest.desc}，不可移动。`,
                placement: `建造：己方行政区空地或任意己方部队${DEFENSE_CONSTRUCTION_SUPPORT_RANGE}格内的非己方空地（同类相距至少${DEFENSE_BUILDING_MIN_DISTANCE}格）；${engineer ? '工程师使其立即完成。' : '下次己方回合完工。'}`
            };
        }
        case 'shoreBattery': {
            const cfg = UNIT_CONFIG.shoreBattery;
            return {
                effect: `效果：固定沿海重炮（${cfg.hp}生命 / ${cfg.attack}攻击 / ${cfg.range}射程），${FRONTEND_TEXT.unitPassives.shoreBattery.desc}；${FRONTEND_TEXT.unitPassives.cannonSiege.desc}，不可移动。`,
                placement: `建造：己方控制的临海空地；阵营共享${NAVAL_RULES.shoreBatteryCooldownRounds}回合冷却，新建炮位至少相距${DEFENSE_BUILDING_MIN_DISTANCE}格，标准地图预置炮位除外。`
            };
        }
        default:
            return { effect: '', placement: '' };
    }
}
