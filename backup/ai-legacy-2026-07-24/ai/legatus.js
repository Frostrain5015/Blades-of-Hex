// Legatus —— 中档指挥官。
//
// 定位：**懂战斗，具备有限战役意识**。
//   会做的：算净交换（含反击/克制/跨域）、集火补刀、知道只有近战能占城、
//           按敌方兵种反制招募、用全套战术卡、给将领挑合适的载体。
//   不做的：长期战役目标承诺（只记一回合，复杂局势仍会改主意）、
//           对手实力建模、威胁预测（只数相邻敌人，不推算敌方下回合覆盖范围）、
//           终局抢点、后方将领职责分工、疫情疏散、破城最后一击预留、
//           远程攻城的近战跟进检查、单位级移动记忆。
//
// 因此它的典型失误是「战术赢、节奏慢」：交换不亏，但目标在城市之间摇摆，
// 也会偶尔用远程把城防打空后让给对手。这正是与 Imperator 拉开差距的地方。

import {
    COMMANDER_STRATEGY,
    canCaptureCityByCombat,
    counterCoefficient,
    createCombatModel,
    estimateSiegeDamage,
    getStrategicCityDistrictProfile,
    scoreTacticalRoleMatchup,
    selectCommander as doctrineSelectCommander,
    selectCommanderPair as doctrineSelectCommanderPair,
    shouldPlanActiveSkill,
    shouldSpendBerserkerBlood
} from './doctrine.js';
import { getStandardMap } from '../rules/standardMaps.js';
import { assessSiegeMission, estimateCampEconomy, estimateDistrictAssetValue } from './strategy.js';

export const meta = {
    name: 'Legatus',
    tier: 'Pro',
    difficultyId: 'medium',
    description: '战斗级指挥：能短期锁定目标并粗略识别经济区，但不预测战线与协同链'
};

export const selectCommander = doctrineSelectCommander;
export const selectCommanderPair = doctrineSelectCommanderPair;

// 中档保留少量决策抖动：不会像最高档那样每次都取最优解。
const DECISION_NOISE = 0.24;

