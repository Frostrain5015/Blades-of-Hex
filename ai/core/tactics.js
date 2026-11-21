// 战术层 —— 单个回合内"每个单位做什么"的执行决策。
//
// 评分量纲统一为等效金币（见 weights.js）：
//   攻击 = 打出伤害×目标每HP金价 + 击杀溢价 − 反击成本 + 战略加成
//   移动 = 任务推进收益 + 进驻收益 + 攻击位潜力 − 威胁暴露成本
// 任务层给的使命优先于局部贪心；无任务单位按散兵处理（打得到就打、打不到就向
// 最近的战略目标靠拢）。

import {
    counterDamageBonus,
    shouldPlanActiveSkill,
    shouldReserveFinalSiegeBlow,
    shouldSpendBerserkerBlood,
    scoreTacticalRoleMatchup
} from '../doctrine.js';
import { assessSiegeMission } from '../strategy.js';
import { W, hpGold, noiseJitter, residualGold, tradeNetValue } from './weights.js';
import { isFieldCapturer, shouldHoldCityPosition, shouldReserveCityGarrison } from './roster.js';
import { isCoastalLandTile, isPortOperationalFor, isWaterborneUnit, ROYAL_ESCORT_RADIUS } from '../../rules/naval.js';
import { isWaterTile } from '../../rules/surfaces.js';
import { getKmtLinkedUnits } from '../../rules/kmtStronghold.js';
import { getUnitBaseType } from '../../rules/units.js';
import {
    getActiveCultureId,
    getFireSeaState,
    getNeverSurrenderStacks
} from '../../rules/cultures.js';
import { chooseCultureStrike } from './cultureStrikes.js';
import { isEmbarkableLandUnit } from '../../rules/movement.js';
import { isStealthGuerrilla, STEALTH_VISIBILITY_RULES } from '../../rules/visibility.js';
import { COMMANDER_CONFIG } from '../../rules/commanders.js';

const FRAGILE_COMMANDERS = new Set(['advisor', 'diplomat', 'engineer', 'priest', 'staller', 'astrologer', 'necromancer', 'tianyan', 'colonel', 'magician']);
const REAR_COMMANDERS = new Set(['minister', 'astrologer']);

// 陆战主体单位（排除真正两栖的美国海军陆战队与海军舰船）下海即沦为无输出运输船且无法占城守城。
function isLandBoundUnit(world, unit) {
    return !!unit && !world.isNaval(unit) && isEmbarkableLandUnit(unit) && unit.type !== 'us_marine';
}

function canRetreatOntoTile(world, unit, tile) {
    if (!tile || (tile.unit && (!world.isUnitVisible || world.isUnitVisible(tile.unit)))) return false;
    if (isLandBoundUnit(world, unit)) return !world.onWater(tile);
    if (unit.type === 'us_marine') {
        return !world.onWater(tile) || (tile.isPort && isPortOperationalFor(tile, world.myCamp, world.gameState));
    }
    return true;
}

function nearestLandDistance(world, tile) {
    let best = Infinity;
    for (const candidate of world.tiles) {
        if (world.onWater(candidate)) continue;
        const d = world.helpers.hexDistance(tile, candidate);
        if (d < best) best = d;
    }
    return best;
}

function hasSurvivableRetreat(world, unit) {
    if (!unit?.tile) return false;
    const pool = unit.hp + (unit.activeShield ?? unit._shield ?? 0);
    if (!world.onWater(unit.tile) || !isLandBoundUnit(world, unit)) {
        if (combinedThreatAt(world, unit.tile, unit, null, 0).total * W.lethalThreatMargin < pool) return true;
    }
    if (unit.isNewRecruit || world.isImmobile(unit)) return false;
    for (const tile of world.helpers.getMovableTiles(unit)) {
        if (!canRetreatOntoTile(world, unit, tile)) continue;
        const { total } = combinedThreatAt(world, tile, unit, null, 0);
        if (total * W.lethalThreatMargin < pool) return true;
        if (!world.isNaval(unit) && tile.isCity && tile.camp === world.myCamp
            && !isReservedForMinisterReturn(world, tile) && total < pool) {
            return true;
        }
    }
    return false;
}

function computeDoomedUnitIds(world, missionsCtx) {
    const doomed = new Set();
    for (const unit of world.myUnits) {
        if (!unit.canAct || !unit.tile || unit.isNewRecruit) continue;
        if (shouldHoldCityPosition(world, unit, missionsCtx?.assignment?.get(unit.id))) continue;
        const pool = unit.hp + (unit.activeShield ?? unit._shield ?? 0);
        const { total } = combinedThreatAt(world, unit.tile, unit, null, 0);
        if (total * W.lethalThreatMargin < pool) continue;
        if (world.isImmobile(unit) || (shouldRetreat(world, unit, missionsCtx) && !hasSurvivableRetreat(world, unit))) {
            doomed.add(unit.id);
        }
    }
    return doomed;
}

function historicalAttackValue(world, attacker, target, damage, kills) {
    const distance = world.helpers.hexDistance;
    switch (getActiveCultureId(world.gameState, attacker.camp || world.myCamp)) {
        case 'de':
            return getFireSeaState(target) ? 14 + residualGold(target) * 0.12 : 0;
        case 'gb':
            return getNeverSurrenderStacks(world.gameState, attacker.camp) < 4 && !kills && !attacker.tile.isCity ? -5 : 0;
        case 'ru': {
            if (attacker.type !== 'ru_katyusha') return world.weather !== 'clear' && kills ? 4 : 0;
            const splash = [...world.rivalUnits, ...world.neutralUnits].filter(unit => unit !== target
                && distance(unit.tile, target.tile) === 1);
            return splash.reduce((value, unit) => value + Math.min(unit.hp, damage * 0.35) * hpGold(unit) + 3, 0)
                + (!kills && (target.morale === 1 || target.morale === 2) ? 7 : 0);
        }
        case 'jp':
            return kills ? Math.min(attacker.maxHp * 0.2, (attacker.maxHp - attacker.hp) * 0.2) * hpGold(attacker) : 0;
        case 'us':
            return attacker.type === 'us_marine' && (isWaterborneUnit(target) || isWaterborneUnit(attacker)) ? 8 : 0;
        case 'cpc': {
            if (attacker.type !== 'cpc_guerrilla') return 0;
            const isolated = !world.rivalUnits.some(unit => unit !== target
                && unit.tile && distance(unit.tile, target.tile) === 1);
            const ambushActive = isStealthGuerrilla(attacker);
            const backlineTarget = getUnitBaseType(target) === 'archer' || !!target.commander;
            return (isolated ? 16 : 0)
                + (ambushActive && kills ? 18 : 0)
                + (ambushActive && backlineTarget ? 14 : 0);
        }
        default:
            return 0;
    }
}

function historicalPositionValue(world, unit, tile) {
    const distance = world.helpers.hexDistance;
    const hasCover = tile.terrain === 'forest' || tile.terrain === 'mountain';
    switch (getActiveCultureId(world.gameState, unit.camp || world.myCamp)) {
        case 'gb': {
            if (!isWaterTile(tile)) return 0;
            const inCombat = world.threatAt(tile, unit) > 0
                || [...world.rivalUnits, ...world.neutralUnits].some(enemy =>
                    enemy.tile && distance(tile, enemy.tile) <= 4);
            const combatScale = inCombat ? 1 : 0.2;
            if (unit.type === 'gb_battleship') return world.myUnits.filter(ally => ally !== unit
                && isWaterborneUnit(ally) && distance(tile, ally.tile) <= ROYAL_ESCORT_RADIUS).length * 10 * combatScale;
            const flagshipDistance = Math.min(Infinity, ...world.myUnits.filter(ally => ally.type === 'gb_battleship')
                .map(ally => distance(tile, ally.tile)));
            return (flagshipDistance <= ROYAL_ESCORT_RADIUS ? 18 : flagshipDistance === 3 ? 5 : 0) * combatScale;
        }
        case 'fr': {
            if (unit.type !== 'fr_heavy_cannon') return 0;
            const range = unit.getEffectiveRange?.() ?? unit.config.range;
            const distances = [...world.rivalUnits, ...world.neutralUnits].map(enemy => distance(tile, enemy.tile));
            const cityArc = world.cities.some(city => city.ownerKey !== world.myCampKey && !city.garrison && city.hp > 0
                && distance(tile, city.tile) >= 2 && distance(tile, city.tile) <= range);
            const targets = distances.filter(steps => steps >= 2 && steps <= range).length;
            return Math.min(3, targets) * 18 + (cityArc ? 15 : 0) + (hasCover && targets ? 6 : 0) - (distances.includes(1) ? 25 : 0);
        }
        case 'us':
            return unit.type === 'us_marine' && (tile.isPort || isCoastalLandTile(tile, world.gameState)) ? 15 : 0;
        case 'kmt': {
            if (unit.type !== 'kmt_training_brigade' || !getKmtLinkedUnits(unit, world.gameState).length) return 0;
            if (isWaterTile(tile)) return -35;
            const allies = world.myUnits.filter(ally => ally !== unit && !ally.isEmbarked && distance(tile, ally.tile) === 1);
            return (tile.isCity || tile.isUrban || tile.fortification || hasCover ? 22 : 0) + Math.min(4, allies.length) * 7;
        }
        case 'cpc': {
            const scoutSite = world.gameState.skirmishFog && tile.isVillage && tile !== unit.tile
                && !tile.unit && world.cities.some(city => city.tile.districtId === (tile.villageDistrictId ?? tile.districtId)
                    && city.ownerKey !== world.myCampKey);
            return (scoutSite ? 20 : 0)
                + (unit.type === 'cpc_guerrilla' && hasCover ? 12 : 0)
                + (unit.type === 'cpc_guerrilla' ? scoreGuerrillaBlindSpotPosition(world, unit, tile) : 0);
        }
        default:
            return 0;
    }
}

// ═══════════════════════════════════════════════════════════════
// 攻击评估
// ═══════════════════════════════════════════════════════════════

/** 目标与本阵营攻城任务的相关性：守军只有"能清掉"时才是收益，打不死的守军是陷阱。 */
function missionTargetBonus(world, missionsCtx, target, kills) {
    let bonus = 0;
    for (const mission of missionsCtx.missions) {
        if (mission.kind === 'siege'
            && target.tile.q === mission.targetQ && target.tile.r === mission.targetR) {
            if (kills) bonus += mission.cityValue * 0.30;
            else if (mission.decisive) bonus += mission.cityValue * W.decisiveGarrisonProgressRatio;
        }
        if (mission.kind === 'intercept' && target.id === mission.targetUnitId) {
            bonus += mission.value;
        }
    }
    return bonus;
}

/** 敌方占城者的威胁定价（真人：雷击只打能占城的）。 */
export function enemyCapturerPremium(world, target) {
    if (!world.caps.interceptPricing || !world.isCapturable(target)) return 0;
    const isNeutralTarget = target.camp === world.gameState.factions?.neutral;
    let best = 0;
    for (const city of world.cities) {
        if (city.ownerKey !== world.myCampKey && city.ownerKey !== 'neutral') continue;
        // 中立单位原本就是中立城守军/缓冲带，绝不把站在自己城边的中立兵误判为"即将抢城的敌方占城者"。
        if (isNeutralTarget && city.ownerKey !== world.myCampKey) continue;
        const distance = world.helpers.hexDistance(target.tile, city.tile);
        if (distance > (isNeutralTarget ? 2 : 3)) continue;
        const value = city.asset.total * W.interceptBaseRatio
            + (city.mine ? 45 : 12)
            + (city.hp <= 0 ? 40 : 0)
            - distance * 10;
        best = Math.max(best, value);
    }
    return best;
}

/** 谋士攻心的转化期望：对非将领守军的每次攻击都是一张夺城彩票。 */
function conversionBonus(world, attacker, target) {
    if (!world.caps.conversionCapture) return 0;
    if (attacker.commander !== 'advisor') return 0;
    if (target.commander || target.isCommanderUnit) return 0;
    const city = world.cities.find(c => c.tile === target.tile);
    if (!city || !city.hostile) return 0;
    return W.conversionChancePerHit * city.asset.total;
}

/** 护航职责：威胁攻城任务占领者的敌人，以及目标城火力圈里的防御设施，护航优先清理。 */
function escortProtectionBonus(world, missionsCtx, attacker, target) {
    const mission = missionsCtx.assignment.get(attacker.id);
    if (!mission || mission.kind !== 'siege' || attacker.id === mission.occupierId) return 0;
    if (!target.tile) return 0;
    const objectiveTile = world.tileMap.get(`${mission.targetQ},${mission.targetR}`);
    if (objectiveTile && world.helpers.hexDistance(target.tile, objectiveTile) <= 3) return 55;
    const occupier = world.myUnits.find(u => u.id === mission.occupierId);
    if (!occupier?.tile) return 0;
    return world.helpers.hexDistance(target.tile, occupier.tile) <= 3 ? 45 : 0;
}

