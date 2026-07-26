// rules/commanders.js — 将领平衡表与资料卡。
// `definition` 是前端展示的将领资料；`balance` 是结算读取的参数。
// 每个数值只在 balance 里出现一次，描述文字在本模块内由 balance 派生后冻结；
// 修改平衡值后，选将卡、技能详情和 tooltip 会同步更新。
// 保留 0 值是为了让配置项显式可见，而不是表示遗漏。

import { deepFreeze } from './freeze.js';
import { percent, rangeText } from './format.js';
import { COLONEL_CARD_DATA } from './cards.js';
import { FORTIFICATION_CONFIG } from './terrain.js';

function buildAdvisor() {
    const balance = { outcomeCount: 4, noEffectOutcome: 0, moraleDownOutcome: 1, confusedOutcome: 2, moraleDownLevel: 1, confusedLevel: 0, normalMorale: 2, durationRounds: 2, paladinAuraRange: 1 };
    const desc = `攻击时随机判定：${percent(1 / balance.outcomeCount)}无效果、${percent(1 / balance.outcomeCount)}使目标士气下降${balance.durationRounds}回合、${percent(1 / balance.outcomeCount)}使目标混乱${balance.durationRounds}回合、${percent(1 / balance.outcomeCount)}使非将领目标变更为己方势力；将领命中最后一项时改为混乱${balance.durationRounds}回合`;
    return {
        definition: {
            id: 'advisor', name: '谋士', skill: '攻心', hpBonusPct: 0.35, atkBonusPct: 0, spdBonus: 1,
            desc, tooltipDesc: desc
        },
        balance
    };
}

function buildAstrologer() {
    const balance = { auraRange: 3, weatherLockRounds: 2, cooldown: 5 };
    return {
        definition: {
            id: 'astrologer', name: '占星者', hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0,
            skills: [
                { name: '夜观', desc: `自身${balance.auraRange}格范围内天气对所有单位与地块一律视为晴天（不分敌我，不受任何天气效果影响）`, type: 'passive' },
                { name: '星移', desc: `强制指定天气并锁定${balance.weatherLockRounds}回合，锁定期间天气负面效果对所有敌人生效，若处于【夜观】范围内则效果翻倍（⏳${balance.cooldown}）`, type: 'active' }
            ],
            activeSkill: { name: '星移', desc: `强制指定当前天气并锁定${balance.weatherLockRounds}回合（⏳${balance.cooldown}）`, duration: balance.weatherLockRounds, cooldown: balance.cooldown }
        },
        balance
    };
}

function buildBerserker() {
    const balance = { hpLossPerStackPct: 0.02, maxStacks: 40, statBonusPerStackPct: 0.01, qixueHpCostPct: 0.30, qixueDamageBonus: 0.30, qixueCritBonus: 0.50, qixueSplashMultiplier: 0.40, qixueRange: 1, cooldown: 1 };
    const stackLoss = percent(balance.hpLossPerStackPct);
    const statBonus = percent(balance.statBonusPerStackPct);
    const passive = `每损失${stackLoss}生命值，获得${statBonus}攻击力与${statBonus}防御力加成，最多${percent(balance.maxStacks * balance.statBonusPerStackPct)}`;
    const qixueText = `立即消耗${percent(balance.qixueHpCostPct)}当前生命值使下一次攻击获得${percent(balance.qixueDamageBonus)}伤害加成并获得${percent(balance.qixueCritBonus)}暴击率，同时主目标周围${balance.qixueRange}格范围内的敌人受到原本${percent(balance.qixueSplashMultiplier)}的溅射伤害。`;
    return {
        definition: {
            id: 'berserker', name: '狂战士', skill: '血怒', hpBonusPct: 0.25, atkBonusPct: 0, spdBonus: 0,
            desc: passive, tooltipDesc: passive,
            skills: [
                { name: '血怒', desc: passive, type: 'passive' },
                { name: '泣血', desc: qixueText, type: 'active' }
            ],
            activeSkill: { name: '泣血', desc: qixueText, duration: 0, cooldown: balance.cooldown }
        },
        balance
    };
}

