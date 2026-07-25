// 生产层 —— 招募、补员、产能格管理。
//
// 真人对局的两条课：
//   1. 产能结构锁死战略选择（紫军尚书坐城 → 终身无陆军）。突击兵缺口存在时，
//      安全后方的城市必须腾位招兵，而不是让一个普通守军占住唯一产能格。
//   2. 守军是固定资产：残血守军花几金补员，比阵亡后重招便宜得多。

import { W } from './weights.js';

const NAVAL_ORDER = ['warship', 'destroyer', 'submarine'];
const LAND_ORDER = ['infantry', 'cavalry', 'archer'];

function canAfford(world, cost, strategy, extraReserve = 0) {
    return world.gold - cost - strategy.reserve - extraReserve >= 0;
}

/** 招募城市兵种：突击缺口时步兵/骑兵置顶（对齐真人"城就是产能"的认知）。 */
function landRecruitOrder(world, strategy) {
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

export function planProduction(world, strategy, missionsCtx) {
    const actions = [];
    const helpers = world.helpers;
    let gold = world.gold;

    // ── 0. 产能腾位：突击缺口 + 无空城 → 安全后方城市的普通守军出城 ──
    //    尚书与受威胁城市不参与让位（屯田收入与城防都比一个招募位重要）。
    let vacatedCity = null;
    if (strategy.assaultCapacity.needsProductionSlot) {
        const candidates = world.myCities
            .filter(city => city.unit && city.unit.camp === world.myCamp)
            .filter(city => !city.unit.commander && !world.isImmobile(city.unit))
            // 有守备任务的城市不腾位（受威胁时守城优先于产能）。
            .filter(city => missionsCtx.assignment.get(city.unit.id)?.kind !== 'garrison')
            .filter(city => world.threatAt(city, city.unit) <= 30);
        for (const city of candidates) {
            const exits = helpers.getMovableTiles(city.unit)
                .filter(tile => !tile.unit && !tile.isCity && world.threatAt(tile, city.unit) <= 20);
            if (exits.length === 0) continue;
            exits.sort((a, b) => world.threatAt(a, city.unit) - world.threatAt(b, city.unit));
            actions.push({ type: 'move', unitId: city.unit.id, tileQ: exits[0].q, tileR: exits[0].r });
            vacatedCity = city;
            break;
        }
    }

    // ── 1. 城市招募（含腾出来的格子）──────────────────────────
    const emptyCities = world.myCities.filter(city => !city.unit || city === vacatedCity);
    const landOrder = landRecruitOrder(world, strategy);
    let recruits = 0;
    const maxRecruits = world.caps.id === 'easy' ? 1 : 2;
    for (const city of emptyCities) {
        if (recruits >= maxRecruits) break;
        const types = helpers.recruitTypesForCity
            ? helpers.recruitTypesForCity(city, landOrder)
            : landOrder;
        for (const type of types) {
            const cost = helpers.UNIT_CONFIG[type]?.cost ?? 99;
            if (!canAfford(world, cost, strategy)) continue;
            if (helpers.canRecruitTypeAtSite && !helpers.canRecruitTypeAtSite(type, city)) continue;
            actions.push({ type: 'recruit', unitType: type, tileQ: city.q, tileR: city.r });
            gold -= cost;
            recruits++;
            break;
        }
    }

    // ── 2. 港口招募：舰队有饱和上限，金币不能全变成占不了城的船。
    // 海军熔断：最近 3 回合内有舰船阵亡就停招——"排队送进岸防炮射程"的连败
    // 循环必须用记忆打断（阵亡的舰不占饱和数，单看饱和会永远补招）。
    const navalCount = world.myUnits.filter(u => world.isNaval(u)).length;
    const assaultCount = world.myUnits.filter(u => world.isCapturable(u)).length;
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
                if (!canAfford(world, cost, strategy)) continue;
                if (helpers.canRecruitTypeAtSite && !helpers.canRecruitTypeAtSite(type, port)) continue;
                actions.push({ type: 'recruit', unitType: type, tileQ: port.q, tileR: port.r });
                gold -= cost;
                break;
            }
        }
    }

    // ── 3. 补员：守军是固定资产，残血补员远便宜于重招；
    //    同一单位最多补 2 次（补到第 3 次还死，说明站位本身就是错的）。
    const aiMemory = (world.gameState._aiCoreMemory ||= {});
    const memory = (aiMemory[world.myCampKey] ||= {});
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
        if (gold < 4) break;
        actions.push({ type: 'reinforce', unitId: tile.unit.id });
        reinforceLedger[tile.unit.id] = (reinforceLedger[tile.unit.id] || 0) + 1;
        gold -= 4;
        reinforced++;
    }

    return { actions, recruitSpend: world.gold - gold };
}
