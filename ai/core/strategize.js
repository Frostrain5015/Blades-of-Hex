// 战略层 —— 姿态（含胜利条件时钟）与目标排序。
//
// 旧架构的姿态只看战力比与经济差；本层新增两条从真人录像归纳的规则：
//   守钟(hold)  —— 城市领先且剩余回合不足以被翻案时，一切动作转为保城；
//   死斗(allin) —— 城市落后且时钟将尽时，一切资源换算成"最快再拿一座城"。

import {
    assessAssaultCapacity,
    assessStrategicPosture,
    getEmergencyRecruitReserve
} from '../strategy.js';
import { rankCityObjectives } from './perceive.js';

/** 攻城 ETA（回合）：占领者赶路 + 破城 + 清守军。 */
export function estimateCaptureEta(world, city) {
    const assault = world.myUnits.filter(u => world.isCapturable(u) && !world.isImmobile(u));
    const speedOf = unit => {
        const speed = Math.max(1, Number(unit.config?.speed) || 1);
        // 运输规划档位：陆地单位跨海按运输上限折算，不再按步行。
        if (world.caps.transportPlanning && !world.isNaval(unit) && world.oceanMap) {
            return Math.max(speed, 4);
        }
        return speed;
    };
    let bestEta = null;
    for (const unit of assault) {
        const dist = world.helpers.hexDistance(unit.tile, city.tile);
        const eta = Math.ceil(dist / speedOf(unit));
        if (bestEta == null || eta < bestEta) bestEta = eta;
    }
    if (bestEta == null) return null;
    const siegePower = world.myUnits
        .filter(u => !world.isImmobile(u))
        .map(u => world.estimateSiegeDamage(u, city.tile))
        .sort((a, b) => b - a)[0] || 0;
    const breachRounds = city.hp > 0
        ? Math.max(1, Math.ceil(city.hp / Math.max(20, siegePower)))
        : 0;
    const garrisonRounds = city.garrison && city.garrison.camp !== world.myCamp ? 1 : 0;
    return bestEta + breachRounds + garrisonRounds;
}

/** 敌方最快夺城 ETA：用于判断"我还剩几回合安全期"。 */
function estimateEnemyCaptureEta(world) {
    let best = null;
    for (const city of world.cities) {
        if (!city.mine) continue;
        for (const unit of world.rivalUnits) {
            if (!world.isCapturable(unit)) continue;
            const speed = Math.max(1, Number(unit.config?.speed) || 1);
            const eta = Math.ceil(world.helpers.hexDistance(unit.tile, city.tile) / speed);
            if (best == null || eta < best) best = eta;
        }
    }
    return best;
}

