// rules/constants.js — 全局规则常量：棋盘、经济、卡牌系统、天气循环与伤害管线参数。
// 约定：百分比统一用小数（0.25 表示 25%）；距离、回合、金币、HP、ATK 用实际数值。
// 每个数值只有一个规则键；文案通过 rules/format.js 引用同一键生成。

import { deepFreeze } from './freeze.js';
import { HEX_NEIGHBORS } from './hex.js';
import { UNIT_RANK_CONFIG } from './units.js';

/** 棋盘和回合的基础规则。一般无需为了平衡而修改像素尺寸。 */
export const BOARD_RULES = deepFreeze({
    hexSize: 30,
    logicalWidth: 1000,
    logicalHeight: 750,
    logLimit: 20,
    hexNeighbors: HEX_NEIGHBORS
});

/** 全局经济、卡牌与天气循环参数。 */
export const GAME_RULES = deepFreeze({
    villageGold: 1,
    villageMinDistance: 3,
    commanderRerollCost: 3,
    income: { firstCityGold: 4, secondCityGold: 3, additionalCityGold: 2 },
    cardSystem: { drawCost: 4, maxHandSize: 3, maxDrawsPerTurn: 2, maxUsesPerTurn: 2 },
    weatherCycle: { warmupRounds: 2, weatherDuration: 2, clearDuration: 1 },
    deckComposition: [
        'heal', 'heal', 'heal', 'heal', 'lightning', 'lightning', 'lightning',
        'mgNest', 'mgNest', 'shield', 'shield', 'shield',
        'landmine', 'landmine', 'landmine', 'landmine',
        'imprison', 'imprison', 'forceMarch', 'poison'
    ],
    skirmishExtras: [],
    // 选将：普通模式每人 3 候选选 1；双将模式每人 5 候选选 2 分别部署。
    commanderDraft: { candidatesPerPlayer: 3, dualCandidatesPerPlayer: 5, dualCommanderCount: 2 },
    // 遭遇战（战争迷雾）视野：各兵种可见格数；己方城市提供相邻格视野。
    skirmishVision: {
        unitVision: { infantry: 1, cavalry: 2, archer: 2, mgNest: 2, shoreBattery: 2, drone: 2, destroyer: 2, warship: 3, submarine: 2, carrier: 3, laserTower: 3 },
        cityVisionRange: 1
    }
});

// ==== 常用别名（与 GAME_RULES 指向同一份冻结数据） ====
export const VILLAGE_GOLD = GAME_RULES.villageGold;
export const VILLAGE_MIN_DIST = GAME_RULES.villageMinDistance;
export const COMMANDER_REROLL_COST = GAME_RULES.commanderRerollCost;
export const CARD_SYSTEM_CONFIG = GAME_RULES.cardSystem;
export const WEATHER_CYCLE = GAME_RULES.weatherCycle;
export const DECK_COMPOSITION = GAME_RULES.deckComposition;
export const SKIRMISH_EXTRAS = GAME_RULES.skirmishExtras;
export const COMMANDER_DRAFT = GAME_RULES.commanderDraft;
export const SKIRMISH_VISION = GAME_RULES.skirmishVision;

// ==== 经济 ====

/**
 * 中立经济门控。中立不是一个有取胜目标的阵营，而是玩家争夺的资源；
 * 它的收入只应维持一支守备队的损耗，不应攒出能左右战局的部队。
 *
 * 必须对**城市与村庄的合计毛收入**只乘一次，不能拆开逐项乘：
 * 村庄单笔只有 $1，逐项取整会直接归零，等于悄悄把村庄收入全砍掉。
 */
export const NEUTRAL_ECONOMY_RATE = 0.20;

export function applyNeutralEconomyRate(campKey, grossIncome) {
    const gross = Math.max(0, Number(grossIncome) || 0);
    if (campKey !== 'neutral') return gross;
    return Math.floor(gross * NEUTRAL_ECONOMY_RATE);
}

// 收入公式：1城=4, 2城=4+3, 3城+=4+3+2*(n-2)
export function calcIncome(cityCount) {
    const income = GAME_RULES.income;
    if (cityCount >= 3) return income.firstCityGold + income.secondCityGold + (cityCount - 2) * income.additionalCityGold;
    if (cityCount === 2) return income.firstCityGold + income.secondCityGold;
    if (cityCount === 1) return income.firstCityGold;
    return 0;
}

/** 伤害管线的共用平衡参数；`Unit.js` 不再保存这些魔法数字。 */
export const COMBAT_BALANCE = deepFreeze({
    float: {
        attack: { min: 0.85, max: 1.35, critThreshold: 1.30 },
        counter: { min: 0.90, cityMin: 1.00, max: 1.70, critThreshold: 1.50, baseMultiplier: 0.75 }
    },
    // 克制不再提供固定增减伤：改为浮动区间平移——顺克上移（暴击率提升），逆克下移（相应惩罚）
    counter: { advantageCrit: 0.40, disadvantageFloatPenalty: -0.40 },
    // 激光塔【集束激光】：回合开始齐射，命中目标越多单发越高（单发 = base + perExtra×(N−1)，cap max）
    laserTower: { baseDamage: 25, perExtraTarget: 10, maxDamage: 65 },
    defense: { minimumMultiplier: 0.15, maximumReduction: 0.85, forestVsRangedBonus: 0.15, cityInfantryBonus: 0.10, windInfantryPenalty: 0.15, rainCityInfantryBonus: 0.10 },
    cavalry: { normalChargeDamagePerStep: 0.10, fogChargeDamagePerStep: 0.15, maxChargeSteps: 3, fogDamageBonus: 0.20 },
    infantry: { cityHealPct: 0.10, cityDamageBonus: 0.15 },
    weather: { rainCityHealPct: 0.15, rainCavalryMovementCost: 1, fogArcherRangeDelta: -1, windArcherRangeDelta: 1, windArcherDamageBonus: 0.20,
        rainLightning: { totalStrikes: 4, unitsPerEffective: 8, damageMultiplier: 0.7, ambientRadius: 4 } },
    rank: {
        xpThresholds: UNIT_RANK_CONFIG.xpThresholds,
        rankUpHealLostPct: UNIT_RANK_CONFIG.rankUpHealLostPct,
        hpBonusAtSecondRank: UNIT_RANK_CONFIG.rank2.hp,
        atkBonusAtSecondRank: UNIT_RANK_CONFIG.rank2.attack,
        critBonusAtFourthRank: UNIT_RANK_CONFIG.rank4.critBonus,
        regenPctAtFourthRank: UNIT_RANK_CONFIG.rank4.regenPct
    }
});