function isTransferableNeutralCarrier(world, target) {
    const districtId = world.standardMap?.carrierControl?.districtId;
    if (districtId == null || target?.type !== 'carrier'
        || target.camp !== world.gameState.factions?.neutral) return false;
    const prizeCity = world.cities.find(city => city.tile.districtId === districtId);
    return !!(prizeCity && prizeCity.hostile
        && world.myUnits.some(unit => isFieldCapturer(world, unit)));
}

/** 中立单位一律可打，但由净交换纪律把关：划算的才打，啃不动的不打；即将靠夺城收编的中立航母禁止白打削血。 */
function isNeutralEngageable(world, missionsCtx, target) {
    if (isTransferableNeutralCarrier(world, target)) return false;
    if (target.camp !== world.gameState.factions?.neutral
        || !missionsCtx.suppressNeutralEngagements) return true;
    return missionsCtx.missions.some(mission => mission.kind === 'siege'
        && target.tile?.q === mission.targetQ && target.tile?.r === mission.targetR);
}

function isRiskyNeutralAssault(world, attacker, target, counter, incoming = null) {
    if (!world.caps.duelModel || !isFieldCapturer(world, attacker) || !target.tile.isCity
        || target.camp !== world.gameState.factions.neutral) return false;
    const w = world.weights || W;
    if (w.allowRiskySiege && !attacker.commander) return false;
    const pool = attacker.hp + (attacker._shield || 0);
    return (counter + (incoming ?? world.threatAt(attacker.tile, attacker))) * w.lethalThreatMargin >= pool;
}

/** 威胁定价：按比例损失折算残余价值，而不是按 HP 单价——快死的单位每一步都更贵。 */
function combinedThreatAt(world, tile, unit, excludedEnemy = null, extraDamageTaken = 0) {
    const ground = world.threatAt(tile, unit, excludedEnemy);
    const air = world.airThreatAt ? world.airThreatAt(tile, unit, extraDamageTaken) : 0;
    return { ground, air, total: ground + air };
}

function threatCost(world, unit, tile, riskWeight = 1) {
    const w = world.weights || W;
    const { ground, air, total } = combinedThreatAt(world, tile, unit, null, 0);
    const pool = Math.max(1, unit.hp + (unit._shield || 0));
    const onKillLine = air > 0 && total * w.lethalThreatMargin >= pool;
    const incoming = ground + (onKillLine ? air : air * W.airThreatBackgroundWeight);
    if (incoming <= 0) return 0;
    const lossRatio = Math.min(1, incoming / pool);
    return lossRatio * residualGold(unit) * riskWeight
        + (onKillLine ? residualGold(unit) * (unit.commander ? 0.85 : 0.30) : 0);
}

/**
 * 决斗期望：近战贴脸不是"打一回合"，而是缠斗到一方倒下。
 * 按双方 DPS 折算整段交换的净值，避免把每回合的小亏叠加成送命。
 */
export function duelExpectation(world, attacker, target) {
    const combat = world.combat;
    const myDps = Math.max(1, combat.estimateDamage(attacker, target, target.tile));
    const theirDps = Math.max(0, combat.estimateCounterDamage(attacker, target));
    const targetPool = target.hp + (target._shield || 0);
    const myPool = attacker.hp + (attacker._shield || 0);
    const turnsToKill = Math.ceil(targetPool / myDps);
    const turnsToDie = theirDps > 0 ? Math.ceil(myPool / theirDps) : Infinity;
    if (turnsToKill <= turnsToDie) {
        // 我先杀掉它：收益 = 它的残余 − 缠斗中我挨的伤害。
        const taken = theirDps * Math.max(0, turnsToKill - 1);
        return residualGold(target) * 0.8 + myDps * hpGold(target) - taken * hpGold(attacker);
    }
    // 它先杀掉我：按阵亡概率扣我的残余。
    return residualGold(target) * 0.3 - residualGold(attacker) * 0.75;
}

/** 移动落点的"自动攻击"代价：贴脸即缠斗，用决斗期望预扣最亏的一场。 */
function autoAttackRisk(world, missionsCtx, unit, tile) {
    if (world.isImmobile(unit)) return 0;
    const range = Math.max(1, Number(unit.config?.range) || 1);
    let worst = 0;
    let bestGood = 0;
    for (const enemy of [...world.rivalUnits, ...world.neutralUnits]) {
        if (!enemy.tile || world.helpers.hexDistance(tile, enemy.tile) > range) continue;
        if (!isNeutralEngageable(world, missionsCtx, enemy)) continue;
        const value = duelExpectation(world, unit, enemy);
        if (value < worst) worst = value;
        if (value > bestGood) bestGood = value;
    }
    // 自动攻击选"看起来最好"的目标：存在正收益目标时按好的算，否则按最亏的预扣。
    return bestGood > 0 ? 0 : worst * 0.8;
}

export function evaluateAttack(world, missionsCtx, attacker, target) {
    const combat = world.combat;
    const damage = combat.estimateDamage(attacker, target, target.tile);
    const kills = damage >= target.hp + (target._shield || 0);
    const counter = kills ? 0 : combat.estimateCounterDamage(attacker, target);
    const isDoomed = Boolean(world._doomedUnitIds?.has(attacker.id));
    const fatalCounter = !kills && counter >= attacker.hp + (attacker.activeShield ?? attacker._shield ?? 0);
    const w = world.weights || W;
    const trade = isDoomed && !fatalCounter
        ? tradeNetValue({ damageDealt: damage, target, kills, counterDamage: counter * 0.15, attacker, weights: w })
        : tradeNetValue({ damageDealt: damage, target, kills, counterDamage: counter, attacker, weights: w });
    // 近战贴脸 = 缠斗承诺：困难档按整段决斗定价；但己方已确认本轮必死时只看当轮爆掉的价值。
    const meleeCommit = Math.max(1, Number(attacker.config?.range) || 1) <= 1;
    const net = meleeCommit && world.caps.duelModel && !isDoomed
        ? duelExpectation(world, attacker, target)
        : trade;
    const strategic = missionTargetBonus(world, missionsCtx, target, kills)
        + historicalAttackValue(world, attacker, target, damage, kills)
        + enemyCapturerPremium(world, target)
        + conversionBonus(world, attacker, target)
        + escortProtectionBonus(world, missionsCtx, attacker, target)
        + scoreTacticalRoleMatchup(attacker, target) * 0.3
        + (target.commander ? (w.commanderTargetFocusBonus ?? 30) : 0)
        + ((target._rank || 0) >= 3 ? 40 : 0); // 高 rank 王牌：放任不管会被它一个个点名
    // 攻击位置暴露成本：攻击完单位留在原地，敌方回合按当前位置的威胁预扣。
    // 这是"潜艇排队送岸防炮"的根因——单看交换不亏，但打完走不了。
    const { ground: incoming, air: airIncoming, total: totalIncoming } = combinedThreatAt(
        world, attacker.tile, attacker, kills ? target : null, counter
    );
    const hpPool = attacker.hp + (attacker.activeShield ?? attacker._shield ?? 0);
    const postCombatPool = Math.max(0, hpPool - counter);
    const airportKillzoneExposure = !isDoomed && !kills && airIncoming > 0 && postCombatPool <= airIncoming * W.airportExecuteMargin
        ? residualGold(attacker) * W.airportKillzoneRiskRatio
        : 0;
    const exposure = ((incoming + airIncoming * W.airThreatExposureWeight) * hpGold(attacker) * 0.4
        + airportKillzoneExposure) * (isDoomed ? 0.15 : 1);
    // 净交换否决：换血明显亏本、形不成击杀、且脱得了身时不打；必死破罐破摔局保留最后一轮输出机会。
    const canDisengage = Math.max(1, Number(attacker.config?.range) || 1) >= 2
        || Number(target.config?.speed) <= 0
        || Math.max(1, Number(target.config?.range) || 1) < world.helpers.hexDistance(attacker.tile, target.tile);
    const rearCommanderExposed = world.caps.rearCommanderSafety
        && REAR_COMMANDERS.has(attacker.commander)
        && !kills
        && totalIncoming >= attacker.hp * 0.35;
    const fatalCounterPenalty = isDoomed && fatalCounter
        ? residualGold(attacker) * W.doomedFatalCounterPenaltyRatio
        : 0;
    const assignment = missionsCtx.assignment.get(attacker.id);
    const hardToReplace = attacker.commander
        || (assignment?.occupierId === attacker.id
            && (assignment.kind === 'siege' || assignment.kind === 'garrison'));
    const capturesCityNow = kills && target.tile.isCity
        && target.camp !== world.myCamp
        && world.isCapturable(attacker);
    const holdingOwnCity = attacker.tile.isCity
        && attacker.tile.camp === world.myCamp
        && isOwnCityThreatened(world, attacker.tile);
    const decisiveClockBlow = world.caps.victoryClock
        && missionsCtx.missions.some(m => m.kind === 'siege' && m.decisive
            && target.tile.q === m.targetQ && target.tile.r === m.targetR);
    // 全回合反集火与反机场斩杀线：禁止将领或高星老兵为了击杀一名非关键外围敌军而停在下一动必死（地面+机场）格
    const criticalAsset = Boolean(attacker.commander) || (attacker._rank || 0) >= 2;
    // 激进前压只放行健康的前线搏杀型将领，绝不放行亡灵法师/军师/谋士等脆皮功能将领硬吃集火；
    // 即便开启 commanderRiskPush，非斩将/非夺城攻击也不可冲入当回合必死集火（留 0.92 生存底线）。
    const aggressiveAllowance = w.commanderRiskPush
        && !FRAGILE_COMMANDERS.has(attacker.commander)
        && attacker.hp >= attacker.maxHp * 0.55
        && (kills || target.commander || damage >= 45)
        && ((kills && target.commander) || postCombatPool > totalIncoming * 0.82);
    const suicidalCriticalExposure = world.caps.duelModel && criticalAsset
        && !holdingOwnCity
        && !target.commander
        && !capturesCityNow
        && !decisiveClockBlow
        && !aggressiveAllowance
        && postCombatPool <= totalIncoming * w.lethalThreatMargin;
    const losingCriticalUnit = world.caps.duelModel && hardToReplace && !kills
        && counter > 0 && trade < 0 && (counter + totalIncoming) * w.lethalThreatMargin >= hpPool;
    const capturerDistance = units => units.reduce((best, unit) =>
        isFieldCapturer(world, unit) ? Math.min(best, world.helpers.hexDistance(unit.tile, target.tile)) : best, Infinity);
    const giftsNeutralCity = kills && target.tile.isCity
        && target.camp === world.gameState.factions.neutral && !world.isCapturable(attacker)
        && capturerDistance(world.rivalUnits) <= 3
        && capturerDistance(world.rivalUnits) < capturerDistance(world.myUnits);
    const siegeCommitTarget = world.caps.opponentModeling && !FRAGILE_COMMANDERS.has(attacker.commander)
        && missionsCtx.missions.some(m => m.kind === 'siege'
            && world.helpers.hexDistance(target.tile, { q: m.targetQ, r: m.targetR }) <= 1
            && ((m.cityHp ?? 250) <= 160 || (m.garrisonHp ?? 180) <= 95 || m.decisive || m.clockCritical));
    const freeSafePoke = world.caps.opponentModeling && counter === 0 && damage > 0
        && !FRAGILE_COMMANDERS.has(attacker.commander) && !isStealthGuerrilla(attacker);
    const fragileEarlyCrossfire = world.caps.opponentModeling
        && FRAGILE_COMMANDERS.has(attacker.commander)
        && world.round <= 4
        && !target.commander
        && !capturesCityNow
        && !holdingOwnCity
        && totalIncoming > 0
        && world.rivalUnits.filter(e => e.tile && e.hp > 0 && world.helpers.hexDistance(e.tile, attacker.tile) <= 3).length >= 2
        && postCombatPool <= totalIncoming * 1.35;
    const hardFragileVeto = fragileEarlyCrossfire && postCombatPool <= totalIncoming * 1.10 && world.rivalCamps?.length <= 1;
    const fragileSoftPenalty = fragileEarlyCrossfire ? 42 : 0;
    const veto = (fatalCounter && !isDoomed)
        || (!isDoomed && !freeSafePoke && !siegeCommitTarget && (losingCriticalUnit || suicidalCriticalExposure
            || hardFragileVeto
            || (!kills && isRiskyNeutralAssault(world, attacker, target, counter, totalIncoming))
            || (!kills && canDisengage && net < -residualGold(attacker) * w.tradeVetoRatio)))
        || (!isDoomed && rearCommanderExposed)
        || giftsNeutralCity
        || damage <= 0;
    const counterEdge = world.caps.opponentModeling ? counterDamageBonus(attacker.type, target.type) : 0;
    const counterHuntBonus = (counterEdge >= 0.12 ? 14 : 0) + (siegeCommitTarget ? 22 : 0) + (freeSafePoke ? 10 : 0);
    const jitter = noiseJitter(world.caps, `atk:${world.round}:${attacker.id}:${target.id}`);
    return { target, damage, kills, counter, net, strategic: strategic + counterHuntBonus, veto, value: (net + strategic + counterHuntBonus - exposure - fatalCounterPenalty - fragileSoftPenalty) * jitter };
}

