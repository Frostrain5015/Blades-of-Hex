// 感知层 —— 把 gameState 折算成一份「世界模型」。
//
// 输出是纯数据（含少量函数），不做任何决策；战略/任务/战术层只读它。
// 迷雾限制普通档位的情报。困难遭遇战直接读取模拟状态，不修改显示视野。

import { getRound } from '../../rules/turns.js';
import { campToKey } from '../../rules/camps.js';
import { getStandardMap } from '../../rules/standardMaps.js';
import { isWaterTile } from '../../rules/surfaces.js';
import { laserTowerShotDamage } from '../../rules/laserTower.js';
import { AI_DIFFICULTY_PROFILES, hasFullAiIntelligence } from '../difficulty.js';
import { UNIT_CONFIG } from '../../rules/units.js';
import { COMMANDER_CONFIG } from '../../rules/commanders.js';
import {
    canCaptureCityByCombat,
    createCombatModel,
    estimateSiegeDamage
} from '../doctrine.js';
import {
    estimateCampEconomy,
    estimateDistrictAssetValue,
    estimateFogRivalForce,
    estimateForceValue
} from '../strategy.js';
import { W } from './weights.js';

const NEUTRAL_KEY = 'neutral';

/** 按难度上限读取回合限制（对齐 gameLogic.checkTurnLimitVictory）。 */
export function getTurnLimit(gameState) {
    return gameState.isThreePlayer ? 26 : 19;
}

/** 每回合把当前可见敌军写入情报记忆，返回带"龄期"的情报表。 */
function updateIntelMemory(gameState, campKey, visibleEnemies, round) {
    const memory = (gameState._aiCoreMemory ||= {});
    const mine = (memory[campKey] ||= {});
    const intel = (mine.intel ||= {});
    for (const unit of visibleEnemies) {
        const key = campToKey(unit.camp);
        const entry = (intel[key] ||= { lastSeenRound: -99, units: {} });
        entry.lastSeenRound = round;
        entry.units[unit.id] = {
            type: unit.type, q: unit.tile.q, r: unit.tile.r,
            hp: unit.hp, maxHp: unit.maxHp,
            commander: unit.commander || null,
            capturable: canCaptureCityByCombat(unit),
            seenRound: round
        };
    }
    // 清理阵亡已久/超过 12 回合未见的条目，防止记忆腐烂成噪声。
    for (const key of Object.keys(intel)) {
        for (const [id, seen] of Object.entries(intel[key].units)) {
            if (round - seen.seenRound > 12) delete intel[key].units[id];
        }
        if (round - intel[key].lastSeenRound > 12 && Object.keys(intel[key].units).length === 0) {
            delete intel[key];
        }
    }
    return intel;
}

/** 情报龄期：距最后一次看到该阵营主力过去了多少回合。 */
function intelAge(intel, campKey, round) {
    const entry = intel[campKey];
    if (!entry) return Infinity;
    return Math.max(0, round - entry.lastSeenRound);
}

/**
 * 建立世界模型。
 * @param {object} gameState 引擎状态
 * @param {object} helpers   js/ai.js 提供的助手集
 * @param {object} myCamp    本阵营 faction 对象
 * @param {object} caps      TIER_CAPABILITIES 中的一档
 */