function buildCenturion() {
    const balance = { attackTriggerChance: 0.30, movementPoints: 3, maxTriggersPerRound: 1, veteranXpMultiplier: 2 };
    return {
        definition: {
            id: 'centurion', name: '百夫长', hpBonusPct: 0, atkBonusPct: 0.40, spdBonus: 1,
            skills: [
                { name: '老兵', desc: '晋升的速度提高100%', type: 'passive' },
                { name: '乘胜', desc: `攻击时有${percent(balance.attackTriggerChance)}概率获得${balance.movementPoints}点行动力，击杀时必定触发，每回合最多${balance.maxTriggersPerRound}次`, type: 'passive' }
            ]
        },
        balance
    };
}

function buildColonel() {
    const balance = {
        ...COLONEL_CARD_DATA,
        baseAirDamageBonus: 0.20,
        antiAirPierce: 0.15,
        rangeBonus: 2
    };
    return {
        definition: {
            id: 'colonel', name: '空军上校', hpBonusPct: 0.30, atkBonusPct: 0.30, spdBonus: 1,
            skills: [
                { name: '制空', desc: `驻扎己方机场城市或挂载航母时，空军伤害提高${percent(balance.baseAirDamageBonus)}、射程+${balance.rangeBonus}并无视${percent(balance.antiAirPierce)}防空；雾天停飞`, type: 'passive' },
                { name: '老练', desc: `每发动1次受强化的空军行动，空军伤害再提高${percent(balance.airDamagePerStack)}，最多叠加${balance.maxAirDamageStacks}层`, type: 'passive' }
            ]
        },
        balance
    };
}

function buildDiplomat() {
    const balance = { handSizeBonus: 1, useBonus: 1, copyChance: 0.50 };
    return {
        definition: {
            id: 'diplomat', name: '纵横家', skill: '合纵', hpBonusPct: 0.30, atkBonusPct: 0.25, spdBonus: 0,
            skills: [
                { name: '合纵', desc: `对策卡上限+${balance.handSizeBonus}，每回合对策卡使用次数+${balance.useBonus}`, type: 'passive' },
                { name: '连横', desc: `处于非己方行政区时，有${percent(balance.copyChance)}概率获得非己方使用的同名对策卡`, type: 'passive' }
            ]
        },
        balance
    };
}

function buildEngineer() {
    const balance = { trenchGoldCost: 1, flakGoldCost: 1, bunkerGoldCost: 7, airfieldGoldCost: 7, fieldRepairGoldCost: 3, fieldRepairCooldown: 2, fieldRepairHealPct: 0.50, bunkerBuildRounds: 0, bunkerCooldownRounds: 0, bunkerHp: 200, bunkerRange: 1 };
    return {
        definition: {
            id: 'engineer', name: '工程师', hpBonusPct: 0.30, atkBonusPct: 0.25, spdBonus: 0,
            skills: [
                { name: '工兵指挥', desc: '建造工事时获得专属折扣；建造碉堡立即完成，驻城时该城市建设机场也享受折扣。', type: 'passive' },
                { name: '战地抢修', desc: '消耗3金币修复相邻己方建筑或碉堡脚手架50%最大生命值，冷却2回合。', type: 'passive' }
            ]
        },
        balance
    };
}

function buildFallenAngel() {
    const balance = { blackMoraleLevels: [1, 3], normalMorale: 2, blackDamageBonus: 0.75, blackCritBonus: 0.60, blackHpLossPct: 0.20, whiteMissingHpHealPct: 0.30 };
    return {
        definition: {
            id: 'fallenAngel', name: '堕天使', hpBonusPct: 0.35, atkBonusPct: 0, spdBonus: 0,
            skills: [
                { name: '堕落', desc: `士气正常时切换至【堕天使·白】，每回合回复已损失生命值的${percent(balance.whiteMissingHpHealPct)}`, type: 'passive' },
                { name: '净化', desc: `士气上升或下降时切换至【堕天使·黑】，造成的伤害+${percent(balance.blackDamageBonus)}、暴击率+${percent(balance.blackCritBonus)}，每回合流失当前生命值${percent(balance.blackHpLossPct)}`, type: 'passive' }
            ]
        },
        balance
    };
}