export function bestAttackFor(world, missionsCtx, unit) {
    if (!unit.canAct || !unit.tile) return null;
    const candidates = world.helpers.getAttackableTiles(unit)
        .filter(tile => tile.unit && tile.unit.camp !== world.myCamp && tile.unit.hp > 0)
        .map(tile => tile.unit)
        .filter(target => isNeutralEngageable(world, missionsCtx, target));
    if (candidates.length === 0) return null;
    const evaluated = candidates
        .map(target => evaluateAttack(world, missionsCtx, unit, target))
        .filter(entry => !entry.veto);
    evaluated.sort((a, b) => b.value - a.value);
    const best = evaluated[0] || null;
    return best && best.value > 0 ? best : null;
}

// ═══════════════════════════════════════════════════════════════
// 主动技能（先于攻击结算）
// ═══════════════════════════════════════════════════════════════

function withVirtualSkill(unit, patch, fn) {
    const saved = {};
    for (const key of Object.keys(patch)) saved[key] = unit[key];
    Object.assign(unit, patch);
    try {
        return fn();
    } finally {
        for (const key of Object.keys(patch)) unit[key] = saved[key];
    }
}

function withVirtualTile(unit, nextTile, fn) {
    const prevTile = unit.tile;
    if (!nextTile || nextTile === prevTile) return fn();
    const prevUnit = nextTile.unit;
    prevTile.unit = null;
    nextTile.unit = unit;
    unit.tile = nextTile;
    try {
        return fn();
    } finally {
        unit.tile = prevTile;
        prevTile.unit = unit;
        nextTile.unit = prevUnit;
    }
}

function qixueSplashSummary(world, unit, entry) {
    if (!entry?.target?.tile) return { hitCount: 0, value: 0, kills: 0 };
    const { qixueSplashMultiplier, qixueRange } = COMMANDER_CONFIG.berserker.balance;
    const splashDmg = entry.damage * qixueSplashMultiplier;
    let hitCount = 0;
    let value = 0;
    let kills = 0;
    for (const enemy of [...world.rivalUnits, ...world.neutralUnits]) {
        if (enemy === entry.target || !enemy.tile || enemy.hp <= 0) continue;
        if (!isNeutralEngageable(world, { missions: [], suppressNeutralEngagements: false }, enemy)) continue;
        if (world.helpers.hexDistance(entry.target.tile, enemy.tile) > qixueRange) continue;
        hitCount++;
        const pool = enemy.hp + (enemy.activeShield ?? enemy._shield ?? 0);
        value += Math.min(pool, splashDmg) * hpGold(enemy);
        if (splashDmg >= pool) {
            kills++;
            value += residualGold(enemy) * W.killPremiumRatio + (enemy.commander ? W.commanderKillBonus : 0);
        }
    }
    return { hitCount, value, kills };
}

function planActiveSkill(world, missionsCtx, unit, actions) {
    if (!unit.commander || !unit.canAct) return false;
    const attack = bestAttackFor(world, missionsCtx, unit);
    const hasWoundedAlly = world.myUnits.some(ally =>
        ally.id !== unit.id && ally.hp < ally.maxHp * 0.6
        && world.helpers.hexDistance(ally.tile, unit.tile) <= 2);
    if (unit.commander === 'berserker') {
        const { qixueHpCostPct } = COMMANDER_CONFIG.berserker.balance;
        const postQixueHp = Math.max(1, unit.hp - Math.round(unit.hp * qixueHpCostPct));
        const evaluateQixueFromCurrent = () => {
            const entry = bestAttackFor(world, missionsCtx, unit);
            if (!entry) return null;
            const splash = qixueSplashSummary(world, unit, entry);
            return { ...entry, splashHitCount: splash.hitCount, splashKills: splash.kills, splashValue: splash.value };
        };
        const qixueSafeAt = (tile, entry) => {
            if (world._doomedUnitIds?.has(unit.id) || entry.target.commander) return true;
            const postPool = postQixueHp + (unit.activeShield ?? unit._shield ?? 0) - (entry.counter || 0);
            const postThreat = combinedThreatAt(world, tile, unit, entry.kills ? entry.target : null, entry.counter || 0).total;
            return postThreat * W.lethalThreatMargin < postPool;
        };
        let buffedAttack = !unit._berserkerQixue
            ? withVirtualSkill(unit, { _berserkerQixue: true, hp: postQixueHp }, evaluateQixueFromCurrent)
            : (attack ? { ...attack, ...qixueSplashSummary(world, unit, attack), splashHitCount: qixueSplashSummary(world, unit, attack).hitCount } : null);
        // 若原地泣血后会把自己压入地面+机场联合斩杀线（非必死局且非高价值斩首将领），放弃原地自损。
        if (buffedAttack && !qixueSafeAt(unit.tile, buffedAttack)) buffedAttack = null;
        // 支持“先开泣血、再机动贴近收割”：若原地够不着敌军，预查本回合安全机动后能斩杀/砸将领+溅射的目标。
        if (!buffedAttack && !unit._berserkerQixue && !unit.isNewRecruit && !world.isImmobile(unit)) {
            let bestMoved = null;
            for (const tile of world.helpers.getMovableTiles(unit)) {
                if (!tile || tile === unit.tile || tile.unit || (tile.isCity && tile.camp !== world.myCamp)) continue;
                if (isLandBoundUnit(world, unit) && world.onWater(tile)) continue;
                const entry = withVirtualSkill(unit, { _berserkerQixue: true, hp: postQixueHp }, () =>
                    withVirtualTile(unit, tile, () => evaluateQixueFromCurrent()));
                if (!entry) continue;
                const safeAfterMove = qixueSafeAt(tile, entry)
                    || (entry.target.commander && combinedThreatAt(world, tile, unit, entry.kills ? entry.target : null, entry.counter || 0).total
                        < postQixueHp + (unit.activeShield ?? unit._shield ?? 0));
                if (!safeAfterMove) continue;
                const totalValue = entry.value + entry.splashValue;
                if (totalValue > 20 && (!bestMoved || totalValue > bestMoved.totalValue)) {
                    bestMoved = { ...entry, totalValue };
                }
            }
            buffedAttack = bestMoved;
        }
        const effectiveAttack = buffedAttack || attack;
        // 泣血 + 治疗预算：有疗愈/牧师托底，或能砍到将领/多目标溅射收益时，果断卖血爆发。
        const healBacked = world.hand.includes('heal')
            || world.myUnits.some(ally => ally.commander === 'priest' && ally.canAct
                && world.helpers.hexDistance(ally.tile, unit.tile) <= 3);
        const convertsToKill = !!(effectiveAttack && (effectiveAttack.kills || effectiveAttack.splashKills > 0));
        const hasClusterSplash = !!(effectiveAttack && (effectiveAttack.splashHitCount || 0) >= 1 && (effectiveAttack.splashValue || 0) >= 10);
        const worthIt = effectiveAttack && (convertsToKill
            || effectiveAttack.target.commander
            || hasClusterSplash
            || effectiveAttack.strategic > 20);
        const abortWhileRetreating = shouldRetreat(world, unit, missionsCtx) && !convertsToKill;
        if (!abortWhileRetreating && effectiveAttack && shouldSpendBerserkerBlood({
            hpRatio: unit.hp / unit.maxHp,
            convertsToKill,
            highValueTarget: !!(worthIt && (healBacked || effectiveAttack.target.commander || hasClusterSplash)),
            outnumbered: strategyForceRatio(world) < 0.7
        }) && shouldPlanActiveSkill(unit, { hasAttackTarget: true })) {
            actions.push({ type: 'activateSkill', unitId: unit.id });
            return true;
        }
        return false;
    }
    if (unit.commander === 'astrologer') {
        if ((unit.activeSkillCD || 0) > 0 || (unit.activeSkillDur || 0) > 0) return false;
        // 天气决策：敌方有活跃机场时可锁雾天停飞；否则按己方兵种构成决定要什么天，后方占星者无需自身有攻击目标。
        const cavalry = world.myUnits.filter(u => getUnitBaseType(u) === 'cavalry').length;
        const archers = world.myUnits.filter(u => getUnitBaseType(u) === 'archer').length;
        const hasHostileAir = (world.hostileAirfields?.length || 0) > 0;
        const targetWeather = (hasHostileAir && archers < 2) || (cavalry >= 2 && cavalry > archers) ? 'fog'
            : archers >= 2 ? 'wind' : 'clear';
        const enemyInAura = world.rivalUnits.some(e => e.tile && world.helpers.hexDistance(unit.tile, e.tile) <= 3);
        const armyEngaged = Boolean(attack) || enemyInAura
            || world.myUnits.some(ally => ally.canAct && bestAttackFor(world, missionsCtx, ally) !== null);
        if ((targetWeather !== world.weather || enemyInAura) && armyEngaged) {
            actions.push({ type: 'activateSkill', unitId: unit.id, targetWeather });
            return true;
        }
        return false;
    }
    let paladinBuffedAttack = null;
    if (unit.commander === 'paladin' && (unit.activeSkillCD || 0) <= 0 && !unit._smiteCharged && Number(unit._faith || 0) >= 1) {
        const canDoubleCharge = (!unit._smiteReady && Number(unit._faith || 0) >= 2)
            || (unit._smiteReady && Number(unit._faith || 0) >= 1);
        const evalPaladinAtCurrent = () => withVirtualSkill(unit, {
            _smiteReady: true,
            _smiteCharged: Boolean(unit._smiteCharged || canDoubleCharge)
        }, () => bestAttackFor(world, missionsCtx, unit));
        paladinBuffedAttack = evalPaladinAtCurrent();
        if (!paladinBuffedAttack && !unit.isNewRecruit && !world.isImmobile(unit)) {
            for (const tile of world.helpers.getMovableTiles(unit)) {
                if (!tile || tile === unit.tile || tile.unit || (tile.isCity && tile.camp !== world.myCamp)) continue;
                if (isLandBoundUnit(world, unit) && world.onWater(tile)) continue;
                const movedEntry = withVirtualTile(unit, tile, evalPaladinAtCurrent);
                if (movedEntry && (!paladinBuffedAttack || movedEntry.value > paladinBuffedAttack.value)) {
                    paladinBuffedAttack = movedEntry;
                }
            }
        }
        if (unit._smiteReady && !unit._smiteCharged && Number(unit._faith || 0) >= 1 && paladinBuffedAttack) {
            const singleEntry = withVirtualSkill(unit, { _smiteReady: true, _smiteCharged: false }, () =>
                bestAttackFor(world, missionsCtx, unit)) || paladinBuffedAttack;
            if (!singleEntry.kills || paladinBuffedAttack.target?.commander) {
                actions.push({ type: 'activateSkill', unitId: unit.id });
                return true;
            }
        }
    }
    if (shouldPlanActiveSkill(unit, { hasAttackTarget: !!(attack || paladinBuffedAttack), hasWoundedAlly })) {
        actions.push({ type: 'activateSkill', unitId: unit.id });
        if (unit.commander === 'paladin' && !unit._smiteReady && Number(unit._faith || 0) >= 2 && paladinBuffedAttack) {
            const singleEntry = withVirtualSkill(unit, { _smiteReady: true, _smiteCharged: false }, () =>
                bestAttackFor(world, missionsCtx, unit));
            if (!singleEntry?.kills || paladinBuffedAttack.target?.commander) {
                actions.push({ type: 'activateSkill', unitId: unit.id });
            }
        }
        return true;
    }
    return false;
}

function strategyForceRatio(world) {
    return world.ownForceValue / Math.max(1, world.rivalForceEstimate);
}

// ═══════════════════════════════════════════════════════════════
// 移动评估
// ═══════════════════════════════════════════════════════════════

