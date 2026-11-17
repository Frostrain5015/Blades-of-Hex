// 生产层 —— 招募、补员、产能格管理。
//
// 真人对局的两条课：
//   1. 产能结构锁死战略选择（紫军尚书坐城 → 终身无陆军）。突击兵缺口存在时，
//      安全后方的城市必须腾位招兵，而不是让一个普通守军占住唯一产能格。
//   2. 守军是固定资产：残血守军花几金补员，比阵亡后重招便宜得多。

import { W } from './weights.js';
import { isFieldCapturer, shouldReserveCityGarrison } from './roster.js';
import { canRepairShipAtPort } from '../../rules/naval.js';
import { canReinforceAtTile } from '../../rules/healing.js';
import { canUnitBeRecruitedAtSite, countLivingUnitsOfType, getUniqueRecruitmentLimit, getUnitBaseType } from '../../rules/units.js';
import { getHistoricalCost, getHistoricalRecruitCost, getCulturalReinforceCostScale, getHeavyCannonStanceBlock, isHeavyCannonDeployed } from '../../rules/cultures.js';
import { getCulturalRecruitmentCandidate } from '../../rules/aiRecruitment.js';
import { getKmtLinkedUnits, getKmtReinforceDeficit, getKmtSharedHealth } from '../../rules/kmtStronghold.js';
import { isLandTile } from '../../rules/surfaces.js';
import { resolveTianyanDroneReserve } from '../doctrine.js';

const NAVAL_ORDER = ['warship', 'destroyer', 'submarine'];
const LAND_ORDER = ['infantry', 'cavalry', 'archer'];

function canAfford(gold, cost, strategy) {
    return gold - cost - strategy.reserve >= 0;
}

function unitCost(world, type) {
    const base = world.helpers.UNIT_CONFIG[type]?.cost ?? 99;
    return getHistoricalRecruitCost(base, world.gameState, world.myCamp, type);
}

/** 招募城市兵种：突击缺口时步兵/骑兵置顶（对齐真人"城就是产能"的认知）。 */
function landRecruitOrder(world, missionsCtx, hasCapturer) {
    if (!hasCapturer) return LAND_ORDER;
    const w = world.weights || W;
    const hostileFortifications = world.rivalUnits.filter(unit =>
        getUnitBaseType(unit) === 'mgNest' || getUnitBaseType(unit) === 'shoreBattery').length;
    const myArchers = world.myUnits.filter(unit => getUnitBaseType(unit) === 'archer').length;
    const myCavalry = world.myUnits.filter(unit => getUnitBaseType(unit) === 'cavalry').length;
    const myInfantry = world.myUnits.filter(unit => getUnitBaseType(unit) === 'infantry').length;
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
    if (w.recruitOrderBias === 'blitz' && myCavalry < Math.max(2, Math.floor(myInfantry * 0.45))) {
        return ['cavalry', 'infantry', 'archer'];
    }
    if (world.caps.id === 'hard' && myInfantry >= 1) {
        if (myCavalry < Math.max(1, Math.floor(myInfantry * 0.35))) {
            return ['cavalry', 'archer', 'infantry'];
        }
        if (myArchers < Math.max(1, Math.floor((myInfantry + myCavalry) / 3))) {
            return ['archer', 'cavalry', 'infantry'];
        }
    }
    return LAND_ORDER;
}

