// rules/constants.js — 全局规则常量：棋盘、经济、卡牌系统、天气循环与伤害管线参数。
// 约定：百分比统一用小数（0.25 表示 25%）；距离、回合、金币、HP、ATK 用实际数值。
// 每个数值只有一个规则键；文案通过 rules/format.js 引用同一键生成。

import { deepFreeze } from './freeze.js';
import { HEX_NEIGHBORS } from './hex.js';

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
        'airstrike', 'airstrike', 'airdrop', 'airdrop', 'mgNest', 'shield', 'shield',
        'landmine', 'landmine', 'imprison', 'imprison', 'forceMarch'
    ],
    skirmishExtras: ['scout', 'scout', 'scout', 'scout', 'scout'],
    // 选将：普通模式每人 3 候选选 1；双将模式每人 5 候选选 2 分别部署。
    commanderDraft: { candidatesPerPlayer: 3, dualCandidatesPerPlayer: 5, dualCommanderCount: 2 },
    // 遭遇战（战争迷雾）视野：各兵种可见格数；己方城市提供相邻格视野。
    skirmishVision: {
        unitVision: { infantry: 1, cavalry: 2, archer: 2, mgNest: 2, shoreBattery: 2, drone: 2, destroyer: 2, warship: 3, submarine: 2 },
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
        counter: { min: 0.90, cityMin: 1.00, max: 1.70, critThreshold: 1.50, baseMultiplier: 0.75 },
        morale: { up: { min: 0.05, max: 0.10 }, down: { min: -0.05, max: -0.10 }, confused: { min: -0.10, max: -0.20 } }
    },
    counter: { advantageDamage: 0.20, disadvantageDamage: -0.20, advantageCrit: 0.25 },
    defense: { minimumMultiplier: 0.20, forestVsRangedBonus: 0.15, cityInfantryBonus: 0.10, windInfantryPenalty: 0.15, rainCityInfantryBonus: 0.10, antiairPerLayer: 0.25, antiairMaxLayers: 3 },
    cavalry: { normalChargeDamagePerStep: 0.10, fogChargeDamagePerStep: 0.15, maxChargeSteps: 3, fogDamageBonus: 0.20 },
    infantry: { cityHealPct: 0.10, cityDamageBonus: 0.15 },
    weather: { rainCityHealPct: 0.15, rainCavalryMovementCost: 1, fogArcherRangeDelta: -1, windArcherRangeDelta: 1, windArcherDamageBonus: 0.20 },
    rank: {
        xpThresholds: [8, 18, 30, 48],
        rankUpHealLostPct: 0.30,
        hpBonusAtFirstRank: 20,
        atkBonusAtSecondRank: 10,
        defBonusAtThirdRank: 0.10,
        critBonusAtThirdRank: 0.25,
        regenPctAtFourthRank: 0.15
    }
});
