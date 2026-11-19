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
import { isFieldCapturer } from './roster.js';
import { W, isImperatorTier, resolveEffectiveWeights, resolveImperatorDoctrine } from './weights.js';
import { getActiveCultureId } from '../../rules/cultures.js';

/** 攻城 ETA（回合）：占领者赶路 + 破城 + 清守军。 */
function estimateApproachTurns(world, unit, tile) {
    if (world.captureRoute) return world.captureRoute(unit, tile)?.turns ?? Infinity;
    const navDist = world.navDistance || world.helpers.hexDistance;
    const dist = navDist(unit.tile, tile);
    return dist / Math.max(1, Number(unit.config?.speed) || 1);
}

export function estimateCaptureEta(world, city) {
    const assault = world.myUnits.filter(unit => isFieldCapturer(world, unit));
    let bestEta = Infinity;
    for (const unit of assault) {
        bestEta = Math.min(bestEta, Math.ceil(estimateApproachTurns(world, unit, city.tile)));
    }
    if (!Number.isFinite(bestEta)) return null;
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
    let best = Infinity;
    for (const city of world.cities) {
        if (!city.mine) continue;
        for (const unit of world.rivalUnits) {
            if (!world.isCapturable(unit) || !unit.tile) continue;
            best = Math.min(best, Math.ceil(estimateApproachTurns(world, unit, city.tile)));
        }
    }
    return Number.isFinite(best) ? best : null;
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
    if (unitHistory.at(-1)?.round === world.round) unitHistory.at(-1).count = world.myUnits.length;
    else unitHistory.push({ round: world.round, count: world.myUnits.length });
    while (unitHistory.length > 10) unitHistory.shift();
    const threeRoundsAgo = unitHistory.filter(h => h.round <= world.round - 3).at(-1);
    const bleeding = !!threeRoundsAgo && threeRoundsAgo.count - world.myUnits.length >= 3;

    let posture = base.posture;
    let urgency = base.urgency;
    const emergencyDefenseCity = world.caps.emergencyDefense
        ? world.myCities.find(city => {
            const hostileCapturers = world.rivalUnits.filter(unit => world.isCapturable(unit)
                && unit.tile
                && world.helpers.hexDistance(unit.tile, city) <= Math.min(3, Math.max(2, Math.floor((Number(unit.config?.speed) || 4) / 2)))).length;
            if (hostileCapturers === 0) return false;
            const localDefenders = world.myUnits.filter(unit => world.isCapturable(unit)
                && unit.tile && world.helpers.hexDistance(unit.tile, city) <= 2).length;
            const weakGarrison = !city.unit || city.unit.hp < city.unit.maxHp * 0.55;
            const highCityThreat = world.threatAt(city, city.unit) >= (city.unit ? city.unit.hp * 0.6 : 1);
            return weakGarrison || hostileCapturers > localDefenders
                || (hostileCapturers >= localDefenders && highCityThreat);
        }) || null
        : null;
    const finishTargetCampKey = world.collapseTarget?.campKey || null;
    if (bleeding && posture === 'expand') {
        posture = 'contest';
        urgency = Math.max(urgency, 0.5);
    }
    if (finishTargetCampKey && !emergencyDefenseCity && posture !== 'defend' && posture !== 'recover') {
        posture = 'allin';
        urgency = Math.max(urgency, 0.88);
    }
    let activeDoctrine = world.doctrine || null;
    if (isImperatorTier(world.caps)) {
        const incomeRatio = world.economy.projectedIncome / Math.max(1, world.strongestRivalEconomy.projectedIncome);
        activeDoctrine = resolveImperatorDoctrine(world.gameState, world.myCampKey, {
            round: world.round,
            oceanMap: world.oceanMap,
            cultureId: getActiveCultureId(world.gameState, world.myCamp),
            commanderIds: world.myUnits.map(u => u.commander).filter(Boolean),
            cityGap: world.cityGap,
            forceRatio: base.forceRatio,
            incomeRatio,
            roundsRemaining: world.roundsRemaining,
            ownCities: world.myCities.length,
            bleeding,
            gold: world.gold
        });
        world.doctrine = activeDoctrine;
        world.weights = resolveEffectiveWeights(world.caps, activeDoctrine);
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
        const trailing = world.cityGap < 0
            || (world.caps.opponentModeling && world.cityGap === 0 && world.roundsRemaining <= (world.oceanMap ? 6 : 4) && base.forceRatio >= 0.85);
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
        } else if (!emergencyDefenseCity && trailing && clockRunningOut) {
            // 残局恢复不能覆盖追分任务：疗愈/维修在战术与生产层仍可正常执行。
            posture = 'allin';
            urgency = 0.9;
        } else if (posture !== 'recover' && posture !== 'defend') {
            if (leadSafe && world.roundsRemaining <= W.leadDefenseRounds) {
                posture = 'hold';
                urgency = Math.max(urgency, 0.55);
            } else if (trailing && clockRunningOut) {
                posture = 'allin';
                urgency = 0.9;
            }
        }
    }

    if (world.caps.victoryClock && !emergencyDefenseCity) {
        if (campMemory.clockAllInRound === world.round && world.cityGap <= 0) {
            posture = 'allin';
            urgency = Math.max(urgency, 0.9);
        }
        if (posture === 'allin') campMemory.clockAllInRound = world.round;
    }

    // 突击力量缺口：决定招募与腾位。
    const assaultUnits = world.myUnits.filter(unit => isFieldCapturer(world, unit));
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
        doctrine: activeDoctrine,
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
