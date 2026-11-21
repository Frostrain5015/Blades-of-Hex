// 2-Ply 对抗式 MiniMax + Alpha-Beta 剪枝与夺城静态延展（Quiescence）搜索引擎——
// 在 MAX 动作（我方攻击/攻城/占城/移防/募兵/战术牌）之后，显式推演敌方最强 1–2 步联合反扑
// （优先排序：空城/低血城反占 -> 击杀将领/精锐 -> 破城补刀），利用 Alpha-Beta 剪枝在 <14ms 内
// 精准识别并重罚"离城被反偷"、"卖将领白送"、"丢关键城门"等致命失误，同时放大可守可攻的胜势路线。
//
// 严格保持纯前端浏览器可打包（不引入 node:*、js/* 或 tools/*）。

import { campToKey } from '../../rules/camps.js';
import { TACTICAL_CARD_DATA } from '../../rules/cards.js';
import { COMMANDER_CONFIG } from '../../rules/commanders.js';
import { UNIT_CONFIG } from '../../rules/units.js';
import { getAntiAirReduction } from '../../rules/antiAir.js';
import { COMBAT_BALANCE } from '../../rules/constants.js';
import { estimateSiegeDamage } from '../doctrine.js';
import { hpGold, residualGold } from './weights.js';
import { isFieldCapturer } from './roster.js';

const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

function coordDist(a, b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) >> 1;
}

function cloneMapOfObjects(src) {
    const out = new Map();
    for (const [k, v] of src.entries()) out.set(k, { ...v });
    return out;
}

function getUnitSpeed(unit) {
    return Math.max(1, Number(unit?.getEffectiveSpeed?.() ?? unit?.config?.speed ?? 3));
}

function getUnitRange(unit) {
    return Math.max(1, Number(unit?.getEffectiveRange?.() ?? unit?.config?.range ?? 1));
}

function getUnitAttack(unit) {
    return Math.max(1, Number(unit?.getEffectiveAttack?.() ?? unit?.config?.attack ?? 20));
}

function isHostileLandCompatible(attacker, tile) {
    if (!tile) return false;
    const water = String(tile.surface || '').includes('Water');
    const naval = attacker.naval;
    if (naval) return water || !!tile.isPort;
    // 陆军可涉水登船，也可贴海滩城市攻占；在极简邻接判定内允许城市与陆地
    return !water || !!tile.isCity || !!tile.isPort;
}

export function snapshotAdversarialState(state, world) {
    const myCampKey = world.myCampKey;
    const myUnits = new Map();
    const rivalUnits = new Map();
    const neutralUnits = new Map();
    const cities = new Map();
    const occupied = new Map();

    const registerUnit = (unit, side) => {
        if (!unit?.tile || unit.hp <= 0) return null;
        const entry = {
            id: unit.id,
            unitRef: unit,
            camp: unit.camp,
            campKey: campToKey(unit.camp),
            side,
            hp: Number(unit.hp || 0),
            maxHp: Math.max(1, Number(unit.maxHp || unit.config?.hp || 100)),
            shield: Number(unit.activeShield ?? unit._shield ?? 0),
            q: unit.tile.q,
            r: unit.tile.r,
            canAct: !!unit.canAct && !unit.isNewRecruit,
            stunned: !!unit._imprisoned,
            commander: unit.commander || null,
            cost: Math.max(2, Number(unit.config?.cost || 8)),
            isCapturer: side === 'mine'
                ? isFieldCapturer(world, unit)
                : Boolean(world.isCapturable?.(unit) && !world.isImmobile?.(unit)),
            attack: getUnitAttack(unit),
            range: getUnitRange(unit),
            speed: getUnitSpeed(unit),
            naval: unit.config?.movementDomain === 'naval',
            hpG: hpGold(unit),
            resG: residualGold(unit)
        };
        occupied.set(`${entry.q},${entry.r}`, { side, id: entry.id });
        return entry;
    };

    for (const u of world.myUnits || []) {
        const e = registerUnit(u, 'mine');
        if (e) myUnits.set(e.id, e);
    }
    for (const u of world.rivalUnits || []) {
        const e = registerUnit(u, 'rival');
        if (e) rivalUnits.set(e.id, e);
    }
    for (const u of world.neutralUnits || []) {
        const e = registerUnit(u, 'neutral');
        if (e) neutralUnits.set(e.id, e);
    }

    for (const c of world.cities || []) {
        if (!c?.tile) continue;
        const ownerKey = campToKey(c.tile.camp);
        const owner = ownerKey === myCampKey
            ? 'mine'
            : (c.hostile && ownerKey !== 'neutral' ? 'rival' : (c.hostile ? 'neutral' : 'ally'));
        cities.set(`${c.tile.q},${c.tile.r}`, {
            q: c.tile.q,
            r: c.tile.r,
            campKey: ownerKey,
            owner,
            hp: Number(c.hp ?? c.tile.hp ?? 0),
            maxHp: Math.max(100, Number(c.tile.maxHp || 250)),
            isPort: !!c.tile.isPort
        });
    }

    return { myUnits, rivalUnits, neutralUnits, cities, occupied };
}