function buildIronGuard() {
    const balance = { shieldMax: 120, shieldRestorePerRound: 40, auraDefenseBonus: 0.10 };
    return {
        definition: {
            id: 'ironGuard', name: '铁卫', hpBonusPct: 0.30, atkBonusPct: 0, spdBonus: 0,
            skills: [
                { name: '守护', desc: `部署时获得${balance.shieldMax}点永久护盾，每回合回复${balance.shieldRestorePerRound}点，最多${balance.shieldMax}点，自身及相邻友军获得【守护灵光】`, type: 'passive' },
                { name: '守护灵光', desc: `防御力+${percent(balance.auraDefenseBonus)}，所受伤害转由铁卫护盾承担`, type: 'passive' }
            ]
        },
        balance
    };
}

function buildMagician() {
    const balance = { counterDamageBonus: 0.25, counterDefenseBonus: 0.15, hpBonusPct: 0.20, rankHpBonus: 20, damagePerStack: 0.05, critPerStack: 0.10, maxStacks: 6 };
    return {
        definition: {
            id: 'magician', name: '魔术师', skill: '幻形', hpBonusPct: 0.20, atkBonusPct: 0, spdBonus: 0,
            skills: [
                { name: '千面', desc: `攻击克制目标时造成的伤害提高${percent(balance.counterDamageBonus)}，被克制目标攻击时受到的伤害降低${percent(balance.counterDefenseBonus)}`, type: 'passive' },
                { name: '幻形', desc: `击杀敌方单位后变形为其兵种类型，获得1层【幻形】效果：造成的伤害提高${percent(balance.damagePerStack)}、暴击率+${percent(balance.critPerStack)}，最多叠加${balance.maxStacks}层`, type: 'passive' }
            ]
        },
        balance
    };
}

function buildMartyr() {
    const balance = { triggerHp: 1, explosionRange: 2, centerMultiplier: 4, adjacentMultiplier: 2, outerMultiplier: 1, elegyDamagePerDeath: 0.05, elegyDamageCap: 0.40, moraleBoostRounds: 2 };
    return {
        definition: {
            id: 'martyr', name: '殉道者', skill: '殉道', hpBonusPct: 0.30, atkBonusPct: 0, spdBonus: 0,
            skills: [
                { name: '殉道', desc: `生命≤${balance.triggerHp}时进入殉道倒计时，期间可移动但无法攻击；下回合开始时对${balance.explosionRange}格范围内所有非己方单位造成基于攻击力的真实伤害`, type: 'passive' },
                { name: '挽歌', desc: `己方单位阵亡时，殉道者永久获得造成的伤害+${percent(balance.elegyDamagePerDeath)}，最多叠加${Math.round(balance.elegyDamageCap / balance.elegyDamagePerDeath)}层`, type: 'passive' }
            ]
        },
        balance
    };
}

function buildMinister() {
    const balance = { goldPerRound: 1, maxGoldPerRound: 12 };
    return {
        definition: {
            id: 'minister', name: '尚书', skill: '屯田', hpBonusPct: 0.40, atkBonusPct: 0, spdBonus: 0,
            desc: `驻扎于城市时，每回合额外产出$${balance.goldPerRound}×当前回合数，最多$${balance.maxGoldPerRound}`
        },
        balance
    };
}