export function buildWorld(gameState, helpers, myCamp, caps) {
    const myCampKey = campToKey(myCamp);
    const round = getRound(gameState);
    const turnLimit = getTurnLimit(gameState);
    const roundsRemaining = Math.max(0, turnLimit - round);
    const fullIntelligence = hasFullAiIntelligence(gameState, myCamp, AI_DIFFICULTY_PROFILES[caps.id]);
    const fog = !!gameState.skirmishFog && !fullIntelligence;
    const tiles = gameState.tiles;
    const standardMap = getStandardMap(gameState.isThreePlayer ? 3 : 2, gameState.standardMapId);
    const oceanMap = standardMap?.familyId === 'uncharted-passage';
    const combat = createCombatModel({ weather: gameState.weather || 'clear', hexDistance: helpers.hexDistance });

    const factions = Object.values(gameState.factions || {});
    const rivalFactions = factions.filter(faction =>
        faction !== myCamp && faction.id !== NEUTRAL_KEY
        && helpers.isHostileFaction(myCamp, faction));
    const neutralFaction = gameState.factions?.[NEUTRAL_KEY] || null;

    const visible = tile => !fog || helpers.isTileVisible(tile, myCamp);
    const explored = tile => {
        if (!fog) return true;
        const set = gameState.exploredTiles?.[myCampKey];
        return set ? set.has(`${tile.q},${tile.r}`) : true;
    };

    // ── 单位分类 ─────────────────────────────────────────────
    const myUnits = [];
    const rivalUnits = [];
    const neutralUnits = [];
    for (const tile of tiles) {
        const unit = tile.unit;
        if (!unit || unit.hp <= 0) continue;
        if (unit.camp === myCamp) {
            myUnits.push(unit);
        } else if (unit.camp === neutralFaction) {
            if (visible(tile)) neutralUnits.push(unit);
        } else if (rivalFactions.includes(unit.camp)) {
            if (visible(tile)) rivalUnits.push(unit);
        }
    }

    // ── 情报记忆（迷雾下的"敌方最后已知位置"）────────────────
    const intel = caps.intelTracking
        ? updateIntelMemory(gameState, myCampKey, rivalUnits, round)
        : {};
    const stalestRivalAge = rivalFactions.length
        ? Math.max(...rivalFactions.map(f => intelAge(intel, campToKey(f), round)))
        : 0;

    // ── 城市与行政区资产 ─────────────────────────────────────
    const myCities = tiles.filter(t => t.isCity && t.camp === myCamp);
    const cityTiles = tiles.filter(t => t.isCity);
    const cityCountByKey = { [myCampKey]: myCities.length };
    for (const faction of rivalFactions) {
        cityCountByKey[campToKey(faction)] = cityTiles.filter(t => t.camp === faction).length;
    }
    const bestRivalCities = Math.max(0, ...rivalFactions.map(f => cityCountByKey[campToKey(f)] || 0));
    const carrierControl = standardMap?.carrierControl || null;
    // 只估价情报中仍存活且可通过夺城获得的航母。
    const transferableCarrierValue = estimateForceValue([...neutralUnits, ...rivalUnits]
        .filter(unit => unit.type === 'carrier'));
    const cities = cityTiles.map(tile => {
        const ownerKey = tile.camp === myCamp ? myCampKey
            : rivalFactions.includes(tile.camp) ? campToKey(tile.camp)
            : tile.camp === neutralFaction ? NEUTRAL_KEY
            : explored(tile) ? NEUTRAL_KEY : 'unknown';
        const asset = estimateDistrictAssetValue(tile, tiles, {
            currentCityCount: myCities.length,
            roundsRemaining,
            oceanMap,
            enemyOwned: rivalFactions.includes(tile.camp),
            carrierControl,
            transferableCarrierValue
        });
        return {
            tile,
            ownerKey,
            mine: ownerKey === myCampKey,
            hostile: ownerKey !== myCampKey,
            hp: Number(tile.hp) || 0,
            garrison: tile.unit || null,
            asset,
            explored: explored(tile)
        };
    });

    // ── 威胁图：某格在下回合可能承受的最大伤害 ────────────────
    // 取伤害最高的两个攻击者的和（模拟集火），其余忽略。
    const hostileForThreat = [...rivalUnits, ...neutralUnits];
    function threatAt(tile, unit, excludedEnemy = null) {
        if (!tile) return 0;
        const damages = [];
        for (const enemy of hostileForThreat) {
            if (enemy === excludedEnemy || !enemy.tile || (enemy.type === 'submarine' && !isWaterTile(tile))) continue;
            const range = Math.max(1, Number(enemy.getEffectiveRange?.() ?? enemy.config?.range) || 1);
            const baseSpeed = Math.max(0, Number(enemy.config?.speed) || 0);
            const speed = enemy._isImmobile || baseSpeed === 0 ? 0 : caps.threatForecast ? baseSpeed : 2;
            const reach = range + Math.min(speed, 4);
            if (helpers.hexDistance(enemy.tile, tile) > reach) continue;
            const clusteredTargets = enemy.type === 'laserTower'
                ? myUnits.filter(ally => ally.tile && helpers.hexDistance(enemy.tile, ally.tile) <= range).length
                : 0;
            const dmg = enemy.type === 'laserTower'
                ? laserTowerShotDamage(Math.max(1, clusteredTargets))
                : combat.estimateDamage(enemy, unit || { type: 'infantry', config: { defense: 0 } }, tile);
            if (dmg > 0) damages.push(dmg);
        }
        damages.sort((a, b) => b - a);
        return (damages[0] || 0) + (damages[1] || 0);
    }

    // ── 经济与战力 ───────────────────────────────────────────
    function economyFor(faction) {
        const campKey = campToKey(faction);
        const economy = estimateCampEconomy(tiles, faction, fullIntelligence ? gameState : null);
        if (!fullIntelligence) return { campKey, ...economy };
        const minister = tiles.find(tile => tile.isCity && tile.unit?.hp > 0
            && tile.unit.camp === faction && tile.unit.commander === 'minister');
        const { goldPerRound, maxGoldPerRound } = COMMANDER_CONFIG.minister.balance;
        const ministerIncome = minister ? Math.min(round * goldPerRound, maxGoldPerRound) : 0;
        return {
            campKey, ...economy,
            gold: Number(gameState.playerGold?.[campKey]) || 0,
            projectedIncome: economy.projectedIncome + ministerIncome
        };
    }
    const economy = economyFor(myCamp);
    const rivalEconomies = rivalFactions.map(economyFor);
    const rivalEconomyByKey = new Map(rivalEconomies.map(profile => [profile.campKey, profile]));
    const strongestRivalEconomy = rivalEconomies.sort((a, b) => b.projectedIncome - a.projectedIncome)[0]
        || { projectedIncome: 0 };
    const ownForceValue = estimateForceValue(myUnits);
    const observedRivalForce = estimateForceValue(rivalUnits);
    const rivalProfiles = rivalFactions.map(faction => {
        const campKey = campToKey(faction);
        const units = rivalUnits.filter(unit => unit.camp === faction);
        return {
            campKey,
            unitCount: units.length,
            cityCount: cityCountByKey[campKey] || 0,
            forceValue: estimateForceValue(units)
        };
    });
    const collapseTarget = !fog && caps.collapseConversion && round >= 6 && myUnits.length >= 6
        ? rivalProfiles
            .filter(profile => profile.cityCount <= 2 && profile.unitCount <= 4
                && ownForceValue >= Math.max(1, profile.forceValue) * 2.2)
            .sort((a, b) => a.cityCount - b.cityCount
                || a.forceValue - b.forceValue
                || a.unitCount - b.unitCount)[0] || null
        : null;
    const aiMemory = (gameState._aiCoreMemory ||= {});
    const intelMemory = (aiMemory[myCampKey] ||= {});
    const baseRivalEstimate = estimateFogRivalForce({
        fogEnabled: fog,
        ownForceValue,
        observedForceValue: observedRivalForce,
        previousEstimate: intelMemory.rivalForceEstimate ?? null,
        elapsedRounds: Math.max(0, round - (intelMemory.forceEstimateRound ?? round - 1))
    });
    // 迷雾零接触 ≠ 敌人死光了：对方也在征兵，估计值永不跌破我方当前兵力的 70%。
    // 旧先验随我方征兵水涨船高（自锚定 0.3 下限），forceRatio 会永久钉死在 3.33——
    // 舰队都快死完了还自认大胜（回归局实证）。
    const rivalForceEstimate = fog
        ? Math.max(baseRivalEstimate, ownForceValue * 0.7)
        : baseRivalEstimate;
    intelMemory.rivalForceEstimate = rivalForceEstimate;
    intelMemory.forceEstimateRound = round;

    // ── 手牌与预算 ───────────────────────────────────────────
    const cardConfig = helpers.CARD_SYSTEM_CONFIG || { drawCost: 4, maxDrawsPerTurn: 2, maxUsesPerTurn: 2, maxHandSize: 3 };
    const hand = (gameState.playerHands?.[myCampKey] || [])
        .map(card => (typeof card === 'string' ? card : card?.id))
        .filter(Boolean);
    const gold = Number(gameState.playerGold?.[myCampKey]) || 0;

    return {
        gameState, helpers, myCamp, myCampKey, caps, combat,
        round, roundsRemaining, turnLimit, fog, oceanMap, standardMap,
        tiles, tileMap: gameState.tileMap,
        weather: gameState.weather || 'clear',
        myUnits, rivalUnits, neutralUnits, rivalFactions,
        myCities, cities, cityCountByKey, bestRivalCities, rivalProfiles, collapseTarget,
        cityGap: myCities.length - bestRivalCities,
        economy, strongestRivalEconomy, rivalEconomyByKey,
        ownForceValue, observedRivalForce, rivalForceEstimate,
        intel, stalestRivalAge,
        threatAt,
        visible, explored,
        hand, gold, cardConfig,
        cardUsesLeft: Math.max(0, (cardConfig.maxUsesPerTurn || 2) - (gameState.playerUsesThisTurn?.[myCampKey] || 0)),
        cardDrawsLeft: Math.max(0, (cardConfig.maxDrawsPerTurn || 2) - (gameState.playerDrawsThisTurn?.[myCampKey] || 0)),
        handFull: hand.length >= (cardConfig.maxHandSize || 3),
        // 便捷判定
        estimateSiegeDamage,
        isCapturable: canCaptureCityByCombat,
        isNaval: unit => unit?.config?.movementDomain === 'naval',
        isImmobile: unit => !!unit?._isImmobile || Number(unit?.config?.speed || 0) <= 0,
        onWater: tile => !!tile && isWaterTile(tile)
    };
}

