// 战略评估层 —— 把“这一回合能打什么”提升为“这一回合必须换来什么”。
//
// 这里的函数保持纯函数，便于用真人对局与自对局遥测做回归。三档 AI 可以读取
// 同一份局势事实，但只应按各自难度使用相应深度；Imperator 不受人为能力封顶。

import { calcIncome } from '../rules/constants.js';

const POSTURES = new Set(['expand', 'contest', 'defend', 'recover', 'finish']);

export function estimateCampEconomy(tiles, camp) {
    const owned = Array.isArray(tiles) ? tiles.filter(tile => tile?.camp === camp) : [];
    const cityCount = owned.filter(tile => tile.isCity).length;
    const villageCount = owned.filter(tile => tile.isVillage).length;
    const portCount = owned.filter(tile => tile.isPort).length;
    return {
        cityCount,
        villageCount,
        portCount,
        projectedIncome: calcIncome(cityCount) + villageCount
    };
}

export function estimateForceValue(units) {
    return (Array.isArray(units) ? units : []).reduce((total, unit) => {
        if (!unit || unit.hp <= 0) return total;
        const cost = Math.max(1, Number(unit.config?.cost) || 8);
        const maxHp = Math.max(1, Number(unit.maxHp ?? unit.config?.hp ?? unit.hp));
        const readiness = Math.max(0.25, Math.min(1, Number(unit.hp) / maxHp));
        const commanderValue = unit.commander ? 8 : 0;
        const rankValue = Math.max(0, Number(unit._rank || 0)) * 2;
        return total + cost * readiness + commanderValue + rankValue;
    }, 0);
}

/**
 * 战争迷雾中的敌军不是 0，而是未知。用我方开局规模建立保守先验，并让旧情报
 * 随时间衰减；重新发现敌军时立刻采用更高的实测值。它只记忆曾经获得的信息，
 * 不读取迷雾下单位，因此不会为了提高难度而作弊。
 */
export function estimateFogRivalForce({
    fogEnabled = false,
    ownForceValue = 0,
    observedForceValue = 0,
    previousEstimate = null,
    elapsedRounds = 1
} = {}) {
    const observed = Math.max(0, Number(observedForceValue) || 0);
    if (!fogEnabled) return observed;
    const ownBaseline = Math.max(1, Number(ownForceValue) || 0) * 0.75;
    const previous = Number(previousEstimate);
    const decaySteps = Math.max(0, Number(elapsedRounds) || 0);
    const decayedMemory = Number.isFinite(previous) && previous > 0
        ? previous * (0.88 ** decaySteps)
        : ownBaseline;
    return Math.max(observed, decayedMemory, ownBaseline * 0.40);
}

/**
 * 估算夺取一座城市后整块行政区在剩余战局中能兑现的价值。
 * 城、村、港、机场、投诚奖励都纳入同一账本，避免只按直线距离追逐城市图标。
 */
export function estimateDistrictAssetValue(city, tiles, {
    currentCityCount = 1,
    roundsRemaining = 8,
    oceanMap = false,
    enemyOwned = false,
    captureReward = null,
    transferableNeutralForceValue = 0
} = {}) {
    if (!city) {
        return Object.freeze({ total: 0, income: 0, villages: 0, ports: 0, infrastructure: 0, reward: 0, denial: 0 });
    }
    const horizon = Math.max(1, Math.min(10, Number(roundsRemaining) || 1));
    const districtTiles = (Array.isArray(tiles) ? tiles : [])
        .filter(tile => tile?.districtId === city.districtId);
    const villages = districtTiles.filter(tile => tile.isVillage).length;
    const ports = districtTiles.filter(tile => tile.isPort).length;
    const readyInstallations = districtTiles.filter(tile =>
        tile.installation?.status === 'ready').length;
    const marginalCityIncome = Math.max(0,
        calcIncome(Math.max(0, currentCityCount) + 1) - calcIncome(Math.max(0, currentCityCount)));
    const income = marginalCityIncome * horizon + villages * horizon;
    const villageValue = villages * 18;
    const portValue = ports * (oceanMap ? 72 : 34);
    const infrastructure = readyInstallations * 36;
    const isRewardCity = captureReward?.type === 'neutralForcesTransfer'
        && Number(captureReward.cityQ) === Number(city.q)
        && Number(captureReward.cityR) === Number(city.r);
    const reward = isRewardCity
        ? 85 + Math.max(0, Number(transferableNeutralForceValue) || 0)
        : 0;
    const denial = enemyOwned ? Math.round((income + portValue + infrastructure) * 0.55) : 0;
    const total = 70 + income + villageValue + portValue + infrastructure + reward + denial;
    return Object.freeze({
        total,
        income,
        villages: villageValue,
        ports: portValue,
        infrastructure,
        reward,
        denial
    });
}

