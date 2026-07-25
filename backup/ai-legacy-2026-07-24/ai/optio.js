// Optio —— 入门档指挥官。
//
// 定位：**只看眼前一格**。它照着条令打，但不做任何前瞻。
//   会做的：找得到能一击斩杀的目标、朝最近的敌城直线推进、空城会走进去占领、
//           城里放步兵守着、有钱就招兵、用基础卡（疗愈/闪电）。
//   不做的：不算反击（会拿驱逐舰去啃岸防炮）、不算跨域减伤、不集火补刀、
//           不区分远程能不能占城（会用炮兵把城防打空然后干瞪眼）、
//           不记路（会在两格之间来回走）、不反制招募、不用高级卡、
//           不做任何战役规划。
//
// 决策抖动很大：同一个局面它未必给出同一个答案，玩家能明显感到它在犹豫。

import {
    COMMANDER_STRATEGY,
    canCaptureCityByCombat,
    createCombatModel,
    estimateSiegeDamage,
    selectCommander as doctrineSelectCommander,
    selectCommanderPair as doctrineSelectCommanderPair
} from './doctrine.js';
import { getStandardMap } from '../rules/standardMaps.js';

export const meta = {
    name: 'Optio',
    tier: 'Basic',
    difficultyId: 'easy',
    description: '只看眼前一格的贪心指挥：能斩杀就打，否则朝最近的城直线走'
};

export const selectCommander = doctrineSelectCommander;
export const selectCommanderPair = doctrineSelectCommanderPair;

// 入门档的犹豫程度：评分噪声大到足以让它在相近选项间摇摆。
const DECISION_NOISE = 0.42;