function estimateCounterDmg(world, attacker, target) {
    if (!world?.combat || !attacker?.unitRef || !target?.unitRef) return 0;
    const dist = coordDist(attacker, target);
    if (attacker.range > 1 || target.range > 1 || dist > target.range) return 0;
    const tile = world.tileMap?.get(`${attacker.q},${attacker.r}`) || attacker.unitRef.tile;
    return Math.max(0, Number(world.combat.estimateDamage(target.unitRef, attacker.unitRef, tile) || 0));
}

function estimateHitDmg(world, attacker, target) {
    if (world?.combat && attacker?.unitRef && target?.unitRef) {
        const tile = world.tileMap?.get(`${target.q},${target.r}`) || target.unitRef.tile;
        return Math.max(1, Number(world.combat.estimateDamage(attacker.unitRef, target.unitRef, tile) || attacker.attack));
    }
    return attacker.attack;
}

function cloneSimState(sim) {
    return {
        myUnits: cloneMapOfObjects(sim.myUnits),
        rivalUnits: cloneMapOfObjects(sim.rivalUnits),
        neutralUnits: cloneMapOfObjects(sim.neutralUnits),
        cities: cloneMapOfObjects(sim.cities),
        occupied: new Map(sim.occupied)
    };
}

/**
 * 静态对抗局面评估：覆盖 2P/3P 城差、城防血量、部队战力与将领生存、残局未设防空城威胁。
 */
export function evaluateMinimaxBoard(sim, world, strategy) {
    const round = Number(world.round || 1);
    const roundsLeft = Number(world.roundsRemaining ?? Math.max(1, 20 - round));
    const lateScale = (round >= 12 || roundsLeft <= 6) ? 1.42 : (round >= 8 ? 1.15 : 1.0);
    const deficitScale = (world.cityGap ?? 0) <= 0 ? 1.22 : 1.0;
    const cityVal = 265 * lateScale * deficitScale;

    let myCityCount = 0;
    const rivalCitiesByCamp = new Map();
    for (const c of sim.cities.values()) {
        if (c.owner === 'mine') {
            myCityCount++;
        } else if (c.owner === 'rival') {
            const ck = c.campKey || 'rival';
            rivalCitiesByCamp.set(ck, (rivalCitiesByCamp.get(ck) || 0) + 1);
        }
    }
    let maxRivalCities = 0;
    for (const cnt of rivalCitiesByCamp.values()) maxRivalCities = Math.max(maxRivalCities, cnt);

    let score = (myCityCount - maxRivalCities) * cityVal;

    const myCapturers = [];
    const rivalCapturers = [];

    for (const u of sim.myUnits.values()) {
        score += u.hp * u.hpG + u.shield * u.hpG * 0.78 + u.resG * 0.45 + (u.commander ? 70 : 0);
        if (u.isCapturer) myCapturers.push(u);
        if (u.commander && u.hp < u.maxHp * 0.36) {
            const dangerClose = Array.from(sim.rivalUnits.values()).some(e =>
                coordDist(u, e) <= e.speed + e.range);
            if (dangerClose) score -= 58;
        }
    }

    for (const e of sim.rivalUnits.values()) {
        score -= (e.hp * e.hpG + e.shield * e.hpG * 0.78 + e.resG * 0.42 + (e.commander ? 65 : 0)) * 0.96;
        if (e.isCapturer) rivalCapturers.push(e);
    }

    for (const n of sim.neutralUnits.values()) {
        score -= (n.hp * n.hpG + n.resG * 0.25) * 0.35;
    }

    // 城防半损、临近占领转化、与已空出己方城防危险
    for (const [cKey, city] of sim.cities.entries()) {
        const occ = sim.occupied.get(cKey);
        if (city.owner === 'mine') {
            score -= (city.maxHp - city.hp) * 0.65;
            if (!occ || occ.side !== 'mine') {
                const capInRange = rivalCapturers.some(e =>
                    coordDist(e, city) <= e.speed);
                if (city.hp <= 0 && capInRange) {
                    score -= 220;
                } else if (city.hp <= 55 && capInRange) {
                    score -= 105;
                }
            }
        } else if (city.owner === 'rival' || city.owner === 'neutral') {
            const weight = city.owner === 'rival' ? 0.56 : 0.42;
            score += (city.maxHp - city.hp) * weight;
            if ((!occ || occ.side !== city.owner) && city.hp <= 50) {
                const reachCap = myCapturers.some(m =>
                    coordDist(m, city) <= m.speed);
                if (reachCap) score += city.owner === 'rival' ? 58 : 42;
            }
        }
    }

    return score;
}