/**
 * Imperator 的战局状态机。优先级体现不可逆损失：先阻止崩盘，再争夺经济，
 * 最后才是常规扩张；残局只有在确实能结束比赛时才覆盖防守。
 */
export function assessStrategicPosture({
    ownForceValue = 0,
    rivalForceValue = 0,
    ownUnitCount = 0,
    ownCityCount = 0,
    rivalCityCount = 0,
    ownProjectedIncome = 0,
    rivalProjectedIncome = 0,
    ownPortCount = 0,
    capitalThreat = 0,
    portThreat = 0,
    rivalMomentum = 0,
    roundsRemaining = 99,
    hasExpansionTargets = true,
    strategicPictureComplete = true
} = {}) {
    const safeRivalForce = Math.max(1, Number(rivalForceValue) || 0);
    const forceRatio = Math.max(0, Number(ownForceValue) || 0) / safeRivalForce;
    const incomeGap = (Number(rivalProjectedIncome) || 0) - (Number(ownProjectedIncome) || 0);
    const cityGap = (Number(rivalCityCount) || 0) - (Number(ownCityCount) || 0);
    const capitalCrisis = Number(capitalThreat) >= 0.58;
    const solePortCrisis = Number(ownPortCount) <= 1 && Number(portThreat) >= 0.62;
    const forceCollapse = Number(ownUnitCount) <= 1 || forceRatio < 0.34;

    let posture = 'expand';
    let urgency = 0;
    if (forceCollapse) {
        posture = 'recover';
        urgency = Math.max(0.85, 1 - forceRatio);
    } else if (capitalCrisis || solePortCrisis) {
        posture = 'defend';
        urgency = Math.max(Number(capitalThreat) || 0, Number(portThreat) || 0);
    } else if (Number(roundsRemaining) <= 4
        || (strategicPictureComplete && !hasExpansionTargets && Number(rivalCityCount) <= 1)) {
        posture = 'finish';
        urgency = 0.72;
    } else if (incomeGap >= 2 || cityGap >= 1 || Number(rivalMomentum) >= 1) {
        posture = 'contest';
        urgency = Math.min(0.82, 0.45 + incomeGap * 0.08 + cityGap * 0.10);
    }

    return Object.freeze({
        posture,
        urgency: Math.max(0, Math.min(1, urgency)),
        forceRatio,
        incomeGap,
        cityGap
    });
}

export function shouldBreakObjectiveCommitment({
    previousPosture = 'expand',
    nextPosture = 'expand',
    capitalThreat = 0,
    objectiveValid = true,
    stalledRounds = 0
} = {}) {
    if (!POSTURES.has(previousPosture) || !POSTURES.has(nextPosture)) return true;
    if (!objectiveValid) return true;
    if (nextPosture === 'recover' || nextPosture === 'defend') {
        return previousPosture !== nextPosture || Number(capitalThreat) >= 0.58;
    }
    return previousPosture !== nextPosture || Number(stalledRounds) >= 2;
}

/** 基础设施、补员与抽牌都必须尊重这笔恢复预算。 */
export function getEmergencyRecruitReserve({
    enabled = false,
    ownUnitCount = 0,
    rivalUnitCount = 0,
    hasEmptyCity = false,
    hasEmptyPort = false,
    oceanMap = false,
    capitalThreat = 0,
    portThreat = 0,
    minimumLandCost = 8,
    minimumNavalCost = 8
} = {}) {
    if (!enabled) return 0;
    const outnumbered = Number(ownUnitCount) + 1 < Number(rivalUnitCount);
    const landEmergency = hasEmptyCity
        && (Number(ownUnitCount) <= 2 || outnumbered || Number(capitalThreat) >= 0.45);
    const navalEmergency = oceanMap && hasEmptyPort
        && (Number(portThreat) >= 0.40 || outnumbered);
    if (!landEmergency && !navalEmergency) return 0;
    return Math.max(
        landEmergency ? Math.max(0, Number(minimumLandCost) || 0) : 0,
        navalEmergency ? Math.max(0, Number(minimumNavalCost) || 0) : 0
    );
}