/** 城市守备力量：守军 + 城市周边 2 格内的防御者（含城防折算）。 */
export function estimateDefenseForce(world, city) {
    let force = 0;
    for (const unit of [...world.rivalUnits, ...world.neutralUnits]) {
        if (!unit.tile) continue;
        const distance = world.helpers.hexDistance(unit.tile, city.tile);
        if (distance > 2) continue;
        const isOwner = unit.camp === city.tile.camp;
        force += (unit.config?.cost || 8) * (isOwner ? 1 : 0.5) * (distance === 0 ? 1.4 : 1);
    }
    return force + (city.hp || 0) / 45;
}

/** 攻城方在目标周边的集结力量（5 格内按血量就绪度折算）。 */
export function estimateLocalStrikeForce(world, cityTile) {
    let force = 0;
    for (const unit of world.myUnits) {
        if (!unit.tile || world.isImmobile(unit)) continue;
        const distance = world.helpers.hexDistance(unit.tile, cityTile);
        if (distance > 5) continue;
        const readiness = Math.max(0.25, Math.min(1, unit.hp / unit.maxHp));
        force += (unit.config?.cost || 8) * readiness * (distance <= 2 ? 1 : 0.5);
    }
    return force;
}

/** 世界模型里的城市条目按"夺城优先级"粗排：资产高且好下的优先。 */
export function rankCityObjectives(world, etaFor) {
    // 3P 制衡：领先者的城市给加成（抢地集火于领先者，不打垫底者替人做嫁衣）。
    const rivalCityCounts = Object.entries(world.cityCountByKey || {})
        .filter(([key]) => key !== world.myCampKey && key !== 'neutral');
    const leaderKey = rivalCityCounts.length > 1
        ? rivalCityCounts.sort((a, b) => b[1] - a[1])[0]?.[0]
        : null;
    const leaderCities = leaderKey ? (world.cityCountByKey[leaderKey] || 0) : 0;
    return world.cities
        .filter(city => city.hostile)
        .map(city => {
            const eta = etaFor(city);
            const garrison = city.garrison && city.garrison.camp !== world.myCamp ? city.garrison : null;
            const defense = estimateDefenseForce(world, city);
            const leaderBonus = leaderKey && city.ownerKey === leaderKey && leaderCities > world.myCities.length
                ? W.leaderCityBonus
                    + (world.caps.victoryClock && world.roundsRemaining <= 8
                        ? W.leaderClockSwingBonus : 0)
                : 0;
            const rivalCaptureEta = city.asset.reward > 0 && world.caps.strategicPrizeRacing
                ? world.rivalUnits
                    .filter(unit => world.isCapturable(unit) && !world.isImmobile(unit) && unit.tile)
                    .reduce((best, unit) => {
                        const speed = Math.max(1, Number(unit.config?.speed) || 1);
                        const rivalEta = Math.ceil(world.helpers.hexDistance(unit.tile, city.tile) / speed);
                        return Math.min(best, rivalEta);
                    }, 99)
                : 99;
            const prizeRaceBonus = city.asset.reward > 0 && world.caps.strategicPrizeRacing
                && rivalCaptureEta <= (eta ?? 99) + W.strategicPrizeRaceWindow
                ? city.asset.reward * W.strategicPrizeRaceRatio
                : 0;
            const rivalEconomy = world.rivalEconomyByKey?.get(city.ownerKey);
            const recruitmentPressure = eta > 1 && city.hp > 0 && !garrison
                && rivalEconomy?.gold != null && rivalEconomy.gold + rivalEconomy.projectedIncome >= UNIT_CONFIG.infantry.cost
                ? W.rivalRecruitmentPressure : 0;
            return {
                city,
                eta: eta == null ? 99 : eta,
                defense,
                rivalCaptureEta,
                // 资产随等待折现（1.22^eta）；守备力量计入成本（固定种子实测 1.5 最优）；
                // 中立城给先验加成（扩张期软目标）。
                score: city.asset.total / Math.pow(1.22, Math.max(0, eta == null ? 99 : eta))
                    - defense * 1.5
                    - (garrison ? 10 : 0)
                    + (city.ownerKey === 'neutral' ? 18 : 0)
                    + leaderBonus
                    + prizeRaceBonus
                    - recruitmentPressure
                    - Math.min(60, city.hp * 0.12)
            };
        })
        .sort((a, b) => b.score - a.score);
}