export function decideStrategy(world) {
    const base = assessStrategicPosture({
        ownForceValue: world.ownForceValue,
        rivalForceValue: world.rivalForceEstimate,
        ownUnitCount: world.myUnits.length,
        ownCityCount: world.myCities.length,
        rivalCityCount: world.bestRivalCities,
        ownProjectedIncome: world.economy.projectedIncome,
        rivalProjectedIncome: world.strongestRivalEconomy.projectedIncome,
        ownPortCount: world.economy.portCount,
        capitalThreat: 0,
        portThreat: 0,
        roundsRemaining: world.roundsRemaining,
        hasExpansionTargets: world.cities.some(c => c.hostile),
        strategicPictureComplete: !world.fog
    });

    // 首都/港口危机用威胁图实测，替代旧版估计值。
    const capitalThreat = world.myCities.length
        ? Math.max(...world.myCities.map(city => world.threatAt(city, city.unit))) / 150
        : 0;

    // 兵力趋势诚实化：3 回合净减 3 个单位以上（无论死于谁手），
    // 就不许再按 forceRatio 自我感觉良好地 expand——forceRatio 看不见喂给中立的损失。
    const aiMemory = (world.gameState._aiCoreMemory ||= {});
    const campMemory = (aiMemory[world.myCampKey] ||= {});
    const unitHistory = (campMemory.unitCountHistory ||= []);
    unitHistory.push({ round: world.round, count: world.myUnits.length });
    while (unitHistory.length > 10) unitHistory.shift();
    const threeRoundsAgo = unitHistory.filter(h => h.round <= world.round - 3).at(-1);
    const bleeding = !!threeRoundsAgo && threeRoundsAgo.count - world.myUnits.length >= 3;

    let posture = base.posture;
    let urgency = base.urgency;
    const emergencyDefenseCity = world.caps.emergencyDefense
        ? world.myCities.find(city => {
            const hostileCapturers = world.rivalUnits.filter(unit => world.isCapturable(unit)
                && unit.tile && world.helpers.hexDistance(unit.tile, city) <= 2).length;
            if (hostileCapturers === 0) return false;
            const localDefenders = world.myUnits.filter(unit => world.isCapturable(unit)
                && unit.tile && world.helpers.hexDistance(unit.tile, city) <= 2).length;
            const weakGarrison = !city.unit || city.unit.hp < city.unit.maxHp * 0.55;
            return weakGarrison || hostileCapturers > localDefenders;
        }) || null
        : null;
    const finishTargetCampKey = world.collapseTarget?.campKey || null;
    if (bleeding && posture === 'expand') {
        posture = 'contest';
        urgency = Math.max(urgency, 0.5);
    }
    if (finishTargetCampKey && !emergencyDefenseCity) {
        posture = 'allin';
        urgency = Math.max(urgency, 0.88);
    }
    if (emergencyDefenseCity) {
        posture = 'defend';
        urgency = Math.max(urgency, 0.95);
    }
    const clock = { enemyCaptureEta: null, myCaptureEta: null };

    if (world.caps.victoryClock) {
        clock.enemyCaptureEta = estimateEnemyCaptureEta(world);
        const ranked = rankCityObjectives(world, city => estimateCaptureEta(world, city));
        const fastest = ranked.find(entry => entry.eta < 99);
        clock.myCaptureEta = fastest ? estimateCaptureEta(world, fastest.city) : null;

        const leadSafe = world.cityGap > 0
            && (clock.enemyCaptureEta == null || world.roundsRemaining <= clock.enemyCaptureEta + 1);
        const trailing = world.cityGap < 0;
        const clockRunningOut = world.roundsRemaining <= Math.max(4, (clock.myCaptureEta ?? 99) + 1);

        // 残局映射：finish 不是"结束"，而是按城市差切成守钟或死斗。
        // 平局也是输——时钟将尽而城市不占优时，必须把最软的城打下来。
        if (base.posture === 'finish') {
            if (world.cityGap > 0) {
                posture = 'hold';
                urgency = Math.max(urgency, 0.6);
            } else {
                posture = 'allin';
                urgency = 0.9;
            }
        } else if (posture !== 'recover' && posture !== 'defend') {
            if (leadSafe && world.roundsRemaining <= 8) {
                posture = 'hold';
                urgency = Math.max(urgency, 0.55);
            } else if (trailing && clockRunningOut) {
                posture = 'allin';
                urgency = 0.9;
            }
        }
    }

    // 突击力量缺口：决定招募与腾位。
    const assaultUnits = world.myUnits.filter(u => world.isCapturable(u) && !world.isImmobile(u));
    const outstandingObjectives = world.cities.filter(c => c.hostile).length;
    const assaultCapacity = assessAssaultCapacity({
        assaultCount: assaultUnits.length,
        outstandingObjectives,
        ownedCities: world.myCities.length,
        emptyOwnedCities: world.myCities.filter(c => !c.unit).length
    });

    // 紧急招募预留金（沿用已测的纯函数）。
    const reserve = getEmergencyRecruitReserve({
        enabled: true,
        ownUnitCount: world.myUnits.length,
        rivalUnitCount: world.rivalUnits.length,
        hasEmptyCity: world.myCities.some(c => !c.unit),
        hasEmptyPort: world.tiles.some(t => t.isPort && t.camp === world.myCamp && !t.unit),
        oceanMap: world.oceanMap,
        capitalThreat,
        portThreat: 0,
        minimumLandCost: 8,
        minimumNavalCost: 8
    });

    // 侦察需求：信息龄期超阈值且迷雾仍在。
    const needsScout = world.caps.scoutMissions
        && world.fog
        && world.stalestRivalAge >= 4
        && posture !== 'recover';

    return Object.freeze({
        posture,
        urgency,
        basePosture: base.posture,
        forceRatio: base.forceRatio,
        incomeGap: base.incomeGap,
        cityGap: world.cityGap,
        clock,
        capitalThreat,
        emergencyDefenseCity,
        finishTargetCampKey,
        assaultCapacity,
        reserve,
        needsScout,
        // 卡牌政策：守钟时控制卡只留给占城威胁；死斗时全砸在夺城链上。
        cardPolicy: posture === 'hold' ? 'reserve-cc-for-capturers'
            : posture === 'allin' ? 'spend-on-capture'
            : posture === 'defend' || posture === 'recover' ? 'defensive' : 'normal'
    });
}