function missionMoveBonus(world, missionsCtx, unit, tile, posture = 'expand') {
    const mission = missionsCtx.assignment.get(unit.id);
    if (!mission) return { bonus: 0, mission: null };
    const helpers = world.helpers;
    const target = world.tileMap.get(`${mission.targetQ},${mission.targetR}`);
    if (!target) return { bonus: 0, mission };
    const distanceBetween = !world.isNaval(unit) && world.navDistance
        ? world.navDistance
        : helpers.hexDistance;
    const currentDistance = distanceBetween(unit.tile, target);
    const newDistance = distanceBetween(tile, target);
    // 死斗姿态的任务推进翻倍：宣言死斗却无人到位，等于没宣言。
    const postureBoost = posture === 'allin' ? 2 : 1;

    if (mission.kind === 'garrison') {
        // 驻城收益由原地评分计入，离城的候选不继承这笔收益。
        if (unit.tile === target) return { bonus: 0, mission };
        return { bonus: (currentDistance - newDistance) * 50 + (tile === target ? 300 : 0), mission };
    }
    if (mission.kind === 'siege') {
        const isOccupier = unit.id === mission.occupierId;
        const city = world.cities.find(c => c.tile.q === mission.targetQ && c.tile.r === mission.targetR);
        const value = mission.cityValue || 120;
        const garrisonAlive = !!(city?.garrison && city.garrison.camp !== world.myCamp);
        // 停滞系数：任务每停滞一回合，推进欲望放大 18%（上限 ×2.4）。
        // "等护航清场"是正确的，但等一辈子就等于放弃胜利条件。只放大推进项，不放大风险项。
        const stalled = Math.max(0, world.round - (mission.createdRound ?? world.round));
        const stallBoost = 1 + Math.min(2.4, stalled * 0.18);
        // 守军未清时：占领者不贴脸（站城下每回合白挨守军打），推进奖励减半、
        // 贴身加成取消——等护航清出破口再进。守军已死或城防归零时全速进城。
        const progressScale = isOccupier && garrisonAlive && currentDistance <= 2 && newDistance <= 1 ? 0.45 : 1;
        const w = world.weights || W;
        let bonus = (currentDistance - newDistance) * value * w.siegeEtaTickRatio * (isOccupier ? 1.6 : 1.15) * progressScale * stallBoost * postureBoost;
        // 占领者到位：空城可进、破门可驻。
        if (isOccupier && tile === target && city && !garrisonAlive && city.hp <= 0) bonus += value * stallBoost;
        if (isOccupier && newDistance <= 1 && city && !garrisonAlive) bonus += value * 0.15;
        // 护航：优先进入目标射程火力压制；落后于占领者较远时才追加跟进分。
        if (!isOccupier) {
            const fireRange = Math.max(1, Number(unit.getEffectiveRange?.() ?? unit.config?.range) || 1);
            if (newDistance <= fireRange && currentDistance > fireRange) bonus += 24;
            if (mission.occupierId != null) {
                const occupier = world.myUnits.find(u => u.id === mission.occupierId);
                if (occupier && distanceBetween(occupier.tile, target) <= currentDistance) {
                    const prevEscortDist = helpers.hexDistance(unit.tile, occupier.tile);
                    const nextEscortDist = helpers.hexDistance(tile, occupier.tile);
                    if (prevEscortDist > 2) bonus += (prevEscortDist - nextEscortDist) * 12;
                }
            }
        }
        // 运输中的占领者：风险按威胁比例计价，停滞 6 回合后折价放行——
        // "等登陆窗口"不能等成终身禁航。
        if (isOccupier && world.onWater(tile) && !world.isNaval(unit)) {
            const seaThreat = world.threatAt(tile, unit);
            const needsSeaCrossing = !!world.captureRoute?.(unit, target)?.landing;
            const seaPenalty = seaThreat > 0
                ? Math.min(90, seaThreat * hpGold(unit) * 2.5)
                : needsSeaCrossing ? 0 : value * W.transportRiskRatio;
            bonus -= stalled >= 6 ? seaPenalty * 0.4 : seaPenalty;
        }
        return { bonus, mission };
    }
    if (mission.kind === 'intercept') {
        const targetUnit = world.rivalUnits.find(u => u.id === mission.targetUnitId);
        if (!targetUnit) return { bonus: 0, mission };
        const close = helpers.hexDistance(unit.tile, targetUnit.tile) - helpers.hexDistance(tile, targetUnit.tile);
        return { bonus: close * 40 + (helpers.hexDistance(tile, targetUnit.tile) <= Math.max(1, unit.config?.range || 1) ? 60 : 0), mission };
    }
    if (mission.kind === 'scout') {
        let unknown = 0;
        for (const [dq, dr] of helpers.HEX_NEIGHBORS) {
            const neighbor = world.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (neighbor && !world.explored(neighbor)) unknown++;
        }
        return {
            bonus: (currentDistance - newDistance) * 18 + unknown * W.scoutValuePerUnknown * (1 + world.stalestRivalAge * 0.25),
            mission
        };
    }
    return { bonus: 0, mission };
}

/** 进驻收益：走进空城/港口/村庄。 */
function captureTileBonus(world, unit, tile) {
    let bonus = 0;
    if (tile.isCity && !tile.unit && tile.hp <= 0 && tile.camp !== world.myCamp
        && world.isCapturable(unit)) {
        const city = world.cities.find(c => c.tile === tile);
        bonus += (city?.asset.total || 120);
    }
    if (tile.isPort && tile.camp !== world.myCamp && (!isLandBoundUnit(world, unit) || world.oceanMap)) {
        bonus += world.oceanMap ? W.portValueOcean : W.portValueLand;
    }
    if (tile.isVillage && tile.camp !== world.myCamp) {
        bonus += W.villageValue;
    }
    // 回到受威胁的己方城市驻守（无威胁的后方空城不吸走前线兵力，也不抢尚书返城位）。
    if (tile.isCity && tile.camp === world.myCamp && !tile.unit && world.isCapturable(unit)
        && isOwnCityThreatened(world, tile) && !isReservedForMinisterReturn(world, tile)) {
        bonus += 26;
    }
    // 无人驻守的高射机枪阵地不提供防空：敌方有活跃机场时，踩住己方防空阵地或上校入驻机场提供防空/制空加成。
    if ((world.hostileAirfields?.length || 0) > 0 && tile.fortification === 'flak' && !tile.unit) {
        bonus += tile.isCity && tile.camp === world.myCamp ? 24 : 12;
    }
    if (unit.commander === 'colonel' && tile.isCity && tile.camp === world.myCamp
        && tile.installation?.type === 'airfield' && !tile.unit && !isReservedForMinisterReturn(world, tile)) {
        bonus += 55;
    }
    // 平时无守城任务且未受威胁时，避免非尚书/非驻机场上校部队走回自家空城占住产能格。
    if (tile.isCity && tile.camp === world.myCamp && !tile.unit
        && unit.commander !== 'minister'
        && !(unit.commander === 'colonel' && tile.installation?.type === 'airfield')
        && !isOwnCityThreatened(world, tile)) {
        bonus -= 35;
    }
    return bonus;
}

function isReservedForMinisterReturn(world, tile) {
    const plan = world.gameState._aiCoreMemory?.[world.myCampKey]?.ministerReturn;
    return !!(plan && plan.cityQ === tile.q && plan.cityR === tile.r);
}

function isOwnCityThreatened(world, cityTile) {
    return world.threatAt(cityTile, cityTile.unit) > 0
        || Boolean(world.exposedAirdropCityKeys?.has(`${cityTile.q},${cityTile.r}`))
        || world.rivalUnits.some(enemy => enemy.tile && world.helpers.hexDistance(enemy.tile, cityTile) <= 3);
}

function guerrillaMaxLandSteps(unit, mp = Number(unit?.remainingMP ?? unit?.config?.speed ?? 5)) {
    if (unit?.type !== 'cpc_guerrilla') return Math.max(2, Math.floor(mp / 2));
    return Math.max(0, Math.floor(mp));
}

function effectiveSiteOwner(world, tile) {
    if (!tile) return null;
    if (tile.isVillage && !tile.unit) {
        const districtId = tile.villageDistrictId ?? tile.districtId;
        const city = world.cities.find(c => c.tile.districtId === districtId);
        if (city) return city.tile.camp;
    }
    return tile.camp;
}

function moveMpCost(world, unit, tile) {
    if (!unit?.tile || !tile || tile === unit.tile) return 0;
    const entry = world.gameState?.moveParents?.get?.(tile);
    const startMp = Number(unit.remainingMP ?? unit.config?.speed ?? 0);
    if (entry && Number.isFinite(entry.remaining)) {
        return Math.max(0, startMp - entry.remaining);
    }
    return world.helpers.hexDistance(unit.tile, tile) * (unit.type === 'cpc_guerrilla' ? 1 : 2);
}

function remainingMpAfterMove(world, unit, tile) {
    if (!unit?.tile || !tile) return 0;
    if (tile === unit.tile) return Number(unit.remainingMP ?? unit.config?.speed ?? 0);
    if (tile.isCity && !unit._isDrone) return 0;
    const entry = world.gameState?.moveParents?.get?.(tile);
    if (entry && Number.isFinite(entry.remaining)) return Math.max(0, entry.remaining);
    const startMp = Number(unit.remainingMP ?? unit.config?.speed ?? 0);
    return Math.max(0, startMp - moveMpCost(world, unit, tile));
}

function isGuerrillaUndetectedAt(world, unit, tile) {
    if (!isStealthGuerrilla(unit) || world.onWater(tile)) return false;
    const distance = world.helpers.hexDistance;
    for (const enemy of [...world.rivalUnits, ...world.neutralUnits]) {
        if (!enemy.tile || enemy.hp <= 0) continue;
        const revealRadius = enemy.type === 'gb_battleship'
            && getActiveCultureId(world.gameState, enemy.camp) === 'gb'
            ? STEALTH_VISIBILITY_RULES.submarineDetectorRadius
            : STEALTH_VISIBILITY_RULES.guerrillaRevealRadius;
        if (distance(enemy.tile, tile) <= revealRadius) return false;
    }
    return true;
}

/**
 * 推断敌方可能忽略的地图盲区目标：
 * 优先选择敌方防守空虚（周围 2 格内敌军 ≤ 1）且偏离敌军主力重心的敌方/中立据点或落单后排；
 * 不被己方行政区村庄或后方遥远中立点拉回自家后院。
 */
function inferGuerrillaBlindSpotTarget(world, unit) {
    if (unit?.type !== 'cpc_guerrilla' || !unit.tile) return null;
    const distance = !world.isNaval(unit) && world.navDistance ? world.navDistance : world.helpers.hexDistance;
    const hexDist = world.helpers.hexDistance;
    const rivals = world.rivalUnits.filter(e => e.tile && e.hp > 0);
    const centroid = rivals.length > 0
        ? {
            q: rivals.reduce((sum, e) => sum + e.tile.q, 0) / rivals.length,
            r: rivals.reduce((sum, e) => sum + e.tile.r, 0) / rivals.length
        }
        : null;
    const enemyGuardsNear = (targetTile, excludedUnit = null) => rivals.filter(enemy =>
        enemy !== excludedUnit && hexDist(enemy.tile, targetTile) <= 2).length;
    const flankBonus = (targetTile, isEnemyAsset) => {
        if (!centroid) return 0;
        const dq = targetTile.q - centroid.q;
        const dr = targetTile.r - centroid.r;
        const distFromCentroid = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
        if (!isEnemyAsset && distFromCentroid > 5) return 0;
        return Math.min(20, distFromCentroid * 3);
    };

    let best = null;
    for (const tile of world.tiles) {
        if (world.onWater(tile)) continue;
        let baseValue = 0;
        let guards = 0;
        let isEnemyAsset = false;
        const owner = effectiveSiteOwner(world, tile);
        if ((tile.isCity || tile.isVillage || tile.isPort) && owner !== world.myCamp) {
            const rivalOwned = world.rivalFactions.includes(owner);
            const travelDistCheck = distance(unit.tile, tile);
            if (tile.isPort && !rivalOwned) continue;
            if (tile.isVillage && !rivalOwned && travelDistCheck > 7) continue;
            guards = enemyGuardsNear(tile);
            if (guards >= 2) continue;
            isEnemyAsset = rivalOwned;
            if (tile.isCity) {
                baseValue = !tile.unit && tile.hp <= 0 ? 125 : !tile.unit ? 88 : 65;
            } else if (tile.isVillage) {
                baseValue = (rivalOwned ? 74 : 56) + (world.gameState.skirmishFog ? 12 : 0);
            } else {
                baseValue = 54;
            }
        } else if (tile.unit && rivals.includes(tile.unit)) {
            const enemy = tile.unit;
            guards = enemyGuardsNear(tile, enemy);
            if (guards >= 2) continue;
            const isBackline = getUnitBaseType(enemy) === 'archer' || !!enemy.commander || enemy.hp < enemy.maxHp * 0.78;
            if (!isBackline && guards > 0) continue;
            isEnemyAsset = true;
            baseValue = 82 + (1 - enemy.hp / Math.max(1, enemy.maxHp)) * 45 + (enemy.commander ? 26 : 0);
        } else {
            continue;
        }
        const travelDist = distance(unit.tile, tile);
        const score = baseValue + flankBonus(tile, isEnemyAsset) - guards * 32 - travelDist * 6.0;
        if (!best || score > best.score) {
            best = { tile, score, guards };
        }
    }
    return best && best.score > 24 ? best : null;
}

