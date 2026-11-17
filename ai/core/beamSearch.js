// 轻量局部前瞻束搜索（Beam Search, width=4, depth=3）——
// 针对前线交火/攻城/手牌连招回合，在局部无副作用快照上推演 2–3 步动作排序
// （如：雷击/炮火压残守军 -> 近战斩杀进驻；先治疗/加盾 -> 抗反击输出；集火点杀高危将领），
// 为 Hybrid 候选评分注入多步连招前瞻效用。
//
// 严格保持纯前端浏览器安全（仅依赖 rules/*、ai/core/weights.js、ai/core/roster.js）。

import { canAttack } from '../../rules/diplomacy.js';
import { TACTICAL_CARD_DATA } from '../../rules/cards.js';
import { COMMANDER_CONFIG } from '../../rules/commanders.js';
import { getHistoricalCost } from '../../rules/cultures.js';
import { estimateSiegeDamage } from '../doctrine.js';
import { hpGold, residualGold, W } from './weights.js';
import { isFieldCapturer } from './roster.js';

const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

function coordDist(a, b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) >> 1;
}

function snapshotUnits(units) {
    const map = new Map();
    for (const u of units || []) {
        if (!u?.tile || u.hp <= 0) continue;
        map.set(u.id, {
            id: u.id,
            unitRef: u,
            camp: u.camp,
            hp: Number(u.hp || 0),
            maxHp: Math.max(1, Number(u.maxHp || 100)),
            shield: Number(u.activeShield ?? u._shield ?? 0),
            q: u.tile.q,
            r: u.tile.r,
            canAct: !!u.canAct && !u.isNewRecruit,
            commander: u.commander || null,
            stunned: !!u._imprisoned,
            poisoned: !!u._poison,
            cost: Math.max(2, Number(u.config?.cost || 8)),
            isDrone: !!u._isDrone,
            isCapturable: false
        });
    }
    return map;
}

function estimateCounter(world, attacker, target) {
    if (!world?.combat || !attacker || !target) return 0;
    const dist = coordDist(attacker, target);
    const targetRange = Math.max(1, Number(target.unitRef.getEffectiveRange?.() ?? target.unitRef.config?.range ?? 1));
    const atkRange = Math.max(1, Number(attacker.unitRef.getEffectiveRange?.() ?? attacker.unitRef.config?.range ?? 1));
    if (atkRange > 1 || targetRange > 1 || dist > targetRange) return 0;
    const est = Number(world.combat.estimateDamage(target.unitRef, attacker.unitRef, attacker.unitRef.tile) || 0);
    return Math.max(0, est);
}