function tryQuiescenceFriendlyCapture(sim, world, cityKey) {
    const city = sim.cities.get(cityKey);
    if (!city || city.owner === 'mine' || city.hp > 0 || sim.occupied.has(cityKey)) return;
    for (const ally of sim.myUnits.values()) {
        if (!ally.canAct || ally.stunned || !ally.isCapturer) continue;
        if (coordDist(ally, city) <= ally.speed) {
            sim.occupied.delete(`${ally.q},${ally.r}`);
            ally.q = city.q;
            ally.r = city.r;
            ally.canAct = false;
            sim.occupied.set(cityKey, { side: 'mine', id: ally.id });
            city.owner = 'mine';
            city.campKey = world.myCampKey;
            return;
        }
    }
}

export function applyMaxCandidateToSim(baseSim, cand, world) {
    if (!cand || cand.actionType === 'endTurn') return cloneSimState(baseSim);

    if ((cand.actionType === 'airCommand' && cand.commandKind === 'airdrop')
        || (cand.actionType === 'tacticalCard' && cand.cardId === 'airdrop')) {
        const key = `${cand.q},${cand.r}`;
        const city = baseSim.cities.get(key);
        if (baseSim.occupied.has(key) || (city && city.owner !== 'mine' && city.hp > 0)) return null;
        const sim = applyMaxCandidateToSim(baseSim, { actionType: 'recruit', unitType: 'infantry', q: cand.q, r: cand.r }, world);
        if (!sim) return null;
        const unit = sim.myUnits.get(`sim_rec_${cand.q}_${cand.r}`);
        if (cand.actionType === 'tacticalCard') {
            unit.hp = Math.min(unit.maxHp, TACTICAL_CARD_DATA.airdrop.balance.infantryHp);
        } else {
            const tile = world.tileMap?.get(key);
            const reduction = tile ? getAntiAirReduction(tile, world.myCamp, world.tileMap, { state: world.gameState, airspace: true }) : 0;
            unit.hp = Math.max(1, unit.maxHp - Math.round(unit.maxHp * Math.min(COMBAT_BALANCE.defense.maximumReduction, reduction)));
        }
        if (city && city.owner !== 'mine') {
            const captured = sim.cities.get(key);
            captured.owner = 'mine';
            captured.campKey = world.myCampKey;
        }
        return sim;
    }

    if (cand.actionType === 'attack') {
        const attacker = baseSim.myUnits.get(cand.unitId);
        if (!attacker || !attacker.canAct || attacker.stunned) return null;
        const sim = cloneSimState(baseSim);
        const simAttacker = sim.myUnits.get(cand.unitId);
        const cKey = `${cand.q},${cand.r}`;

        if (cand.isCitySiege) {
            const city = sim.cities.get(cKey);
            if (!city || city.owner === 'mine' || city.hp <= 0 || coordDist(attacker, city) > attacker.range) return null;
            const cityTile = world.tileMap?.get(cKey);
            const siegeDmg = Number(world.estimateSiegeDamage?.(attacker.unitRef, cityTile)
                ?? estimateSiegeDamage(attacker.unitRef, cityTile)
                ?? attacker.attack);
            city.hp = Math.max(0, city.hp - siegeDmg);
            simAttacker.canAct = false;
            if (city.hp <= 0) tryQuiescenceFriendlyCapture(sim, world, cKey);
            return sim;
        }

        const targetMap = sim.rivalUnits.has(cand.targetId) ? sim.rivalUnits : sim.neutralUnits;
        const target = targetMap.get(cand.targetId);
        if (!target || target.hp <= 0 || coordDist(attacker, target) > attacker.range) return null;

        const dmg = estimateHitDmg(world, attacker, target);
        const pool = target.hp + target.shield;
        const killed = dmg >= pool;
        const counter = killed ? 0 : estimateCounterDmg(world, attacker, target);

        if (killed) {
            sim.occupied.delete(`${target.q},${target.r}`);
            targetMap.delete(target.id);
        } else {
            const remShield = Math.max(0, target.shield - dmg);
            target.hp = Math.max(1, target.hp - Math.max(0, dmg - target.shield));
            target.shield = remShield;
        }

        const myPool = simAttacker.hp + simAttacker.shield;
        if (counter >= myPool) {
            sim.occupied.delete(`${simAttacker.q},${simAttacker.r}`);
            sim.myUnits.delete(simAttacker.id);
        } else {
            const myShield = Math.max(0, simAttacker.shield - counter);
            simAttacker.hp = Math.max(1, simAttacker.hp - Math.max(0, counter - simAttacker.shield));
            simAttacker.shield = myShield;
            simAttacker.canAct = false;
        }

        if (killed) {
            const city = sim.cities.get(`${target.q},${target.r}`);
            if (city && city.owner !== 'mine') {
                if (city.hp <= 0 && sim.myUnits.has(simAttacker.id)
                    && simAttacker.isCapturer
                    && coordDist(simAttacker, city) === 1) {
                    sim.occupied.delete(`${simAttacker.q},${simAttacker.r}`);
                    simAttacker.q = city.q;
                    simAttacker.r = city.r;
                    sim.occupied.set(`${city.q},${city.r}`, { side: 'mine', id: simAttacker.id });
                    city.owner = 'mine';
                    city.campKey = world.myCampKey;
                } else {
                    tryQuiescenceFriendlyCapture(sim, world, `${city.q},${city.r}`);
                }
            }
        }
        return sim;
    }

    if (cand.actionType === 'move') {
        const mover = baseSim.myUnits.get(cand.unitId);
        if (!mover || !mover.canAct || mover.stunned) return null;
        const sim = cloneSimState(baseSim);
        const simMover = sim.myUnits.get(cand.unitId);
        const destKey = `${cand.q},${cand.r}`;
        if (sim.occupied.has(destKey)) return null;
        sim.occupied.delete(`${simMover.q},${simMover.r}`);
        simMover.q = cand.q;
        simMover.r = cand.r;
        simMover.canAct = false;
        sim.occupied.set(destKey, { side: 'mine', id: simMover.id });
        const city = sim.cities.get(destKey);
        if (city && city.owner !== 'mine' && city.hp <= 0 && simMover.isCapturer) {
            city.owner = 'mine';
            city.campKey = world.myCampKey;
        }
        return sim;
    }

    if (cand.actionType === 'recruit') {
        const siteKey = `${cand.q},${cand.r}`;
        if (baseSim.occupied.has(siteKey)) return null;
        const sim = cloneSimState(baseSim);
        const utype = cand.unitType || 'infantry';
        const cfg = world.helpers?.UNIT_CONFIG?.[utype] || UNIT_CONFIG[utype];
        if (!cfg) return null;
        const fakeId = `sim_rec_${cand.q}_${cand.r}`;
        const fakeRef = { type: utype, hp: cfg.hp, maxHp: cfg.hp, config: cfg };
        sim.myUnits.set(fakeId, {
            id: fakeId,
            unitRef: fakeRef,
            camp: world.myCamp,
            campKey: world.myCampKey,
            side: 'mine',
            hp: cfg.hp,
            maxHp: cfg.hp,
            shield: 0,
            q: cand.q,
            r: cand.r,
            canAct: false,
            stunned: false,
            commander: null,
            cost: Number(cfg.cost || 8),
            isCapturer: !['archer', 'warship', 'destroyer', 'submarine', 'carrier', 'mgNest', 'shoreBattery'].includes(utype),
            attack: Number(cfg.attack || 26),
            range: Number(cfg.range || 1),
            speed: Number(cfg.speed || 3),
            naval: cfg.movementDomain === 'naval',
            hpG: hpGold(fakeRef),
            resG: residualGold(fakeRef)
        });
        sim.occupied.set(siteKey, { side: 'mine', id: fakeId });
        return sim;
    }

    if (cand.actionType === 'tacticalCard') {
        const sim = cloneSimState(baseSim);
        const cid = cand.cardId;
        if (cid === 'heal' || cid === 'shield') {
            const ally = sim.myUnits.get(cand.targetId)
                || Array.from(sim.myUnits.values()).find(u => u.q === cand.q && u.r === cand.r);
            if (!ally) return null;
            if (cid === 'heal') {
                ally.hp = Math.min(ally.maxHp, ally.hp + Math.round(ally.maxHp * TACTICAL_CARD_DATA.heal.balance.healMaxHpPct));
            } else {
                ally.shield += Number(TACTICAL_CARD_DATA.shield?.balance?.shield || 60);
            }
            return sim;
        }
        if (['lightning', 'imprison', 'poison', 'orbitalStrike'].includes(cid)) {
            const dmg = Number(TACTICAL_CARD_DATA[cid]?.balance?.damage || (cid === 'lightning' ? TACTICAL_CARD_DATA.lightning.balance.maxDamage : 0));
            const target = sim.rivalUnits.get(cand.targetId)
                || sim.neutralUnits.get(cand.targetId)
                || Array.from(sim.rivalUnits.values()).find(e => e.q === cand.q && e.r === cand.r);
            if (target) {
                const map = target.side === 'rival' ? sim.rivalUnits : sim.neutralUnits;
                if (dmg >= target.hp + target.shield) {
                    sim.occupied.delete(`${target.q},${target.r}`);
                    map.delete(target.id);
                    tryQuiescenceFriendlyCapture(sim, world, `${target.q},${target.r}`);
                } else if (dmg > 0) {
                    const sRem = Math.max(0, target.shield - dmg);
                    target.hp = Math.max(1, target.hp - Math.max(0, dmg - target.shield));
                    target.shield = sRem;
                }
                if (cid === 'imprison') target.stunned = true;
            } else return null;
            return sim;
        }
        return sim;
    }

    if (cand.actionType === 'droneSuicide' || cand.actionType === 'banzaiCharge') {
        const attacker = baseSim.myUnits.get(cand.unitId);
        const target = baseSim.rivalUnits.get(cand.targetId)
            || baseSim.neutralUnits.get(cand.targetId)
            || Array.from(baseSim.rivalUnits.values()).find(e => e.q === cand.q && e.r === cand.r);
        if (!attacker || !attacker.canAct || attacker.stunned || !target) return null;
        const sim = cloneSimState(baseSim);
        const simAtt = sim.myUnits.get(cand.unitId);
        const targetMap = sim.rivalUnits.has(target.id) ? sim.rivalUnits : sim.neutralUnits;
        const simTarget = targetMap.get(target.id);
        const dmg = cand.actionType === 'droneSuicide'
            ? COMMANDER_CONFIG.tianyan.balance.droneSuicideDamage
            : Math.max(attacker.attack * 1.35, estimateHitDmg(world, attacker, target) * 1.25);
        if (dmg >= simTarget.hp + simTarget.shield) {
            sim.occupied.delete(`${simTarget.q},${simTarget.r}`);
            targetMap.delete(simTarget.id);
            tryQuiescenceFriendlyCapture(sim, world, `${simTarget.q},${simTarget.r}`);
        } else {
            const sRem = Math.max(0, simTarget.shield - dmg);
            simTarget.hp = Math.max(1, simTarget.hp - Math.max(0, dmg - simTarget.shield));
            simTarget.shield = sRem;
        }
        if (cand.actionType === 'droneSuicide') {
            sim.occupied.delete(`${simAtt.q},${simAtt.r}`);
            sim.myUnits.delete(simAtt.id);
        } else {
            simAtt.canAct = false;
        }
        return sim;
    }

    return cloneSimState(baseSim);
}