function buildNecromancer() {
    const balance = { soulMarkRounds: 3, curseBaseDamage: 20, curseMissingHpPct: 0.40, maxSoulMinions: 2, soulHpPct: 0.40, soulAttackPct: 0.70, moraleBoostRounds: 2, rankXp: [0, 2, 5, 12, 20], killBaseXp: 3, commanderKillXp: 10 };
    return {
        definition: {
            id: 'necromancer', name: '亡灵法师', hpBonusPct: 0.25, atkBonusPct: 0.20, spdBonus: 0,
            skills: [
                { name: '留魂', desc: `友军单位阵亡后原地留下持续${balance.soulMarkRounds}回合的【亡魂】，对占据其上的单位持续施加【亡魂诅咒】，每回合造成${balance.curseBaseDamage}+${percent(balance.curseMissingHpPct)}当前已损失生命值的真实伤害`, type: 'passive' },
                { name: '回魂', desc: `回合开始牵引最近的空地【亡魂】唤起【魂卒】，拥有原单位${percent(balance.soulHpPct)}生命值和${percent(balance.soulAttackPct)}攻击力，场上最多${balance.maxSoulMinions}个`, type: 'passive' }
            ]
        },
        balance
    };
}

function buildPaladin() {
    const balance = { faithMax: 3, faithOnDeploy: 1, faithCostPerCharge: 1, defensePerFaith: 0.05, auraAttackBonus: 0, auraDamageBonus: 0.12, smiteCooldown: 1, normalSmiteMin: 25, normalSmiteMax: 40, chargedSmiteMin: 65, chargedSmiteMax: 85, maxSmiteCharges: 2 };
    return {
        definition: {
            id: 'paladin', name: '圣骑士', hpBonusPct: 0.25, atkBonusPct: 0.30, spdBonus: 0,
            skills: [
                { name: '勇气灵光', desc: `自身及相邻6格友军造成的伤害+${percent(balance.auraDamageBonus)}，士气不会下降或混乱`, type: 'passive' },
                { name: '誓言', desc: `【勇气灵光】范围内的友军受击或击杀时获得1誓言，每回合最多1层，上限${balance.faithMax}层，每层为圣骑士提供${percent(balance.defensePerFaith)}防御力`, type: 'passive' },
                { name: '至圣斩', desc: `每次点击消耗1层誓言蓄力（1层${rangeText(balance.normalSmiteMin, balance.normalSmiteMax)}/2层${rangeText(balance.chargedSmiteMin, balance.chargedSmiteMax)}真实伤害），最多${balance.maxSmiteCharges}层，命中后冷却${balance.smiteCooldown}回合`, type: 'active' }
            ],
            activeSkill: { name: '至圣斩', desc: `每次点击消耗1层誓言蓄力（1层${rangeText(balance.normalSmiteMin, balance.normalSmiteMax)}→再点→2层${rangeText(balance.chargedSmiteMin, balance.chargedSmiteMax)}），最多${balance.maxSmiteCharges}层，命中后冷却${balance.smiteCooldown}回合`, duration: 0, cooldown: 0 }
        },
        balance
    };
}

function buildPriest() {
    const balance = { chainFirstRange: 1, chainFirstHealPct: 0.10, chainSecondRange: 2, chainSecondHealPct: 0.05, prayerRange: 2, prayerHpCostPct: 0.50, prayerInitialHealPct: 0.35, auraHealPct: 0.20, auraDuration: 3, minimumHpPct: 0.20, cooldown: 5 };
    return {
        definition: {
            id: 'priest', name: '牧师', hpBonusPct: 0.30, atkBonusPct: 0, spdBonus: 0,
            skills: [
                { name: '圣疗', desc: `每回合链式群体治疗：1段瞄准相邻友方回复${percent(balance.chainFirstHealPct)}生命值，2段传导${balance.chainSecondRange}格内友方回复${percent(balance.chainSecondHealPct)}生命值`, type: 'passive' },
                { name: '祈祷', desc: `消耗${percent(balance.prayerHpCostPct)}当前生命值，为${balance.prayerRange}格范围友军附加【治愈灵光】：立即回复${percent(balance.prayerInitialHealPct)}生命值，每回合再回复${percent(balance.auraHealPct)}生命值，持续期间受致命一击则提前释放全部剩余治疗量并消耗灵光（⏱${balance.auraDuration} ⏳${balance.cooldown}）`, type: 'active' }
            ],
            activeSkill: { name: '祈祷', desc: `消耗${percent(balance.prayerHpCostPct)}当前HP，为${balance.prayerRange}格范围友军附加【治愈灵光】（立即${percent(balance.prayerInitialHealPct)}HP+每回合${percent(balance.auraHealPct)}HP，持续${balance.auraDuration}回合）；灵光单位受致命一击时提前迸发剩余治疗，仍不足则保底${percent(balance.minimumHpPct)}生命`, duration: 0, cooldown: balance.cooldown }
        },
        balance
    };
}