function scoreSimulatedAction(simState, cand, world, strategy) {
    const myUnits = simState.myUnits;
    const hostileUnits = simState.hostileUnits;
    const cityHpByKey = simState.cityHpByKey;

    if (cand.actionType === 'attack') {
        const attacker = myUnits.get(cand.unitId);
        if (!attacker || !attacker.canAct || attacker.stunned) return null;

        if (cand.isCitySiege) {
            const cKey = `${cand.q},${cand.r}`;
            const curCityHp = cityHpByKey.get(cKey);
            if (curCityHp === undefined || curCityHp <= 0) return null;
            const cityTile = world.tileMap?.get(cKey);
            if (!cityTile || cityTile.unit) return null;
            const siegeDmg = Number(world.estimateSiegeDamage?.(attacker.unitRef, cityTile)
                ?? estimateSiegeDamage(attacker.unitRef, cityTile)
                ?? 25);
            const nextHp = Math.max(0, curCityHp - siegeDmg);
            const breached = curCityHp > 0 && nextHp <= 0;
            // 若破城后附近有另一个仍可行动且无视阻挡可进入该城的友军，附加高额连招破门奖励
            const followerReady = breached && Array.from(myUnits.values()).some(ally =>
                ally.id !== attacker.id && ally.canAct && !ally.stunned && ally.isCapturable
                && coordDist(ally, cand) <= Math.max(2, Number(ally.unitRef.config?.speed || 4)));
            const delta = Math.min(curCityHp, siegeDmg) * 0.38
                + (breached ? 36 : 0)
                + (followerReady ? 95 : 0);
            const nextUnits = new Map(myUnits);
            nextUnits.set(attacker.id, { ...attacker, canAct: false });
            const nextCities = new Map(cityHpByKey);
            nextCities.set(cKey, nextHp);
            return {
                delta,
                nextState: { ...simState, myUnits: nextUnits, cityHpByKey: nextCities }
            };
        }

        const target = hostileUnits.get(cand.targetId);
        if (!target || target.hp <= 0) return null;
        const dmg = Number(world.combat.estimateDamage(attacker.unitRef, target.unitRef, target.unitRef.tile) || 0);
        if (dmg <= 0) return null;
        const pool = target.hp + target.shield;
        const absorbed = Math.min(pool, dmg);
        const killed = dmg >= pool;
        const counter = killed ? 0 : estimateCounter(world, attacker, target);
        const myPool = attacker.hp + attacker.shield;
        const iDie = counter >= myPool;

        const targetHpGold = hpGold(target.unitRef);
        const myHpGold = hpGold(attacker.unitRef);
        let delta = absorbed * targetHpGold * 1.15 - counter * myHpGold * (strategy?.doctrine?.riskWeightScale ?? 1.0);
        if (killed) {
            delta += residualGold(target.unitRef) * 0.95 + (target.commander ? 45 : 0);
            const tTile = target.unitRef.tile;
            if (tTile?.isCity && canAttack(world.gameState, world.myCamp, tTile.camp)) {
                const cKey = `${tTile.q},${tTile.r}`;
                const curCityHp = cityHpByKey.get(cKey) ?? Number(tTile.hp || 0);
                if (attacker.isCapturable && coordDist(attacker, tTile) === 1 && curCityHp <= 0) {
                    delta += 145;
                } else {
                    delta += 32;
                }
            }
        } else if (pool - dmg <= 45) {
            // 打入可补刀残血区间时，如果附近有还没行动的友军能补刀，记入连招衔接势能
            const canFollow = Array.from(myUnits.values()).some(ally =>
                ally.id !== attacker.id && ally.canAct && !ally.stunned
                && coordDist(ally, target)
                    <= Math.max(1, Number(ally.unitRef.getEffectiveRange?.() ?? 1)) + 2);
            if (canFollow) delta += 22;
        }
        if (iDie && !killed) delta -= residualGold(attacker.unitRef) * 1.15;

        const nextMy = new Map(myUnits);
        if (iDie) {
            nextMy.delete(attacker.id);
        } else {
            const shieldRem = Math.max(0, attacker.shield - counter);
            const hpRem = Math.max(1, attacker.hp - Math.max(0, counter - attacker.shield));
            nextMy.set(attacker.id, { ...attacker, hp: hpRem, shield: shieldRem, canAct: false });
        }
        const nextHostiles = new Map(hostileUnits);
        if (killed) {
            nextHostiles.delete(target.id);
        } else {
            const tShield = Math.max(0, target.shield - dmg);
            const tHp = Math.max(1, target.hp - Math.max(0, dmg - target.shield));
            nextHostiles.set(target.id, { ...target, hp: tHp, shield: tShield });
        }
        return { delta, nextState: { ...simState, myUnits: nextMy, hostileUnits: nextHostiles } };
    }

    if (cand.actionType === 'move') {
        const mover = myUnits.get(cand.unitId);
        if (!mover || !mover.canAct || mover.stunned || !mover.isCapturable) return null;
        const cKey = `${cand.q},${cand.r}`;
        const tile = world.tileMap?.get(cKey);
        if (!tile?.isCity || !canAttack(world.gameState, world.myCamp, tile.camp)) return null;
        const curCityHp = cityHpByKey.get(cKey) ?? Number(tile.hp || 0);
        const occupying = Array.from(hostileUnits.values()).some(e => e.q === cand.q && e.r === cand.r && e.hp > 0);
        if (curCityHp > 0 || occupying) return null;
        const nextMy = new Map(myUnits);
        nextMy.set(mover.id, { ...mover, q: cand.q, r: cand.r, canAct: false });
        const nextCities = new Map(cityHpByKey);
        nextCities.delete(cKey);
        return {
            delta: 165,
            nextState: { ...simState, myUnits: nextMy, cityHpByKey: nextCities }
        };
    }

    if (cand.actionType === 'droneSuicide' || cand.actionType === 'banzaiCharge') {
        const attacker = myUnits.get(cand.unitId);
        const target = hostileUnits.get(cand.targetId)
            || Array.from(hostileUnits.values()).find(e => e.q === cand.q && e.r === cand.r);
        if (!attacker || !attacker.canAct || !target || target.hp <= 0) return null;
        const dmg = cand.actionType === 'droneSuicide'
            ? COMMANDER_CONFIG.tianyan.balance.droneSuicideDamage
            : Number(world.combat.estimateDamage(attacker.unitRef, target.unitRef, target.unitRef.tile, 35) || 60);
        const pool = target.hp + target.shield;
        const killed = dmg >= pool;
        let delta = Math.min(pool, dmg) * hpGold(target.unitRef) * 1.15;
        if (killed) delta += residualGold(target.unitRef) + (target.commander ? 45 : 0);
        if (cand.actionType === 'droneSuicide') delta -= 12; // 无人机是 $5 消耗品，仅对高价或斩杀收割合算
        const nextMy = new Map(myUnits);
        if (cand.actionType === 'droneSuicide') nextMy.delete(attacker.id);
        else nextMy.set(attacker.id, { ...attacker, canAct: false });
        const nextHostiles = new Map(hostileUnits);
        if (killed) nextHostiles.delete(target.id);
        else nextHostiles.set(target.id, { ...target, hp: Math.max(1, target.hp - Math.max(0, dmg - target.shield)), shield: Math.max(0, target.shield - dmg) });
        return { delta, nextState: { ...simState, myUnits: nextMy, hostileUnits: nextHostiles } };
    }

    if (cand.actionType === 'tacticalCard') {
        if (simState.usesLeft <= 0 || simState.gold < 0) return null;
        const cid = cand.cardId;
        if (simState.usedCardCounts.get(cid) >= simState.handCounts.get(cid)) return null;
        const nextUsed = new Map(simState.usedCardCounts);
        nextUsed.set(cid, (nextUsed.get(cid) || 0) + 1);

        if (cid === 'lightning' || cid === 'poison' || cid === 'imprison') {
            const target = hostileUnits.get(cand.targetId)
                || Array.from(hostileUnits.values()).find(e => e.q === cand.q && e.r === cand.r);
            if (!target || target.hp <= 0) return null;
            const dmg = cid === 'lightning'
                ? Number(TACTICAL_CARD_DATA.lightning?.balance?.damage || 70)
                : cid === 'poison'
                    ? Math.round(target.maxHp * 0.25)
                    : 0;
            const pool = target.hp + target.shield;
            const killed = dmg >= pool;
            let delta = Math.min(pool, dmg) * hpGold(target.unitRef) * 1.1;
            if (killed) delta += residualGold(target.unitRef) + (target.commander ? 45 : 0);
            if (cid === 'imprison' && !target.stunned) delta += residualGold(target.unitRef) * 0.65 + (target.commander ? 24 : 0);
            const cityHere = target.unitRef.tile?.isCity;
            if (cityHere && !killed && pool - dmg <= 55) {
                const allyCanFinish = Array.from(myUnits.values()).some(ally => ally.canAct && ally.isCapturable
                    && coordDist(ally, target) <= 2);
                if (allyCanFinish) delta += 48;
            }
            const nextHostiles = new Map(hostileUnits);
            if (killed) nextHostiles.delete(target.id);
            else nextHostiles.set(target.id, {
                ...target,
                hp: Math.max(1, target.hp - Math.max(0, dmg - target.shield)),
                shield: Math.max(0, target.shield - dmg),
                stunned: target.stunned || cid === 'imprison'
            });
            return {
                delta: delta - 6,
                nextState: { ...simState, usesLeft: simState.usesLeft - 1, usedCardCounts: nextUsed, hostileUnits: nextHostiles }
            };
        }

        if (cid === 'heal' || cid === 'shield') {
            const ally = myUnits.get(cand.targetId)
                || Array.from(myUnits.values()).find(u => u.q === cand.q && u.r === cand.r);
            if (!ally) return null;
            const healAmt = cid === 'heal' ? Math.min(ally.maxHp - ally.hp, Math.round(ally.maxHp * 0.30)) : 0;
            const shieldAmt = cid === 'shield' ? Number(TACTICAL_CARD_DATA.shield?.balance?.shield || 60) : 0;
            if (healAmt <= 5 && !ally.poisoned && shieldAmt <= 0) return null;
            const criticalBoost = ally.hp < ally.maxHp * 0.55 ? 2.0 : 0.7;
            const delta = (healAmt + shieldAmt * 0.85) * hpGold(ally.unitRef) * criticalBoost
                + (ally.commander ? 16 : 4) - 6;
            const nextMy = new Map(myUnits);
            nextMy.set(ally.id, {
                ...ally,
                hp: Math.min(ally.maxHp, ally.hp + healAmt),
                shield: ally.shield + shieldAmt,
                poisoned: cid === 'heal' ? false : ally.poisoned
            });
            return {
                delta,
                nextState: { ...simState, usesLeft: simState.usesLeft - 1, usedCardCounts: nextUsed, myUnits: nextMy }
            };
        }
    }

    return null;
}