/**
 * 为 MIN 层生成最高威胁的敌方反扑候选（按夺城 -> 击杀将领 -> 破防/点杀 MVV-LVA 排序）。
 */
export function generateAdversarialMinActions(sim, world, maxActions = 10) {
    const actions = [];

    for (const enemy of sim.rivalUnits.values()) {
        if (enemy.hp <= 0 || enemy.stunned) continue;

        // 1. 直接步入己方或中立 0HP 空城（夺城反转）
        if (enemy.isCapturer) {
            for (const [cKey, city] of sim.cities.entries()) {
                if (city.owner === 'rival' || city.hp > 0 || sim.occupied.has(cKey)) continue;
                const d = coordDist(enemy, city);
                if (d > enemy.speed) continue;
                const tile = world.tileMap?.get(cKey);
                if (!isHostileLandCompatible(enemy, tile)) continue;
                actions.push({
                    kind: 'minCapture',
                    actorId: enemy.id,
                    campKey: enemy.campKey,
                    q: city.q,
                    r: city.r,
                    priority: city.owner === 'mine' ? 520 : 280
                });
            }
        }

        // 2. 轰击/攻打己方空城或残防城
        for (const [cKey, city] of sim.cities.entries()) {
            if (city.owner !== 'mine' || city.hp <= 0 || sim.occupied.has(cKey)) continue;
            const d = coordDist(enemy, city);
            if (d > enemy.speed + enemy.range) continue;
            const cityTile = world.tileMap?.get(cKey);
            const siegeDmg = Number(estimateSiegeDamage(enemy.unitRef, cityTile) || enemy.attack);
            const breaches = city.hp <= siegeDmg;
            actions.push({
                kind: 'minSiege',
                actorId: enemy.id,
                campKey: enemy.campKey,
                q: city.q,
                r: city.r,
                dmg: siegeDmg,
                priority: (breaches ? 340 : 140) + Math.max(0, 120 - city.hp)
            });
        }

        // 3. 集火击杀/重创己方暴露单位与守城兵
        for (const mine of sim.myUnits.values()) {
            if (mine.hp <= 0) continue;
            const d = coordDist(enemy, mine);
            if (d > enemy.speed + enemy.range) continue;
            const dmg = estimateHitDmg(world, enemy, mine);
            const kills = dmg >= (mine.hp + mine.shield);
            const onCity = sim.cities.get(`${mine.q},${mine.r}`)?.owner === 'mine';
            const priority = (kills ? 260 : 85)
                + (mine.commander ? (kills ? 160 : 65) : 0)
                + (onCity ? 135 : 0)
                + Math.min(100, dmg * mine.hpG * 0.45);
            actions.push({
                kind: 'minAttack',
                actorId: enemy.id,
                campKey: enemy.campKey,
                targetId: mine.id,
                dmg,
                priority
            });
        }
    }

    actions.sort((a, b) => b.priority - a.priority);
    return actions.slice(0, maxActions);
}

