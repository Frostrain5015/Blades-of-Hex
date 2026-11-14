// rules/uiText.js — 兵种被动、效果栏文案与图标映射。
// 这里改动会同时影响选择面板和悬浮详情；数值全部引用规则键派生，没有第二份数字。

import { deepFreeze } from './freeze.js';
import { percent } from './format.js';
import { EMOJI } from './symbols.js';
import { COMMANDER_CONFIG } from './commanders.js';
import { COMBAT_BALANCE } from './constants.js';

export const FRONTEND_TEXT = deepFreeze({
    // v2 起常规兵种的 0 阶不再有兵种被动；专精被动文案由 rules/units.js 的
    // UNIT_SPECIALIZATION_CONFIG 派生。这里只保留建筑单位的结构性说明。
    unitPassives: {
        shoreBattery: { name: '制海', desc: '对舰船伤害提高30%，对陆军伤害降低60%，可侦测2格内的潜艇' },
        mgNest: { name: '机枪', desc: '对步兵造成的伤害提高30%' },
        carrier: { name: '舰载机', desc: '目标生命每损失5%，攻击力提高1点（至多15点）' },
        laserTower: { name: '集束激光', desc: `回合开始时自动攻击3格内所有敌方单位，单发伤害${COMBAT_BALANCE.laserTower.baseDamage}；每多命中1个目标伤害+${COMBAT_BALANCE.laserTower.perExtraTarget}（至多${COMBAT_BALANCE.laserTower.maxDamage}）` },
        us_marine: { name: '两栖登陆', desc: '下海保持攻防，从海上攻击陆军伤害提高30%。从水域登陆后，本回合下一次对陆上单位的主动攻击伤害提高20%。' },
        gb_battleship: { name: '天佑女王', desc: '常驻2格反潜侦测能力；受到敌方攻击时有20%概率闪避全部伤害。' },
        fr_heavy_cannon: { name: '远程重炮', desc: '射程5格，无视陆军对海军减伤并附带35%溅射。回合开始时自动炮击射程内随机敌军，之后仍可移动。' },
        ru_katyusha: { name: '火力覆盖', desc: '每次普通攻击均激发火箭齐射，对主目标相邻敌军造成35%溅射伤害。' },
        kmt_training_brigade: { name: '同心同德', desc: '同阵营有两支或以上教导旅在场时，全图链接并共享生命与治疗。链接中的教导旅获得的城防、工事及地形防御加成提高50%，自身与相邻六格友军造成的伤害提高15%。增伤不叠加。' },
        cpc_guerrilla: { name: '敌后游击', desc: '无视地形与天气对行动力的负面减益；除敌军贴近至1格或占领非己方原本控制的村庄外，对非己方隐藏行踪。' },
        jp_samurai: { name: '武士信条', desc: '常驻禁疗（仅可在城市或村庄补员）；主动技万岁冲锋向2格内敌军绝死突击（冷却1回合），自损75%当前生命，若击杀目标则无视禁疗回复60%最大生命。' }
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
            infantry: '⚔️', cavalry: '🐎', archer: '🎯', shoreBattery: '🏯', destroyer: '🛡', warship: '💥', submarine: '🌊', carrier: '🛫', drone: EMOJI.commander.drone, laserTower: '🗼',
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