function navalRecruitOrder(world) {
    const w = world.weights || W;
    const enemySubs = world.rivalUnits.filter(u => getUnitBaseType(u) === 'submarine').length;
    const myDestroyers = world.myUnits.filter(u => getUnitBaseType(u) === 'destroyer' || u.config?.submarineDetectorRadius).length;
    const enemyWarships = world.rivalUnits.filter(u => getUnitBaseType(u) === 'warship').length;
    const enemyAntiSub = world.rivalUnits.filter(u => getUnitBaseType(u) === 'destroyer' || u.config?.submarineDetectorRadius).length;
    const mySubs = world.myUnits.filter(u => getUnitBaseType(u) === 'submarine').length;
    const myWarships = world.myUnits.filter(u => getUnitBaseType(u) === 'warship').length;
    let order = NAVAL_ORDER;
    if (enemySubs > myDestroyers) {
        order = ['destroyer', 'warship', 'submarine'];
    } else if (world.oceanMap && myWarships < Math.max(2, enemyWarships + ((w.navalWarshipBias ?? 1) > 1.2 ? 1 : 0))) {
        // 海图优先补齐巡洋舰与护航驱逐舰，抢夺制海与远程轰城权。
        order = ['warship', 'destroyer', 'submarine'];
    } else if (enemyWarships > mySubs
        && mySubs < Math.max(2, myWarships + myDestroyers)
        && enemyAntiSub <= myDestroyers + 1) {
        order = ['submarine', 'warship', 'destroyer'];
    }
    return order;
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
    const soleCityNeedsTroops = world.myCities.length === 1 && strategy.assaultCapacity.deficit > 0
        && world.myCities[0].unit?.type === 'fr_heavy_cannon';
    const recruitBank = soleCityNeedsTroops ? unitCost(world, 'infantry') : W.ministerVacateRecruitBank;
    return spendableGold >= recruitBank
        && recruitmentIsUrgent
        && cooldownReady;
}

function productionExitUnit(world, unit) {
    if (!isHeavyCannonDeployed(unit)) return unit;
    if (unit.movedThisTurn || unit._heavyCannonAutoFiredThisTurn || getHeavyCannonStanceBlock(unit, world.gameState)) return null;
    // Query the same movement rules the executor will use after packing up.
    const mobile = Object.assign(Object.create(Object.getPrototypeOf(unit)), unit, { _heavyCannonDeployed: false });
    mobile.remainingMP = mobile.getEffectiveSpeed();
    return mobile;
}