function applyMinAction(baseSim, act, world) {
    const enemy = baseSim.rivalUnits.get(act.actorId);
    if (!enemy || enemy.hp <= 0) return null;
    const sim = cloneSimState(baseSim);
    const simEnemy = sim.rivalUnits.get(act.actorId);

    if (act.kind === 'minCapture') {
        const cKey = `${act.q},${act.r}`;
        const city = sim.cities.get(cKey);
        if (!city || city.hp > 0 || sim.occupied.has(cKey)) return null;
        sim.occupied.delete(`${simEnemy.q},${simEnemy.r}`);
        simEnemy.q = act.q;
        simEnemy.r = act.r;
        sim.occupied.set(cKey, { side: 'rival', id: simEnemy.id });
        city.owner = 'rival';
        city.campKey = simEnemy.campKey;
        return { sim, openedCaptureAt: null };
    }

    if (act.kind === 'minSiege') {
        const cKey = `${act.q},${act.r}`;
        const city = sim.cities.get(cKey);
        if (!city || city.owner !== 'mine' || city.hp <= 0) return null;
        city.hp = Math.max(0, city.hp - act.dmg);
        return { sim, openedCaptureAt: city.hp <= 0 ? cKey : null };
    }

    if (act.kind === 'minAttack') {
        const mine = sim.myUnits.get(act.targetId);
        if (!mine || mine.hp <= 0) return null;
        const pool = mine.hp + mine.shield;
        const killed = act.dmg >= pool;
        const counter = (!killed && coordDist(simEnemy, mine) <= mine.range)
            ? estimateCounterDmg(world, simEnemy, mine) * 0.55
            : 0;
        let openedCaptureAt = null;
        if (killed) {
            const cKey = `${mine.q},${mine.r}`;
            sim.occupied.delete(cKey);
            sim.myUnits.delete(mine.id);
            const city = sim.cities.get(cKey);
            if (city && city.owner === 'mine') {
                // 若敌军近战杀掉 0HP 城防，敌方本身如可夺城可直接入城或由第 2 步接管
                if (city.hp <= 0 && simEnemy.isCapturer
                    && coordDist(simEnemy, city) <= simEnemy.speed) {
                    sim.occupied.delete(`${simEnemy.q},${simEnemy.r}`);
                    simEnemy.q = city.q;
                    simEnemy.r = city.r;
                    sim.occupied.set(cKey, { side: 'rival', id: simEnemy.id });
                    city.owner = 'rival';
                    city.campKey = simEnemy.campKey;
                } else {
                    openedCaptureAt = cKey;
                }
            }
        } else {
            const sRem = Math.max(0, mine.shield - act.dmg);
            mine.hp = Math.max(1, mine.hp - Math.max(0, act.dmg - mine.shield));
            mine.shield = sRem;
        }
        if (counter >= simEnemy.hp + simEnemy.shield) {
            sim.occupied.delete(`${simEnemy.q},${simEnemy.r}`);
            sim.rivalUnits.delete(simEnemy.id);
        } else if (counter > 0) {
            simEnemy.hp = Math.max(1, simEnemy.hp - counter);
        }
        return { sim, openedCaptureAt };
    }
    return null;
}