export function planActions(gameState, helpers, myCamp) {
    const {
        getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS,
        CAMP, UNIT_CONFIG, isHostileFaction, recruitTypesForCity, canRecruitTypeAtSite
    } = helpers;
    const tileMap = gameState.tileMap;
    const actions = [];
    const processed = new Set();
    const plannedVacatedRecruitCities = new Set();
    const weather = gameState.weather || 'clear';
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
    const isEnemyCamp = camp => enemyCampKeys.has(camp?.id);

    const standardMap = getStandardMap(gameState.isThreePlayer ? 3 : 2, gameState.standardMapId);
    const { myHomeDistricts } = getStrategicCityDistrictProfile(standardMap, campKey, enemyCampKeys);

    const decisionRandom = () => gameState.rng?.next?.() ?? Math.random();
    const jitter = scale => (decisionRandom() * 2 - 1) * scale * DECISION_NOISE;

    const tileVisible = tile => !gameState.skirmishFog
        || !helpers.isTileVisible || helpers.isTileVisible(tile, myCamp);
    const tileExplored = tile => !gameState.skirmishFog || tileVisible(tile)
        || gameState.exploredTiles?.[campKey]?.has?.(`${tile.q},${tile.r}`);

    const { estimateDamage, estimateCounterDamage, wouldDieToCounter } =
        createCombatModel({ weather, hexDistance });

    // ── 战场数据 ────────────────────────────────
    const allUnits = gameState.tiles
        .filter(t => t.unit && t.unit.camp === myCamp && t.unit.canAct && !t.unit.isNewRecruit)
        .map(t => t.unit);
    const myCities = gameState.tiles.filter(t => t.isCity && t.camp === myCamp);
    const allEnemyUnits = gameState.tiles.filter(t =>
        t.unit && isEnemyCamp(t.unit.camp) && tileVisible(t));
    // 中档只看得见已探索的城，不会把地图静态布局当作已知情报。
    const hostileCities = gameState.tiles.filter(t =>
        t.isCity && t.camp !== myCamp && tileExplored(t));
    const livingOwnUnits = gameState.tiles
        .filter(tile => tile.unit?.camp === myCamp && tile.unit.hp > 0)
        .map(tile => tile.unit);
    const livingAssaultUnits = livingOwnUnits.filter(unit => canCaptureCityByCombat(unit));
    let gold = gameState.playerGold[campKey];

    const myCommanderUnits = gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit?.camp === myCamp && unit.commander && unit.hp > 0);
    const cmdStrat = myCommanderUnits.reduce((combined, unit) => {
        const strategy = COMMANDER_STRATEGY[unit.commander] || {};
        for (const [key, value] of Object.entries(strategy)) {
            if (typeof value === 'number') combined[key] = Math.max(combined[key] || 0, value);
            else if (typeof value === 'boolean') combined[key] = combined[key] || value;
            else if (Array.isArray(value) && !combined[key]) combined[key] = value;
        }
        return combined;
    }, {});

    // 中档不做集火：每个单位独立判断「我这一刀能不能砍死它」，
    // 不会为了凑一次击杀而在同伴之间分配输出。多个单位重复打同一个残血目标、
    // 把伤害打在已经必死的敌人身上，都是它与 Imperator 的差距所在。
    const effectiveHp = defender => defender.hp + (defender._shield || 0);
    const willKill = (attacker, defender) =>
        estimateDamage(attacker, defender) >= effectiveHp(defender);

    function countAdjacentAllies(tile, excludeId) {
        let count = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (neighbor?.unit?.camp === myCamp && neighbor.unit.id !== excludeId) count++;
        }
        return count;
    }
    // 中立部队照样开火，所以「相邻威胁」按所有非己方单位计。中档没有威胁预测，
    // 这是它唯一的安全感知，再漏掉中立就会一头撞进岸防炮的射程。
    function countAdjacentEnemies(tile) {
        let count = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (neighbor?.unit && neighbor.unit.camp !== myCamp) count++;
        }
        return count;
    }
    function evaluateCityDefense(cityTile, ownerCamp) {
        let score = 0;
        for (const tile of gameState.tiles) {
            if (!tile.unit || tile.unit.camp !== ownerCamp) continue;
            const distance = hexDistance(cityTile, tile);
            if (distance > 3) continue;
            score += tile.unit.hp * (distance === 0 ? 1.5 : distance <= 1 ? 1.0 : 0.5);
        }
        return score;
    }
    const isEngageable = tile => {
        const occupant = tile?.unit;
        if (!occupant || occupant.camp === myCamp) return false;
        return isEnemyCamp(occupant.camp) || !ownsForwardCity
            || (primaryObjective && hexDistance(tile, primaryObjective) <= 2);
    };

    // ── 目标选择：一回合短期承诺 + 粗略行政区价值 ──
    // 中档现在能避免最明显的左右摇摆，也知道带村庄/港口的城区更值钱；但它不算
    // 对手经济曲线、投诚兵力、航程与战线联动，这些仍是 Imperator 独占能力。
    const ownsForwardCity = myCities.some(city => !myHomeDistricts.has(city.districtId));
    const turnSlots = Math.max(1, gameState.turnOrder?.length || 1);
    const currentRound = Math.floor(Number(gameState.turnCounter || 0) / turnSlots) + 1;
    const capital = myCities.find(city => myHomeDistricts.has(city.districtId)) || myCities[0] || null;
    const directCapitalThreat = capital && allEnemyUnits.some(tile => hexDistance(tile, capital) <= 3);
    const remembered = gameState._legatusStrategicObjectives?.[campKey];
    const rememberedTile = remembered && remembered.expiresRound >= currentRound
        ? tileMap.get(`${remembered.q},${remembered.r}`) : null;
    let primaryObjective = directCapitalThreat
        ? capital
        : (rememberedTile?.isCity && rememberedTile.camp !== myCamp ? rememberedTile : null);
    if (!primaryObjective) {
        let bestScore = Infinity;
        const economy = estimateCampEconomy(gameState.tiles, myCamp);
        for (const city of hostileCities) {
            const asset = estimateDistrictAssetValue(city, gameState.tiles, {
                currentCityCount: economy.cityCount,
                roundsRemaining: 5,
                oceanMap: standardMap?.familyId === 'uncharted-passage'
            });
            const coarseAssetValue = asset.income + asset.villages + asset.ports;
            const score = avgDistance(city) * 2
                + evaluateCityDefense(city, city.camp) * 0.012
                - coarseAssetValue * 0.12
                + jitter(6);
            if (score < bestScore) { bestScore = score; primaryObjective = city; }
        }
    }
    gameState._legatusStrategicObjectives ||= {};
    if (primaryObjective) {
        gameState._legatusStrategicObjectives[campKey] = {
            q: primaryObjective.q,
            r: primaryObjective.r,
            expiresRound: currentRound + 1
        };
    }
    // 中档只维持一回合级别的攻城配合：指定最近占领者，但不会像 Imperator 那样跨战役保存护航编组。
    const objectiveOccupier = primaryObjective?.isCity && primaryObjective.camp !== myCamp
        ? [...livingAssaultUnits].sort((left, right) =>
            hexDistance(left.tile, primaryObjective) - hexDistance(right.tile, primaryObjective))[0] || null
        : null;
    const isObjectiveOccupier = unit => !!unit && unit.id === objectiveOccupier?.id;
    const enemyCapturePriority = target => {
        if (!target?.tile || !canCaptureCityByCombat(target)) return 0;
        const threatenedAsset = gameState.tiles.find(tile => tile.isCity
            && tile.camp !== target.camp && hexDistance(tile, target.tile) <= 2);
        return threatenedAsset ? (threatenedAsset.camp === myCamp ? 95 : 60) : 0;
    };
    function avgDistance(targetTile) {
        if (allUnits.length === 0) return 99;
        return allUnits.reduce((sum, unit) => sum + hexDistance(unit.tile, targetTile), 0) / allUnits.length;
    }

    const units = [...allUnits].sort((left, right) => {
        if (!primaryObjective) return 0;
        if (isObjectiveOccupier(left) && !isObjectiveOccupier(right)) return -1;
        if (isObjectiveOccupier(right) && !isObjectiveOccupier(left)) return 1;
        return hexDistance(left.tile, primaryObjective) - hexDistance(right.tile, primaryObjective);
    });

    // ═══ 卡牌 ═══
    const hand = gameState.playerHands[campKey] || [];
    let cardUses = gameState.playerUsesThisTurn[campKey] || 0;
    const drawCost = helpers.CARD_SYSTEM_CONFIG ? helpers.CARD_SYSTEM_CONFIG.drawCost : 4;

    if (gold >= 12 && (gameState.playerDrawsThisTurn[campKey] || 0) < 1 && hand.length === 0
        && (gameState.cardDrawPile.length > 0 || gameState.cardDiscardPile.length > 0)) {
        actions.push({ type: 'drawCard' });
        gold -= drawCost;
    }

    if (!myCommanderUnits.length && hand.includes('commanderDeploy')) {
        const carrierPref = cmdStrat.carrierPref || ['cavalry', 'infantry', 'archer'];
        let best = null, bestScore = -Infinity;
        for (const unit of allUnits) {
            if (unit.commander) continue;
            const typeIndex = carrierPref.indexOf(unit.type);
            let score = unit.hp / unit.maxHp * 50 + (typeIndex >= 0 ? (2 - typeIndex) * 20 : 0);
            if (primaryObjective) score += Math.max(0, 60 - hexDistance(unit.tile, primaryObjective) * 5);
            if (score > bestScore) { bestScore = score; best = unit; }
        }
        if (best) {
            actions.push({ type: 'tacticalCard', cardId: 'commanderDeploy', targetId: best.id });
            processed.add(best.id);
            cardUses++;
        }
    }

    for (const cardId of hand) {
        if (cardUses >= 1) break;
        if (cardId === 'commanderDeploy') continue;
        if (cardId === 'heal') {
            const wounded = allUnits
                .filter(unit => unit._poison || unit.hp < unit.maxHp * 0.4
                    || (isObjectiveOccupier(unit) && unit.hp < unit.maxHp * 0.6))
                .sort((left, right) => {
                    if (isObjectiveOccupier(left) !== isObjectiveOccupier(right)) {
                        return isObjectiveOccupier(left) ? -1 : 1;
                    }
                    return (left.hp / left.maxHp) - (right.hp / right.maxHp);
                })[0];
            if (wounded) {
                actions.push({ type: 'tacticalCard', cardId: 'heal', targetId: wounded.id });
                cardUses++;
            }
        } else if (cardId === 'lightning' || cardId === 'imprison' || cardId === 'poison') {
            let best = null, bestScore = 0;
            for (const tile of gameState.tiles) {
                if (!tileVisible(tile) || !isEngageable(tile)) continue;
                const target = tile.unit;
                let score = (1 - target.hp / target.maxHp) * 100 + (target.commander ? 90 : 0);
                if (cardId === 'poison') score += countAdjacentEnemies(tile) * 45 - countAdjacentAllies(tile, target.id) * 60;
                if (score > bestScore) { bestScore = score; best = target; }
            }
            if (best && bestScore >= 60) {
                actions.push({ type: 'tacticalCard', cardId, targetId: best.id });
                cardUses++;
            }
        } else if (cardId === 'shield') {
            const anchor = allUnits.find(isObjectiveOccupier)
                || allUnits.find(unit => unit.commander) || allUnits[0];
            if (anchor) {
                actions.push({ type: 'tacticalCard', cardId: 'shield', targetId: anchor.id });
                cardUses++;
            }
        } else if (cardId === 'forceMarch') {
            const exhausted = livingOwnUnits
                .filter(unit => !unit.canAct && (isObjectiveOccupier(unit) || unit.commander))
                .sort((left, right) => Number(isObjectiveOccupier(right)) - Number(isObjectiveOccupier(left)))[0];
            if (exhausted) {
                actions.push({ type: 'tacticalCard', cardId: 'forceMarch', targetId: exhausted.id });
                cardUses++;
            }
        }
    }

    // ═══ 主动技能 ═══
    for (const unit of allUnits) {
        if (processed.has(unit.id)) continue;
        if (!['berserker', 'paladin', 'priest'].includes(unit.commander)) continue;
        const reachable = getAttackableTiles(unit).filter(isEngageable);
        const hasWoundedAlly = gameState.tiles.some(tile => tile.unit
            && tile.unit.camp === myCamp && tile.unit !== unit
            && tile.unit.hp < tile.unit.maxHp
            && hexDistance(unit.tile, tile) <= 2);
        if (!shouldPlanActiveSkill(unit, { hasAttackTarget: reachable.length > 0, hasWoundedAlly })) continue;
        if (unit.commander === 'berserker' && !shouldSpendBerserkerBlood({
            hpRatio: unit.hp / unit.maxHp,
            convertsToKill: reachable.some(tile => willKill(unit, tile.unit)),
            highValueTarget: reachable.some(tile => tile.unit.commander)
        })) continue;
        actions.push({ type: 'activateSkill', unitId: unit.id });
        if (unit.commander === 'priest') processed.add(unit.id);
    }

    // ═══ 捡城：只处理「已经破了的空城」 ═══
    // 中档知道远程进不了城，所以会派近战走进已破的空城——这是机会主义的捡漏，
    // 不是有计划的夺城。它不会为了占城去指派近战击杀守军，也不会检查
    // 「远程把门拆开之后谁先进得去」，因此照样会替对手拆城门。
    for (const city of hostileCities) {
        if (city.unit || city.hp > 0) continue;
        const enterer = units.find(unit => !processed.has(unit.id)
            && canCaptureCityByCombat(unit) && getMovableTiles(unit).includes(city));
        if (enterer) {
            actions.push({ type: 'move', unitId: enterer.id, tileQ: city.q, tileR: city.r });
            processed.add(enterer.id);
        }
    }

    // ═══ 攻击：算净交换 + 集火 ═══
    for (const unit of units) {
        if (processed.has(unit.id)) continue;
        const targets = getAttackableTiles(unit)
            .filter(isEngageable)
            .filter(tile => effectiveHp(tile.unit) > 0);
        if (targets.length === 0) continue;

        let bestTile = null, bestScore = -Infinity;
        for (const tile of targets) {
            const target = tile.unit;
            const inflicted = Math.min(effectiveHp(target), estimateDamage(unit, target, tile));
            const counter = estimateCounterDamage(unit, target);
            let score = inflicted * 0.8 - counter * 0.7;
            if (willKill(unit, target)) score += 200 * (cmdStrat.killBonus || 1);
            if (wouldDieToCounter(unit, target)) score -= 150;
            if (tile.isCity && tile.camp !== myCamp) score += 120;
            if (primaryObjective && tile === primaryObjective) score += 150;
            if (target.commander) score += 60;
            score += enemyCapturePriority(target);
            if (counterCoefficient(unit.type, target.type) > 1) score += 40;
            score += scoreTacticalRoleMatchup(unit, target);
            score += countAdjacentAllies(tile, target.id) * 20;
            score += jitter(55);
            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }
        // 开火门槛略低于「净收益为正」：一味只做稳赚的交换会变成挨打不还手，
        // 双人局里它因此打得比入门档还少、死得还多。
        if (bestTile && bestScore > -40) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: bestTile.unit.id });
            processed.add(unit.id);
        }
    }

    // ═══ 攻城：优先已经磨低的城墙，不检查近战跟进 ═══
    for (const unit of units) {
        if (processed.has(unit.id)) continue;
        const siegeTiles = getAttackableTiles(unit)
            .filter(tile => !tile.unit && tile.isCity && tile.hp > 0 && tile.camp !== myCamp)
            .sort((left, right) => left.hp - right.hp);
        if (siegeTiles.length === 0) continue;
        const siegeTarget = siegeTiles[0];
        if (!canCaptureCityByCombat(unit)
            && estimateSiegeDamage(unit, siegeTarget) >= siegeTarget.hp) {
            const completion = assessSiegeMission({
                cityHp: 0,
                cityOccupied: false,
                occupierDistance: objectiveOccupier
                    ? hexDistance(objectiveOccupier.tile, siegeTarget)
                    : Infinity,
                occupierMoveRange: objectiveOccupier?.config?.speed
            });
            if (!completion.safeToFinishBreach) continue;
        }
        actions.push({
            type: 'siegeCityAttack', unitId: unit.id,
            tileQ: siegeTarget.q, tileR: siegeTarget.r
        });
        processed.add(unit.id);
    }

    // ═══ 移动：向目标推进，只数相邻敌人，不做威胁预测 ═══
    const reserved = new Set();
    const garrisoned = new Set();
    const needsAssaultProduction = livingAssaultUnits.length < 3;
    const lacksOpenCity = !myCities.some(city => !city.unit);
    for (const unit of units) {
        if (processed.has(unit.id)) continue;
        const validTiles = getMovableTiles(unit)
            .filter(tile => !tile.unit && !reserved.has(`${tile.q},${tile.r}`));
        if (validTiles.length === 0) continue;

        // 守城：步兵或受威胁时留守，中档不区分主城与前哨城。
        if (unit.tile.isCity && unit.tile.camp === myCamp) {
            const cityKey = `${unit.tile.q},${unit.tile.r}`;
            const threatened = allEnemyUnits.some(tile => hexDistance(tile, unit.tile) <= 3);
            const shouldVacateForProduction = needsAssaultProduction && lacksOpenCity
                && !unit.commander && !threatened && gold >= UNIT_CONFIG.infantry.cost;
            if (!shouldVacateForProduction
                && !garrisoned.has(cityKey) && (unit.type === 'infantry' || threatened)) {
                garrisoned.add(cityKey);
                continue;
            }
        }

        const hpRatio = unit.hp / unit.maxHp;
        let bestTile = null, bestScore = -Infinity;
        for (const tile of validTiles) {
            let score = 0;
            if (primaryObjective) {
                const gained = hexDistance(unit.tile, primaryObjective) - hexDistance(tile, primaryObjective);
                score += gained * 12 * (cmdStrat.pushWeight || 1);
                if (isObjectiveOccupier(unit)) score += gained * 22;
                if (tile.isCity && tile.camp !== myCamp && canCaptureCityByCombat(unit)) score += 90;
            }
            // 只数相邻敌人——不像最高档那样推算敌方下回合的火力覆盖。
            const adjacentEnemies = countAdjacentEnemies(tile);
            score -= adjacentEnemies * (hpRatio < 0.4 ? 40 : 12);
            score += countAdjacentAllies(tile, unit.id) * 8;
            if (tile.terrain === 'mountain') score += 6;
            else if (tile.terrain === 'forest') score += 4;
            if (tile.isVillage) score += 15;
            score += jitter(30);
            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }
        if (bestTile && !(bestTile.q === unit.tile.q && bestTile.r === unit.tile.r)) {
            const vacatedCityKey = unit.tile.isCity && unit.tile.camp === myCamp
                ? `${unit.tile.q},${unit.tile.r}` : null;
            actions.push({ type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r });
            if (vacatedCityKey && !unit.commander && needsAssaultProduction && lacksOpenCity) {
                plannedVacatedRecruitCities.add(vacatedCityKey);
            }
            reserved.add(`${bestTile.q},${bestTile.r}`);
            processed.add(unit.id);
        }
    }

    // ═══ 补员 ═══
    let reinforced = 0;
    for (const tile of gameState.tiles) {
        if (reinforced >= 1) break;
        const unit = tile.unit;
        if (!unit || unit.camp !== myCamp || unit.hp >= unit.maxHp * 0.5) continue;
        if (!((tile.isCity && tile.camp === myCamp) || tile.isVillage) || tile._reinforcedThisTurn) continue;
        const cost = Math.max(1, Math.ceil(unit.config.cost * 0.5));
        if (gold - cost < 8) break;
        actions.push({ type: 'reinforce', unitId: unit.id });
        gold -= cost;
        reinforced++;
    }

    // ═══ 招募：按敌方主力兵种反制 ═══
    const emptyOwnCities = gameState.tiles.filter(t => t.isCity && t.camp === myCamp
        && (!t.unit || plannedVacatedRecruitCities.has(`${t.q},${t.r}`)));
    const hasEmptyPort = gameState.tiles.some(tile => tile.isPort && tile.camp === myCamp && !tile.unit);
    if (gold < 8 || (emptyOwnCities.length === 0 && !hasEmptyPort)) return actions;

    const enemyTypeCounts = { infantry: 0, cavalry: 0, archer: 0 };
    for (const tile of allEnemyUnits) {
        if (enemyTypeCounts[tile.unit.type] !== undefined) enemyTypeCounts[tile.unit.type]++;
    }
    const dominant = Object.entries(enemyTypeCounts).sort((a, b) => b[1] - a[1])[0];
    let recruitPriority = cmdStrat.recruitPref || ['cavalry', 'archer', 'infantry'];
    if (dominant && dominant[1] > 0) {
        recruitPriority = dominant[0] === 'cavalry' ? ['infantry', 'archer', 'cavalry']
            : dominant[0] === 'archer' ? ['cavalry', 'infantry', 'archer']
                : ['archer', 'cavalry', 'infantry'];
    }
    // 保证还有能进城的兵；中档只看总数，不按剩余城市目标数动态推算。
    const assaultCount = livingAssaultUnits.length;
    if (assaultCount < 3) {
        recruitPriority = ['infantry', 'cavalry',
            ...recruitPriority.filter(type => type !== 'infantry' && type !== 'cavalry')];
    }

    emptyOwnCities.sort((left, right) => {
        const score = city => (primaryObjective
            ? Math.max(0, 100 - hexDistance(city, primaryObjective) * 6) : 0)
            + countAdjacentEnemies(city) * 35;
        return score(right) - score(left);
    });

    const maxRecruits = gold >= 25 ? 3 : gold >= 12 ? 2 : 1;
    let recruitCount = 0;
    if (standardMap?.familyId === 'uncharted-passage' && assaultCount >= 2) {
        const emptyPort = gameState.tiles.find(tile => tile.isPort && tile.camp === myCamp && !tile.unit);
        const ownNaval = gameState.tiles.filter(tile =>
            tile.unit?.camp === myCamp && tile.unit.config?.movementDomain === 'naval').length;
        const enemyNaval = allEnemyUnits.filter(tile =>
            tile.unit.config?.movementDomain === 'naval').length;
        if (emptyPort && ownNaval < Math.max(2, enemyNaval)) {
            const navalOrder = allEnemyUnits.some(tile => tile.unit.type === 'submarine')
                ? ['destroyer', 'warship', 'submarine'] : ['submarine', 'destroyer', 'warship'];
            const type = navalOrder.find(unitType => gold >= UNIT_CONFIG[unitType].cost
                && (!canRecruitTypeAtSite || canRecruitTypeAtSite(unitType, emptyPort)));
            if (type) {
                actions.push({ type: 'recruit', unitType: type, tileQ: emptyPort.q, tileR: emptyPort.r });
                gold -= UNIT_CONFIG[type].cost;
                recruitCount++;
            }
        }
    }
    for (let index = 0; index < emptyOwnCities.length && recruitCount < maxRecruits; index++) {
        const city = emptyOwnCities[index];
        const types = recruitTypesForCity ? recruitTypesForCity(city, recruitPriority) : recruitPriority;
        for (const type of types) {
            if (gold >= UNIT_CONFIG[type].cost) {
                actions.push({ type: 'recruit', unitType: type, tileQ: city.q, tileR: city.r });
                gold -= UNIT_CONFIG[type].cost;
                recruitCount++;
                break;
            }
        }
    }

    return actions;
}