export function planProduction(world, strategy, missionsCtx) {
    const setup = [];
    const actions = [];
    const emergencyRecruits = [];
    const helpers = world.helpers;
    let gold = world.gold;
    const assaultCount = world.myUnits.filter(unit => isFieldCapturer(world, unit)).length;
    let currentAssaultCount = assaultCount;
    const prodMemory = ((world.gameState._aiCoreMemory ||= {})[world.myCampKey] ||= {});
    prodMemory.strategicSaveReserve = 0;
    const tianyanProtectedFund = (reserveBase, urgent = false) => reserveBase + (urgent
        ? 0
        : resolveTianyanDroneReserve(world.gameState, world.myCamp, {
            assaultCount: currentAssaultCount,
            urgentDefense: !!strategy.emergencyDefenseCity,
            gold
        }));

    // 战略级拨款优先队列（海图巡洋舰 / 空城空降 / 前进机场），防止每回合被 $8 步兵吸干预算。
    const readyAirfields = world.myCities.filter(city => city.installation?.type === 'airfield'
        && city.installation?.status === 'ready');
    const pendingDirectAirdrop = world.caps.id === 'hard' && readyAirfields.some(af => {
        const range = 8;
        const readyRound = Number(af.installation?.airCommandReadyRound?.airdrop || 0);
        if (readyRound > world.round) return false;
        return world.cities.some(c => c.hostile && !c.garrison && c.hp <= 0
            && helpers.hexDistance(af, c.tile) <= range);
    });
    const pendingForwardAirfield = world.caps.id === 'hard' && !strategy.emergencyDefenseCity
        && currentAssaultCount >= 2 && gold >= 10
        && world.myCities.length >= 2 && existingAirfieldCount(world) < (world.oceanMap ? 3 : 2)
        && world.cities.some(c => c.mine && !c.tile.installation);
    function existingAirfieldCount(wObj) {
        return wObj.myCities.filter(c => c.installation?.type === 'airfield').length;
    }
    const strategicAirFund = pendingDirectAirdrop ? 10 : (pendingForwardAirfield && gold >= 8 ? 10 : 0);
    const isCapturerType = type => !['archer', 'warship', 'shoreBattery', 'submarine', 'carrier', 'destroyer', 'drone', 'mgNest']
        .includes(getUnitBaseType(type));
    const uniqueType = getCulturalRecruitmentCandidate(world.gameState, world.myCamp);
    const uniqueCount = uniqueType ? countLivingUnitsOfType(world.gameState, world.myCamp, uniqueType) : 0;
    let uniqueSlots = uniqueType ? getUniqueRecruitmentLimit(uniqueType) - uniqueCount : 0;
    const cityUnique = uniqueType && canUnitBeRecruitedAtSite(uniqueType, 'city');
    const uniqueCanCapture = cityUnique && getUnitBaseType(uniqueType) !== 'archer';
    const canRecruit = (type, site) => !helpers.canRecruitTypeAtSite || helpers.canRecruitTypeAtSite(type, site);
    const savingForUnique = uniqueType && uniqueCount === 0 && assaultCount > 0 && !strategy.emergencyDefenseCity
        && !canAfford(gold, unitCost(world, uniqueType), strategy)
        && world.tiles.some(tile => !tile.unit && tile.camp === world.myCamp
            && ((tile.isCity && cityUnique) || (tile.isPort && canUnitBeRecruitedAtSite(uniqueType, 'port')))
            && canRecruit(uniqueType, tile));
    const aiMemory = (world.gameState._aiCoreMemory ||= {});
    const memory = (aiMemory[world.myCampKey] ||= {});
    const returnPlan = memory.ministerReturn;
    const reservedForMinister = city => returnPlan && returnPlan.vacatedRound < world.round
        && returnPlan.cityQ === city.q && returnPlan.cityR === city.r;

    const isCanVacateOffCityExit = (tile, unit) => isLandTile(tile) || (unit.type === 'us_marine' && tile.isPort);
    const reinforceLedger = (memory.reinforceLedger ||= {});
    const reinforceRatio = strategy.posture === 'hold' ? 0.85 : W.reinforceHpRatio;
    const planWoundedRecovery = (reserveFloor, { onlyUrgent = false } = {}) => {
        const candidates = world.tiles
            .filter(t => t.unit && t.unit.camp === world.myCamp && !t._reinforcedThisTurn
                && !actions.some(a => a.type === 'reinforce' && a.unitId === t.unit.id)
                && canReinforceAtTile(t.unit, world.gameState))
            .map(tile => {
                const linked = getKmtLinkedUnits(tile.unit, world.gameState);
                const shared = linked.length > 0 ? getKmtSharedHealth(linked) : null;
                const effectiveRatio = shared ? shared.hp / Math.max(1, shared.maxHp) : tile.unit.hp / tile.unit.maxHp;
                const deficit = linked.length > 0
                    ? getKmtReinforceDeficit(tile.unit, world.gameState)
                    : Math.max(0, tile.unit.maxHp - tile.unit.hp);
                const isSafeRearStation = linked.length > 0 && tile.isCity && world.threatAt(tile, tile.unit) === 0;
                const onThreatenedCity = tile.isCity && tile.camp === world.myCamp && world.threatAt(tile, tile.unit) > 0;
                const urgentNeed = (onThreatenedCity && effectiveRatio < 0.65)
                    || (Boolean(tile.unit.commander) && effectiveRatio < 0.60)
                    || effectiveRatio < 0.45;
                return { tile, effectiveRatio, deficit, isSafeRearStation, onThreatenedCity, urgentNeed };
            })
            .filter(entry => entry.deficit > 0 && entry.effectiveRatio < reinforceRatio)
            .filter(entry => !onlyUrgent || entry.urgentNeed || entry.isSafeRearStation)
            .filter(entry => {
                const cap = entry.isSafeRearStation ? 4
                    : (entry.onThreatenedCity || entry.tile.unit.commander || (entry.tile.unit._rank || 0) >= 2 ? 3 : 2);
                return (reinforceLedger[entry.tile.unit.id] || 0) < cap;
            })
            .sort((a, b) => Number(b.isSafeRearStation) - Number(a.isSafeRearStation)
                || Number(b.urgentNeed) - Number(a.urgentNeed)
                || a.effectiveRatio - b.effectiveRatio);
        let reinforced = actions.filter(a => a.type === 'reinforce').length;
        const cap = strategy.posture === 'hold' ? 3 : 2;
        for (const { tile, deficit, onThreatenedCity, effectiveRatio } of candidates) {
            if (reinforced >= cap) break;
            if (savingForUnique && !(onThreatenedCity && effectiveRatio < 0.60)) continue;
            const heal = Math.min(Math.floor(tile.unit.maxHp * 0.50), deficit);
            const base = Math.ceil(tile.unit.config.cost * (heal / tile.unit.maxHp) * getCulturalReinforceCostScale(world.gameState, tile, world.myCamp));
            const cost = getHistoricalCost(Math.max(1, base), world.gameState, world.myCamp);
            if (heal <= 0 || gold - cost < tianyanProtectedFund(reserveFloor)) continue;
            actions.push({ type: 'reinforce', unitId: tile.unit.id });
            reinforceLedger[tile.unit.id] = (reinforceLedger[tile.unit.id] || 0) + 1;
            gold -= cost;
            earlySpend += cost;
            reinforced++;
        }

        // 停靠港口的受损舰先维修再开火/离港，不要求单位尚有行动力。
        for (const unit of world.myUnits) {
            if (savingForUnique) break;
            if (setup.some(a => a.type === 'repairShip' && a.unitId === unit.id)) continue;
            if (!canRepairShipAtPort(unit, world.gameState) || unit.tile._reinforcedThisTurn) continue;
            const urgentShip = unit.commander || unit.hp / unit.maxHp < 0.55 || world.threatAt(unit.tile, unit) > 0;
            if (onlyUrgent && !urgentShip) continue;
            const heal = Math.min(Math.floor(unit.maxHp * 0.5), unit.maxHp - unit.hp);
            if (heal < unit.maxHp * 0.2) continue;
            const cost = getHistoricalCost(Math.max(1, Math.ceil(unit.config.cost * heal / unit.maxHp)), world.gameState, world.myCamp);
            if (gold - cost < reserveFloor) continue;
            setup.unshift({ type: 'repairShip', unitId: unit.id });
            gold -= cost;
            earlySpend += cost;
        }
    };

    // ── 0. 产能腾位与紧急招募准备 ────────────────────────────
    let earlySpend = 0;
    let emergencyRecruitFund = strategy.reserve;
    const emptyCitiesAll = world.myCities.filter(city => !city.unit && !reservedForMinister(city))
        .sort((a, b) => Number(b === strategy.emergencyDefenseCity) - Number(a === strategy.emergencyDefenseCity));
    const urgentCities = new Set();
    let recruits = 0;
    const maxRecruits = world.caps.id === 'easy' ? 1 : world.caps.id === 'hard' ? 3 : 2;
    const landOrder = landRecruitOrder(world, missionsCtx, assaultCount > 0);
    const cityOrder = (site, order, urgent) => uniqueSlots > 0 && cityUnique
        && (uniqueCanCapture || (!urgent && assaultCount > 0)) && canRecruit(uniqueType, site)
        ? [uniqueType, ...order] : order;
    // 最紧急的空城保卫战先行拨款，避免前线补员花光保命买步兵的钱。
    for (const city of emptyCitiesAll) {
        if (recruits >= maxRecruits) break;
        const urgentLandRecruit = emergencyRecruitFund > 0
            && (world.myUnits.length <= 2 || city === strategy.emergencyDefenseCity);
        if (!urgentLandRecruit) continue;
        const types = cityOrder(city, LAND_ORDER, true);
        for (const type of types) {
            const cost = unitCost(world, type);
            if (cost > gold || !canRecruit(type, city)) continue;
            emergencyRecruits.push({ type: 'recruit', unitType: type, tileQ: city.q, tileR: city.r });
            emergencyRecruitFund = Math.max(0, emergencyRecruitFund - cost);
            gold -= cost;
            earlySpend += cost;
            if (isCapturerType(type)) currentAssaultCount++;
            if (type === uniqueType) uniqueSlots--;
            urgentCities.add(city);
            recruits++;
            break;
        }
    }

    // 在非紧急扩编之前先执行"能补员就补员"：重伤守军与将领优先保命回复。
    planWoundedRecovery(emergencyRecruitFund, { onlyUrgent: true });

    let vacatedCity = null;
    const hasEmptyCity = world.myCities.some(city => !city.unit);
    const hasMinisterCity = world.myCities.some(city => city.unit?.commander === 'minister');
    const ministerMayVacate = !hasEmptyCity && hasMinisterCity
        && shouldTemporarilyVacateMinister(world, strategy, memory);
    const needsUniqueSlot = cityUnique && uniqueCount === 0 && (assaultCount > 0 || uniqueCanCapture)
        && canAfford(gold, unitCost(world, uniqueType), strategy);
    const surplusRecruitSlot = world.caps.duelModel
        && gold - unitCost(world, 'infantry') - strategy.reserve >= 2;
    if (!hasEmptyCity && (strategy.assaultCapacity.needsProductionSlot || ministerMayVacate || needsUniqueSlot || surplusRecruitSlot)) {
        const candidates = world.myCities
            .filter(city => !reservedForMinister(city))
            .filter(city => city.unit && city.unit.camp === world.myCamp && city.unit.canAct)
            .filter(city => !shouldReserveCityGarrison(world, city.unit))
            .filter(city => ((!city.unit.commander && city.unit.type !== 'fr_heavy_cannon')
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
            const minister = city.unit.commander === 'minister';
            const urgent = minister && city.unit.type === 'fr_heavy_cannon'
                && world.myCities.length === 1 && strategy.assaultCapacity.deficit > 0;
            const type = cityOrder(emptySite, urgent ? LAND_ORDER : landOrder, urgent).find(candidate =>
                canAfford(gold, unitCost(world, candidate), strategy)
                && canRecruit(candidate, emptySite));
            if (!type) continue;
            const mobile = productionExitUnit(world, city.unit);
            if (!mobile) continue;
            const exits = helpers.getMovableTiles(mobile)
                .filter(tile => (!tile.unit || (world.isUnitVisible && !world.isUnitVisible(tile.unit)))
                    && !tile.isCity && isCanVacateOffCityExit(tile, city.unit) && world.threatAt(tile, city.unit) <= 20);
            if (exits.length === 0) continue;
            exits.sort((a, b) => world.threatAt(a, city.unit) - world.threatAt(b, city.unit));
            const move = {
                type: 'move', unitId: city.unit.id, tileQ: exits[0].q, tileR: exits[0].r,
                autoAttack: false
            };
            vacatedCity = city;
            if (minister) {
                move.returnToCity = { q: city.q, r: city.r, round: world.round };
            }
            if (mobile !== city.unit) setup.push({ type: 'heavyCannonStance', unitId: city.unit.id });
            setup.push(move, { type: 'recruit', unitType: type, tileQ: city.q, tileR: city.r });
            gold -= unitCost(world, type);
            earlySpend += unitCost(world, type);
            if (isCapturerType(type)) currentAssaultCount++;
            if (type === uniqueType) uniqueSlots--;
            recruits++;
            break;
        }
    }

    // ── 1. 常规城市招募 ──────────────────────────────────────
    const emptyCities = emptyCitiesAll.filter(city => city !== vacatedCity && !urgentCities.has(city));
    const emptyPorts = world.tiles.filter(t => t.isPort && t.camp === world.myCamp && !t.unit);
    const earlyUniquePort = uniqueSlots > 0 && !cityUnique && assaultCount > 0 && !savingForUnique
        && canUnitBeRecruitedAtSite(uniqueType, 'port')
        && gold - unitCost(world, uniqueType) >= tianyanProtectedFund(emergencyRecruitFund)
        && emptyPorts.find(port => canRecruit(uniqueType, port));
    if (earlyUniquePort) {
        actions.push({ type: 'recruit', unitType: uniqueType, tileQ: earlyUniquePort.q, tileR: earlyUniquePort.r });
        gold -= unitCost(world, uniqueType);
        if (isCapturerType(uniqueType)) currentAssaultCount++;
        uniqueSlots--;
    }
    const wProdEarly = world.weights || W;
    const earlyEmptyPorts = world.tiles.filter(t => t.isPort && t.camp === world.myCamp && !t.unit);
    const earlyMyWarships = world.myUnits.filter(u => getUnitBaseType(u) === 'warship').length;
    const earlyEnemyWarships = world.rivalUnits.filter(u => getUnitBaseType(u) === 'warship').length;
    const desiredWarships = (wProdEarly.navalWarshipBias ?? 1) > 1.2 ? Math.max(3, earlyEnemyWarships + 1) : Math.max(2, earlyEnemyWarships);
    const needCruiserLead = world.oceanMap && !strategy.emergencyDefenseCity
        && currentAssaultCount >= 2 && earlyEmptyPorts.length > 0 && earlyMyWarships < desiredWarships
        && !(world.myCities.some(c => !c.unit && world.threatAt(c, null) >= 40));
    const warshipCost = unitCost(world, 'warship');
    const navalOrderNow = navalRecruitOrder(world);
    let builtPriorityWarship = false;
    if (needCruiserLead && navalOrderNow[0] === 'warship'
        && gold - warshipCost >= emergencyRecruitFund
        && (!helpers.canRecruitTypeAtSite || helpers.canRecruitTypeAtSite('warship', earlyEmptyPorts[0]))) {
        actions.push({ type: 'recruit', unitType: 'warship', tileQ: earlyEmptyPorts[0].q, tileR: earlyEmptyPorts[0].r });
        gold -= warshipCost;
        recruits++;
        builtPriorityWarship = true;
    } else if (needCruiserLead && !builtPriorityWarship && gold < warshipCost + emergencyRecruitFund) {
        prodMemory.strategicSaveReserve = Math.max(prodMemory.strategicSaveReserve, Math.min(gold, warshipCost));
    }
    if (strategicAirFund > 0 && !strategy.emergencyDefenseCity) {
        prodMemory.strategicSaveReserve = Math.max(prodMemory.strategicSaveReserve, strategicAirFund);
    }
    const strategicReserveFloor = Math.max(emergencyRecruitFund, prodMemory.strategicSaveReserve || 0);

    for (const city of emptyCities) {
        if (recruits >= maxRecruits) break;
        if (savingForUnique) continue;
        const standard = helpers.recruitTypesForCity
            ? helpers.recruitTypesForCity(city, landOrder)
            : landOrder;
        const types = cityOrder(city, standard, false);
        for (const type of types) {
            const cost = unitCost(world, type);
            const cityUnderThreat = world.threatAt(city, null) >= 35;
            const diversifyCap = world.caps.id === 'hard' && !cityUnderThreat && !strategy.emergencyDefenseCity
                && !needCruiserLead && (type === 'cavalry' || type === 'archer')
                && currentAssaultCount >= 2;
            const reserveFloorHere = cityUnderThreat
                ? emergencyRecruitFund
                : diversifyCap
                    ? Math.max(2, (prodMemory.strategicSaveReserve || 0) - 6)
                    : strategicReserveFloor;
            const minFundAfterRecruit = tianyanProtectedFund(reserveFloorHere, false);
            if (gold - cost < minFundAfterRecruit) continue;
            if (!canRecruit(type, city)) continue;
            actions.push({ type: 'recruit', unitType: type, tileQ: city.q, tileR: city.r });
            gold -= cost;
            if (isCapturerType(type)) currentAssaultCount++;
            if (type === uniqueType) uniqueSlots--;
            recruits++;
            break;
        }
    }

    // ── 2. 港口招募：舰队有饱和上限，金币不能全变成占不了城的船。
    // 海军熔断：最近 3 回合内有舰船阵亡就停招——"排队送进岸防炮射程"的连败
    // 循环必须用记忆打断（阵亡的舰不占饱和数，单看饱和会永远补招）。
    const wProd = world.weights || W;
    const navalCount = world.myUnits.filter(u => world.isNaval(u)).length;
    const myWarshipsCount = world.myUnits.filter(u => getUnitBaseType(u) === 'warship').length;
    const enemyWarshipsCount = world.rivalUnits.filter(u => getUnitBaseType(u) === 'warship').length;
    const navalMemory = ((world.gameState._aiCoreMemory ||= {})[world.myCampKey] ||= {});
    if (Number.isFinite(navalMemory.lastNavalCount) && navalCount < navalMemory.lastNavalCount) {
        const trailingWarships = world.oceanMap && enemyWarshipsCount > myWarshipsCount;
        navalMemory.navalCooldownUntil = world.round + (trailingWarships ? 1 : 2);
    }
    navalMemory.lastNavalCount = navalCount;
    const navalCoolingDown = Number.isFinite(navalMemory.navalCooldownUntil)
        && world.round < navalMemory.navalCooldownUntil;
    const minAssaultForNavy = world.oceanMap ? 2 : 3;
    const fleetCap = Math.max(4, Math.round(assaultCount * 2 * (wProd.navalSaturatedScale ?? 1)));
    const fleetSaturated = navalCount >= fleetCap
        || assaultCount < minAssaultForNavy
        || navalCoolingDown;
    const hostileNavyPresent = world.rivalUnits.some(u => world.isNaval(u));
    const allowLandMapNavy = !world.oceanMap && hostileNavyPresent && navalCount < 1;
    const uniquePort = !earlyUniquePort && uniqueSlots > 0 && canUnitBeRecruitedAtSite(uniqueType, 'port')
        && gold - unitCost(world, uniqueType) >= tianyanProtectedFund(emergencyRecruitFund)
        && emptyPorts.find(port => canRecruit(uniqueType, port));
    if (uniquePort) {
        actions.push({ type: 'recruit', unitType: uniqueType, tileQ: uniquePort.q, tileR: uniquePort.r });
        gold -= unitCost(world, uniqueType);
        if (isCapturerType(uniqueType)) currentAssaultCount++;
    } else if (!earlyUniquePort && !savingForUnique && !fleetSaturated
        && (world.oceanMap || allowLandMapNavy)
        && emptyPorts.length > 0 && strategy.assaultCapacity.deficit === 0) {
        const order = navalRecruitOrder(world);
        for (const port of emptyPorts.slice(0, 1)) {
            if (!world.oceanMap && world.rivalUnits.some(u => world.isNaval(u) && u.tile
                && world.helpers.hexDistance(u.tile, port) <= 2)) continue;
            if (!builtPriorityWarship && needCruiserLead && order[0] === 'warship'
                && gold - warshipCost < tianyanProtectedFund(emergencyRecruitFund)) {
                break;
            }
            for (const type of order) {
                const cost = unitCost(world, type);
                if (gold - cost < tianyanProtectedFund(emergencyRecruitFund)) continue;
                if (helpers.canRecruitTypeAtSite && !helpers.canRecruitTypeAtSite(type, port)) continue;
                actions.push({ type: 'recruit', unitType: type, tileQ: port.q, tileR: port.r });
                gold -= cost;
                break;
            }
        }
    }

    // ── 3. 常规补员（轻中伤单位在有盈余时补满）──────────────────
    planWoundedRecovery(emergencyRecruitFund, { onlyUrgent: false });
    return {
        emergencyRecruits,
        setup,
        actions,
        earlySpend,
        recruitSpend: savingForUnique ? world.gold : world.gold - gold,
        remainingReserve: emergencyRecruitFund
    };
}