export function searchMinReplyWithAlphaBeta(simAfterMax, world, strategy, alpha, stats) {
    let minVal = evaluateMinimaxBoard(simAfterMax, world, strategy);
    if (minVal <= alpha) {
        stats.cutoffs++;
        return { val: minVal, pruned: true };
    }

    const threats = generateAdversarialMinActions(simAfterMax, world, 10);
    if (threats.length === 0) return { val: minVal, pruned: false };

    for (let i = 0; i < threats.length; i++) {
        const t1 = threats[i];
        const res1 = applyMinAction(simAfterMax, t1, world);
        if (!res1) continue;
        stats.nodes++;

        const v1 = evaluateMinimaxBoard(res1.sim, world, strategy);
        if (v1 < minVal) minVal = v1;
        if (minVal <= alpha) {
            stats.cutoffs++;
            return { val: minVal, pruned: true };
        }

        // Depth-2 敌军协同集火 / 清防后步兵补城：当第1步破防/清场或高优目标时，推演同阵营第2名友军接力
        if (i < 5 && (res1.openedCaptureAt || t1.kind === 'minAttack')) {
            if (res1.openedCaptureAt) {
                const openCity = res1.sim.cities.get(res1.openedCaptureAt);
                if (openCity && openCity.hp <= 0 && !res1.sim.occupied.has(res1.openedCaptureAt)) {
                    for (const e2 of res1.sim.rivalUnits.values()) {
                        if (e2.id === t1.actorId || e2.campKey !== t1.campKey || !e2.isCapturer || e2.stunned) continue;
                        if (coordDist(e2, openCity) <= e2.speed) {
                            const s2 = cloneSimState(res1.sim);
                            const se2 = s2.rivalUnits.get(e2.id);
                            s2.occupied.delete(`${se2.q},${se2.r}`);
                            se2.q = openCity.q;
                            se2.r = openCity.r;
                            s2.occupied.set(res1.openedCaptureAt, { side: 'rival', id: se2.id });
                            const sc = s2.cities.get(res1.openedCaptureAt);
                            sc.owner = 'rival';
                            sc.campKey = se2.campKey;
                            stats.nodes++;
                            const v2 = evaluateMinimaxBoard(s2, world, strategy);
                            if (v2 < minVal) minVal = v2;
                            if (minVal <= alpha) {
                                stats.cutoffs++;
                                return { val: minVal, pruned: true };
                            }
                            break;
                        }
                    }
                }
            }

            let checkedFollowups = 0;
            for (let j = 0; j < threats.length && checkedFollowups < 4; j++) {
                if (j === i) continue;
                const t2 = threats[j];
                if (t2.actorId === t1.actorId || t2.campKey !== t1.campKey) continue;
                checkedFollowups++;
                const res2 = applyMinAction(res1.sim, t2, world);
                if (!res2) continue;
                stats.nodes++;
                const v2 = evaluateMinimaxBoard(res2.sim, world, strategy);
                if (v2 < minVal) minVal = v2;
                if (minVal <= alpha) {
                    stats.cutoffs++;
                    return { val: minVal, pruned: true };
                }
            }
        }
    }

    return { val: minVal, pruned: false };
}