function scoreGuerrillaBlindSpotPosition(world, unit, tile) {
    if (unit?.type !== 'cpc_guerrilla' || !tile || world.onWater(tile)) return 0;
    const hexDist = world.helpers.hexDistance;
    // 游击纵队全陆地地形步耗恒为 1 MP（js/gameLogic.js），满移动力下回合可推进 5 步直接近战奇袭。
    const maxPounceDist = Math.max(2, guerrillaMaxLandSteps(unit, Number(unit.config?.speed) || 5));
    const undetected = isGuerrillaUndetectedAt(world, unit, tile);
    let score = 0;
    if (undetected) {
        // 隐匿潜伏窗口：距离孤立敌军、敌方后排或空虚据点 2~maxPounceDist 格时提前入隐匿；
        // 更远的格位应省下 2 MP 先行全速接近，避免过早隐匿白白消耗回合。
        let bestAmbushWindow = 0;
        for (const enemy of world.rivalUnits) {
            if (!enemy.tile || enemy.hp <= 0) continue;
            const d = hexDist(tile, enemy.tile);
            if (d < 2 || d > maxPounceDist) continue;
            const isolated = !world.rivalUnits.some(other => other !== enemy && other.tile && hexDist(other.tile, enemy.tile) === 1);
            const highValue = getUnitBaseType(enemy) === 'archer' || !!enemy.commander || enemy.hp < enemy.maxHp * 0.8;
            const rangeBonus = d <= 3 ? 6 : 0;
            const windowScore = 14 + (isolated ? 8 : 0) + (highValue ? 6 : 0) + rangeBonus;
            if (windowScore > bestAmbushWindow) bestAmbushWindow = windowScore;
        }
        for (const city of world.cities) {
            if (!city.hostile) continue;
            const d = hexDist(tile, city.tile);
            if (d >= 2 && d <= maxPounceDist && !world.rivalUnits.some(e => e.tile && hexDist(e.tile, city.tile) <= 1)) {
                bestAmbushWindow = Math.max(bestAmbushWindow, d <= 3 ? 20 : 14);
            }
        }
        score += bestAmbushWindow;
    } else if (!tile.unit && world.rivalUnits.some(e => e.tile && hexDist(e.tile, tile) === 1)) {
        // 无本轮奇袭收益时避免主动贴到敌军 1 格显形圈内暴露行踪。
        score -= 14;
    }
    return score;
}

/** 攻击位潜力：站到这格后能否打出有价值的攻击（近似：按射程圈算）。 */
function attackPotential(world, missionsCtx, unit, tile) {
    const range = Math.max(1, Number(unit.config?.range) || 1);
    if (range <= 1 && !world.isCapturable(unit)) return 0;
    const evaluateAtTile = () => withVirtualTile(unit, tile, () => {
        let best = 0;
        for (const enemy of [...world.rivalUnits, ...world.neutralUnits]) {
            if (!enemy.tile) continue;
            if (world.helpers.hexDistance(tile, enemy.tile) > range) continue;
            if (!isNeutralEngageable(world, missionsCtx, enemy)) continue;
            const entry = evaluateAttack(world, missionsCtx, unit, enemy);
            if (!entry.veto) best = Math.max(best, entry.value);
        }
        return best * 0.55; // 落点潜在收益打折；以虚拟站位评估真实暴露与反击。
    });
    if (unit.commander === 'paladin' && (unit.activeSkillCD || 0) <= 0
        && (unit._smiteReady || Number(unit._faith || 0) >= 1)) {
        return withVirtualSkill(unit, {
            _smiteReady: true,
            _smiteCharged: Boolean(unit._smiteCharged || Number(unit._faith || 0) >= 2)
        }, evaluateAtTile);
    }
    return evaluateAtTile();
}

function shouldRetreat(world, unit, missionsCtx = null) {
    if (!unit.tile) return false;
    if (unit._specializationAttackSpent && unit.canAct && Number(unit.remainingMP || 0) > 0) {
        return combinedThreatAt(world, unit.tile, unit, null, 0).total > 0;
    }
    if (missionsCtx && shouldHoldCityPosition(world, unit, missionsCtx.assignment?.get(unit.id))) {
        return false;
    }
    const pool = unit.hp + (unit.activeShield ?? unit._shield ?? 0);
    const { ground: incoming, total: totalThreat } = combinedThreatAt(world, unit.tile, unit, null, 0);
    const criticalAsset = !!unit.commander || (unit._rank || 0) >= 2;
    // 多重岸防/集火及敌方机场斩杀陷阱规避：海军或核心王牌只要地面+空袭预期承伤逼近总血池即提前撤离
    const crossfireMul = world.caps.opponentModeling ? 1.28 : W.lethalCrossfireRetreatRatio;
    if ((world.isNaval(unit) || criticalAsset) && totalThreat >= pool * crossfireMul) {
        return true;
    }
    // 必死规避：当前位置下回合预期承伤（含机场执行线）>= 总血池时提前脱险
    if ((totalThreat >= pool && (pool < unit.maxHp * 0.7 || !!unit.commander))
        || (incoming >= pool && pool < unit.maxHp * 0.7)) return true;
    const hpRatio = unit.hp / unit.maxHp;
    const wRetreat = world.weights || W;
    const navalRetreatRatio = world.caps.opponentModeling
        ? Math.min(0.42, wRetreat.navalRetreatHpRatio ?? 0.42)
        : (wRetreat.navalRetreatHpRatio ?? 0.58);
    // 受伤的主力将领/老兵舰船在重压下脱离战场回港维修（激进流派敢压更低血线再撤）。
    if (world.isNaval(unit) && criticalAsset && hpRatio < navalRetreatRatio && incoming >= pool * 0.55) {
        return true;
    }
    const w = world.weights || W;
    // 高 rank 老兵按将领级保护：一个 rank2+ 单位是两倍身家的资产。
    const veteran = (unit._rank || 0) >= 2;
    const threshold = FRAGILE_COMMANDERS.has(unit.commander) ? 0.52
        : unit.commander || veteran ? w.retreatHpRatioCommander : w.retreatHpRatio;
    if (hpRatio >= threshold) return false;
    if (world.caps.opponentModeling) {
        return incoming > 0 && (incoming >= unit.hp * 0.68 || (hpRatio < threshold * 0.7 && incoming >= unit.hp * 0.30));
    }
    return incoming > 0 && (incoming >= unit.hp * 0.5 || hpRatio < threshold * 0.7);
}

