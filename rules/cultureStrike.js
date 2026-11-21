import { campToKey } from './camps.js';
import { isPlayableBoardTile } from './boardLayout.js';
import { canAttack } from './diplomacy.js';
import { HEX_NEIGHBORS, hexDistance } from './hex.js';
import { isCitySiegeBlocked } from './citySiege.js';
import { canUnitOccupyTile, resolveMovementStep } from './movement.js';
import { canUnitTargetUnit } from './naval.js';
import { canNeutralAttackTile } from './neutralDefense.js';
import { isLandTile } from './surfaces.js';
import { isTileVisible, isUnitVisibleToCamp } from './visibility.js';
import { getRoundIndex } from './turns.js';

export const CULTURE_STRIKES = Object.freeze({
    jp_samurai: Object.freeze({
        id: 'samuraiChain', name: '群体连斩', icon: '⚔️', movementCost: 2,
        cooldown: 1, range: 2, limit: 4, multiplier: 1.8,
        desc: '选择2格内敌军。自动连斩相邻敌军，最多4段，每段为有效攻击力的180%，在最后一个目标旁落地后统一结算。'
    }),
    cpc_guerrilla: Object.freeze({
        id: 'guerrillaSnipe', name: '远距狙击', icon: '🎯', movementCost: 2,
        cooldown: 2, multiplier: 3.2, retention: 0.75,
        desc: '沿六个轴向之一射至地图边缘。首个目标为有效攻击力的320%，每穿过一名目标，后续威力降为上一段的75%。友军与非敌对部队会挡弹。'
    })
});

export const CULTURE_STRIKE_TIMING = Object.freeze({
    charge: 210, cut: 78, exit: 70, hold: 500, lock: 330, bulletPerHex: 27, normalBullet: 260
});

export function cultureStrikeCooldown(unit, state) {
    const ready = unit?.type === 'jp_samurai' ? unit._banzaiReadyRound : unit?._guerrillaReadyRound;
    return Math.max(0, (ready || 0) - getRoundIndex(state));
}

export function cultureStrikeUnavailable(unit, state) {
    const config = CULTURE_STRIKES[unit?.type];
    if (!config || !unit.tile || unit.hp <= 0 || !unit.canAct || unit.isNewRecruit || unit.isEmbarked
        || unit._imprisoned || unit._transportTransitionedThisTurn || unit._specializationAttackSpent
        || unit._campaignCanAct === false || unit._campaignCanAttack === false || unit.morale === 0
        || (unit.commander === 'martyr' && unit._martyrPrimed)) return '当前无法施放';
    const cooldown = cultureStrikeCooldown(unit, state);
    if (cooldown) return `冷却 ${cooldown} 回合`;
    return unit.remainingMP < config.movementCost ? `需 ${config.movementCost} 点行动力` : '';
}

const coord = tile => `${tile.q},${tile.r}`;
const tileAt = (state, q, r) => state.tileMap?.get(`${q},${r}`);
const viewUnit = (state, tile, camp) => tile?.unit && isTileVisible(tile, camp, state)
    && isUnitVisibleToCamp(tile.unit, camp, state) ? tile.unit : null;
const canHit = (state, unit, tile, enemy) => enemy?.hp > 0 && enemy._campaignTargetable !== false
    && canAttack(state, unit.camp, enemy.camp) && canUnitTargetUnit(unit, enemy, state)
    && canNeutralAttackTile(state, unit, tile);

function alignment(from, current, next) {
    const x = (current.q - from.q) + (current.r - from.r) / 2;
    const y = (current.r - from.r) * Math.sqrt(3) / 2;
    const dx = next.q - current.q + (next.r - current.r) / 2;
    const dy = (next.r - current.r) * Math.sqrt(3) / 2;
    return (x * dx + y * dy) / (Math.hypot(x, y) * Math.hypot(dx, dy));
}

function orderedNeighbors(state, previous, current) {
    return HEX_NEIGHBORS.map(([dq, dr]) => tileAt(state, current.q + dq, current.r + dr))
        .filter(isPlayableBoardTile)
        .sort((a, b) => alignment(previous, current, b) - alignment(previous, current, a));
}

