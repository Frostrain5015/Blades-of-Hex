// 战术层 —— 单个回合内"每个单位做什么"的执行决策。
//
// 评分量纲统一为等效金币（见 weights.js）：
//   攻击 = 打出伤害×目标每HP金价 + 击杀溢价 − 反击成本 + 战略加成
//   移动 = 任务推进收益 + 进驻收益 + 攻击位潜力 − 威胁暴露成本
// 任务层给的使命优先于局部贪心；无任务单位按散兵处理（打得到就打、打不到就向
// 最近的战略目标靠拢）。

import {
    shouldPlanActiveSkill,
    shouldReserveFinalSiegeBlow,
    shouldSpendBerserkerBlood,
    scoreTacticalRoleMatchup
} from '../doctrine.js';
import { assessSiegeMission } from '../strategy.js';
import { W, hpGold, noiseJitter, residualGold, tradeNetValue } from './weights.js';

const FRAGILE_COMMANDERS = new Set(['advisor', 'diplomat', 'engineer', 'priest', 'staller']);
const REAR_COMMANDERS = new Set(['minister', 'astrologer']);

// ═══════════════════════════════════════════════════════════════
// 攻击评估
// ═══════════════════════════════════════════════════════════════

/** 目标与本阵营攻城任务的相关性：守军只有"能清掉"时才是收益，打不死的守军是陷阱。 */
function missionTargetBonus(world, missionsCtx, target, kills) {
    let bonus = 0;
    for (const mission of missionsCtx.missions) {
        if (mission.kind === 'siege'
            && target.tile.q === mission.targetQ && target.tile.r === mission.targetR
            && kills) {
            bonus += mission.cityValue * 0.30;
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
    let best = 0;
    for (const city of world.cities) {
        if (city.ownerKey !== world.myCampKey && city.ownerKey !== 'neutral') continue;
        const distance = world.helpers.hexDistance(target.tile, city.tile);
        if (distance > 3) continue;
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

/** 护航职责：威胁攻城任务占领者的敌人，护航舰优先清理。 */
function escortProtectionBonus(world, missionsCtx, attacker, target) {
    const mission = missionsCtx.assignment.get(attacker.id);
    if (!mission || mission.kind !== 'siege' || attacker.id === mission.occupierId) return 0;
    const occupier = world.myUnits.find(u => u.id === mission.occupierId);
    if (!occupier?.tile || !target.tile) return 0;
    return world.helpers.hexDistance(target.tile, occupier.tile) <= 3 ? 45 : 0;
}

/** 中立单位一律可打，但由净交换纪律把关：划算的才打，啃不动的不打。 */
function isNeutralEngageable(world, missionsCtx, target) {
    return true;
}

/** 威胁定价：按比例损失折算残余价值，而不是按 HP 单价——快死的单位每一步都更贵。 */
function threatCost(world, unit, tile, riskWeight = 1) {
    const incoming = world.threatAt(tile, unit);
    if (incoming <= 0) return 0;
    const pool = Math.max(1, unit.hp + (unit._shield || 0));
    const lossRatio = Math.min(1, incoming / pool);
    return lossRatio * residualGold(unit) * riskWeight;
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

function evaluateAttack(world, missionsCtx, attacker, target) {
    const combat = world.combat;
    const damage = combat.estimateDamage(attacker, target, target.tile);
    const kills = damage >= target.hp + (target._shield || 0);
    const counter = kills ? 0 : combat.estimateCounterDamage(attacker, target);
    // 近战贴脸 = 缠斗承诺，按决斗期望定价；远程按单回合交换定价。
    const meleeCommit = Math.max(1, Number(attacker.config?.range) || 1) <= 1;
    const net = meleeCommit
        ? duelExpectation(world, attacker, target)
        : tradeNetValue({
            damageDealt: damage, target, kills,
            counterDamage: counter, attacker
        });
    const strategic = missionTargetBonus(world, missionsCtx, target, kills)
        + enemyCapturerPremium(world, target)
        + conversionBonus(world, attacker, target)
        + escortProtectionBonus(world, missionsCtx, attacker, target)
        + scoreTacticalRoleMatchup(attacker, target) * 0.3
        + (target.commander ? 30 : 0)
        + ((target._rank || 0) >= 3 ? 40 : 0); // 高 rank 王牌：放任不管会被它一个个点名
    // 净交换否决：换血明显亏本、形不成击杀、且脱得了身时不打。
    const canDisengage = Math.max(1, Number(attacker.config?.range) || 1) >= 2
        || Number(target.config?.speed) <= 0
        || Math.max(1, Number(target.config?.range) || 1) < world.helpers.hexDistance(attacker.tile, target.tile);
    const veto = !kills && canDisengage && net < -residualGold(attacker) * W.tradeVetoRatio;
    const jitter = noiseJitter(world.caps, `atk:${world.round}:${attacker.id}:${target.id}`);
    return { target, damage, kills, counter, net, strategic, veto, value: (net + strategic) * jitter };
}

function bestAttackFor(world, missionsCtx, unit) {
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

function planActiveSkill(world, missionsCtx, unit, actions) {
    if (!unit.commander || !unit.canAct) return false;
    const attack = bestAttackFor(world, missionsCtx, unit);
    const hasWoundedAlly = world.myUnits.some(ally =>
        ally.id !== unit.id && ally.hp < ally.maxHp * 0.6
        && world.helpers.hexDistance(ally.tile, unit.tile) <= 2);
    if (unit.commander === 'berserker') {
        // 泣血 + 治疗预算：手上有疗愈或身旁有牧师时，卖血是节奏不是赌博。
        const healBacked = world.hand.includes('heal')
            || world.myUnits.some(ally => ally.commander === 'priest' && ally.canAct
                && world.helpers.hexDistance(ally.tile, unit.tile) <= 3);
        const worthIt = attack && (attack.kills
            || attack.target.commander
            || attack.strategic > 20);
        if (attack && shouldSpendBerserkerBlood({
            hpRatio: unit.hp / unit.maxHp,
            convertsToKill: attack.kills,
            highValueTarget: worthIt && healBacked,
            outnumbered: strategyForceRatio(world) < 0.7
        }) && shouldPlanActiveSkill(unit, { hasAttackTarget: true })) {
            actions.push({ type: 'activateSkill', unitId: unit.id });
            return true;
        }
        return false;
    }
    if (unit.commander === 'astrologer') {
        if ((unit.activeSkillCD || 0) > 0 || (unit.activeSkillDur || 0) > 0) return false;
        // 简化天气决策：己方兵种构成决定要什么天。
        const cavalry = world.myUnits.filter(u => u.type === 'cavalry').length;
        const archers = world.myUnits.filter(u => u.type === 'archer').length;
        const targetWeather = cavalry >= 2 && cavalry > archers ? 'fog'
            : archers >= 2 ? 'wind' : 'clear';
        if (targetWeather !== world.weather && attack) {
            actions.push({ type: 'activateSkill', unitId: unit.id, targetWeather });
            return true;
        }
        return false;
    }
    if (shouldPlanActiveSkill(unit, { hasAttackTarget: !!attack, hasWoundedAlly })) {
        actions.push({ type: 'activateSkill', unitId: unit.id });
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

function missionMoveBonus(world, missionsCtx, unit, tile) {
    const mission = missionsCtx.assignment.get(unit.id);
    if (!mission) return { bonus: 0, mission: null };
    const helpers = world.helpers;
    const target = world.tileMap.get(`${mission.targetQ},${mission.targetR}`);
    if (!target) return { bonus: 0, mission };
    const currentDistance = helpers.hexDistance(unit.tile, target);
    const newDistance = helpers.hexDistance(tile, target);

    if (mission.kind === 'garrison') {
        // 守备：在城里就别动；没在城里就回家。
        if (unit.tile === target) return { bonus: 400, mission };
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
        const progressScale = isOccupier && garrisonAlive ? 0.45 : 1;
        let bonus = (currentDistance - newDistance) * value * W.siegeEtaTickRatio * (isOccupier ? 1.6 : 0.6) * progressScale * stallBoost;
        // 占领者到位：空城可进、破门可驻。
        if (isOccupier && tile === target && city && !garrisonAlive && city.hp <= 0) bonus += value * stallBoost;
        if (isOccupier && newDistance <= 1 && city && !garrisonAlive) bonus += value * 0.15;
        // 护航：贴近占领者两格内 + 顺带压向目标。
        if (!isOccupier && mission.occupierId != null) {
            const occupier = world.myUnits.find(u => u.id === mission.occupierId);
            if (occupier) {
                const escortDistance = helpers.hexDistance(tile, occupier.tile);
                bonus += Math.max(0, 2 - escortDistance) * 30;
            }
        }
        // 运输中的占领者：深水承伤风险折损；海域集火可能致死时短暂等待（停滞系数会抵消）。
        if (isOccupier && world.onWater(tile) && !world.isNaval(unit)) {
            const seaThreat = world.threatAt(tile, unit);
            bonus -= seaThreat > unit.hp * 0.5 ? 45 : value * W.transportRiskRatio;
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
    if (tile.isPort && tile.camp !== world.myCamp) {
        bonus += world.oceanMap ? W.portValueOcean : W.portValueLand;
    }
    if (tile.isVillage && tile.camp !== world.myCamp) {
        bonus += W.villageValue;
    }
    // 回到己方城市驻守（步兵守城有防御加成，比漂在外面强）。
    if (tile.isCity && tile.camp === world.myCamp && !tile.unit && world.isCapturable(unit)) {
        bonus += 26;
    }
    return bonus;
}

/** 攻击位潜力：站到这格后能否打出有价值的攻击（近似：按射程圈算）。 */
function attackPotential(world, missionsCtx, unit, tile) {
    const range = Math.max(1, Number(unit.config?.range) || 1);
    if (range <= 1 && !world.isCapturable(unit)) return 0;
    let best = 0;
    for (const enemy of [...world.rivalUnits, ...world.neutralUnits]) {
        if (!enemy.tile) continue;
        if (world.helpers.hexDistance(tile, enemy.tile) > range) continue;
        if (!isNeutralEngageable(world, missionsCtx, enemy)) continue;
        const entry = evaluateAttack(world, missionsCtx, unit, enemy);
        if (!entry.veto) best = Math.max(best, entry.value);
    }
    return best * 0.55; // 移动后自动攻击只按运行时的简化评分兑现，打折
}

function shouldRetreat(world, unit) {
    if (!unit.tile) return false;
    const hpRatio = unit.hp / unit.maxHp;
    const threshold = FRAGILE_COMMANDERS.has(unit.commander) ? 0.48
        : unit.commander ? W.retreatHpRatioCommander : W.retreatHpRatio;
    if (hpRatio >= threshold) return false;
    const incoming = world.threatAt(unit.tile, unit);
    return incoming > 0 && (incoming >= unit.hp * 0.5 || hpRatio < threshold * 0.7);
}

function planMove(world, missionsCtx, unit, posture, actions) {
    if (!unit.canAct || !unit.tile || world.isImmobile(unit)) return false;
    if (unit._transportTransitionedThisTurn) return false;
    const movable = world.helpers.getMovableTiles(unit);
    if (movable.length === 0) return false;

    const mission = missionsCtx.assignment.get(unit.id) || null;
    const retreating = shouldRetreat(world, unit);
    // 风险权重：占领者为兑现城市资产敢冒险；散兵没有对冲收益，必须惜命。
    const riskWeight = (mission && unit.id === mission.occupierId ? 0.65 : mission ? 1.0 : 1.6)
        * (FRAGILE_COMMANDERS.has(unit.commander) ? 1.6 : 1)
        * (posture === 'allin' ? 0.7 : 1)
        * (posture === 'hold' && (!mission || mission.kind !== 'garrison') ? 1.25 : 1);
    const poisonedAllies = world.myUnits.filter(ally => ally._poison);
    const rallyPoint = !mission ? primaryRallyPoint(world, missionsCtx) : null;

    let bestTile = null;
    let bestScore = retreating ? -Infinity : scoreOfStaying(world, missionsCtx, unit, mission);
    for (const tile of movable) {
        if (tile.unit) continue;
        const missionScore = missionMoveBonus(world, missionsCtx, unit, tile);
        let score = missionScore.bonus
            + captureTileBonus(world, unit, tile)
            + attackPotential(world, missionsCtx, unit, tile);
        // 散兵：有攻城任务时向占领者集结，否则向最近敌对城市缓慢施压。
        if (!mission) {
            if (rallyPoint) {
                const now = world.helpers.hexDistance(unit.tile, rallyPoint);
                const next = world.helpers.hexDistance(tile, rallyPoint);
                score += Math.max(-40, Math.min(40, (now - next) * 8));
            } else {
                const nearestHostile = nearestHostileCity(world, tile);
                const fromHere = nearestHostileCity(world, unit.tile);
                if (nearestHostile != null && fromHere != null) {
                    score += Math.max(-16, Math.min(16, (fromHere - nearestHostile) * 4));
                }
            }
        }
        // 威胁暴露（按残余价值比例计价）+ 落点自动攻击的预扣。
        score -= threatCost(world, unit, tile, riskWeight);
        score += autoAttackRisk(world, missionsCtx, unit, tile);
        // 中毒疏散：别贴着中毒友军挤成一团（守城者例外）。
        for (const ally of poisonedAllies) {
            if (ally.id === unit.id) continue;
            if (world.helpers.hexDistance(tile, ally.tile) <= 1) {
                score -= unit.tile.isCity && tile === unit.tile ? 0 : 16;
            }
        }
        if (retreating) {
            const threat = world.threatAt(tile, unit);
            const safety = -threat * 3 - world.helpers.hexDistance(tile, unit.tile) * 0.5;
            const homePull = nearestOwnCityDistance(world, tile);
            score = safety - homePull * 4 + (tile.isCity && tile.camp === world.myCamp ? 80 : 0);
        }
        if (score > 0) score *= noiseJitter(world.caps, `mv:${world.round}:${unit.id}:${tile.q},${tile.r}`);
        if (score > bestScore) { bestScore = score; bestTile = tile; }
    }
    if (!bestTile || bestTile === unit.tile) return false;
    actions.push({ type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r });
    return true;
}

/** 主攻方向上的集结点：当前第一攻城任务的占领者位置。 */
function primaryRallyPoint(world, missionsCtx) {
    const siege = missionsCtx.missions.find(m => m.kind === 'siege');
    if (!siege) return null;
    const occupier = world.myUnits.find(u => u.id === siege.occupierId);
    return occupier?.tile || world.tileMap.get(`${siege.targetQ},${siege.targetR}`);
}

function scoreOfStaying(world, missionsCtx, unit, mission) {
    let score = 0;
    if (mission?.kind === 'garrison' && unit.tile.isCity) score += 300;
    if (unit.tile.isCity && unit.tile.camp === world.myCamp && unit.commander === 'minister') score += 500;
    if (unit.tile.isCity && unit.tile.camp !== world.myCamp && world.isCapturable(unit)) score += 150;
    return score;
}

function nearestHostileCity(world, tile) {
    let best = null;
    for (const city of world.cities) {
        if (!city.hostile) continue;
        const distance = world.helpers.hexDistance(tile, city.tile);
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
            && !world.combat.wouldDieToCounter(unit, garrison));
        const finisher = assaults.find(unit => unit.id === mission.occupierId) || assaults[0];
        if (!finisher) continue; // 射程内没有近战终结者：火力先不浪费，等人到位
        const finisherDamage = world.combat.estimateDamage(finisher, garrison, city.tile);
        const softeners = attackers
            .filter(unit => unit.id !== finisher.id && !world.combat.wouldDieToCounter(unit, garrison))
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
        if (remaining <= finisherDamage) {
            for (const entry of sequence) {
                actions.push({ type: 'attack', unitId: entry.unit.id, targetId: garrison.id });
                processed.add(entry.unit.id);
            }
            actions.push({ type: 'attack', unitId: finisher.id, targetId: garrison.id });
            processed.add(finisher.id);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// 攻城与夺城结算
// ═══════════════════════════════════════════════════════════════

/** 夺城结算：近战击杀守军进驻 / 走进空城。先于普通攻击。 */
function planCaptureFinishers(world, missionsCtx, actions, processed) {
    for (const unit of world.myUnits) {
        if (processed.has(unit.id) || !unit.canAct || !world.isCapturable(unit)) continue;
        for (const city of world.cities) {
            if (!city.hostile) continue;
            // 空城（城防归零且无守军）→ 直接进驻。
            if (!city.garrison && city.hp <= 0
                && world.helpers.getMovableTiles(unit).includes(city.tile)) {
                actions.push({ type: 'move', unitId: unit.id, tileQ: city.tile.q, tileR: city.tile.r });
                processed.add(unit.id);
                break;
            }
            // 有守军但一击可杀且不死于反击 → 击杀进驻。
            if (city.garrison && world.helpers.hexDistance(unit.tile, city.tile) <= 1) {
                const entry = evaluateAttack(world, missionsCtx, unit, city.garrison);
                if (entry.kills && !world.combat.wouldDieToCounter(unit, city.garrison)) {
                    actions.push({ type: 'attack', unitId: unit.id, targetId: city.garrison.id });
                    processed.add(unit.id);
                    break;
                }
            }
        }
    }
}

/** 攻城：只磨"占领者两回合内能跟进"的任务目标城；最后一击预留给能进驻的近战。 */
function planSiegeAttacks(world, missionsCtx, actions, processed, onlyUnitIds = null) {
    const siegeCities = new Set(missionsCtx.missions
        .filter(m => m.kind === 'siege')
        .map(m => `${m.targetQ},${m.targetR}`));
    for (const unit of world.myUnits) {
        if (onlyUnitIds && !onlyUnitIds.has(unit.id)) continue;
        if (processed.has(unit.id) || !unit.canAct) continue;
        const siegeTile = world.helpers.getAttackableTiles(unit)
            .find(tile => !tile.unit && tile.isCity && tile.hp > 0 && tile.camp !== world.myCamp);
        if (!siegeTile) continue;
        const city = world.cities.find(c => c.tile === siegeTile);
        const onMission = siegeCities.has(`${siegeTile.q},${siegeTile.r}`);
        if (!onMission) continue; // 不替对手拆门：没有攻城任务就不磨城防
        const damage = world.estimateSiegeDamage(unit, siegeTile);
        const wouldBreach = damage >= siegeTile.hp;
        if (wouldBreach && !world.isCapturable(unit)) {
            // 远程不抢最后一击，除非占领者当回合必能进驻。
            const occupier = world.myUnits.find(u =>
                world.isCapturable(u) && world.helpers.getMovableTiles(u).includes(siegeTile));
            if (!occupier) continue;
        }
        if (world.isCapturable(unit)) {
            // 近战能打守军时不浪费在城防上（守军死了城就是进）。
            if (city?.garrison) continue;
        }
        const reserve = shouldReserveFinalSiegeBlow(siegeTile.hp,
            world.myUnits.filter(u => world.isCapturable(u) && u.canAct)
                .map(u => world.estimateSiegeDamage(u, siegeTile)));
        if (!world.isCapturable(unit) && reserve) continue;
        actions.push({ type: 'siegeCityAttack', unitId: unit.id, tileQ: siegeTile.q, tileR: siegeTile.r });
        processed.add(unit.id);
    }
}

// ═══════════════════════════════════════════════════════════════
// 主入口
// ═══════════════════════════════════════════════════════════════

/**
 * 产出一个完整回合的单位动作序列。
 * 顺序：主动技能 → 夺城结算 → 普通攻击（价值序）→ 攻城 → 移动。
 */
export function planTactics(world, strategy, missionsCtx) {
    const actions = [];
    const processed = new Set();

    // 0. 主动技能（泣血/至圣斩/天气等，必须在攻击前）。
    for (const unit of world.myUnits) {
        if (unit.canAct && unit.commander && !world.gameState._aiSkillPlanned?.has?.(unit.id)) {
            if (planActiveSkill(world, missionsCtx, unit, actions)) processed.add(unit.id);
        }
    }

    // 1. 夺城结算（优先进驻/击杀进驻）。
    planCaptureFinishers(world, missionsCtx, actions, processed);

    // 1.5 破门序列：攻城任务守军的协同斩杀（终结者收尾进城）。
    planBreachSequence(world, missionsCtx, actions, processed);

    // 2. 普通攻击：全阵营候选按价值排序，保证集火与高价值交换先行。
    const attackPlans = [];
    for (const unit of world.myUnits) {
        if (processed.has(unit.id) || !unit.canAct) continue;
        const best = bestAttackFor(world, missionsCtx, unit);
        if (best) attackPlans.push({ unit, best });
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
}