function planMove(world, missionsCtx, unit, posture, actions, { captureObjective = null, stageOnLand = false } = {}) {
    if (!unit.canAct || !unit.tile || world.isImmobile(unit)) return false;
    if (unit._transportTransitionedThisTurn || shouldReserveCityGarrison(world, unit)) return false;
    const movable = world.helpers.getMovableTiles(unit);
    if (movable.length === 0) return false;

    const mission = missionsCtx.assignment.get(unit.id) || null;
    const retreating = shouldRetreat(world, unit, missionsCtx);
    if (captureObjective && retreating) return false;
    const distance = world.navDistance || world.helpers.hexDistance;
    const distanceToObjective = captureObjective ? distance(unit.tile, captureObjective) : 0;
    const landBound = isLandBoundUnit(world, unit);
    const doomed = Boolean(world._doomedUnitIds?.has(unit.id));
    const seaTarget = world.captureRoute && mission?.kind === 'siege' && mission.occupierId === unit.id
        ? world.tileMap.get(`${mission.targetQ},${mission.targetR}`) : null;
    const seaRoute = seaTarget && world.captureRoute(unit, seaTarget);
    const missionTargetTile = mission?.kind === 'siege'
        ? world.tileMap.get(`${mission.targetQ},${mission.targetR}`)
        : null;
    const occupier = mission?.kind === 'siege' && mission.occupierId !== unit.id
        ? world.myUnits.find(u => u.id === mission.occupierId)
        : null;
    const activeSeaCrossing = Boolean(
        world.oceanMap && !retreating && mission?.kind === 'siege'
        && !REAR_COMMANDERS.has(unit.commander) && unit.commander !== 'advisor'
        && (seaRoute?.landing || (occupier && missionTargetTile && !FRAGILE_COMMANDERS.has(unit.commander)
            && world.captureRoute?.(occupier, missionTargetTile)?.landing))
    );
    const pool = unit.hp + (unit.activeShield ?? unit._shield ?? 0);
    const safeLand = tile => !world.onWater(tile)
        && combinedThreatAt(world, tile, unit, null, 0).total * W.lethalThreatMargin < pool;
    const canStayAshore = landBound && !activeSeaCrossing
        && (safeLand(unit.tile) || movable.some(tile => !tile.unit && safeLand(tile)));
    const mustDisembark = landBound && world.onWater(unit.tile) && !activeSeaCrossing
        && movable.some(tile => !tile.unit && !world.onWater(tile));
    const shouldLand = (canStayAshore || mustDisembark) && world.onWater(unit.tile);
    const protectCommander = world.caps.rearCommanderSafety && Boolean(unit.commander);
    const currentThreat = protectCommander ? combinedThreatAt(world, unit.tile, unit, null, 0).total : 0;
    const neutralObjective = world.caps.duelModel && mission?.kind === 'siege'
        && mission.occupierId === unit.id
        ? world.cities.find(city => city.ownerKey === 'neutral'
            && city.tile.q === mission.targetQ && city.tile.r === mission.targetR)
        : null;
    // 风险权重：占领者为兑现城市资产敢冒险；散兵没有对冲收益，必须惜命；
    // 高 rank 老兵额外惜命（rank2+ 是双倍资产）。
    const veteran = (unit._rank || 0) >= 2;
    const w = world.weights || W;
    const riskWeight = (mission && unit.id === mission.occupierId ? 0.65 : mission ? 1.0 : 1.6)
        * (w.riskWeightScale ?? 1)
        * (FRAGILE_COMMANDERS.has(unit.commander) ? 1.6 : 1)
        * (world.caps.rearCommanderSafety && REAR_COMMANDERS.has(unit.commander)
            ? w.rearCommanderRiskMultiplier : 1)
        * (veteran ? 1.35 : 1)
        * (posture === 'allin' ? 0.7 : 1)
        * (posture === 'hold' && (!mission || mission.kind !== 'garrison') ? 1.25 : 1);
    const poisonedAllies = world.myUnits.filter(ally => ally._poison);
    const rallyPoint = !mission ? primaryRallyPoint(world, missionsCtx) : null;
    const guerrillaBlindSpot = unit.type === 'cpc_guerrilla'
        ? inferGuerrillaBlindSpotTarget(world, unit)
        : null;
    const applyBlindSpotPull = !!guerrillaBlindSpot && (
        !mission
        || (mission.kind === 'siege' && mission.occupierId !== unit.id && missionTargetTile
            && world.helpers.hexDistance(missionTargetTile, guerrillaBlindSpot.tile) <= 4)
    );

    let bestTile = null;
    let bestScore = (retreating && !doomed) || shouldLand ? -Infinity : scoreOfStaying(world, missionsCtx, unit, mission)
        + historicalPositionValue(world, unit, unit.tile);
    for (const tile of movable) {
        if (tile.unit && (!world.isUnitVisible || world.isUnitVisible(tile.unit))) continue;
        if (seaTarget && (world.onWater(unit.tile) || world.onWater(tile)) && !safeApproachTile(world, unit, tile)) continue;
        if (seaTarget && world.onWater(tile)) {
            const next = world.captureRoute(unit, seaTarget, tile);
            if (!retreating && (!seaRoute?.landing || !next || next.turns >= seaRoute.turns)) continue;
        }
        if (stageOnLand && world.onWater(tile)) continue;
        if (landBound && !activeSeaCrossing && (!world.onWater(unit.tile) || retreating) && world.onWater(tile)) continue;
        if (canStayAshore && world.onWater(tile)) continue;
        if (shouldLand && (canStayAshore ? !safeLand(tile) : world.onWater(tile))) continue;
        if (captureObjective && (distance(tile, captureObjective) >= distanceToObjective
            || world.threatAt(tile, unit) >= unit.hp + (unit._shield || 0))) continue;
        if (protectCommander && !retreating && tile !== captureObjective) {
            const incoming = combinedThreatAt(world, tile, unit, null, 0).total;
            const poolHere = unit.hp + (unit._shield || 0);
            const allowPush = w.commanderRiskPush
                && !FRAGILE_COMMANDERS.has(unit.commander)
                && unit.commander !== 'colonel'
                && unit.hp >= unit.maxHp * 0.55
                && attackPotential(world, missionsCtx, unit, tile) > 0
                && incoming < poolHere * 0.92;
            if (!allowPush && incoming > currentThreat
                && incoming * w.lethalThreatMargin >= poolHere) continue;
        }
        if (neutralObjective && tile !== neutralObjective.tile && !w.allowRiskySiege
            && !retreating && world.helpers.hexDistance(tile, neutralObjective.tile) <= 1
            && world.threatAt(tile, unit) >= unit.hp + (unit._shield || 0)) continue;
        const missionScore = missionMoveBonus(world, missionsCtx, unit, tile, posture);
        const potentialAtTile = attackPotential(world, missionsCtx, unit, tile);
        let score = missionScore.bonus
            + captureTileBonus(world, unit, tile)
            + historicalPositionValue(world, unit, tile)
            + potentialAtTile;
        if (landBound && world.onWater(unit.tile) && world.onWater(tile) && !activeSeaCrossing) {
            const landDistNow = nearestLandDistance(world, unit.tile);
            const landDistNext = nearestLandDistance(world, tile);
            if (Number.isFinite(landDistNow) && Number.isFinite(landDistNext)) {
                score += (landDistNow - landDistNext) * 28;
            }
        }
        // 游击纵队：散兵或战区附近护航时，向推断出的敌方防守盲区/侧翼迂回渗透。
        if (applyBlindSpotPull) {
            const pathDist = !world.isNaval(unit) && world.navDistance
                ? world.navDistance
                : world.helpers.hexDistance;
            const nowDist = pathDist(unit.tile, guerrillaBlindSpot.tile);
            const nextDist = pathDist(tile, guerrillaBlindSpot.tile);
            score += Math.max(-20, Math.min(30, (nowDist - nextDist) * 12));
        }
        // 散兵：有攻城任务时向占领者集结，否则向最近敌对城市缓慢施压。
        if (!mission) {
            const pathDist = !world.isNaval(unit) && world.navDistance
                ? world.navDistance
                : world.helpers.hexDistance;
            if (rallyPoint) {
                const now = pathDist(unit.tile, rallyPoint);
                const next = pathDist(tile, rallyPoint);
                score += Math.max(-40, Math.min(40, (now - next) * 8));
            } else {
                const nearestHostile = nearestHostileCity(world, tile, unit);
                const fromHere = nearestHostileCity(world, unit.tile, unit);
                if (nearestHostile != null && fromHere != null) {
                    score += Math.max(-16, Math.min(16, (fromHere - nearestHostile) * 4));
                }
            }
        }
        // 威胁暴露（按残余价值比例计价）+ 落点自动攻击的预扣。
        // 游击纵队若能在落点保持隐匿且不被敌方侦测，敌方回合无法锁定它，暴露风险大幅折减。
        const stealthProtected = unit.type === 'cpc_guerrilla'
            && isGuerrillaUndetectedAt(world, unit, tile)
            && potentialAtTile <= 0;
        score -= threatCost(world, unit, tile, stealthProtected ? riskWeight * 0.2 : riskWeight);
        score += autoAttackRisk(world, missionsCtx, unit, tile);
        if (blocksOccupierSeaLane(world, missionsCtx, unit, tile)) score -= 45;
        // 中毒疏散：别贴着中毒友军挤成一团（守城者例外）。
        for (const ally of poisonedAllies) {
            if (ally.id === unit.id) continue;
            if (world.helpers.hexDistance(tile, ally.tile) <= 1) {
                score -= unit.tile.isCity && tile === unit.tile ? 0 : 16;
            }
        }
        if (retreating) {
            const threat = combinedThreatAt(world, tile, unit, null, 0).total;
            const ports = (world.isNaval(unit) || unit.type === 'us_marine') ? world.tiles.filter(port =>
                isPortOperationalFor(port, world.myCamp, world.gameState) && (!port.unit || port.unit === unit)) : [];
            const ownsRecoverySite = !world.isNaval(unit) && !isReservedForMinisterReturn(world, tile)
                && ((tile.isCity && tile.camp === world.myCamp)
                    || (tile.isVillage && effectiveSiteOwner(world, tile) === world.myCamp));
            const holdsThreatenedOwnCity = !world.isNaval(unit) && world.isCapturable(unit)
                && tile.isCity && tile.camp === world.myCamp
                && !isReservedForMinisterReturn(world, tile)
                && isOwnCityThreatened(world, tile);
            if (doomed) {
                score = (holdsThreatenedOwnCity ? 140 : 0)
                    + (potentialAtTile > 0 ? potentialAtTile * 2 : 0)
                    + captureTileBonus(world, unit, tile)
                    - threat * 0.15;
            } else {
                const safety = -threat * 3 - world.helpers.hexDistance(tile, unit.tile) * 0.5;
                const homePull = ports.length ? Math.min(...ports.map(port => world.helpers.hexDistance(tile, port)))
                    : nearestOwnCityDistance(world, tile);
                const canRecover = ports.includes(tile) || ownsRecoverySite;
                const blocksSoleRecruitSlot = world.caps.opponentModeling
                    && tile.isCity && tile.camp === world.myCamp
                    && world.myCities.length <= 2 && world.gold >= 8
                    && !isOwnCityThreatened(world, tile);
                const safeDockBonus = canRecover && !blocksSoleRecruitSlot && threat * W.lethalThreatMargin < pool ? 80 : 0;
                score = safety - homePull * 4 + safeDockBonus - (blocksSoleRecruitSlot ? 65 : 0);
            }
        }
        if (score > 0) score *= noiseJitter(world.caps, `mv:${world.round}:${unit.id}:${tile.q},${tile.r}`);
        if (score > bestScore) { bestScore = score; bestTile = tile; }
    }
    if (!bestTile || bestTile === unit.tile) return false;
    actions.push({
        type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r,
        ...(captureObjective ? { autoAttack: false } : {})
    });
    return true;
}

/** 主攻方向上的集结点：当前第一攻城任务的目标城市。 */
function primaryRallyPoint(world, missionsCtx) {
    const siege = missionsCtx.missions.find(m => m.kind === 'siege');
    if (!siege) return null;
    const occupier = world.myUnits.find(u => u.id === siege.occupierId);
    return world.tileMap.get(`${siege.targetQ},${siege.targetR}`) || occupier?.tile;
}

function blocksOccupierSeaLane(world, missionsCtx, unit, tile) {
    if (!world.captureRoute || !world.onWater(tile)) return false;
    for (const siege of missionsCtx.missions) {
        if (siege.kind !== 'siege' || siege.occupierId === unit.id) continue;
        const occupier = world.myUnits.find(u => u.id === siege.occupierId);
        const goal = world.tileMap.get(`${siege.targetQ},${siege.targetR}`);
        if (!occupier?.tile || !goal || world.helpers.hexDistance(occupier.tile, tile) !== 1) continue;
        const currentRoute = world.captureRoute(occupier, goal, occupier.tile);
        const stepRoute = world.captureRoute(occupier, goal, tile);
        if (currentRoute && stepRoute && stepRoute.turns < currentRoute.turns) return true;
    }
    return false;
}

function scoreOfStaying(world, missionsCtx, unit, mission) {
    let score = 0;
    if (mission?.kind === 'garrison' && unit.tile.isCity
        && unit.tile.q === mission.targetQ && unit.tile.r === mission.targetR) score += 300;
    if (unit.tile.isCity && unit.tile.camp === world.myCamp && unit.commander === 'minister') score += 500;
    if (world.caps.rearCommanderSafety && unit.tile.isCity && unit.tile.camp === world.myCamp
        && unit.commander === 'astrologer') score += W.rearCommanderCityValue;
    if (unit.tile.isCity && unit.tile.camp === world.myCamp && unit.commander === 'colonel'
        && unit.tile.installation?.type === 'airfield') score += 220;
    if ((world.hostileAirfields?.length || 0) > 0 && unit.tile.fortification === 'flak') {
        score += unit.tile.isCity && unit.tile.camp === world.myCamp ? 24 : 12;
    }
    if (unit.tile.isCity && unit.tile.camp === world.myCamp && world.isCapturable(unit)) {
        if (isReservedForMinisterReturn(world, unit.tile) && unit.commander !== 'minister') score -= 40;
        else if (!mission && isOwnCityThreatened(world, unit.tile)) score += 26;
    }
    if (unit.tile.isCity && unit.tile.camp !== world.myCamp && world.isCapturable(unit)) score += 150;
    if (blocksOccupierSeaLane(world, missionsCtx, unit, unit.tile)) score -= 45;
    return score;
}

function nearestHostileCity(world, tile, unit = null) {
    let best = null;
    const dist = !world.isNaval(unit) && world.navDistance ? world.navDistance : world.helpers.hexDistance;
    for (const city of world.cities) {
        if (!city.hostile) continue;
        const distance = dist(tile, city.tile);
        if (best == null || distance < best) best = distance;
    }
    return best;
}

function nearestOwnCityDistance(world, tile) {
    let best = 99;
    for (const city of world.myCities) {
        best = Math.min(best, world.helpers.hexDistance(tile, city));
    }
    return best;
}

// ═══════════════════════════════════════════════════════════════
// 破门序列：把守军斩杀编成"先软化、终结者收尾"的一回合剧本。
// 规则事实：只有突击类单位亲手击杀守军（或打破最后一道城防）才能进驻。
// 所以远程先把守军磨进终结者一击线，近战终结者打最后一击并进城；
// 凑不齐斩杀就整体按住不打——守军固守每回合回 20，零敲碎打等于白打。
// ═══════════════════════════════════════════════════════════════

