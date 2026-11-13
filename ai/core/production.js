// 生产层 —— 招募、补员、产能格管理。
//
// 真人对局的两条课：
//   1. 产能结构锁死战略选择（紫军尚书坐城 → 终身无陆军）。突击兵缺口存在时，
//      安全后方的城市必须腾位招兵，而不是让一个普通守军占住唯一产能格。
//   2. 守军是固定资产：残血守军花几金补员，比阵亡后重招便宜得多。

import { W } from './weights.js';
import { isFieldCapturer } from './roster.js';
import { canRepairShipAtPort } from '../../rules/naval.js';

const NAVAL_ORDER = ['warship', 'destroyer', 'submarine'];
const LAND_ORDER = ['infantry', 'cavalry', 'archer'];

function canAfford(gold, cost, strategy) {
    return gold - cost - strategy.reserve >= 0;
}

/** 招募城市兵种：突击缺口时步兵/骑兵置顶（对齐真人"城就是产能"的认知）。 */
function landRecruitOrder(world, strategy, missionsCtx) {
    if (!world.myUnits.some(unit => isFieldCapturer(world, unit))) return LAND_ORDER;
    const hostileFortifications = world.rivalUnits.filter(unit =>
        unit.type === 'laserTower' || unit.type === 'mgNest' || unit.type === 'shoreBattery').length;
    const myArchers = world.myUnits.filter(unit => unit.type === 'archer').length;
    if (world.caps.lethalFocus && hostileFortifications > myArchers) {
        return ['archer', 'cavalry', 'infantry'];
    }
    const decisiveSiege = missionsCtx.missions.find(mission =>
        mission.kind === 'siege' && mission.decisive);
    const targetCity = decisiveSiege
        ? world.cities.find(city => city.tile.q === decisiveSiege.targetQ
            && city.tile.r === decisiveSiege.targetR)
        : null;
    const assaultCount = world.myUnits.filter(unit => world.isCapturable(unit)).length;
    const desiredSupport = Math.max(1, Math.ceil(assaultCount / W.siegeSupportPerAssault));
    if (world.caps.lethalFocus && targetCity
        && (targetCity.hp > 0 || targetCity.garrison)
        && myArchers < desiredSupport) {
        return ['archer', 'infantry', 'cavalry'];
    }
    if (strategy.assaultCapacity.deficit > 0) {
        return LAND_ORDER;
    }
    // 无缺口时步兵优先（守城 +10% 防御，也是最可靠的占领者），骑兵/炮兵补充。
    return ['infantry', 'cavalry', 'archer'];
}

function navalRecruitOrder(world) {
    const enemySubs = world.rivalUnits.filter(u => u.type === 'submarine').length;
    const myDestroyers = world.myUnits.filter(u => u.type === 'destroyer').length;
    if (enemySubs > myDestroyers) return ['destroyer', 'warship', 'submarine'];
    const enemyWarships = world.rivalUnits.filter(u => u.type === 'warship').length;
    const mySubs = world.myUnits.filter(u => u.type === 'submarine').length;
    if (enemyWarships > mySubs) return ['submarine', 'warship', 'destroyer'];
    return NAVAL_ORDER;
}

function shouldTemporarilyVacateMinister(world, strategy, memory) {
    const spendableGold = world.gold - strategy.reserve;
    const forceRatio = world.myUnits.length / Math.max(1, world.rivalUnits.length);
    const recruitmentIsUrgent = strategy.assaultCapacity.deficit > 0
        || ['recover', 'allin'].includes(strategy.posture)
        || forceRatio < W.ministerVacateForceRatio;
    const lastVacatedRound = Number(memory.ministerLastVacatedRound);
    const cooldownReady = !Number.isFinite(lastVacatedRound)
        || world.round - lastVacatedRound >= W.ministerVacateCooldownRounds;
    return spendableGold >= W.ministerVacateRecruitBank
        && recruitmentIsUrgent
        && cooldownReady;
}