/**
 * 局部束搜索前瞻（Beam Search）：评估前线交火/斩杀/攻城连招的 2–3 步累积收益，
 * 输出可加到候选效用的 lookaheadBonuses Map<key, bonus>。
 */
export function computeBeamTacticalBonuses(state, world, strategy, candidates, {
    beamWidth = 4,
    maxDepth = 3,
    maxExpansions = 48,
    timeBudgetMs = 10
} = {}) {
    const bonuses = new Map();
    if (!world || !candidates || candidates.length === 0) return bonuses;
    const tStart = nowMs();

    const tacticalPool = candidates.filter(c =>
        c.actionType === 'attack'
        || c.actionType === 'droneSuicide'
        || c.actionType === 'banzaiCharge'
        || (c.actionType === 'tacticalCard' && ['lightning', 'poison', 'imprison', 'heal', 'shield'].includes(c.cardId))
        || (c.actionType === 'move' && (() => {
            const t = world.tileMap?.get(`${c.q},${c.r}`);
            return t?.isCity && Number(t.hp || 0) <= 150 && canAttack(state, world.myCamp, t.camp);
        })()));

    if (tacticalPool.length < 2) return bonuses;

    const myUnits = snapshotUnits(world.myUnits);
    for (const entry of myUnits.values()) {
        entry.isCapturable = isFieldCapturer(world, entry.unitRef);
    }
    const hostileUnits = snapshotUnits([...(world.rivalUnits || []), ...(world.neutralUnits || [])]);
    const cityHpByKey = new Map();
    for (const c of world.cities || []) {
        if (c.hostile && c.tile) cityHpByKey.set(`${c.tile.q},${c.tile.r}`, Number(c.hp || 0));
    }

    const handCounts = new Map();
    for (const cardId of world.hand || []) {
        handCounts.set(cardId, (handCounts.get(cardId) || 0) + 1);
    }

    const rootState = {
        myUnits,
        hostileUnits,
        cityHpByKey,
        usesLeft: Number(world.cardUsesLeft || 0),
        handCounts,
        usedCardCounts: new Map(),
        gold: Number(world.gold || 0)
    };

    const singleScores = new Map();
    const rootBeam = [];
    for (const cand of tacticalPool) {
        const res = scoreSimulatedAction(rootState, cand, world, strategy);
        if (!res) continue;
        singleScores.set(cand.key, res.delta);
        rootBeam.push({
            rootKey: cand.key,
            totalScore: res.delta,
            state: res.nextState,
            usedKeys: new Set([cand.key])
        });
    }
    if (rootBeam.length === 0) return bonuses;

    rootBeam.sort((a, b) => b.totalScore - a.totalScore);
    let beam = rootBeam.slice(0, beamWidth * 2);
    const bestSeqByRoot = new Map();
    for (const node of beam) {
        bestSeqByRoot.set(node.rootKey, Math.max(bestSeqByRoot.get(node.rootKey) ?? -Infinity, node.totalScore));
    }

    let expansions = 0;
    for (let depth = 2; depth <= maxDepth; depth++) {
        if (expansions >= maxExpansions || nowMs() - tStart >= timeBudgetMs) break;
        const nextBeam = [];
        for (const node of beam) {
            if (expansions >= maxExpansions || nowMs() - tStart >= timeBudgetMs) break;
            for (const cand of tacticalPool) {
                if (node.usedKeys.has(cand.key)) continue;
                expansions++;
                const res = scoreSimulatedAction(node.state, cand, world, strategy);
                if (!res || res.delta <= 1) continue;
                const total = node.totalScore + res.delta;
                const prevBest = bestSeqByRoot.get(node.rootKey) ?? -Infinity;
                if (total > prevBest) bestSeqByRoot.set(node.rootKey, total);
                const nextUsed = new Set(node.usedKeys);
                nextUsed.add(cand.key);
                nextBeam.push({
                    rootKey: node.rootKey,
                    totalScore: total,
                    state: res.nextState,
                    usedKeys: nextUsed
                });
                if (expansions >= maxExpansions) break;
            }
        }
        if (nextBeam.length === 0) break;
        nextBeam.sort((a, b) => b.totalScore - a.totalScore);
        beam = nextBeam.slice(0, beamWidth);
    }

    let maxBestSeq = -Infinity;
    for (const v of bestSeqByRoot.values()) maxBestSeq = Math.max(maxBestSeq, v);

    for (const [rootKey, bestSeq] of bestSeqByRoot.entries()) {
        const single = singleScores.get(rootKey) ?? 0;
        const comboGain = Math.max(0, bestSeq - single);
        // 把前瞻连招增益与领先路径优势映射到候选效用加权（限制上界防止盖过绝对铁律）
        const bonus = Math.max(-18, Math.min(44,
            comboGain * 0.42
            + (bestSeq >= maxBestSeq - 1e-6 && bestSeq > 20 ? 18 : 0)
            + (single < 0 && bestSeq < 0 ? -10 : 0)
        ));
        if (Number.isFinite(bonus) && Math.abs(bonus) >= 0.5) {
            bonuses.set(rootKey, bonus);
        }
    }

    return bonuses;
}