function buildStaller() {
    const balance = { range: 2, movementCostPerLayer: 2, rangedDefenseBonus: 0.25, rangeReduction: 1 };
    return {
        definition: {
            id: 'staller', name: '停滞者', skill: '迟滞力场', hpBonusPct: 0.30, atkBonusPct: 0.20, spdBonus: 0,
            desc: `自身${balance.range}格范围内敌人每步移动力消耗+${balance.movementCostPerLayer}，范围内友军单位对远程攻击防御力提高${percent(balance.rangedDefenseBonus)}`
        },
        balance
    };
}

function buildTianyan() {
    const balance = { maxCount: 2, signalRange: 5, deployRange: 1, deployLimitPerTurn: 1, deployGoldCost: 5, hp: 75, attack: 30, movement: 8, attackRange: 2, suicideRange: 3, visionBonus: 1, actionPointCost: 2 };
    return {
        definition: {
            id: 'tianyan', name: '天眼', hpBonusPct: 0.30, atkBonusPct: 0.15, spdBonus: 1,
            skills: [
                { name: '战场观测', desc: `遭遇战中自身视野+${balance.visionBonus}；常驻显示${balance.signalRange}格无人机信号范围`, type: 'passive' },
                { name: '天眼哨机', desc: `$${balance.deployGoldCost} 在周围部署天眼哨机，每回合可部署${balance.deployLimitPerTurn}架，上限${balance.maxCount}架，哨机与天眼距离超过${balance.signalRange}格会失控`, type: 'active' },
                { name: '自爆', desc: `立即撞向${balance.suicideRange}格内指定目标自毁并造成穿刺伤害`, type: 'active' }
            ],
            activeSkill: { name: '天眼哨机', desc: `$${balance.deployGoldCost} 在周围${balance.deployRange}格空地部署天眼哨机，每回合最多部署${balance.deployLimitPerTurn}架，同时最多存在${balance.maxCount}架`, duration: 0, cooldown: 0 }
        },
        balance
    };
}

function buildVampire() {
    const balance = { healMinPct: 0.30, healMaxPct: 0.60, overflowToShieldPct: 0.50, shieldCap: 60 };
    return {
        definition: {
            id: 'vampire', name: '吸血鬼', skill: '嗜血', hpBonusPct: 0.20, atkBonusPct: 0.40, spdBonus: 0,
            desc: `攻击造成伤害时随机回复伤害值${percent(balance.healMinPct)}~${percent(balance.healMaxPct)}的生命值（溢出部分按${percent(balance.overflowToShieldPct)}转化为护盾，上限${balance.shieldCap}）`
        },
        balance
    };
}

export const COMMANDER_CONFIG = deepFreeze({
    advisor: buildAdvisor(),
    astrologer: buildAstrologer(),
    berserker: buildBerserker(),
    centurion: buildCenturion(),
    colonel: buildColonel(),
    diplomat: buildDiplomat(),
    engineer: buildEngineer(),
    fallenAngel: buildFallenAngel(),
    ironGuard: buildIronGuard(),
    magician: buildMagician(),
    martyr: buildMartyr(),
    minister: buildMinister(),
    necromancer: buildNecromancer(),
    paladin: buildPaladin(),
    priest: buildPriest(),
    staller: buildStaller(),
    tianyan: buildTianyan(),
    vampire: buildVampire()
});
