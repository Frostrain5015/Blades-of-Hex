// 任务层 —— 把战略目标变成"有名有姓、跨回合存续"的单位编组。
//
// 旧架构每回合对全部单位重新贪心评分，于是占领者永远被局部最优拉回主线、
// 舰队每次重规划都换一个方向。任务层把"谁负责拿下哪座城"显式固化：
// 攻城（siege）、守备（garrison）、截杀（intercept）、侦察（scout）。
// 无任务单位由战术层按散兵处理。

import { assessSiegeMission } from '../strategy.js';
import { estimateCaptureEta } from './strategize.js';
import { rankCityObjectives } from './perceive.js';
import { W } from './weights.js';
import { duelExpectation } from './tactics.js';

let missionSerial = 0;

function missionStore(world) {
    const memory = (world.gameState._aiCoreMemory ||= {});
    const mine = (memory[world.myCampKey] ||= {});
    return (mine.missions ||= []);
}

function byId(world, id) {
    return world.myUnits.find(unit => unit.id === id) || null;
}

/** 占领者挑选：最近的能进城者；有记忆时优先原班人马，避免每回合换人。 */
function pickOccupier(world, cityTile, preferredId = null) {
    const candidates = world.myUnits
        .filter(unit => world.isCapturable(unit) && !world.isImmobile(unit))
        .sort((a, b) => {
            const da = world.helpers.hexDistance(a.tile, cityTile);
            const db = world.helpers.hexDistance(b.tile, cityTile);
            return da - db;
        });
    if (preferredId != null) {
        const remembered = candidates.find(unit => unit.id === preferredId);
        if (remembered) return remembered;
    }
    return candidates[0] || null;
}

function pickEscorts(world, occupier, cityTile, count, excludeIds) {
    if (!occupier || count <= 0) return [];
    const garrison = cityTile.unit && cityTile.unit.camp !== world.myCamp ? cityTile.unit : null;
    return world.myUnits
        .filter(unit => unit.id !== occupier.id && !excludeIds.has(unit.id))
        .filter(unit => !world.isImmobile(unit) && !world.isCapturable(unit))
        .filter(unit => !['minister', 'astrologer'].includes(unit.commander))
        .sort((a, b) => {
            // 守军还在时，优先选"打得动守军"的护航；否则选离占领者最近的。
            const score = unit => world.helpers.hexDistance(unit.tile, occupier.tile)
                + world.helpers.hexDistance(unit.tile, cityTile) * 0.35
                - (garrison ? Math.max(-40, Math.min(60, duelExpectation(world, unit, garrison))) * 0.8 : 0);
            return score(a) - score(b);
        })
        .slice(0, count);
}

/** 敌方"能占城的近战"逼近我方/中立城市时生成截杀任务。 */
function findInterceptTargets(world) {
    if (!world.caps.interceptPricing) return [];
    const targets = [];
    for (const unit of world.rivalUnits) {
        if (!world.isCapturable(unit) || !unit.tile) continue;
        let bestValue = 0;
        let bestCity = null;
        for (const city of world.cities) {
            if (city.ownerKey !== world.myCampKey && city.ownerKey !== 'neutral') continue;
            const distance = world.helpers.hexDistance(unit.tile, city.tile);
            if (distance > 3) continue;
            const value = city.asset.total * W.interceptBaseRatio * (1 - distance * 0.22)
                + (city.mine ? 40 : 0);
            if (value > bestValue) { bestValue = value; bestCity = city; }
        }
        if (bestCity) targets.push({ unit, value: bestValue, city: bestCity });
    }
    return targets.sort((a, b) => b.value - a.value);
}

/** 侦察目标：朝情报最陈旧的方向，或未知邻格最多的前沿。 */
function pickScoutDestination(world, scoutUnit) {
    const helpers = world.helpers;
    let best = null;
    let bestScore = 0;
    for (const tile of world.tiles) {
        if (tile.unit) continue;
        if (world.fog && world.explored(tile)) continue;
        const distance = helpers.hexDistance(scoutUnit.tile, tile);
        if (distance > 10) continue;
        let unknown = 0;
        for (const [dq, dr] of helpers.HEX_NEIGHBORS) {
            const neighbor = world.tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (neighbor && !world.explored(neighbor)) unknown++;
        }
        const score = unknown * W.scoutValuePerUnknown + world.stalestRivalAge * 2 - distance * 0.8;
        if (score > bestScore) { bestScore = score; best = tile; }
    }
    return best;
}

/**
 * 任务分配主入口。返回 { missions, assignment: Map<unitId, mission> }。
 * 同时把任务写回记忆，供跨回合持续与下回合校验。
 */