export function planActions(gameState, helpers, myCamp) {
    const {
        getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS,
        CAMP, UNIT_CONFIG, isHostileFaction, recruitTypesForCity
    } = helpers;
    const tileMap = gameState.tileMap;
    const actions = [];
    const processed = new Set();
    const campKey = myCamp.id;

    let enemyCamps = (gameState.turnOrder || Object.keys(CAMP))
        .filter(key => key !== 'neutral')
        .map(key => CAMP[key])
        .filter(faction => faction && faction !== myCamp && faction.active !== false
            && (!isHostileFaction || isHostileFaction(myCamp, faction)));
    if (enemyCamps.length === 0) {
        enemyCamps = (gameState.turnOrder || Object.keys(CAMP))
            .filter(key => key !== 'neutral')
            .map(key => CAMP[key])
            .filter(faction => faction && faction !== myCamp && faction.active !== false);
    }
    if (enemyCamps.length === 0) return actions;
    const enemyCampKeys = new Set(enemyCamps.map(camp => camp.id));

    const decisionRandom = () => gameState.rng?.next?.() ?? Math.random();
    const jitter = scale => (decisionRandom() * 2 - 1) * scale * DECISION_NOISE;
    const tileVisible = tile => !gameState.skirmishFog
        || !helpers.isTileVisible || helpers.isTileVisible(tile, myCamp);

    // 入门档也用同一套战斗估算，但只拿它判断「打不打得死」——
    // 反击、跨域减伤这些数字它算得出来，只是从不去看。
    const { estimateDamage } = createCombatModel({ weather: gameState.weather || 'clear', hexDistance });

    const allUnits = gameState.tiles
        .filter(t => t.unit && t.unit.camp === myCamp && t.unit.canAct && !t.unit.isNewRecruit)
        .map(t => t.unit);
    const livingAssaultUnits = gameState.tiles
        .filter(tile => tile.unit?.camp === myCamp && tile.unit.hp > 0
            && canCaptureCityByCombat(tile.unit))
        .map(tile => tile.unit);
    const myCities = gameState.tiles.filter(t => t.isCity && t.camp === myCamp);
    const visibleEnemyTiles = gameState.tiles.filter(t =>
        t.unit && t.unit.camp !== myCamp && tileVisible(t));
    // 敌对目标：入门档不区分中立与玩家，谁挡路打谁。
    const isFoe = tile => !!tile?.unit && tile.unit.camp !== myCamp;
    let gold = gameState.playerGold[campKey];

    const myCommanderUnits = allUnits.filter(unit => unit.commander);
    const cmdStrat = COMMANDER_STRATEGY[myCommanderUnits[0]?.commander] || {};

    const willKill = (attacker, defender) =>
        estimateDamage(attacker, defender) >= defender.hp + (defender._shield || 0);

    function countAdjacentEnemies(tile) {
        let count = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (neighbor?.unit && neighbor.unit.camp !== myCamp) count++;
        }
        return count;
    }

    // ── 目标：最近的一座非己方城市。没有城就冲最近的敌人 ──
    // 没有评分、没有守备权衡、没有承诺，纯粹取直线最近。
    let objective = null;
    {
        let bestDistance = Infinity;
        const reference = allUnits[0]?.tile || myCities[0];
        for (const tile of gameState.tiles) {
            if (!tile.isCity || tile.camp === myCamp || !reference) continue;
            if (gameState.skirmishFog && !tileVisible(tile)
                && !gameState.exploredTiles?.[campKey]?.has?.(`${tile.q},${tile.r}`)) continue;
            const distance = hexDistance(reference, tile) + jitter(3);
            if (distance < bestDistance) { bestDistance = distance; objective = tile; }
        }
        // 入门档不估守军和城区价值，但至少知道标准地图上公开的城市坐标；
        // 这消除迷雾局在出生点打转的纯低级错误，不会赋予它战役判断。
        if (!objective && reference) {
            const standardMap = getStandardMap(gameState.isThreePlayer ? 3 : 2, gameState.standardMapId);
            for (const site of standardMap?.board?.cities || []) {
                const tile = tileMap.get(`${site.q},${site.r}`);
                if (!tile?.isCity || tile.camp === myCamp) continue;
                const distance = hexDistance(reference, tile) + jitter(3);
                if (distance < bestDistance) { bestDistance = distance; objective = tile; }
            }
        }
        if (!objective && visibleEnemyTiles.length > 0) objective = visibleEnemyTiles[0];
    }

    // ═══ 卡牌：只会用疗愈和闪电 ═══
    const hand = gameState.playerHands[campKey] || [];
    let cardUses = gameState.playerUsesThisTurn[campKey] || 0;

    if (myCommanderUnits.length === 0 && hand.includes('commanderDeploy')) {
        const carrierPref = cmdStrat.carrierPref || ['cavalry', 'infantry', 'archer'];
        const carrier = [...allUnits]
            .filter(unit => !unit.commander)
            .sort((left, right) => {
                const rank = unit => {
                    const index = carrierPref.indexOf(unit.type);
                    return index >= 0 ? index : 9;
                };
                if (rank(left) !== rank(right)) return rank(left) - rank(right);
                return right.hp - left.hp;
            })[0];
        if (carrier) {
            actions.push({ type: 'tacticalCard', cardId: 'commanderDeploy', targetId: carrier.id });
            processed.add(carrier.id);
            cardUses++;
        }
    }

    for (const cardId of hand) {
        if (cardUses >= 1) break;
        if (cardId === 'heal') {
            const wounded = [...allUnits]
                .filter(unit => unit.hp < unit.maxHp * 0.5)
                .sort((left, right) => left.hp - right.hp)[0];
            if (wounded) {
                actions.push({ type: 'tacticalCard', cardId: 'heal', targetId: wounded.id });
                cardUses++;
            }
        } else if (cardId === 'lightning') {
            const target = [...visibleEnemyTiles]
                .sort((left, right) => left.unit.hp - right.unit.hp)[0];
            if (target) {
                actions.push({ type: 'tacticalCard', cardId: 'lightning', targetId: target.unit.id });
                cardUses++;
            }
        }
        // 其余卡牌看不懂，留在手里。
    }

    // ═══ 攻击：能斩杀就打，否则打最虚弱的 ═══
    // 完全不看反击——所以它会反复拿驱逐舰去啃射程 2 的岸防炮。
    for (const unit of allUnits) {
        if (processed.has(unit.id)) continue;
        const targets = getAttackableTiles(unit).filter(isFoe);
        if (targets.length === 0) continue;

        let bestTile = null, bestScore = -Infinity;
        for (const tile of targets) {
            const target = tile.unit;
            let score = (1 - target.hp / target.maxHp) * 80;
            if (willKill(unit, target)) score += 200 * (cmdStrat.killBonus || 1);
            if (tile.isCity && tile.camp !== myCamp) score += 60;
            score += jitter(70);
            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }
        if (bestTile) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: bestTile.unit.id });
            processed.add(unit.id);
        }
    }

    // ═══ 攻城：谁在旁边谁上，不管自己进不进得去 ═══
    for (const unit of allUnits) {
        if (processed.has(unit.id)) continue;
        const siegeTile = getAttackableTiles(unit)
            .find(tile => !tile.unit && tile.isCity && tile.hp > 0 && tile.camp !== myCamp);
        if (!siegeTile) continue;
        if (!canCaptureCityByCombat(unit) && estimateSiegeDamage(unit, siegeTile) >= siegeTile.hp) {
            // 入门档只做最明显的一层常识修正：两回合内连一个近战都没有，就别替敌人拆最后一道门。
            const hasLooseFollowUp = livingAssaultUnits.some(assault =>
                hexDistance(assault.tile, siegeTile)
                    <= Math.max(1, Number(assault.config?.speed || 1)) * 2);
            if (!hasLooseFollowUp) continue;
        }
        actions.push({
            type: 'siegeCityAttack', unitId: unit.id,
            tileQ: siegeTile.q, tileR: siegeTile.r
        });
        processed.add(unit.id);
    }

    // ═══ 移动：朝目标直线靠近 ═══
    const reserved = new Set();
    const garrisoned = new Set();
    for (const unit of allUnits) {
        if (processed.has(unit.id)) continue;
        const validTiles = getMovableTiles(unit)
            .filter(tile => !tile.unit && !reserved.has(`${tile.q},${tile.r}`));
        if (validTiles.length === 0) continue;

        // 守城：城里的步兵不动。仅此而已，不判断威胁也不换人。
        if (unit.tile.isCity && unit.tile.camp === myCamp && unit.type === 'infantry') {
            const cityKey = `${unit.tile.q},${unit.tile.r}`;
            if (!garrisoned.has(cityKey)) { garrisoned.add(cityKey); continue; }
        }

        let bestTile = null, bestScore = -Infinity;
        for (const tile of validTiles) {
            let score = 0;
            if (objective) {
                score += (hexDistance(unit.tile, objective) - hexDistance(tile, objective)) * 10;
                // 只修正规则层面的无效指令：远程不能占城，不再反复提交必定被拒绝的移动。
                if (tile.isCity && tile.camp !== myCamp && !tile.unit
                    && unit.config?.movementDomain === 'land'
                    && unit.type !== 'archer') score += 80;
            }
            // 唯一的安全意识：残血时躲开贴脸的敌人。没有威胁预测，没有回溯记忆。
            if (unit.hp < unit.maxHp * 0.35) score -= countAdjacentEnemies(tile) * 30;
            score += jitter(45);
            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }
        if (bestTile && !(bestTile.q === unit.tile.q && bestTile.r === unit.tile.r)) {
            actions.push({ type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r });
            reserved.add(`${bestTile.q},${bestTile.r}`);
            processed.add(unit.id);
        }
    }

    // ═══ 招募：固定偏好，不看敌人配了什么 ═══
    const emptyOwnCities = gameState.tiles.filter(t => t.isCity && t.camp === myCamp && !t.unit);
    if (gold < 8 || emptyOwnCities.length === 0) return actions;

    let recruitPriority = cmdStrat.recruitPref || ['infantry', 'cavalry', 'archer'];
    if (livingAssaultUnits.length < 2) {
        recruitPriority = ['infantry', 'cavalry',
            ...recruitPriority.filter(type => type !== 'infantry' && type !== 'cavalry')];
    }
    for (const city of emptyOwnCities.slice(0, gold >= 20 ? 2 : 1)) {
        const types = recruitTypesForCity ? recruitTypesForCity(city, recruitPriority) : recruitPriority;
        for (const type of types) {
            if (gold >= UNIT_CONFIG[type].cost) {
                actions.push({ type: 'recruit', unitType: type, tileQ: city.q, tileR: city.r });
                gold -= UNIT_CONFIG[type].cost;
                break;
            }
        }
    }

    return actions;
}