/**
 * 在混合评分前对 Top 关键战术/走位/招募/防空城候选运行 2-Ply 对抗式 MiniMax + Alpha-Beta 剪枝，
 * 输出 <candidateKey, deltaBonus>（同时返回节点数与剪枝计数用于测试观测）。
 */
export function computeMinimaxAlphaBetaBonuses(state, world, strategy, candidates, {
    preScores = null,
    vetoFlags = null,
    maxRootBranches = 16,
    timeBudgetMs = 16
} = {}) {
    const bonuses = new Map();
    const stats = { nodes: 0, cutoffs: 0, evaluatedRoots: 0 };
    if (!world || !candidates || candidates.length < 2 || !world.rivalUnits?.length) {
        return { bonuses, stats };
    }

    const tStart = nowMs();
    const rootSim = snapshotAdversarialState(state, world);

    // 挑选需要接受对抗复检的关键候选：Top 预评分候选 + 所有涉及己方受威胁城防的回防/招募/夺城/低血将领撤退
    const scoredIndices = [];
    for (let i = 0; i < candidates.length; i++) {
        if (vetoFlags && vetoFlags[i]) continue;
        const c = candidates[i];
        if (!['attack', 'move', 'recruit', 'tacticalCard', 'droneSuicide', 'banzaiCharge'].includes(c.actionType)) continue;
        let priority = preScores ? Number(preScores[i] || 0) : 0;
        if (c.q !== undefined && c.r !== undefined) {
            const city = rootSim.cities.get(`${c.q},${c.r}`);
            if (city && city.owner === 'mine') priority += 45;
            if (city && city.owner !== 'mine') priority += 35;
        }
        const mover = c.unitId !== undefined ? rootSim.myUnits.get(c.unitId) : null;
        if (mover?.commander && mover.hp < mover.maxHp * 0.45 && c.actionType === 'move') priority += 40;
        scoredIndices.push({ idx: i, cand: c, priority });
    }
    scoredIndices.sort((a, b) => b.priority - a.priority);
    const rootPool = scoredIndices.slice(0, maxRootBranches);
    if (rootPool.length === 0) return { bonuses, stats };

    const { val: baselineVal } = searchMinReplyWithAlphaBeta(rootSim, world, strategy, -Infinity, stats);
    let alpha = -Infinity;
    const rawValues = [];

    for (const item of rootPool) {
        if (nowMs() - tStart >= timeBudgetMs) break;
        const postMax = applyMaxCandidateToSim(rootSim, item.cand, world);
        if (!postMax) continue;
        stats.evaluatedRoots++;
        // 使用渴望窗口 (alpha - 75)：只剪掉显著劣于最优解 75 分以上的致命败招，避免连带误伤其他正收益协同攻势
        const cutoffBound = Number.isFinite(alpha) ? alpha - 75 : -Infinity;
        const { val, pruned } = searchMinReplyWithAlphaBeta(postMax, world, strategy, cutoffBound, stats);
        if (!pruned && val > alpha) alpha = val;
        rawValues.push({ key: item.cand.key, val, pruned, cutoffBound });
    }

    for (const { key, val, pruned, cutoffBound } of rawValues) {
        let scaled;
        if (pruned) {
            scaled = Math.max(-70, Math.min(-18, -18 + (val - cutoffBound) * 0.35));
        } else {
            const gainOverPass = val - baselineVal;
            scaled = Math.max(-68, Math.min(86, gainOverPass * 0.36));
        }
        if (Number.isFinite(scaled) && Math.abs(scaled) >= 1.5) {
            bonuses.set(key, scaled);
        }
    }

    return { bonuses, stats };
}