export function planProduction(world, strategy, missionsCtx) {
    const setup = [];
    const actions = [];
    const emergencyRecruits = [];
    const helpers = world.helpers;
    let gold = world.gold;
    const aiMemory = (world.gameState._aiCoreMemory ||= {});
    const memory = (aiMemory[world.myCampKey] ||= {});
    const returnPlan = memory.ministerReturn;
    const reservedForMinister = city => returnPlan && returnPlan.vacatedRound < world.round
        && returnPlan.cityQ === city.q && returnPlan.cityR === city.r;

    // ── 0. 产能腾位：突击缺口 + 无空城 → 安全后方城市的普通守军出城 ──
    //    尚书仅在兵力/产能告急且金币足够连续招募时离城一回合，随后由任务层强制返城。
    let vacatedCity = null;
    const landOrder = landRecruitOrder(world, strategy, missionsCtx);
    const hasEmptyCity = world.myCities.some(city => !city.unit);
    const hasMinisterCity = world.myCities.some(city => city.unit?.commander === 'minister');
    const ministerMayVacate = !hasEmptyCity && hasMinisterCity
        && shouldTemporarilyVacateMinister(world, strategy, memory);
    if (!hasEmptyCity && (strategy.assaultCapacity.needsProductionSlot || ministerMayVacate)) {
        const candidates = world.myCities
            .filter(city => !reservedForMinister(city))
            .filter(city => city.unit && city.unit.camp === world.myCamp && city.unit.canAct)
            .filter(city => (!city.unit.commander
                || (ministerMayVacate && city.unit.commander === 'minister'))
                && !world.isImmobile(city.unit))
            // 有守备任务的城市不腾位（受威胁时守城优先于产能）。
            .filter(city => city.unit.commander === 'minister'
                || missionsCtx.assignment.get(city.unit.id)?.kind !== 'garrison')
            .filter(city => world.threatAt(city, city.unit) <= 30)
            .sort((a, b) => Number(!!a.unit.commander) - Number(!!b.unit.commander));
        for (const city of candidates) {
            // 校验的是离城后的格子；执行层仍对真实格子再次终检。
            const emptySite = { ...city, unit: null };
            const type = landOrder.find(candidate =>
                canAfford(gold, helpers.UNIT_CONFIG[candidate]?.cost ?? 99, strategy)
                && (!helpers.canRecruitTypeAtSite || helpers.canRecruitTypeAtSite(candidate, emptySite)));
            if (!type) continue;
            const exits = helpers.getMovableTiles(city.unit)
                .filter(tile => !tile.unit && !tile.isCity && world.threatAt(tile, city.unit) <= 20);
            if (exits.length === 0) continue;
            exits.sort((a, b) => world.threatAt(a, city.unit) - world.threatAt(b, city.unit));
            const move = {
                type: 'move', unitId: city.unit.id, tileQ: exits[0].q, tileR: exits[0].r,
                autoAttack: false
            };
            vacatedCity = city;
            if (city.unit.commander === 'minister') {
                move.returnToCity = { q: city.q, r: city.r, round: world.round };
            }
            setup.push(move, { type: 'recruit', unitType: type, tileQ: city.q, tileR: city.r });
            gold -= helpers.UNIT_CONFIG[type].cost;
            break;
        }
    }

    // ── 1. 城市招募（含腾出来的格子）──────────────────────────
    const emptyCities = world.myCities.filter(city => !city.unit && city !== vacatedCity
        && !reservedForMinister(city))
        .sort((a, b) => Number(b === strategy.emergencyDefenseCity) - Number(a === strategy.emergencyDefenseCity));
    let emergencyRecruitFund = strategy.reserve;
    let recruits = vacatedCity ? 1 : 0;
    const maxRecruits = world.caps.id === 'easy' ? 1 : 2;
    for (const city of emptyCities) {
        if (recruits >= maxRecruits) break;
        const urgentLandRecruit = emergencyRecruitFund > 0
            && (world.myUnits.length <= 2 || city === strategy.emergencyDefenseCity);
        const types = urgentLandRecruit ? LAND_ORDER : helpers.recruitTypesForCity
            ? helpers.recruitTypesForCity(city, landOrder)
            : landOrder;
        for (const type of types) {
            const cost = helpers.UNIT_CONFIG[type]?.cost ?? 99;
            const emergencyRecruit = urgentLandRecruit && cost <= gold;
            if (!emergencyRecruit && !canAfford(gold, cost, strategy)) continue;
            if (helpers.canRecruitTypeAtSite && !helpers.canRecruitTypeAtSite(type, city)) continue;
            const recruit = { type: 'recruit', unitType: type, tileQ: city.q, tileR: city.r };
            (emergencyRecruit ? emergencyRecruits : actions).push(recruit);
            if (emergencyRecruit) emergencyRecruitFund = Math.max(0, emergencyRecruitFund - cost);
            gold -= cost;
            recruits++;
            break;
        }
    }

    // ── 2. 港口招募：舰队有饱和上限，金币不能全变成占不了城的船。
    // 海军熔断：最近 3 回合内有舰船阵亡就停招——"排队送进岸防炮射程"的连败
    // 循环必须用记忆打断（阵亡的舰不占饱和数，单看饱和会永远补招）。
    const navalCount = world.myUnits.filter(u => world.isNaval(u)).length;
    const assaultCount = world.myUnits.filter(unit => isFieldCapturer(world, unit)).length;
    const navalMemory = ((world.gameState._aiCoreMemory ||= {})[world.myCampKey] ||= {});
    if (Number.isFinite(navalMemory.lastNavalCount) && navalCount < navalMemory.lastNavalCount) {
        navalMemory.navalCooldownUntil = world.round + 3;
    }
    navalMemory.lastNavalCount = navalCount;
    const navalCoolingDown = Number.isFinite(navalMemory.navalCooldownUntil)
        && world.round < navalMemory.navalCooldownUntil;
    const fleetSaturated = navalCount >= Math.max(4, assaultCount * 2)
        || assaultCount < 3
        || navalCoolingDown;
    const emptyPorts = world.tiles.filter(t => t.isPort && t.camp === world.myCamp && !t.unit);
    if (!fleetSaturated && (world.oceanMap || emptyPorts.length > 0) && strategy.assaultCapacity.deficit === 0) {
        const order = navalRecruitOrder(world);
        for (const port of emptyPorts.slice(0, 1)) {
            for (const type of order) {
                const cost = helpers.UNIT_CONFIG[type]?.cost ?? 99;
                if (gold - cost < emergencyRecruitFund) continue;
                if (helpers.canRecruitTypeAtSite && !helpers.canRecruitTypeAtSite(type, port)) continue;
                actions.push({ type: 'recruit', unitType: type, tileQ: port.q, tileR: port.r });
                gold -= cost;
                break;
            }
        }
    }

    // ── 3. 补员：守军是固定资产，残血补员远便宜于重招；
    //    同一单位最多补 2 次（补到第 3 次还死，说明站位本身就是错的）。
    const reinforceLedger = (memory.reinforceLedger ||= {});
    const reinforceRatio = strategy.posture === 'hold' ? 0.85 : W.reinforceHpRatio;
    const candidates = world.tiles
        .filter(t => t.unit && t.unit.camp === world.myCamp && !t._reinforcedThisTurn)
        .filter(t => (t.isCity || t.isVillage) && t.unit.hp < t.unit.maxHp * reinforceRatio)
        .filter(t => (reinforceLedger[t.unit.id] || 0) < 2)
        .sort((a, b) => (a.unit.hp / a.unit.maxHp) - (b.unit.hp / b.unit.maxHp));
    let reinforced = 0;
    for (const tile of candidates) {
        if (reinforced >= (strategy.posture === 'hold' ? 3 : 2)) break;
        if (gold - 4 < emergencyRecruitFund) break;
        actions.push({ type: 'reinforce', unitId: tile.unit.id });
        reinforceLedger[tile.unit.id] = (reinforceLedger[tile.unit.id] || 0) + 1;
        gold -= 4;
        reinforced++;
    }

    // 停靠港口的受损舰先维修再开火/离港，不要求单位尚有行动力。
    for (const unit of world.myUnits) {
        if (!canRepairShipAtPort(unit, world.gameState) || unit.tile._reinforcedThisTurn) continue;
        const heal = Math.min(Math.floor(unit.maxHp * 0.5), unit.maxHp - unit.hp);
        if (heal < unit.maxHp * 0.2) continue;
        const cost = Math.max(1, Math.ceil(unit.config.cost * heal / unit.maxHp));
        if (gold - cost < emergencyRecruitFund) continue;
        setup.unshift({ type: 'repairShip', unitId: unit.id });
        gold -= cost;
    }
    return { emergencyRecruits, setup, actions, recruitSpend: world.gold - gold };
}