function chainPlan(unit, aim, state, commit) {
    const config = CULTURE_STRIKES.jp_samurai;
    const origin = unit.tile;
    const range = hexDistance(origin, aim);
    const picked = viewUnit(state, aim, unit.camp);
    if (range < 1 || range > config.range || !isLandTile(aim) || !canHit(state, unit, aim, picked)) return null;
    const canCross = (from, to) => resolveMovementStep(unit, from, to, state).allowed;
    if (range === 1 ? !canCross(origin, aim) : !orderedNeighbors(state, aim, origin).some(step =>
        hexDistance(step, aim) === 1 && isLandTile(step) && !isCitySiegeBlocked(step, unit.camp, state)
        && !(commit ? step.unit : viewUnit(state, step, unit.camp)) && canCross(origin, step) && canCross(step, aim))) return null;

    const route = [aim];
    const visited = new Set([coord(aim)]);
    let previous = origin;
    let plan = null;
    while (route.length <= config.limit) {
        const last = route.at(-1);
        const adjacent = orderedNeighbors(state, previous, last);
        const empty = adjacent.filter(tile => tile !== origin && !visited.has(coord(tile))
            && !(commit ? tile.unit : viewUnit(state, tile, unit.camp))
            && !isCitySiegeBlocked(tile, unit.camp, state) && canCross(last, tile));
        const landing = empty.find(tile => isLandTile(tile) && canUnitOccupyTile(unit, tile, state)) ?? empty.find(tile =>
            canUnitOccupyTile({ type: unit.type, config: unit.config, isEmbarked: true }, tile, state));
        if (landing) plan = {
            kind: config.id, origin, landing, path: [origin, ...route, landing],
            hits: route.map(tile => ({ tile, multiplier: config.multiplier }))
        };
        if (route.length === config.limit) break;
        const next = adjacent.find(tile => !visited.has(coord(tile)) && isLandTile(tile)
            && canHit(state, unit, tile, viewUnit(state, tile, unit.camp)) && canCross(last, tile));
        if (!next) break;
        previous = last;
        visited.add(coord(next));
        route.push(next);
    }
    return plan;
}

function sniperPlan(unit, aim, state) {
    const config = CULTURE_STRIKES.cpc_guerrilla;
    const origin = unit.tile;
    const distance = hexDistance(origin, aim);
    if (distance < 1) return null;
    const dq = (aim.q - origin.q) / distance;
    const dr = (aim.r - origin.r) / distance;
    if (!HEX_NEIGHBORS.some(([q, r]) => dq === q && dr === r)) return null;

    const path = [origin];
    const hits = [];
    let multiplier = config.multiplier;
    for (let steps = 1; ; steps++) {
        const tile = tileAt(state, origin.q + dq * steps, origin.r + dr * steps);
        if (!isPlayableBoardTile(tile)) break;
        path.push(tile);
        const blocker = viewUnit(state, tile, unit.camp);
        if (!blocker) continue;
        if (!canHit(state, unit, tile, blocker)) break;
        hits.push({ tile, multiplier });
        multiplier *= config.retention;
    }
    return hits.some(hit => hit.tile === aim) ? { kind: config.id, origin, path, hits } : null;
}

export function planCultureStrike(unit, aim, state, { commit = false } = {}) {
    if (cultureStrikeUnavailable(unit, state) || !isPlayableBoardTile(aim) || state.tileMap?.get(coord(aim)) !== aim) return null;
    return unit.type === 'jp_samurai' ? chainPlan(unit, aim, state, commit) : sniperPlan(unit, aim, state);
}

export function listCultureStrikePlans(unit, state) {
    if (cultureStrikeUnavailable(unit, state)) return [];
    return state.tiles.flatMap(tile => {
        if (!tile.unit || !canAttack(state, unit.camp, tile.unit.camp)) return [];
        const plan = planCultureStrike(unit, tile, state);
        return plan ? [{ aim: tile, ...plan }] : [];
    });
}

export function findCultureStrikeCaster(state, id) {
    return state.tiles.find(tile => tile.unit?.id === id)?.unit;
}

export function isCultureStrikeTurn(unit, state) {
    return Boolean(unit && campToKey(unit.camp) === campToKey(state.currentCamp));
}