function planBreachSequence(world, missionsCtx, actions, processed) {
    for (const mission of missionsCtx.missions) {
        if (mission.kind !== 'siege') continue;
        const city = world.cities.find(c => c.tile.q === mission.targetQ && c.tile.r === mission.targetR);
        const garrison = city?.garrison;
        if (!city || !garrison || garrison.camp === world.myCamp) continue;
        const attackers = world.myUnits.filter(unit =>
            !processed.has(unit.id) && unit.canAct && unit.tile
            && world.helpers.getAttackableTiles(unit).includes(city.tile));
        if (attackers.length === 0) continue;
        const assaults = attackers.filter(unit => world.isCapturable(unit)
            && !shouldHoldCityPosition(world, unit, missionsCtx.assignment.get(unit.id))
            && !world.combat.wouldDieToCounter(unit, garrison));
        const finisher = assaults.find(unit => unit.id === mission.occupierId) || assaults[0];
        if (!finisher && !mission.clockCritical) continue; // 非残局继续等近战终结者到位
        const finisherDamage = finisher
            ? world.combat.estimateDamage(finisher, garrison, city.tile)
            : 0;
        const softeners = attackers
            .filter(unit => unit.id !== finisher?.id && !world.combat.wouldDieToCounter(unit, garrison))
            .filter(unit => !isRiskyNeutralAssault(world, unit, garrison,
                world.combat.estimateCounterDamage(unit, garrison)))
            .map(unit => ({ unit, damage: world.combat.estimateDamage(unit, garrison, city.tile) }))
            .filter(entry => entry.damage > 0)
            .sort((a, b) => b.damage - a.damage);
        let remaining = garrison.hp + (garrison._shield || 0);
        const sequence = [];
        for (const entry of softeners) {
            if (remaining <= finisherDamage) break;
            sequence.push(entry);
            remaining -= entry.damage;
        }
        if (finisher && remaining <= finisherDamage) {
            for (const entry of sequence) {
                actions.push({ type: 'attack', unitId: entry.unit.id, targetId: garrison.id });
                processed.add(entry.unit.id);
            }
            actions.push({ type: 'attack', unitId: finisher.id, targetId: garrison.id });
            processed.add(finisher.id);
        } else if (mission.clockCritical) {
            // 回合即将耗尽时，不能因为“本回合杀不完”就让驻军完整回血。
            // 所有不会死于反击的在位攻击手持续压低同一守军，等待下一轮终结者收尾。
            const pressure = attackers
                .filter(unit => !world.combat.wouldDieToCounter(unit, garrison))
                .filter(unit => !isRiskyNeutralAssault(world, unit, garrison,
                    world.combat.estimateCounterDamage(unit, garrison)))
                .map(unit => ({ unit, damage: world.combat.estimateDamage(unit, garrison, city.tile) }))
                .filter(entry => entry.damage > 0)
                .sort((a, b) => b.damage - a.damage);
            for (const entry of pressure) {
                actions.push({ type: 'attack', unitId: entry.unit.id, targetId: garrison.id });
                processed.add(entry.unit.id);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// 攻城与夺城结算
// ═══════════════════════════════════════════════════════════════

function canMoveToCapture(unit) {
    return unit.canAct && !unit.isNewRecruit && !unit._isDrone && unit._campaignCanMove !== false;
}

function captureMove(unit, tile) {
    return { type: 'move', unitId: unit.id, tileQ: tile.q, tileR: tile.r, captureCity: true, autoAttack: false };
}

function approachThreat(world, unit, tile) {
    const isEmbarked = isEmbarkableLandUnit(unit) && world.onWater(tile);
    const defender = isEmbarked === !!unit.isEmbarked ? unit
        : Object.assign(Object.create(Object.getPrototypeOf(unit)), unit, { isEmbarked });
    return world.threatAt(tile, defender);
}

function safeApproachTile(world, unit, tile) {
    return approachThreat(world, unit, tile) * W.lethalThreatMargin < unit.hp + (unit._shield || 0);
}

function planLandingApproach(world, unit, goal, route, actions) {
    const atSea = world.onWater(unit.tile);
    let best = null;
    for (const tile of world.helpers.getMovableTiles(unit)) {
        if (tile.unit && (!world.isUnitVisible || world.isUnitVisible(tile.unit))) continue;
        const next = world.captureRoute(unit, goal, tile);
        const landing = atSea && !world.onWater(tile);
        const nearLandApproach = landing && next && !next.landing && next.turns <= 1;
        if (!next || (next.turns >= route.turns && !nearLandApproach)) continue;
        const threat = approachThreat(world, unit, tile);
        const hp = unit.hp + (unit._shield || 0);
        if (threat * W.lethalThreatMargin >= hp) continue;
        const score = route.turns - next.turns - threat / hp * W.landingThreatWeight
            + (landing ? W.landingReadyBonus : 0);
        if (!best || score > best.score) best = { tile, landing, score };
    }
    if (!best) return false;
    actions.push({ type: 'move', unitId: unit.id, tileQ: best.tile.q, tileR: best.tile.r, autoAttack: !best.landing });
    return true;
}

/** 夺城结算：走进空城或近战击杀守军进驻。先于普通攻击。 */
export function planCaptureFinishers(world, missionsCtx, actions, processed, onlyOpenCities = false) {
    const claimed = new Set();
    const capturers = [...world.myUnits].sort((a, b) =>
        Number(isFieldCapturer(world, b)) - Number(isFieldCapturer(world, a)));
    for (const unit of capturers) {
        if (processed.has(unit.id) || !canMoveToCapture(unit) || world.isImmobile(unit)) continue;
        if (shouldHoldCityPosition(world, unit, missionsCtx?.assignment.get(unit.id))) continue;
        const hasOpenCity = world.cities.some(city => city.hostile && !claimed.has(city.tile)
            && !city.garrison && city.hp <= 0);
        const reachable = hasOpenCity ? world.helpers.getMovableTiles(unit) : [];
        for (const city of world.cities) {
            if (!city.hostile || claimed.has(city.tile)) continue;
            if (!city.garrison && city.hp <= 0 && reachable.includes(city.tile)) {
                actions.push(captureMove(unit, city.tile));
                claimed.add(city.tile);
                processed.add(unit.id);
                break;
            }
            if (!onlyOpenCities && city.garrison && world.isCapturable(unit)
                && world.helpers.hexDistance(unit.tile, city.tile) === 1
                && world.helpers.getAttackableTiles(unit).includes(city.tile)) {
                const entry = evaluateAttack(world, missionsCtx, unit, city.garrison);
                if (entry.kills && !entry.veto) {
                    actions.push({ type: 'attack', unitId: unit.id, targetId: city.garrison.id });
                    claimed.add(city.tile);
                    processed.add(unit.id);
                    break;
                }
            }
        }
    }
}

function planCaptureApproaches(world, strategy, missionsCtx, actions, processed) {
    for (const mission of missionsCtx.missions) {
        if (mission.kind !== 'siege' || processed.has(mission.occupierId)) continue;
        const city = world.cities.find(({ tile }) => tile.q === mission.targetQ && tile.r === mission.targetR);
        if (!city?.hostile) continue;
        const unit = world.myUnits.find(candidate => candidate.id === mission.occupierId);
        if (!unit || !canMoveToCapture(unit) || missionsCtx.assignment.get(unit.id) !== mission) continue;
        const route = world.captureRoute?.(unit, city.tile);
        if (route?.landing) {
            if (!shouldRetreat(world, unit) && !bestAttackFor(world, missionsCtx, unit)?.kills
                && planLandingApproach(world, unit, city.tile, route, actions)) processed.add(unit.id);
            continue;
        }
        const open = !city.garrison && city.hp <= 0;
        if (!open) {
            // 战前集结限于陆上。海上离城更近的落点可能堵住另一支部队的登陆线。
            if (world.onWater(unit.tile)) continue;
            const hasSupport = world.caps.missionPersistence && world.myUnits.some(ally =>
                ally !== unit && ally.canAct && world.helpers.getAttackableTiles(ally).includes(city.tile));
            if (!hasSupport || bestAttackFor(world, missionsCtx, unit)?.kills) continue;
        }
        if (planMove(world, missionsCtx, unit, strategy.posture, actions, {
            captureObjective: city.tile, stageOnLand: !open
        })) processed.add(unit.id);
    }
}

// If the occupier is in melee range, concentrate just enough fire to let it finish and enter.
function planCoordinatedCityBreaches(world, missionsCtx, actions, processed) {
    for (const mission of missionsCtx.missions) {
        if (mission.kind !== 'siege') continue;
        const tile = world.tileMap.get(`${mission.targetQ},${mission.targetR}`);
        if (!tile?.isCity || tile.unit || tile.hp <= 0) continue;
        const ready = world.myUnits.filter(unit => unit.canAct && !processed.has(unit.id)
            && world.helpers.getAttackableTiles(unit).includes(tile));
        const finisher = ready.find(unit => unit.id === mission.occupierId
            && !shouldHoldCityPosition(world, unit, mission) && world.helpers.hexDistance(unit.tile, tile) === 1);
        if (!finisher) continue;
        const finishingDamage = world.estimateSiegeDamage(finisher, tile);
        if (finishingDamage >= tile.hp || finishingDamage <= 0) continue;
        const canEnter = world.helpers.canReachCityAfterBreach?.(finisher, tile);
        let hp = tile.hp;
        const support = [];
        for (const unit of ready.filter(candidate => !world.isCapturable(candidate))
            .sort((a, b) => world.estimateSiegeDamage(b, tile) - world.estimateSiegeDamage(a, tile))) {
            const damage = world.estimateSiegeDamage(unit, tile);
            if (damage <= 0 || (damage >= hp && !canEnter)) continue;
            support.push(unit);
            hp -= damage;
            if (hp <= finishingDamage) break;
        }
        if (hp > finishingDamage) continue;
        for (const unit of [...support, finisher]) {
            if (unit === finisher && hp <= 0) actions.push(captureMove(unit, tile));
            else actions.push({ type: 'siegeCityAttack', unitId: unit.id, tileQ: tile.q, tileR: tile.r });
            processed.add(unit.id);
        }
    }
}

function rivalCanClaimFirst(world, tile, processed, missionsCtx) {
    if (!world.captureRoute) return false;
    const arrival = unit => world.captureRoute(unit, tile)?.turns ?? Infinity;
    const rivalEta = world.rivalUnits
        .filter(unit => unit.camp !== tile.camp && world.isCapturable(unit) && !world.isImmobile(unit))
        .reduce((best, unit) => Math.min(best, arrival(unit)), Infinity);
    if (rivalEta > 1) return false;
    return !world.myUnits.some(unit => isFieldCapturer(world, unit)
        && !shouldHoldCityPosition(world, unit, missionsCtx.assignment.get(unit.id))
        && ((!world.onWater(unit.tile) && arrival(unit) <= rivalEta)
            || (!processed.has(unit.id) && canMoveToCapture(unit)
            && world.helpers.canReachCityAfterBreach?.(unit, tile))));
}

/** 困难档先寻找本回合能稳定击杀的共同目标，避免每个单位各自打出“最高单次收益”却无人阵亡。 */
function planLethalFocus(world, missionsCtx, actions, processed) {
    if (!world.caps.lethalFocus) return;
    const candidates = [];
    for (const target of [...world.rivalUnits, ...world.neutralUnits]) {
        if (!target.tile || !isNeutralEngageable(world, missionsCtx, target)) continue;
        const entries = world.myUnits
            .filter(unit => !processed.has(unit.id) && unit.canAct && unit.tile
                && world.helpers.getAttackableTiles(unit).includes(target.tile))
            .map(unit => ({ unit, entry: evaluateAttack(world, missionsCtx, unit, target) }))
            .filter(candidate => !candidate.entry.veto && candidate.entry.value > 0)
            .sort((a, b) => b.entry.damage - a.entry.damage || b.entry.value - a.entry.value);
        const pool = target.hp + (target._shield || 0);
        if (entries.reduce((sum, candidate) => sum + candidate.entry.damage, 0)
            < pool * W.lethalFocusMargin) continue;
        const selected = [];
        let damage = 0;
        for (const candidate of entries) {
            selected.push(candidate);
            damage += candidate.entry.damage;
            if (damage >= pool * W.lethalFocusMargin) break;
        }
        const priority = residualGold(target)
            + (target.commander ? W.commanderKillBonus : 0)
            + enemyCapturerPremium(world, target);
        candidates.push({ target, selected, priority });
    }
    candidates.sort((a, b) => b.priority - a.priority);
    for (const candidate of candidates) {
        if (candidate.selected.some(item => processed.has(item.unit.id))) continue;
        for (const { unit } of candidate.selected) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: candidate.target.id });
            processed.add(unit.id);
        }
    }
}

/** 攻城：攻击任务目标，避免把对手先到的空城打成易守难夺的据点。 */
function planSiegeAttacks(world, missionsCtx, actions, processed, breachOnly = false) {
    const siegeCities = new Set(missionsCtx.missions
        .filter(m => m.kind === 'siege')
        .map(m => `${m.targetQ},${m.targetR}`));
    const plannedBreaches = new Set();
    for (const unit of world.myUnits) {
        if (processed.has(unit.id) || !unit.canAct) continue;
        if (world.isCapturable(unit) && shouldHoldCityPosition(world, unit, missionsCtx.assignment.get(unit.id))) continue;
        const siegeTile = world.helpers.getAttackableTiles(unit)
            .find(tile => !tile.unit && tile.isCity && tile.hp > 0 && tile.camp !== world.myCamp
                && !plannedBreaches.has(tile)
                && (siegeCities.has(`${tile.q},${tile.r}`)
                    || (!breachOnly && world.myUnits.some(ally => isFieldCapturer(world, ally)
                        && !shouldHoldCityPosition(world, ally, missionsCtx.assignment.get(ally.id))
                        && world.helpers.hexDistance(ally.tile, tile) <= 2))));
        if (!siegeTile) continue;
        const damage = world.estimateSiegeDamage(unit, siegeTile);
        const wouldBreach = damage >= siegeTile.hp;
        if (breachOnly && !wouldBreach) continue;
        let occupier = null;
        if (wouldBreach && !world.isCapturable(unit)) {
            // 现在的墙会挡住路径查询。只在这座城破墙后的合法路径存在时安排接力。
            occupier = world.myUnits.find(candidate => candidate !== unit && !processed.has(candidate.id)
                && canMoveToCapture(candidate)
                && !shouldHoldCityPosition(world, candidate, missionsCtx.assignment.get(candidate.id))
                && world.helpers.canReachCityAfterBreach?.(candidate, siegeTile));
            if (!occupier) continue;
        }
        const reserve = shouldReserveFinalSiegeBlow(siegeTile.hp,
            world.myUnits.filter(u => !processed.has(u.id) && world.isCapturable(u) && u.canAct
                && !shouldHoldCityPosition(world, u, missionsCtx.assignment.get(u.id))
                && world.helpers.hexDistance(u.tile, siegeTile) === 1
                && world.helpers.getAttackableTiles(u).includes(siegeTile))
                .map(u => world.estimateSiegeDamage(u, siegeTile)));
        if (!world.isCapturable(unit) && reserve) continue;
        if (!occupier && !(wouldBreach && world.isCapturable(unit))
            && rivalCanClaimFirst(world, siegeTile, processed, missionsCtx)) continue;
        actions.push({ type: 'siegeCityAttack', unitId: unit.id, tileQ: siegeTile.q, tileR: siegeTile.r });
        processed.add(unit.id);
        if (wouldBreach) plannedBreaches.add(siegeTile);
        if (occupier) {
            actions.push(captureMove(occupier, siegeTile));
            processed.add(occupier.id);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// 天眼无人机作战：每回合 1 架向前线部署（$5）；
// 自爆只打高价值目标（将领/炮兵/高 rank/攻城守军）——无人机是消耗品，但只许值回票价。
// ═══════════════════════════════════════════════════════════════

function planDroneOps(world, missionsCtx, actions, processed, availableGold) {
    const drones = world.myUnits.filter(unit => unit._isDrone);
    for (const drone of drones) {
        if (processed.has(drone.id) || !drone.canAct || !drone.tile) continue;
        let best = null;
        for (const enemy of [...world.rivalUnits, ...world.neutralUnits]) {
            if (!enemy.tile || world.helpers.hexDistance(drone.tile, enemy.tile) > 3) continue;
            const enemyPool = enemy.hp + (enemy.activeShield ?? enemy._shield ?? 0);
            const killsBySuicide = 100 >= enemyPool;
            let score = 100 * hpGold(enemy) + enemyCapturerPremium(world, enemy);
            if (killsBySuicide) {
                score += residualGold(enemy) * W.killPremiumRatio + (residualGold(enemy) >= 7 ? 32 : 0);
            }
            if (enemy.commander) score += W.commanderKillBonus + 30;
            if (['staller', 'priest', 'necromancer', 'ironGuard'].includes(enemy.commander)) score += 15;
            if ((enemy._rank || 0) >= 2) score += 25;
            if (['archer', 'mgNest', 'shoreBattery'].includes(getUnitBaseType(enemy))) score += 20;
            score += missionTargetBonus(world, missionsCtx, enemy, killsBySuicide);
            if (!best || score > best.score) best = { target: enemy, score };
        }
        if (best && best.score >= 60) {
            actions.push({ type: 'droneSuicide', unitId: drone.id, targetId: best.target.id });
            processed.add(drone.id);
        }
    }
    const tianyan = world.myUnits.find(unit =>
        unit.commander === 'tianyan' && unit.tile && !unit._isDrone && unit.canAct);
    if (!tianyan) return;
    if (Number(tianyan.remainingMP || 0) < 2 || shouldRetreat(world, tianyan, missionsCtx)) return;
    const tianyanPool = tianyan.hp + (tianyan.activeShield ?? tianyan._shield ?? 0);
    if (combinedThreatAt(world, tianyan.tile, tianyan, null, 0).total >= tianyanPool * 0.72) return;
    if (world.myUnits.filter(unit => unit._isDrone && !processed.has(unit.id)).length >= 2) return;
    const { deployGoldCost, deployLimitPerTurn, signalRange } = COMMANDER_CONFIG.tianyan.balance;
    const { _droneDeployTurn, _droneDeployCount, turnCounter } = world.gameState;
    if (availableGold < deployGoldCost || (_droneDeployTurn?.[world.myCampKey] === turnCounter
        && _droneDeployCount?.[world.myCampKey] >= deployLimitPerTurn)) return;
    // 海图开局若港口空置且我方尚无主力舰，优先攒钱造巡洋舰以免陷入每回合-5金却零造船的贫困循环
    const hasEmptyOwnPort = world.tiles.some(t => t.isPort && t.camp === world.myCamp && !t.unit);
    const hasWarship = world.myUnits.some(u => getUnitBaseType(u) === 'warship');
    const localEnemyUrgency = [...world.rivalUnits, ...world.neutralUnits].some(e =>
        e.tile && e.hp > 0 && world.helpers.hexDistance(tianyan.tile, e.tile) <= 4);
    const hasEmptyOwnCity = world.myCities.some(c => !c.unit);
    if ((hasEmptyOwnCity || world.myUnits.length < 7) && availableGold < deployGoldCost + 8 && !localEnemyUrgency) return;
    if (world.oceanMap && world.round >= 2 && hasEmptyOwnPort && !hasWarship && world.gold < 15 && !localEnemyUrgency) return;
    const objective = missionsCtx.missions.find(m => m.kind === 'siege');
    const nearestRival = [...world.rivalUnits].filter(enemy => enemy.tile && enemy.hp > 0)
        .sort((a, b) => world.helpers.hexDistance(tianyan.tile, a.tile) - world.helpers.hexDistance(tianyan.tile, b.tile))[0];
    const anchor = (objective ? world.tileMap.get(`${objective.targetQ},${objective.targetR}`) : null)
        || nearestRival?.tile
        || null;
    const candidates = world.helpers.HEX_NEIGHBORS
        .map(([dq, dr]) => world.tileMap.get(`${tianyan.tile.q + dq},${tianyan.tile.r + dr}`))
        .filter(tile => tile && !tile.unit && !tile.isCity && tile.terrain !== 'mountain'
            && world.helpers.hexDistance(tianyan.tile, tile) <= signalRange);
    if (candidates.length === 0) return;
    candidates.sort((a, b) => {
        const distA = anchor ? world.helpers.hexDistance(a, anchor) : 0;
        const distB = anchor ? world.helpers.hexDistance(b, anchor) : 0;
        return distA - distB || world.threatAt(a, null) - world.threatAt(b, null);
    });
    actions.push({ type: 'droneDeploy', unitId: tianyan.id, tileQ: candidates[0].q, tileR: candidates[0].r });
}

export function planTactics(world, strategy, missionsCtx, availableGold = world.gold - strategy.reserve) {
    const actions = [];
    const processed = new Set();
    const virtualReverts = [];

    try {
        world._doomedUnitIds = computeDoomedUnitIds(world, missionsCtx);
        virtualReverts.push(() => { delete world._doomedUnitIds; });
        // 已可占领的空城先兑现，避免占领者先做技能或普通交战。
        planCaptureFinishers(world, missionsCtx, actions, processed, true);

        // 0. 主动技能（泣血/至圣斩/天气等，必须在普通攻击与击杀夺城前，且不锁死本轮攻击/移动）。
        for (const unit of world.myUnits) {
            const allowSecondSmite = unit.commander === 'paladin' && unit._smiteReady && !unit._smiteCharged && Number(unit._faith || 0) >= 1;
            if (!processed.has(unit.id) && unit.canAct && unit.commander
                && (!world.gameState._aiSkillPlanned?.has?.(unit.id) || allowSecondSmite)) {
                if (planActiveSkill(world, missionsCtx, unit, actions)) {
                    const wasSkillPlanned = Boolean(world.gameState._aiSkillPlanned?.has?.(unit.id));
                    (world.gameState._aiSkillPlanned ||= new Set()).add(unit.id);
                    if (!wasSkillPlanned) {
                        virtualReverts.push(() => {
                            world.gameState._aiSkillPlanned?.delete?.(unit.id);
                        });
                    }
                    if (unit.commander === 'paladin') {
                        const prevReady = unit._smiteReady;
                        const prevCharged = unit._smiteCharged;
                        const plannedSmiteCount = actions.filter(a => a.type === 'activateSkill' && a.unitId === unit.id).length;
                        unit._smiteReady = true;
                        unit._smiteCharged = prevCharged || plannedSmiteCount >= 2 || (prevReady && Number(unit._faith || 0) >= 1);
                        virtualReverts.push(() => {
                            unit._smiteReady = prevReady;
                            unit._smiteCharged = prevCharged;
                        });
                    } else if (unit.commander === 'berserker' && !unit._berserkerQixue) {
                        const prevQixue = unit._berserkerQixue;
                        unit._berserkerQixue = true;
                        virtualReverts.push(() => {
                            unit._berserkerQixue = prevQixue;
                        });
                    }
                }
            }

        }

        // 含主动技能加成的近战击杀夺城结算。
        planCaptureFinishers(world, missionsCtx, actions, processed, false);

        // 0.5 天眼无人机：自爆兑现 + 向前线部署新哨机；帝国武士：优先收割已处于斩杀线的目标。
        planDroneOps(world, missionsCtx, actions, processed, availableGold);
        for (const unit of world.myUnits) {
            if (processed.has(unit.id)) continue;
            const strike = chooseCultureStrike(world, unit);
            if (!strike) continue;
            const normal = bestAttackFor(world, missionsCtx, unit);
            if (strike.value <= Math.max(1, normal?.value || 0)) continue;
            actions.push({ type: 'cultureStrike', unitId: unit.id, targetQ: strike.plan.aim.q, targetR: strike.plan.aim.r });
            processed.add(unit.id);
        }

        // 1.5 破门序列：攻城任务守军的协同斩杀（终结者收尾进城）。
        planBreachSequence(world, missionsCtx, actions, processed);
        if (world.captureRoute) planCoordinatedCityBreaches(world, missionsCtx, actions, processed);
        planSiegeAttacks(world, missionsCtx, actions, processed, true);
        planCaptureApproaches(world, strategy, missionsCtx, actions, processed);

        // 1.65 濒死撤离优先：有安全/可活路线时先脱离致命火网再择机开火；
        // 但若已无路可逃（必死局），则放弃徒劳逃命（更不准跳海），留到后续步骤破罐破摔打满输出。
        for (const unit of world.myUnits) {
            if (processed.has(unit.id) || !unit.canAct || unit.isNewRecruit || world.isImmobile(unit)) continue;
            if (!shouldRetreat(world, unit, missionsCtx)) continue;
            const pool = unit.hp + (unit.activeShield ?? unit._shield ?? 0);
            const bestHere = bestAttackFor(world, missionsCtx, unit);
            const clearsLethalThreat = bestHere?.kills
                && combinedThreatAt(world, unit.tile, unit, bestHere.target, bestHere.counter).total < pool * W.lethalCrossfireRetreatRatio
                && !(world.isNaval(unit) && (unit.commander || (unit._rank || 0) >= 2) && unit.hp < unit.maxHp * 0.45);
            if (clearsLethalThreat) continue;
            if (world._doomedUnitIds?.has(unit.id) && !(isLandBoundUnit(world, unit) && world.onWater(unit.tile))) {
                const canLastStandStrike = Boolean(bestHere)
                    || world.helpers.getMovableTiles(unit).some(tile =>
                        !tile.unit && canRetreatOntoTile(world, unit, tile)
                        && attackPotential(world, missionsCtx, unit, tile) > 0);
                if (canLastStandStrike) continue;
            }
            if (planMove(world, missionsCtx, unit, strategy.posture, actions)) {
                processed.add(unit.id);
            }
        }

        // 1.75 困难档集火终结：在分配常规攻击前，先锁定能够确保减员的攻击包。
        planLethalFocus(world, missionsCtx, actions, processed);

        // 2. 普通攻击：全阵营候选按价值排序，保证集火与高价值交换先行。
        const attackPlans = [];
        for (const unit of world.myUnits) {
            if (processed.has(unit.id) || !unit.canAct) continue;
            const best = bestAttackFor(world, missionsCtx, unit);
            if (!best) continue;
            attackPlans.push({ unit, best });
        }
        // 集火协调：同一目标被多个攻击手覆盖且合击必杀时，全员加协同价值——
        // 真人玩家从不把伤害摊在三个打不死的目标上。
        const plansByTarget = new Map();
        for (const plan of attackPlans) {
            const list = plansByTarget.get(plan.best.target.id) || [];
            list.push(plan);
            plansByTarget.set(plan.best.target.id, list);
        }
        for (const plans of plansByTarget.values()) {
            if (plans.length < 2) continue;
            const target = plans[0].best.target;
            const totalDamage = plans.reduce((sum, plan) => sum + plan.best.damage, 0);
            if (totalDamage >= target.hp + (target._shield || 0)) {
                const focusBonus = 25 + residualGold(target) * 0.2;
                for (const plan of plans) plan.best.value += focusBonus;
            }
        }
        attackPlans.sort((a, b) => b.best.value - a.best.value);
        for (const { unit, best } of attackPlans) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: best.target.id });
            processed.add(unit.id);
        }

        // 3. 攻城（近战此时若被 processed 跳过，不影响——打守军优先于磨城防）。
        planSiegeAttacks(world, missionsCtx, actions, processed);

        // 4. 移动（任务优先，其次散兵）。
        const movers = [...world.myUnits].sort((a, b) => {
            const ma = missionsCtx.assignment.get(a.id);
            const mb = missionsCtx.assignment.get(b.id);
            const rank = mission => mission?.kind === 'siege' ? 0 : mission ? 1 : 2;
            return rank(ma) - rank(mb);
        });
        for (const unit of movers) {
            if (processed.has(unit.id)) continue;
            planMove(world, missionsCtx, unit, strategy.posture, actions);
        }

        return actions;
    } finally {
        for (const revert of virtualReverts) revert();
    }
}