export function assignMissions(world, strategy) {
    const store = missionStore(world);
    const previous = world.caps.missionPersistence ? store : [];
    const missions = [];
    const assigned = new Set();

    // ── 1. 攻城任务（最多 2 条，按资产/ETA 排序）────────────────
    const ranked = rankCityObjectives(world, city => estimateCaptureEta(world, city))
        .filter(entry => entry.eta < 99);
    // 死斗姿态只抢最快能兑现的城，不再按资产排序。
    if (strategy.posture === 'allin') ranked.sort((a, b) => a.eta - b.eta);
    const siegeBudget = strategy.posture === 'allin' ? 1
        : strategy.posture === 'hold' ? 0
        : Math.min(2, ranked.length ? 1 + (world.myUnits.length >= 8 ? 1 : 0) : 0);
    for (const entry of ranked.slice(0, siegeBudget)) {
        const city = entry.city;
        const prior = previous.find(m => m.kind === 'siege'
            && m.targetQ === city.tile.q && m.targetR === city.tile.r);
        const occupier = pickOccupier(world, city.tile, prior?.occupierId ?? null);
        if (!occupier) break;
        assigned.add(occupier.id);
        const escortCount = !world.caps.multiEscort ? 1 : (world.oceanMap ? 2 : 1);
        const escorts = pickEscorts(world, occupier, city.tile, escortCount, assigned);
        escorts.forEach(unit => assigned.add(unit.id));
        const missionState = assessSiegeMission({
            cityOwned: false,
            cityOccupied: !!city.garrison,
            cityHp: city.hp,
            occupierDistance: world.helpers.hexDistance(occupier.tile, city.tile),
            occupierMoveRange: Number(occupier.config?.speed) || 1,
            escortCount: escorts.length
        });
        missions.push({
            id: prior?.id || `m${++missionSerial}`,
            kind: 'siege',
            targetQ: city.tile.q, targetR: city.tile.r,
            cityValue: city.asset.total,
            occupierId: occupier.id,
            escortIds: escorts.map(u => u.id),
            phase: prior && prior.phase !== 'hold' ? prior.phase : missionState.phase,
            createdRound: prior?.createdRound ?? world.round,
            garrisonHp: city.garrison ? city.garrison.hp : 0
        });
    }

    // ── 2. 守备任务：只响应"真能占城"的威胁 ─────────────────
    // 潜艇/岸防炮能造成伤害却永远占不了城——按威胁图回填只会让守军永远不出门。
    const enemyCapturerNear = cityTile => world.rivalUnits.some(unit =>
        world.isCapturable(unit) && unit.tile
        && world.helpers.hexDistance(unit.tile, cityTile) <= 4);
    for (const cityTile of world.myCities) {
        const capturerNear = enemyCapturerNear(cityTile);
        const garrison = cityTile.unit && cityTile.unit.camp === world.myCamp ? cityTile.unit : null;
        const threatened = capturerNear || strategy.posture === 'defend';
        if (garrison && (world.isCapturable(garrison) || garrison.commander === 'minister')) {
            if (threatened || world.isImmobile(garrison) || garrison.commander === 'minister'
                || strategy.posture === 'hold') {
                assigned.add(garrison.id);
                missions.push({
                    id: `m${++missionSerial}`, kind: 'garrison',
                    targetQ: cityTile.q, targetR: cityTile.r,
                    occupierId: garrison.id, escortIds: [],
                    phase: 'hold', createdRound: world.round
                });
            }
            continue;
        }
        if (!garrison && (capturerNear || strategy.posture === 'hold')) {
            // 空城受威胁：找最近的能进城者回填。
            const filler = pickOccupier(world, cityTile);
            if (filler && !assigned.has(filler.id)) {
                assigned.add(filler.id);
                missions.push({
                    id: `m${++missionSerial}`, kind: 'garrison',
                    targetQ: cityTile.q, targetR: cityTile.r,
                    occupierId: filler.id, escortIds: [],
                    phase: 'approach', createdRound: world.round
                });
            }
        }
    }

    // ── 3. 截杀任务（按价值分配最近的空闲战斗单位）─────────────
    for (const target of findInterceptTargets(world).slice(0, 2)) {
        const hunters = world.myUnits
            .filter(unit => !assigned.has(unit.id) && !world.isImmobile(unit))
            .filter(unit => !['minister', 'astrologer'].includes(unit.commander))
            .sort((a, b) => world.helpers.hexDistance(a.tile, target.unit.tile)
                - world.helpers.hexDistance(b.tile, target.unit.tile))
            .slice(0, 2);
        if (hunters.length === 0) continue;
        hunters.forEach(unit => assigned.add(unit.id));
        missions.push({
            id: `m${++missionSerial}`, kind: 'intercept',
            targetQ: target.unit.tile.q, targetR: target.unit.tile.r,
            targetUnitId: target.unit.id,
            value: target.value,
            occupierId: hunters[0].id,
            escortIds: hunters.slice(1).map(u => u.id),
            phase: 'hunt', createdRound: world.round
        });
    }

    // ── 4. 侦察任务 ──────────────────────────────────────────
    if (strategy.needsScout) {
        const scout = world.myUnits
            .filter(unit => !assigned.has(unit.id) && !world.isImmobile(unit))
            .sort((a, b) => (Number(b.config?.speed) || 0) - (Number(a.config?.speed) || 0)
                || (Number(a.config?.cost) || 99) - (Number(b.config?.cost) || 99))[0];
        const destination = scout ? pickScoutDestination(world, scout) : null;
        if (scout && destination) {
            assigned.add(scout.id);
            missions.push({
                id: `m${++missionSerial}`, kind: 'scout',
                targetQ: destination.q, targetR: destination.r,
                occupierId: scout.id, escortIds: [],
                phase: 'approach', createdRound: world.round
            });
        }
    }

    // 写回记忆（只留仍有效的；攻城任务在城市易主后退役）。
    const alive = missions.filter(mission => {
        if (mission.kind === 'siege') {
            const city = world.cities.find(c => c.tile.q === mission.targetQ && c.tile.r === mission.targetR);
            return city && city.hostile;
        }
        if (mission.kind === 'garrison') {
            const city = world.cities.find(c => c.tile.q === mission.targetQ && c.tile.r === mission.targetR);
            return city && city.mine;
        }
        return true;
    });
    store.length = 0;
    store.push(...alive);

    const assignment = new Map();
    for (const mission of alive) {
        for (const id of [mission.occupierId, ...(mission.escortIds || [])]) {
            if (id != null) assignment.set(id, mission);
        }
    }
    return { missions: alive, assignment };
}
