// Imperator —— 最高档指挥官。
//
// 与另外两档的根本差别不是「多几个加分项」，而是它是唯一一个**下战役棋**的档次：
//   · 战役目标承诺：三回合内锁定同一座城，不因单回合评分抖动而改主意
//   · 对手实力建模：按可见兵力与已知城市给每个敌人打分，优先撬动最强者的地盘
//   · 威胁预测：按敌方射程+移动力推算落点危险，而不是只数相邻敌人
//   · 终局抢点：回合限制前三回合切换成纯占城模式
//   · 后方将领职责：尚书驻城产金、亡灵法师不前压、占星者按战局决定进退
//   · 疫情管制、破城最后一击预留、远程攻城需近战跟进、净交换否决
//
// 条令（规则事实）来自 ai/doctrine.js，本文件只负责「怎么打」。

import {
    BERSERKER_BALANCE,
    COMMANDER_STRATEGY,
    canCaptureCityByCombat,
    counterCoefficient,
    createCombatModel,
    estimateSiegeDamage,
    CITY_VISION_RANGE,
    estimateUnitVisionRadius,
    getStrategicCityDistrictProfile,
    hasMinisterYieldCooldownElapsed,
    isImmediateBacktrack,
    poisonPressure,
    readStrategicObjectiveCommitment,
    scoreTacticalRoleMatchup,
    selectCommander as doctrineSelectCommander,
    selectCommanderPair as doctrineSelectCommanderPair,
    shouldKeepAstrologerRear,
    shouldPlanActiveSkill,
    shouldReserveFinalSiegeBlow,
    shouldSpendBerserkerBlood,
    shouldYieldMinisterCity
} from './doctrine.js';
import {
    assessStrategicPosture,
    estimateCampEconomy,
    estimateDistrictAssetValue,
    estimateFogRivalForce,
    estimateForceValue,
    shouldBreakObjectiveCommitment
} from './strategy.js';
import { getStandardMap } from '../rules/standardMaps.js';
import {
    getEagleSynergyMeter,
    hasEagleSynergyActive,
    isEagleAirAttacker,
    isEagleCommanderUnit,
    isEagleFortressAttacker
} from '../rules/eagle.js';

export const meta = {
    name: 'Imperator',
    tier: 'Max',
    difficultyId: 'hard',
    description: '战役级指挥：锁定战役目标、建模对手、预测威胁、终局抢点'
};

export const selectCommander = doctrineSelectCommander;
export const selectCommanderPair = doctrineSelectCommanderPair;

export function planActions(gameState, helpers, myCamp) {
    const {
        getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP,
        UNIT_CONFIG, isHostileFaction, recruitTypesForCity, canRecruitTypeAtSite
    } = helpers;
    const tileMap = gameState.tileMap;
    const actions = [];
    const processed = new Set();

    const weather = gameState.weather || 'clear';

    let enemyCamps = (gameState.turnOrder || Object.keys(CAMP))
        .filter(key => key !== 'neutral')
        .map(key => CAMP[key])
        .filter(faction => faction && faction !== myCamp
            && faction.active !== false
            && (!isHostileFaction || isHostileFaction(myCamp, faction)));
    // 兜底：外交尚未初始化时仍把所有其他玩家阵营视为竞争者。
    if (enemyCamps.length === 0) {
        enemyCamps = (gameState.turnOrder || Object.keys(CAMP))
            .filter(key => key !== 'neutral')
            .map(key => CAMP[key])
            .filter(faction => faction && faction !== myCamp && faction.active !== false);
    }
    if (enemyCamps.length === 0) return actions;
    const enemyCampKeys = new Set(enemyCamps.map(camp => camp.id));
    const isEnemyCamp = camp => enemyCampKeys.has(camp?.id);
    const standardMap = getStandardMap(
        gameState.isThreePlayer ? 3 : 2,
        gameState.standardMapId
    );
    const {
        neutralDistricts,
        myHomeDistricts,
        enemyHomeDistricts: enemyCapitalDistricts
    } = getStrategicCityDistrictProfile(standardMap, myCamp.id, enemyCampKeys);
    const turnSlots = Math.max(1, gameState.turnOrder?.length || 1);
    const currentRound = Math.floor(Number(gameState.turnCounter || 0) / turnSlots) + 1;
    const roundLimit = gameState.isThreePlayer ? 26 : 19;
    const roundsRemaining = Math.max(0, roundLimit - currentRound);
    // 终局窗口按「是否已经领先」动态放宽。回合限制判的是城市数，领先方只要
    // 守住就赢，落后或持平的一方必须提前动手——三回合的窗口连行军都不够，
    // 回归里 Imperator 揣着 20 个单位、3 座城，眼睁睁打成平局。
    const myCityCount = gameState.tiles.filter(tile => tile.isCity && tile.camp === myCamp).length;
    const bestRivalCityCount = Math.max(0, ...enemyCamps.map(camp =>
        gameState.tiles.filter(tile => tile.isCity && tile.camp === camp).length));
    const trailingOnCities = myCityCount <= bestRivalCityCount;
    const terminalPhase = roundsRemaining <= (trailingOnCities ? 7 : 3);
    // 最高档不掷骰：同一局面永远给出同一个决定。评分里保留 jitterScore 的调用点
    // 只是为了与另外两档共用同一套评分公式书写方式，这里恒为 0。
    const jitterScore = () => 0;
    /** 总是取评分最优项，不做候选窗口抽样。 */
    const chooseFromRanked = (items, scoreOf, ascending = true) => {
        if (items.length === 0) return null;
        return [...items].sort((left, right) => {
            const delta = scoreOf(left) - scoreOf(right);
            return ascending ? delta : -delta;
        })[0];
    };
    const tileVisible = tile => !gameState.skirmishFog
        || !helpers.isTileVisible
        || helpers.isTileVisible(tile, myCamp);
    const tileExplored = tile => !gameState.skirmishFog
        || tileVisible(tile)
        || gameState.exploredTiles?.[myCamp.id]?.has?.(`${tile.q},${tile.r}`);

    // ═══════════════════════════════════════════
    // 辅助函数
    // ═══════════════════════════════════════════

    function isOwnCity(tile) { return tile.isCity && tile.camp === myCamp; }
    function isEnemyCity(tile) { return tile.isCity && isEnemyCamp(tile.camp); }
    function isNeutralCity(tile) { return tile.isCity && tile.camp === CAMP.neutral; }

    // 夺城时中立守军同样是障碍：即便已进入阶段2，清掉它换一座城依然划算。
    function isCapturableOccupant(unit) {
        return !!unit && unit.camp !== myCamp
            && (!isHostileFaction || isHostileFaction(myCamp, unit.camp));
    }

    /**
     * 远程单位打空城防前的安全判定：城防归零后城市对所有人开放，
     * 只有我方近战比对手更快能进驻时，这一击才是自己的收益。
     */
    function assaultReinforcementNearby(cityTile) {
        let myClosest = Infinity;
        let rivalClosest = Infinity;
        for (const tile of gameState.tiles) {
            const occupant = tile.unit;
            if (!occupant || occupant.hp <= 0 || !canCaptureCityByCombat(occupant)) continue;
            const steps = hexDistance(tile, cityTile)
                / Math.max(1, Number(occupant.config?.speed || 1));
            if (occupant.camp === myCamp) myClosest = Math.min(myClosest, steps);
            else if (tileVisible(tile)) rivalClosest = Math.min(rivalClosest, steps);
        }
        return myClosest <= 3 && myClosest <= rivalClosest;
    }

    function countAdjacentAllies(tile, excludeId) {
        let c = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && nb.unit && nb.unit.camp === myCamp && nb.unit.id !== excludeId) c++;
        }
        return c;
    }

    function countAdjacentEnemies(tile) {
        let c = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && nb.unit && isEnemyCamp(nb.unit.camp)) c++;
        }
        return c;
    }

    function countHostileClusterAround(tile) {
        let count = tile.unit && isEnemyCamp(tile.unit.camp) ? 1 : 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (neighbor?.unit && isEnemyCamp(neighbor.unit.camp)) count++;
        }
        return count;
    }

    function countFlankSetups(tile, movingUnitId) {
                let setups = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const enemyTile = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (!enemyTile?.unit || !isEnemyCamp(enemyTile.unit.camp)) continue;
            const opposite = tileMap.get(`${enemyTile.q + dq},${enemyTile.r + dr}`);
            if (opposite?.unit && opposite.unit.camp === myCamp && opposite.unit.id !== movingUnitId) {
                setups++;
            }
        }
        return setups;
    }

    function estimateDestinationThreat(tile, movingUnit) {
        let threat = 0;
        for (const enemyTile of allThreatUnits) {
            const enemy = enemyTile.unit;
            if (!enemy?.tile) continue;
            const distance = hexDistance(tile, enemy.tile);
            const range = Math.max(1, Number(enemy.config?.range || 1));
            const speed = Math.max(0, Number(enemy.config?.speed || 0));
            const isNeutral = !isEnemyCamp(enemy.camp);
            // 中立里只有固定火力点值得绕：岸防炮 speed=0、射程 2、对舰 +30%，
            // 站在它射程里就是白挨打。会动的中立由防御型人格驱动，守着自己的
            // 区域不会全图追杀——把它们也算成威胁，等于把整张海图标成禁区，
            // 实测会让舰队一整局不敢出港。
            if (isNeutral && speed > 0) continue;
            const damage = estimateDamage(enemy, movingUnit, tile);
            if (distance <= range) threat += damage;
            else if (distance <= range + speed) threat += damage * 0.35;
        }
        return threat;
    }

    function getRoleTargetBonus(tile, movingUnit) {
        let bonus = 0;
        for (const enemyTile of allEnemyUnits) {
            if (!enemyTile.unit) continue;
            const distance = hexDistance(tile, enemyTile);
            const target = enemyTile.unit;
            if (distance <= Math.max(1, Number(movingUnit.config?.range || 1))) {
                bonus += scoreTacticalRoleMatchup(movingUnit, target);
            }
        }
        return bonus;
    }

    // 战斗估算统一走条令层，保证三档对同一次交换算出同一个数字。
    // 差别在于用不用得上：Imperator 会把它同时喂给集火账本、净交换否决与走位威胁。
    const { estimateDamage, estimateCounterDamage, wouldDieToCounter } =
        createCombatModel({ weather, hexDistance });

    // 集火账本：记录本回合已排入攻击的预估伤害，让后续单位能"补刀"锁定击杀。
    // 这是最高档独有的——另外两档各打各的，不会为了凑一次击杀而分配输出。
    const plannedDmg = new Map();
    function effectiveHp(defender) {
        return defender.hp + (defender._shield || 0) - (plannedDmg.get(defender.id) || 0);
    }
    function recordPlannedAttack(attacker, defender) {
        plannedDmg.set(defender.id, (plannedDmg.get(defender.id) || 0) + estimateDamage(attacker, defender));
    }

    function willKill(attacker, defender) {
        return estimateDamage(attacker, defender) >= effectiveHp(defender);
    }

    function counterAdvantage(myType, enemyType) {
        return counterCoefficient(myType, enemyType);
    }

    function evaluateCityDefense(cityTile, ownerCamp) {
        let defenseScore = 0;
        for (const tile of gameState.tiles) {
            if (!tile.unit || tile.unit.camp !== ownerCamp) continue;
            const dist = hexDistance(cityTile, tile);
            if (dist > 4) continue;
            const weight = dist === 0 ? 1.5 : dist <= 1 ? 1.0 : dist <= 2 ? 0.6 : 0.3;
            const typeMult = tile.unit.type === 'infantry' ? 1.3 : tile.unit.type === 'archer' ? 0.9 : 1.0;
            defenseScore += tile.unit.hp * weight * typeMult;
        }
        return defenseScore;
    }

    function avgDistanceFromMyForces(targetTile) {
        let total = 0, count = 0;
        for (const unit of allUnits) {
            total += hexDistance(unit.tile, targetTile);
            count++;
        }
        return count > 0 ? total / count : 99;
    }

    // 检查某格是否在己方占星者3格星光力场内
    function isInAstrologerShield(tile) {
        if (!tile || !tileMap) return false;
        const dirs = [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
        const rings = [[[0,0]], dirs];
        // 2格范围
        const range2 = [];
        for (const [q1, r1] of dirs) {
            for (const [q2, r2] of dirs) {
                range2.push([q1+q2, r1+r2]);
            }
        }
        rings.push(range2);
        // 3格范围
        const range3 = [];
        for (const [q1, r1] of dirs) {
            for (const [q2, r2] of dirs) {
                for (const [q3, r3] of dirs) {
                    const q = q1+q2+q3, r = r1+r2+r3;
                    const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(q+r));
                    if (dist === 3) range3.push([q, r]);
                }
            }
        }
        rings.push(range3);

        for (let d = 0; d <= 3; d++) {
            for (const [dq, dr] of rings[d]) {
                const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                if (nb && nb.unit && nb.unit.commander === 'astrologer' &&
                    nb.unit.camp === myCamp && nb.unit.hp > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    // 将领从运行中单位解析，不再从固定玩家席位推断。
    const myCommanderUnits = gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit?.camp === myCamp && unit.commander && unit.hp > 0);
    const myCommanderUnit = myCommanderUnits[0] || null;
    const myCmdKey = myCommanderUnit?.commander || null;
    const myCmdKeys = new Set(myCommanderUnits.map(unit => unit.commander));
    const cmdStrat = myCommanderUnits.reduce((combined, unit) => {
        const strategy = COMMANDER_STRATEGY[unit.commander] || {};
        for (const [key, value] of Object.entries(strategy)) {
            if (typeof value === 'number') combined[key] = Math.max(combined[key] || 0, value);
            else if (typeof value === 'boolean') combined[key] = combined[key] || value;
            else if (Array.isArray(value) && !combined[key]) combined[key] = value;
        }
        return combined;
    }, {});

    // ═══════════════════════════════════════════
    // 收集战局数据
    // ═══════════════════════════════════════════

    const allLivingUnits = gameState.tiles
        .filter(t => t.unit && t.unit.camp === myCamp && t.unit.hp > 0)
        .map(t => t.unit);
    const allUnits = gameState.tiles
        .filter(t => t.unit && t.unit.camp === myCamp && t.unit.canAct && !t.unit.isNewRecruit)
        .map(t => t.unit);

    // 初始排序：先按兵种（炮>骑>步），primaryObjective 确定后再按距离重排
    const units = [...allUnits].sort((a, b) => {
        const order = { archer: 0, cavalry: 1, infantry: 2 };
        return order[a.type] - order[b.type];
    });

    const myCities = gameState.tiles.filter(t => t.isCity && t.camp === myCamp);
    // 公平信息：迷雾下只读取已探索城市和当前可见单位。困难档不再偷看全图。
    const enemyCities = gameState.tiles.filter(t =>
        t.isCity && isEnemyCamp(t.camp) && tileExplored(t));
    const neutralCities = gameState.tiles.filter(t =>
        t.isCity && t.camp === CAMP.neutral && tileExplored(t));
    const allEnemyUnits = gameState.tiles.filter(t =>
        t.unit && isEnemyCamp(t.unit.camp) && tileVisible(t));
    // 中立部队照样开火，岸防炮更是射程 2、对舰 +30% 的固定火力点。
    // 只按「敌对玩家阵营」评估威胁，等于闭着眼从中立炮台面前开过去——
    // 三档回归里 Imperator 一局 20 个损失有 14 个就是这么送掉的。
    const allThreatUnits = gameState.tiles.filter(t =>
        t.unit && t.unit.camp !== myCamp && tileVisible(t));
    const campKey = myCamp.id;
    if (!gameState._imperatorMovementMemory) gameState._imperatorMovementMemory = {};
    if (!gameState._imperatorMovementMemory[campKey]) gameState._imperatorMovementMemory[campKey] = {};
    const movementMemory = gameState._imperatorMovementMemory[campKey];
    const backtrackPenalty = (unit, tile) =>
        isImmediateBacktrack(movementMemory[unit.id], tile, currentRound) ? 90 : 0;
    const rememberPlannedMove = unit => {
        movementMemory[unit.id] = {
            q: unit.tile.q,
            r: unit.tile.r,
            round: currentRound
        };
    };
    let gold = gameState.playerGold[campKey];

    const ownsNeutralCity = myCities.some(c => neutralDistricts.has(c.districtId));
    const oceanMap = standardMap?.familyId === 'uncharted-passage';
    const capitalTile = myCities.find(city => myHomeDistricts.has(city.districtId)) || myCities[0] || null;
    const ownPorts = gameState.tiles.filter(tile => tile.isPort && tile.camp === myCamp);

    function strategicThreatAt(asset) {
        if (!asset) return 0;
        let threat = 0;
        for (const enemyTile of allEnemyUnits) {
            const enemy = enemyTile.unit;
            const reach = Math.max(1, Number(enemy.config?.range || 1))
                + Math.max(0, Number(enemy.config?.speed || 0));
            const distance = hexDistance(enemyTile, asset);
            if (distance > reach + 3) continue;
            threat = Math.max(threat, (reach + 3 - distance) / Math.max(1, reach + 3));
        }
        return Math.max(0, Math.min(1, threat));
    }

    const capitalThreat = strategicThreatAt(capitalTile);
    const mostThreatenedPort = ownPorts.length > 0
        ? [...ownPorts].sort((left, right) => strategicThreatAt(right) - strategicThreatAt(left))[0]
        : null;
    const portThreat = strategicThreatAt(mostThreatenedPort);
    const ownEconomy = estimateCampEconomy(gameState.tiles, myCamp);
    const visibleRivalEconomies = enemyCamps.map(camp => {
        const visibleTiles = gameState.skirmishFog
            ? gameState.tiles.filter(tile => tile.camp === camp && tileExplored(tile))
            : gameState.tiles;
        return { camp, ...estimateCampEconomy(visibleTiles, camp) };
    });
    const strongestObservedRivalEconomy = [...visibleRivalEconomies]
        .sort((left, right) => right.projectedIncome - left.projectedIncome
            || right.cityCount - left.cityCount)[0]
        || { cityCount: 0, projectedIncome: 0, portCount: 0 };
    const visibleRivalUnits = allEnemyUnits.map(tile => tile.unit);
    const ownForceValue = estimateForceValue(allLivingUnits);
    gameState._imperatorIntelMemory ||= {};
    const intelMemory = (gameState._imperatorIntelMemory[campKey] ||= {});
    const rivalIntel = enemyCamps.map(camp => {
        const observedUnits = allEnemyUnits
            .filter(tile => tile.unit.camp === camp)
            .map(tile => tile.unit);
        const observedForceValue = estimateForceValue(observedUnits);
        const previous = intelMemory[camp.id];
        const elapsedIntelRounds = previous
            ? Math.max(0, currentRound - Number(previous.round || currentRound))
            : 1;
        const forceEstimate = estimateFogRivalForce({
            fogEnabled: gameState.skirmishFog,
            ownForceValue,
            observedForceValue,
            previousEstimate: previous?.forceEstimate,
            elapsedRounds: elapsedIntelRounds
        });
        const observedEconomy = visibleRivalEconomies.find(entry => entry.camp === camp)
            || { cityCount: 0, projectedIncome: 0, portCount: 0 };
        // 初次接触前按对称开局估计；之后保留并缓慢衰减旧经济情报。已探明资产
        // 永远可以把估计向上修正，但“暂时没看见”不能把对手经济瞬间归零。
        const priorIncome = Number(previous?.projectedIncome);
        const incomeEstimate = gameState.skirmishFog
            ? Math.max(
                observedEconomy.projectedIncome,
                Number.isFinite(priorIncome)
                    ? priorIncome * (0.94 ** elapsedIntelRounds)
                    : ownEconomy.projectedIncome * 0.80
            )
            : observedEconomy.projectedIncome;
        const priorCities = Number(previous?.cityCount);
        const cityEstimate = gameState.skirmishFog
            ? Math.max(
                observedEconomy.cityCount,
                Number.isFinite(priorCities)
                    ? priorCities * (0.94 ** elapsedIntelRounds)
                    : Math.min(1, ownEconomy.cityCount)
            )
            : observedEconomy.cityCount;
        const next = {
            forceEstimate,
            observedForceValue,
            projectedIncome: incomeEstimate,
            cityCount: cityEstimate,
            observedUnitCount: observedUnits.length,
            round: currentRound
        };
        intelMemory[camp.id] = next;
        return { camp, ...next };
    });
    const strongestRivalIntel = [...rivalIntel]
        .sort((left, right) => right.forceEstimate - left.forceEstimate
            || right.projectedIncome - left.projectedIncome)[0]
        || { forceEstimate: 1, observedForceValue: 0, projectedIncome: 0, cityCount: 0 };
    const strategicPosture = assessStrategicPosture({
        ownForceValue,
        rivalForceValue: strongestRivalIntel.forceEstimate,
        ownUnitCount: allLivingUnits.length,
        ownCityCount: ownEconomy.cityCount,
        rivalCityCount: strongestRivalIntel.cityCount,
        ownProjectedIncome: ownEconomy.projectedIncome,
        rivalProjectedIncome: strongestRivalIntel.projectedIncome,
        ownPortCount: ownEconomy.portCount,
        capitalThreat,
        portThreat,
        roundsRemaining,
        hasExpansionTargets: enemyCities.length + neutralCities.length > 0,
        strategicPictureComplete: !gameState.skirmishFog
    });
    const defensiveAnchor = strategicPosture.posture === 'recover'
        ? capitalTile
        : strategicPosture.posture === 'defend'
            ? ((portThreat > capitalThreat && ownPorts.length <= 1) ? mostThreatenedPort : capitalTile)
            : null;

    const enemyStrategicPower = new Map(enemyCamps.map(camp => {
        const visibleForce = allEnemyUnits
            .filter(tile => tile.unit.camp === camp)
            .reduce((sum, tile) => sum + tile.unit.hp
                + (tile.unit.getEffectiveAttack?.() ?? tile.unit.config?.attack ?? 0) * 2, 0);
        const knownCities = enemyCities.filter(tile => tile.camp === camp).length;
        return [camp.id, visibleForce + knownCities * 500];
    }));
    const strongestEnemyPower = Math.max(1, ...enemyStrategicPower.values());
    const strategicUrgency = city => {
        if (!city?.camp) return 0;
        return (enemyStrategicPower.get(city.camp.id) || 0) / strongestEnemyPower;
    };

    // 占星者天气控制：如果己方有占星者且天气不利，主动放星移
    // （冷却在单位身上：unit.activeSkillCD / activeSkillDur，不存在 gameState.activeSkillP*CD 字段）
    const astrologerUnit = allUnits.find(u => u.commander === 'astrologer' && u.canAct);
    const canForceWeather = astrologerUnit
        && (astrologerUnit.activeSkillCD || 0) <= 0
        && (astrologerUnit.activeSkillDur || 0) <= 0;

    // ═══════════════════════════════════════════
    // 战略阶段判定 + 选定主攻目标
    // ═══════════════════════════════════════════

    // 目标池是“全部非己方城市”，不再按“先中立后敌方”二元切换。
    // 旧版一旦夺下第一座中立城就永久切进敌方阶段，棋盘上剩下的中立城再也不会
    // 被看一眼——而回合限制判的正是城市数量，强攻隔着深海的敌方主城，远不如
    // 再拿一座守备薄弱的中立城划算。无主航路两局的死局就是这么来的。
    const objectivePhase = strategicPosture.posture;
    const objectiveMemory = gameState._imperatorStrategicObjectives?.[campKey];
    const memoryStalled = Number(objectiveMemory?.stalledRounds || 0) >= 2;
    const postureBreaksCommitment = shouldBreakObjectiveCommitment({
        previousPosture: objectiveMemory?.phase || objectivePhase,
        nextPosture: objectivePhase,
        capitalThreat,
        objectiveValid: !memoryStalled,
        stalledRounds: objectiveMemory?.stalledRounds || 0
    });
    const committedCoords = postureBreaksCommitment ? null : readStrategicObjectiveCommitment(
        objectiveMemory, objectivePhase, currentRound);
    const committedTile = committedCoords
        ? tileMap.get(`${committedCoords.q},${committedCoords.r}`)
        : null;
    const defensivePhase = objectivePhase === 'defend' || objectivePhase === 'recover';
    const committedObjectiveValid = Boolean(committedTile)
        && (defensivePhase
            ? committedTile.camp === myCamp
            : committedTile.isCity && committedTile.camp !== myCamp && tileExplored(committedTile));
    let primaryObjective = defensiveAnchor || (committedObjectiveValid ? committedTile : null);
    // 夺城只能靠近战，所以“多远”按最近的近战单位算，而不是全军平均距离——
    // 舰队再近，够不着的城也拿不下。
    const nearestAssaultDistance = cityTile => {
        let best = Infinity;
        for (const unit of allUnits) {
            if (!canCaptureCityByCombat(unit)) continue;
            best = Math.min(best, hexDistance(unit.tile, cityTile));
        }
        return Number.isFinite(best) ? best : avgDistanceFromMyForces(cityTile) + 6;
    };

    // 无主航路的中央城带 neutralForcesTransfer：夺下它，全部中立部队转投。
    // 这是全图唯一能一次性改变兵力对比的目标，值得压过距离成本。
    const captureRewardCity = standardMap?.captureReward?.type === 'neutralForcesTransfer'
        ? { q: standardMap.captureReward.cityQ, r: standardMap.captureReward.cityR }
        : null;
    const isCaptureRewardCity = city => !!captureRewardCity
        && city.q === captureRewardCity.q && city.r === captureRewardCity.r;

    // 标准地图上的城市坐标是选图时就公开的静态信息，迷雾遮蔽的是归属与守军，
    // 不是“这里有没有城”。旧版把未探索的城完全排除在目标池外，遭遇战里 AI
    // 于是整局在自家门口来回踩点——G5 连续三轮 0 击杀的死局正源于此。
    const objectiveCities = new Map();
    for (const city of [...neutralCities, ...enemyCities]) {
        if (city.camp === myCamp) continue;
        objectiveCities.set(`${city.q},${city.r}`, city);
    }
    for (const site of standardMap?.board?.cities || []) {
        const key = `${site.q},${site.r}`;
        if (objectiveCities.has(key)) continue;
        const tile = tileMap.get(key);
        if (!tile?.isCity || tile.camp === myCamp) continue;
        objectiveCities.set(key, tile);
    }
    const transferableNeutralForceValue = estimateForceValue(gameState.tiles
        .filter(tile => tile.unit?.camp === CAMP.neutral && tileExplored(tile))
        .map(tile => tile.unit));
    const strategicKnownTiles = gameState.tiles.map(tile => tileExplored(tile)
        ? tile : { ...tile, installation: null });
    const objectiveAssetValues = new Map();
    for (const city of objectiveCities.values()) {
        objectiveAssetValues.set(`${city.q},${city.r}`, estimateDistrictAssetValue(city, strategicKnownTiles, {
            currentCityCount: ownEconomy.cityCount,
            roundsRemaining,
            oceanMap,
            enemyOwned: tileExplored(city) && isEnemyCamp(city.camp),
            captureReward: standardMap?.captureReward,
            transferableNeutralForceValue
        }));
    }

    // ═══════════════════════════════════════════
    // 战略情报层：敌人在看哪、注意力在哪、哪座城最便宜
    // ═══════════════════════════════════════════
    // 这一层是最高档独有的。真人高手赢棋靠的不是每一刀砍得更准，而是判断
    // 「这一步的投入产出比」：对方主力压在东线，就用少量部队把他黏在东线，
    // 主力绕开他的视野去摘西线那座没人守的城。中档看不到这一层，于是会被
    // 拖进正面消耗，把城让给坐收渔利的一方。

    /**
     * 敌方视野覆盖。只用「我方已经看见的敌方棋子 + 已探明的敌方城市」推算，
     * 不读取迷雾下的隐藏单位——这与玩家自己心算对手视野是同一份信息权限。
     * 非迷雾局里所有格子都互相可见，这张图恒为空，隐蔽绕行自然失效。
     */
    const enemyVisionCoverage = new Set();
    if (gameState.skirmishFog) {
        const markVision = (originTile, radius) => {
            for (const tile of gameState.tiles) {
                if (hexDistance(originTile, tile) <= radius) {
                    enemyVisionCoverage.add(`${tile.q},${tile.r}`);
                }
            }
        };
        for (const enemyTile of allEnemyUnits) {
            markVision(enemyTile, estimateUnitVisionRadius(enemyTile.unit, weather));
        }
        for (const city of enemyCities) markVision(city, CITY_VISION_RANGE);
    }
    const isUnderEnemyObservation = tile => enemyVisionCoverage.has(`${tile.q},${tile.r}`);

    /**
     * 敌方注意力模型：每个敌方阵营的兵力重心，以及有多大比例已经被别人缠住。
     * `tiedDownRatio` 是「借刀杀人」的度量——对手正在跟第三方或中立交火时，
     * 他的城市对我们来说就是打折商品。
     */
    const attentionByCamp = new Map();
    for (const camp of enemyCamps) {
        const campTiles = allEnemyUnits.filter(tile => tile.unit.camp === camp);
        if (campTiles.length === 0) continue;
        let mass = 0;
        let sumQ = 0;
        let sumR = 0;
        let tiedDown = 0;
        for (const tile of campTiles) {
            const weight = Math.max(1, tile.unit.hp);
            mass += weight;
            sumQ += tile.q * weight;
            sumR += tile.r * weight;
            // 与「既不是我、也不是他自己」的单位相邻 = 正在别处开战
            const busy = HEX_NEIGHBORS.some(([dq, dr]) => {
                const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`)?.unit;
                return neighbor && neighbor.camp !== camp && neighbor.camp !== myCamp;
            });
            if (busy) tiedDown++;
        }
        attentionByCamp.set(camp.id, {
            centroid: { q: Math.round(sumQ / mass), r: Math.round(sumR / mass) },
            mass,
            count: campTiles.length,
            tiedDownRatio: tiedDown / campTiles.length
        });
    }

    /**
     * 城市的「便宜程度」：守军越弱、越远离其主人的兵力重心、其主人越被别人缠住，
     * 这座城就越值得偷。返回的是折扣分（越大越便宜），直接并进目标评分。
     */
    /**
     * 补刀垂死对手。只剩最后一座城的敌人，那座城是全图最高性价比的目标：
     * 拿下它既让我方城市数 +1，又直接淘汰一个竞争者，还断掉他后续的招募。
     * 回归里 Imperator 攥着 26 个单位，对面只剩 1 城 1 兵，居然打成平局——
     * 就是因为评分里完全没有「终结」这个概念。
     */
    const cityCountByCamp = new Map();
    for (const tile of gameState.tiles) {
        if (!tile.isCity || !tile.camp || tile.camp === CAMP.neutral) continue;
        cityCountByCamp.set(tile.camp.id, (cityCountByCamp.get(tile.camp.id) || 0) + 1);
    }
    function finishingBlowDiscount(city) {
        if (!isEnemyCamp(city.camp)) return 0;
        if ((cityCountByCamp.get(city.camp.id) || 0) > 1) return 0;
        // 够不着的终结机会不是机会：不加闸门时全军会横跨半张图去追一座主城，
        // 沿途的软柿子全放掉，赢局因此变成平局（实测胜 6→4、平 2→5）。
        if (nearestAssaultDistance(city) > 7) return 0;
        const survivors = allEnemyUnits.filter(tile => tile.unit.camp === city.camp).length;
        return survivors <= 3 ? 70 : 45;
    }

    /**
     * 动态制衡：三方局里若有一方短期内明显失控（城市数领先且还在快速扩张），
     * 暂时压下与弱者的内斗，把矛头转向领先者，等均势恢复再回到常规扩张。
     *
     * 权重刻意压得比夺城收益低一档。一味压制领先者是替第三方做嫁衣——
     * 那正是我们要利用对手犯的错误，自己不能犯。这里只做到「同等条件下
     * 优先啃领先者、暂时不去碰垫底的那家」，不会为了压制而放弃唾手可得的城。
     */
    const SUPPRESSION_PULL = 25;
    const runawayLeader = (() => {
        if (enemyCamps.length === 1) {
            const [rival] = rivalIntel;
            const isAhead = (rival?.cityCount || 0) > myCityCount
                || (rival?.projectedIncome || 0) >= ownEconomy.projectedIncome + 2;
            return strategicPosture.posture === 'contest' && isAhead ? enemyCamps[0] : null;
        }
        if (enemyCamps.length < 2) return null;
        gameState._imperatorPowerHistory ||= {};
        const history = (gameState._imperatorPowerHistory[campKey] ||= []);
        if (!history.length || history[history.length - 1].round !== currentRound) {
            history.push({
                round: currentRound,
                cities: Object.fromEntries(cityCountByCamp)
            });
        }
        while (history.length > 6) history.shift();
        const past = history.find(entry => currentRound - entry.round >= 3) || history[0];
        const momentumOf = id => (cityCountByCamp.get(id) || 0) - (past?.cities?.[id] || 0);

        const ranked = enemyCamps
            .map(camp => ({
                camp,
                cities: cityCountByCamp.get(camp.id) || 0,
                momentum: momentumOf(camp.id)
            }))
            .sort((left, right) => right.cities - left.cities);
        const [top, second] = ranked;
        if (!top || !second) return null;
        if (top.cities <= myCityCount) return null;      // 他没比我强，轮不到压制

        // 迟滞：进入压制的门槛高于退出门槛，避免均势线上每回合反复改主意。
        const previouslySuppressing = gameState._imperatorSuppressTarget?.[campKey] === top.camp.id;
        const lead = top.cities - Math.max(second.cities, myCityCount);
        const engaged = previouslySuppressing
            ? lead >= 1
            : (lead >= 2 || (lead >= 1 && top.momentum >= 2));

        gameState._imperatorSuppressTarget ||= {};
        gameState._imperatorSuppressTarget[campKey] = engaged ? top.camp.id : null;
        // 触发计数供自对局复盘核对：机制没跑起来和跑起来没用，是两回事。
        gameState._imperatorSuppressRounds ||= {};
        if (engaged) {
            gameState._imperatorSuppressRounds[campKey] =
                (gameState._imperatorSuppressRounds[campKey] || 0) + 1;
        }
        return engaged ? top.camp : null;
    })();

    /**
     * 制衡修正：**抢在失控者前面占下他要扩张的那座城**，而不是去围攻他的本土。
     *
     * 强攻领先者的老巢是最贵的压制方式：两个追赶者都在他的城墙下消耗，
     * 他反而坐稳。实测按「打他的城」实现时，平均城数差距从 2.67 涨到 3.00，
     * 领先者赢得更大。真人的做法是卡住他的下一步扩张——同一座中立城，
     * 我先拿到就等于他少一座，成本只有行军，没有攻坚。
     */
    function balanceOfPowerAdjust(city) {
        if (!runawayLeader) return 0;
        if (enemyCamps.length === 1) {
            if (city.camp === runawayLeader) return -35;
            const rivalDistance = Math.min(Infinity, ...allEnemyUnits
                .filter(tile => tile.unit.camp === runawayLeader)
                .map(tile => hexDistance(tile, city)));
            return Number.isFinite(rivalDistance) && rivalDistance <= nearestAssaultDistance(city) + 2
                ? -28 : 0;
        }
        // 他自己的城：不主动去啃，那是替第三方做嫁衣。
        if (city.camp === runawayLeader) return SUPPRESSION_PULL * 0.5;
        // 无主/第三方的城，且他比我更近 → 这是他的下一块扩张地，优先截胡。
        if (!isEnemyCamp(city.camp) || city.camp !== runawayLeader) {
            const leaderDistance = Math.min(Infinity, ...allEnemyUnits
                .filter(tile => tile.unit.camp === runawayLeader)
                .map(tile => hexDistance(tile, city)));
            const myDistance = nearestAssaultDistance(city);
            if (Number.isFinite(leaderDistance) && leaderDistance <= myDistance + 2) {
                return -SUPPRESSION_PULL;
            }
        }
        return 0;
    }

    function raidDiscountFor(city) {
        const attention = attentionByCamp.get(city.camp?.id);
        if (!attention) return 0;
        // 守军主力离这座城越远，越是薄弱点
        const attentionDistance = hexDistance(city, attention.centroid);
        let discount = Math.min(40, attentionDistance * 4);
        // 对手正在跟第三方交火：我们不必自己出牵制兵力
        discount += attention.tiedDownRatio * 35;
        // 迷雾下这座城如果不在对方视野里，我们能悄悄摸过去
        if (gameState.skirmishFog && !isUnderEnemyObservation(city)) discount += 18;
        return discount;
    }

    if (!primaryObjective) {
        const candidates = [];
        for (const city of objectiveCities.values()) {
            if (city.camp === myCamp) continue;
            const owner = city.camp;
            // 未探索城市的守军是未知信息，按中性估值处理，不偷看迷雾。
            const defense = tileExplored(city)
                ? evaluateCityDefense(city, owner)
                : 300;
            const assaultDist = nearestAssaultDistance(city);
            // 归属同样是迷雾信息：未探索的城只按“地图上有一座城”估值，
            // 不读取它此刻真实的阵营，AI 与玩家共用同一份情报权限。
            const known = tileExplored(city);
            const isEnemyCapital = known && isEnemyCamp(owner)
                && enemyCapitalDistricts.has(city.districtId);
            let score = assaultDist * 1.6
                + avgDistanceFromMyForces(city) * 0.4
                + defense * 0.012
                - (known ? strategicUrgency(city) * 30 : 0)
                + jitterScore(8);
            const assetValue = objectiveAssetValues.get(`${city.q},${city.r}`)?.total || 0;
            // 把城市当作“行政区资产包”估值：未来收入、村庄、港口、机场和投诚兵力
            // 都会改变整局资源曲线。距离仍是成本，但不再是唯一标准。
            score -= assetValue * (objectivePhase === 'contest' ? 0.26 : 0.20);
            // 中立城不会像敌方主城那样越打越硬，且拿下即刻计入城市数。
            if (known && owner === CAMP.neutral) score -= 20;
            // 敌方主城守备最厚、路径最长，非终局阶段不作为首选——
            // 但那是对方还有退路时的判断，若它已是对方最后一座城，就该直取。
            const killShot = finishingBlowDiscount(city);
            if (isEnemyCapital && killShot === 0) score += terminalPhase ? -26 : 34;
            score -= killShot;
            // 已被敌方夺走的中立区块要抢回来，否则等于白让一座城。
            if (known && isEnemyCamp(owner) && neutralDistricts.has(city.districtId)) score -= 16;
            // 出生区之外的城市在开局静态布局里就是中立的，未探索也照样值得去。
            if (!known && neutralDistricts.has(city.districtId)) score -= 20;
            if (isCaptureRewardCity(city)) score -= 18;
            if (terminalPhase) score -= 18;
            // 投入产出比：薄弱点、被第三方缠住的对手、视野盲区，都让这座城更便宜。
            if (known) score -= raidDiscountFor(city);
            // 动态制衡：有人失控时优先啃他，暂时放过垫底的那家。
            if (known) score += balanceOfPowerAdjust(city);
            candidates.push({ city, score });
        }
        // 终局且未领先：这时唯一重要的事情是再拿下一座城，越近越软越好。
        // 价值高低、谁是主城、谁最强，都让位给「剩下的回合够不够走到」。
        if (terminalPhase && trailingOnCities) {
            for (const candidate of candidates) {
                const reach = nearestAssaultDistance(candidate.city);
                const garrison = tileExplored(candidate.city)
                    ? evaluateCityDefense(candidate.city, candidate.city.camp)
                    : 300;
                candidate.score = reach * 6 + garrison * 0.02
                    + (reach > roundsRemaining * 2 ? 500 : 0);
            }
        }
        primaryObjective = chooseFromRanked(candidates, candidate => candidate.score)?.city || null;
    }

    if (!primaryObjective && gameState.skirmishFog) {
        // 侦察要指向大片未知区域，而不是脚边那一格：按“最近的未探索格”选目标
        // 会让部队走一格、探开一格、再选下一格，整局在出生地打转。
        const unexplored = gameState.tiles.filter(tile =>
            tile.playable !== false && !tileExplored(tile));
        const frontierValue = tile => {
            let unknownNeighbors = 0;
            for (const [dq, dr] of HEX_NEIGHBORS) {
                const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                if (neighbor && !tileExplored(neighbor)) unknownNeighbors++;
            }
            return avgDistanceFromMyForces(tile) * 0.6 - unknownNeighbors * 4 + jitterScore(5);
        };
        primaryObjective = chooseFromRanked(unexplored, frontierValue);
    }

    if (primaryObjective) {
        if (!gameState._imperatorStrategicObjectives) gameState._imperatorStrategicObjectives = {};
        const previousSameObjective = objectiveMemory
            && objectiveMemory.q === primaryObjective.q && objectiveMemory.r === primaryObjective.r;
        const observedDistance = defensivePhase
            ? Math.min(Infinity, ...allEnemyUnits.map(tile => hexDistance(tile, primaryObjective)))
            : nearestAssaultDistance(primaryObjective);
        const observedHp = Number(primaryObjective.hp || 0);
        let stalledRounds = previousSameObjective ? Number(objectiveMemory.stalledRounds || 0) : 0;
        if (previousSameObjective && Number(objectiveMemory.lastObservedRound) < currentRound) {
            const distanceImproved = observedDistance < Number(objectiveMemory.observedDistance ?? Infinity);
            const hpImproved = observedHp < Number(objectiveMemory.observedHp ?? Infinity);
            stalledRounds = distanceImproved || hpImproved
                ? 0 : Number(objectiveMemory.stalledRounds || 0) + 1;
        }
        gameState._imperatorStrategicObjectives[campKey] = {
            phase: objectivePhase,
            q: primaryObjective.q,
            r: primaryObjective.r,
            // 正常承诺保持三回合，但危机转态或连续两回合无进展会立即改令。
            expiresRound: currentRound + 2,
            lastObservedRound: currentRound,
            observedDistance,
            observedHp,
            stalledRounds
        };
    } else if (!primaryObjective && gameState._imperatorStrategicObjectives?.[campKey]) {
        delete gameState._imperatorStrategicObjectives[campKey];
    }

    gameState._imperatorStrategicTelemetry ||= {};
    const telemetry = (gameState._imperatorStrategicTelemetry[campKey] ||= []);
    if (telemetry.at(-1)?.round !== currentRound) {
        telemetry.push({
            round: currentRound,
            posture: objectivePhase,
            urgency: strategicPosture.urgency,
            objective: primaryObjective ? { q: primaryObjective.q, r: primaryObjective.r } : null,
            objectiveAssetValue: primaryObjective
                ? objectiveAssetValues.get(`${primaryObjective.q},${primaryObjective.r}`)?.total || 0
                : 0,
            projectedIncome: ownEconomy.projectedIncome,
            rivalProjectedIncome: strongestRivalIntel.projectedIncome,
            observedRivalForce: strongestRivalIntel.observedForceValue,
            estimatedRivalForce: strongestRivalIntel.forceEstimate,
            forceRatio: strategicPosture.forceRatio,
            capitalThreat,
            portThreat
        });
        while (telemetry.length > 40) telemetry.shift();
    }

    // 确定主攻目标后，按离目标由近到远重新排序全军
    if (primaryObjective) {
        const typeOrder = { archer: 0, cavalry: 1, infantry: 2 };
        units.sort((a, b) => {
            const da = hexDistance(a.tile, primaryObjective);
            const db = hexDistance(b.tile, primaryObjective);
            if (da !== db) return da - db;
            return typeOrder[a.type] - typeOrder[b.type];
        });
    }

    /**
     * 联合特遣队：扩张有余力时才开第二战线，每条支线至少包含一名占城手和
     * 一名火力/海军掩护。旧版让每个近战各追一座最近城市，结果突击兵与舰队
     * 被系统性拆散；海图上看似“四路并进”，实际是四路逐个送死。
     */
    const detachmentObjectives = new Map();
    {
        const maySplit = !defensivePhase && allLivingUnits.length >= 7
            && estimateForceValue(allLivingUnits) >= estimateForceValue(visibleRivalUnits) * 0.85;
        if (maySplit) {
            const secondaryCities = [...objectiveCities.values()]
                .filter(city => city !== primaryObjective)
                .map(city => ({
                    city,
                    value: (objectiveAssetValues.get(`${city.q},${city.r}`)?.total || 0)
                        - nearestAssaultDistance(city) * 12
                        - evaluateCityDefense(city, city.camp) * 0.03
                }))
                .sort((left, right) => right.value - left.value)
                .slice(0, Math.min(2, Math.floor(allLivingUnits.length / 7)));
            const assigned = new Set();
            for (const { city } of secondaryCities) {
                const assault = allUnits
                    .filter(unit => canCaptureCityByCombat(unit) && !assigned.has(unit.id))
                    .sort((left, right) =>
                        hexDistance(left.tile, city) - hexDistance(right.tile, city))[0];
                if (!assault) continue;
                detachmentObjectives.set(assault.id, city);
                assigned.add(assault.id);

                const escorts = allUnits
                    .filter(unit => !canCaptureCityByCombat(unit) && !assigned.has(unit.id))
                    .sort((left, right) => {
                        const leftRally = hexDistance(left.tile, assault.tile) + hexDistance(left.tile, city) * 0.4;
                        const rightRally = hexDistance(right.tile, assault.tile) + hexDistance(right.tile, city) * 0.4;
                        return leftRally - rightRally;
                    })
                    .slice(0, oceanMap ? 2 : 1);
                for (const escort of escorts) {
                    detachmentObjectives.set(escort.id, city);
                    assigned.add(escort.id);
                }
            }
        }
    }
    /** 该单位本回合的行军目标：完整分队的支线目标优先，其余跟随主攻目标。 */
    const objectiveFor = unit => detachmentObjectives.get(unit.id) || primaryObjective;

    // ═══════════════════════════════════════════
    // 牵制 + 隐蔽突击的编组
    // ═══════════════════════════════════════════
    // 决定打不打这一手：需要有一个「对方主力压着的方向」和一个「他顾不上的城」。
    // 牵制分队只求黏住对方、不求战果，规模压到全军 1/4 且至多 3 个单位——
    // 投进去的越多，这手的投入产出比越差。
    const raidPlan = { pinAnchor: null, pinnerIds: new Set(), strikeCity: null };
    {
        // 找出最值得黏住的敌方集群：兵力最重的那一坨。
        let heaviest = null;
        for (const [campId, attention] of attentionByCamp) {
            if (attention.count < 3) continue;
            if (!heaviest || attention.mass > heaviest.attention.mass) {
                heaviest = { campId, attention };
            }
        }
        // 目标城要满足：不是那坨主力正守着的地方，且守备确实薄弱。
        if (!defensivePhase && heaviest && allUnits.length >= 6) {
            const anchor = heaviest.attention.centroid;
            let bestCity = null;
            let bestValue = -Infinity;
            for (const city of objectiveCities.values()) {
                if (!tileExplored(city)) continue;
                const awayFromMass = hexDistance(city, anchor);
                if (awayFromMass < 5) continue;
                const value = awayFromMass * 3
                    + raidDiscountFor(city)
                    - evaluateCityDefense(city, city.camp) * 0.02
                    - nearestAssaultDistance(city) * 1.2;
                if (value > bestValue) { bestValue = value; bestCity = city; }
            }
            if (bestCity && bestValue > 0) {
                raidPlan.strikeCity = bestCity;
                raidPlan.pinAnchor = anchor;
                // 牵制人选：已经贴在对方主力附近、且不是能占城的近战。
                // 把稀缺的占城手投进牵制是本末倒置——那正是中档会犯的错。
                const pinCandidates = allUnits
                    .filter(unit => !canCaptureCityByCombat(unit))
                    .filter(unit => hexDistance(unit.tile, anchor) <= 6)
                    .sort((left, right) =>
                        hexDistance(left.tile, anchor) - hexDistance(right.tile, anchor));
                const pinBudget = Math.min(3, Math.floor(allUnits.length / 4));
                for (const unit of pinCandidates.slice(0, pinBudget)) {
                    raidPlan.pinnerIds.add(unit.id);
                }
                // 突击集群：离目标城最近的几个近战改为直取薄弱点。
                const strikers = allUnits
                    .filter(unit => canCaptureCityByCombat(unit))
                    .sort((left, right) =>
                        hexDistance(left.tile, bestCity) - hexDistance(right.tile, bestCity))
                    .slice(0, 3);
                for (const unit of strikers) detachmentObjectives.set(unit.id, bestCity);
            }
        }
    }
    const isPinner = unit => raidPlan.pinnerIds.has(unit.id);
    const isStriker = unit => raidPlan.strikeCity
        && detachmentObjectives.get(unit.id) === raidPlan.strikeCity;

    /**
     * 中立部队什么时候该打：还没有前进基地时全打；有了之后只打挡在某个城市目标
     * 前面的、或已经贴到脸上的，避免把中立拉成第三条战线。
     * 这里必须按「所有城市目标」判定而不是只看主攻目标——否则分兵去拿第二座城的
     * 部队会走到城下，却因为守军是中立而拒绝开火。
     */
    function shouldEngageNeutralAt(tile) {
        if (!ownsNeutralCity) return true;
        if (tile.isCity && tile.camp !== myCamp) return true;
        for (const city of objectiveCities.values()) {
            if (hexDistance(tile, city) <= 2) return true;
        }
        return allUnits.some(unit => hexDistance(unit.tile, tile) <= 1);
    }
    /** 统一的交战目标判定：敌方阵营恒可打，中立按上面的规则。 */
    function isEngageableTarget(tile) {
        const occupant = tile?.unit;
        if (!occupant || occupant.camp === myCamp) return false;
        if (isEnemyCamp(occupant.camp)) return true;
        return shouldEngageNeutralAt(tile);
    }

    // ═══════════════════════════════════════════
    // 第零轮：对策卡 — 抽牌 + 使用
    // ═══════════════════════════════════════════

    const isDeployed = !!myCommanderUnit;
    const hand = gameState.playerHands[campKey] || [];
    let cardUses = gameState.playerUsesThisTurn[campKey] || 0;
    let drawsUsed = gameState.playerDrawsThisTurn[campKey] || 0;
    const drawCost = helpers.CARD_SYSTEM_CONFIG ? helpers.CARD_SYSTEM_CONFIG.drawCost : 4;
    const maxHandSize = helpers.CARD_SYSTEM_CONFIG ? helpers.CARD_SYSTEM_CONFIG.maxHandSize : 3;
    const colGold = helpers.COLONEL_CARD_GOLD || { diveStrafe: 4, carpetBomb: 5, airlift: 4 };
    const ownEagleActive = hasEagleSynergyActive(gameState, campKey);
    const ownEagleMeter = ownEagleActive ? getEagleSynergyMeter(gameState, campKey) : null;
    const visibleEnemyEagleCamps = new Set(enemyCamps
        .filter(camp => allEnemyUnits.filter(tile =>
            tile.unit.camp === camp && isEagleCommanderUnit(tile.unit)).length >= 2)
        .map(camp => camp.id));

    // 抽牌（v6: 纵横家多抽牌，其他少抽）
    if (!terminalPhase && cmdStrat.cardFocus) {
        // 纵横家：多抽，利用手牌上限+1
        if (gold >= drawCost && drawsUsed < 2 && hand.length < maxHandSize
            && (gameState.cardDrawPile.length > 0 || gameState.cardDiscardPile.length > 0)) {
            actions.push({ type: 'drawCard' });
            gold -= drawCost; drawsUsed++;
            if (gold >= drawCost && drawsUsed < 2 && hand.length < maxHandSize - 1
                && (gameState.cardDrawPile.length > 0 || gameState.cardDiscardPile.length > 0)) {
                actions.push({ type: 'drawCard' });
                gold -= drawCost; drawsUsed++;
            }
        }
    } else if (!terminalPhase) {
        // 通用：余钱≥8且手牌空时才抽1张。
        // 疫情期例外：疗愈可净化中毒，手上没有解药时值得多花 4 金去找，
        // 一条没掐断的传染链在三跳里能吃掉半支部队。
        const poisonedNow = gameState.tiles.some(tile =>
            tile.unit?.camp === myCamp && tile.unit.hp > 0 && tile.unit._poison);
        // 门槛要留出抽完还能招一个步兵的余量：压到 drawCost 时金币全被抽牌吃掉，
        // 五局占城从 13 掉到 8——解毒再重要也不能拿断兵去换。
        const lacksCure = poisonedNow && !hand.includes('heal');
        const drawGoldThreshold = lacksCure ? drawCost + UNIT_CONFIG.infantry.cost
            : true ? 8 : 12;
        const handRoom = lacksCure ? hand.length < maxHandSize : hand.length === 0;
        if (gold >= drawGoldThreshold && drawsUsed < 1 && handRoom
            && (gameState.cardDrawPile.length > 0 || gameState.cardDiscardPile.length > 0)) {
            actions.push({ type: 'drawCard' });
            gold -= drawCost; drawsUsed++;
        }
    }

    // 部署将领
    if (!isDeployed && hand.includes('commanderDeploy')) {
        if (myCmdKey) {
            let bestCarrier = null;
            let bestCarrierScore = -Infinity;
            const carrierPref = cmdStrat.carrierPref || ['cavalry', 'infantry', 'archer'];
            for (const unit of allUnits) {
                let score = unit.hp / unit.maxHp * 50;
                const typeIdx = carrierPref.indexOf(unit.type);
                if (typeIdx >= 0) score += (2 - typeIdx) * 20;
                const nearEnemies = allEnemyUnits.filter(e => hexDistance(unit.tile, e) <= 5).length;
                score += nearEnemies * 12;
                if (primaryObjective) {
                    score += Math.max(0, 60 - hexDistance(unit.tile, primaryObjective) * 5);
                }
                if ((cmdStrat.holdCity || cmdStrat.economyFirst) && unit.tile.isCity) score += 40;
                // 空军上校：优先部署在高攻单位上
                if (cmdStrat.airPower && unit.type === 'cavalry') score += 30;
                if (cmdStrat.airPower && unit.type === 'archer') score += 20;
                // 亡灵法师：部署在步兵上（活的久才能产魂）
                if (cmdStrat.soulPlay && unit.type === 'infantry') score += 30;
                if (unit.commander) score = -Infinity;
                if (score > bestCarrierScore) { bestCarrierScore = score; bestCarrier = unit; }
            }
            if (bestCarrier) {
                actions.push({ type: 'tacticalCard', cardId: 'commanderDeploy', targetId: bestCarrier.id });
                processed.add(bestCarrier.id); cardUses++;
            }
        }
    }

    // 遍历手牌使用（纵横家可用2张，其他1张）
    const maxCardUseThisTurn = cmdStrat.cardFocus ? 2 : 1;
    const basicCards = new Set(['heal', 'lightning']);

    for (const cardId of hand) {
        if (cardUses >= maxCardUseThisTurn) break;
        if (cardId === 'commanderDeploy') continue;
        
        if (cardId === 'lightning') {
            let bestTarget = null, bestScore = 0;
            const rainBonus = weather === 'rain' ? 1.5 : 1.0;
            for (const tile of gameState.tiles) {
                if (!tileVisible(tile)) continue;
                const target = tile.unit;
                if (!target || target.camp === myCamp) continue;
                if (target.camp === CAMP.neutral && ownsNeutralCity) continue;
                let score = 0;
                if (target.commander) score += 150 * rainBonus;
                if (target.hp <= 30) score += 120 * rainBonus;
                if (target.hp <= 60) score += 80 * rainBonus;
                if (primaryObjective && target.tile === primaryObjective) score += 150;
                if (target.tile.isCity && isEnemyCamp(target.camp)) score += 70;
                if (target.morale >= 3) score += 50;
                if (target.type === 'archer') score += 30;
                if (!ownsNeutralCity && target.camp === CAMP.neutral
                    && objectivePhase === 'expand') score += 100;
                if (defensivePhase && isEnemyCamp(target.camp)) score += 90;
                // 雨天闪电加成已计入
                if (score > bestScore) { bestScore = score; bestTarget = target; }
            }
            if (bestScore >= (weather === 'rain' ? 50 : 80)) {
                actions.push({ type: 'tacticalCard', cardId: 'lightning', targetId: bestTarget.id });
                cardUses++;
            }
        } else if (cardId === 'heal') {
            // 疗愈同时净化中毒。投毒每跳按最大生命 15% 结算并向相邻单位传染，
            // 早一回合拔掉源头，等于少掉整条传染链，所以中毒优先级高于单纯残血。
            const healable = allUnits
                .filter(u => u._poison || u.hp < u.maxHp * 0.4)
                .sort((a, b) => {
                    const score = unit => poisonPressure(unit)
                        + (unit.commander ? 120 : 0)
                        + (1 - unit.hp / unit.maxHp) * 100
                        + countAdjacentAllies(unit.tile, unit.id) * (unit._poison ? 45 : 0);
                    return score(b) - score(a);
                });
            if (healable.length > 0) {
                actions.push({ type: 'tacticalCard', cardId: 'heal', targetId: healable[0].id });
                cardUses++;
            }
        } else if (cardId === 'poison') {
            let best = null, bestScore = -Infinity;
            for (const tile of gameState.tiles) {
                if (!tileVisible(tile)) continue;
                const target = tile.unit;
                if (!target || target._poison || target.camp === myCamp) continue;
                const adjacentEnemies = HEX_NEIGHBORS.reduce((count, [dq, dr]) => {
                    const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`)?.unit;
                    return count + (neighbor && neighbor.camp !== myCamp ? 1 : 0);
                }, 0);
                const adjacentFriendlies = HEX_NEIGHBORS.reduce((count, [dq, dr]) => {
                    const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`)?.unit;
                    return count + (neighbor && neighbor.camp === myCamp ? 1 : 0);
                }, 0);
                const score = target.maxHp * 0.45 + adjacentEnemies * 45 - adjacentFriendlies * 65
                    + (target.commander ? 70 : 0);
                if (score > bestScore) { best = target; bestScore = score; }
            }
            if (best && bestScore > 45) {
                actions.push({ type: 'tacticalCard', cardId: 'poison', targetId: best.id });
                cardUses++;
            }
        } else if (cardId === 'imprison') {
            let bestTarget = null, bestScore = 0;
            for (const tile of gameState.tiles) {
                if (!tileVisible(tile)) continue;
                const target = tile.unit;
                if (!target || target.camp === myCamp) continue;
                let score = target.hp + target.config.attack * 2;
                if (target.commander) score += 80;
                if (primaryObjective && target.tile === primaryObjective) score += 100;
                if (target.morale >= 3) score += 40;
                if (score > bestScore) { bestScore = score; bestTarget = target; }
            }
            if (bestScore >= 40) {
                actions.push({ type: 'tacticalCard', cardId: 'imprison', targetId: bestTarget.id });
                cardUses++;
            }
        } else if (cardId === 'mgNest') {
            if (primaryObjective) {
                const nearbyTiles = gameState.tiles.filter(t =>
                    !t.unit && !t.isCity && t.terrain !== 'mountain'
                    && t.camp === myCamp
                    && hexDistance(t, primaryObjective) <= 3);
                if (nearbyTiles.length > 0) {
                    nearbyTiles.sort((a, b) => hexDistance(a, primaryObjective) - hexDistance(b, primaryObjective));
                    actions.push({ type: 'tacticalCard', cardId: 'mgNest', targetId: nearbyTiles[0].id });
                    cardUses++;
                }
            }
        } else if (cardId === 'airdrop') {
            if (primaryObjective) {
                const nearEmpty = gameState.tiles.filter(t =>
                    !t.unit && hexDistance(t, primaryObjective) <= 2);
                if (nearEmpty.length > 0) {
                    nearEmpty.sort((a, b) => hexDistance(a, primaryObjective) - hexDistance(b, primaryObjective));
                    actions.push({ type: 'tacticalCard', cardId: 'airdrop', targetId: nearEmpty[0].id });
                    cardUses++;
                }
            }
        } else if (cardId === 'airstrike') {
            let bestAirstrikeTarget = null, bestAirstrikeScore = 0;
            for (const tile of gameState.tiles) {
                if (!tileVisible(tile)) continue;
                if (tile.camp === myCamp) continue;
                if (!tile.unit && !tile.isCity) continue;
                let score = 0;
                if (tile.isCity && isEnemyCamp(tile.camp)) score += 200;
                if (tile.isCity && tile.camp === CAMP.neutral && !ownsNeutralCity) score += 150;
                if (tile.unit && tile.unit.commander) score += 80;
                if (tile.unit && tile.unit.hp <= 40) score += 60;
                if (primaryObjective && tile === primaryObjective) score += 150;
                let nearbyCount = 0;
                for (const [dq, dr] of [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]) {
                    const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                    if (nb && nb.unit && nb.unit.camp !== myCamp) nearbyCount++;
                }
                score += nearbyCount * 30;
                if (score > bestAirstrikeScore) { bestAirstrikeScore = score; bestAirstrikeTarget = tile; }
            }
            if (bestAirstrikeScore >= 100) {
                actions.push({ type: 'tacticalCard', cardId: 'airstrike', targetId: bestAirstrikeTarget.id });
                cardUses++;
            }
        } else if (cardId === 'orbitalStrike') {
            // 天基打击：锁定敌方单位最密集的位置（中心高价值目标优先）
            let bestOrbitalTarget = null, bestOrbitalScore = 0;
            for (const tile of gameState.tiles) {
                if (!tileVisible(tile)) continue;
                let score = 0, hitCount = 0;
                for (const [dq, dr] of [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]) {
                    const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                    if (!nb || !nb.unit) continue;
                    const isCenter = dq === 0 && dr === 0;
                    if (nb.unit.camp === myCamp) { score -= isCenter ? 200 : 80; continue; }
                    hitCount++;
                    score += isCenter ? 120 : 40;
                    if (isCenter && nb.unit.commander) score += 80;
                    if (isCenter && nb.unit.hp <= 60) score += 50;
                }
                if (hitCount > 0 && score > bestOrbitalScore) { bestOrbitalScore = score; bestOrbitalTarget = tile; }
            }
            if (bestOrbitalScore >= 150) {
                actions.push({ type: 'tacticalCard', cardId: 'orbitalStrike', targetId: bestOrbitalTarget.id });
                cardUses++;
            }
        } else if (cardId === 'shield') {
            let best = null, bestScore = 0;
            for (const u of allUnits) {
                let s = u.config.attack * 2 + u.hp * 0.3;
                if (u.commander) s += 50;
                if (u.hp < u.maxHp * 0.4) s += 40;
                if (primaryObjective && hexDistance(u.tile, primaryObjective) <= 3) s += 30;
                if (s > bestScore) { bestScore = s; best = u; }
            }
            if (bestScore >= 40) {
                actions.push({ type: 'tacticalCard', cardId: 'shield', targetId: best.id });
                cardUses++;
            }
        } else if (cardId === 'landmine') {
            const mineAnchor = defensiveAnchor || primaryObjective;
            if (mineAnchor) {
                const mineSpots = gameState.tiles.filter(t =>
                    !t.unit && !t.isCity && t.camp === myCamp
                    && hexDistance(t, mineAnchor) <= (defensivePhase ? 2 : 4));
                if (mineSpots.length > 0) {
                    mineSpots.sort((a, b) => {
                        const nearestThreat = tile => Math.min(Infinity, ...allEnemyUnits
                            .map(enemyTile => hexDistance(tile, enemyTile)));
                        return nearestThreat(a) - nearestThreat(b)
                            || hexDistance(a, mineAnchor) - hexDistance(b, mineAnchor);
                    });
                    actions.push({ type: 'tacticalCard', cardId: 'landmine', targetId: mineSpots[0].id });
                    cardUses++;
                }
            }
        } else if (cardId === 'forceMarch') {
            // 优先给无法行动的指挥官或骑兵
            const exhausted = allUnits.filter(u => !u.canAct && (u.commander || u.type === 'cavalry'));
            if (exhausted.length > 0) {
                exhausted.sort((a, b) => (b.config.attack || 0) - (a.config.attack || 0));
                actions.push({ type: 'tacticalCard', cardId: 'forceMarch', targetId: exhausted[0].id });
                cardUses++;
            }
        }
        // 空军上校专属卡（diveStrafe/carpetBomb/airlift）由上层 ai.js 的 executeAction 的 tacticalCard 处理
        // 此处仅需在卡牌选择阶段识别并推送
        else if (cardId === 'diveStrafe') {
            if (weather === 'fog') continue; // 雾天停飞
            if (gold < colGold.diveStrafe) continue;
            // 上校可能已阵亡：null 时跳过斩杀加分，避免对 null 估伤崩掉整个规划
            const colonelSelf = findColonelUnit();
            let best = null, bestS = 0;
            for (const tile of gameState.tiles) {
                if (!tileVisible(tile)) continue;
                const t = tile.unit;
                if (!t || t.camp === myCamp) continue;
                let s = t.config.attack * 2 + t.hp * 0.3;
                if (t.commander) s += 100;
                if (colonelSelf && willKill(colonelSelf, t)) s += 200;
                if (primaryObjective && t.tile === primaryObjective) s += 150;
                if (s > bestS) { bestS = s; best = t; }
            }
            if (bestS >= 60) {
                actions.push({ type: 'tacticalCard', cardId: 'diveStrafe', targetId: best.id });
                cardUses++;
            }
        } else if (cardId === 'carpetBomb') {
            if (weather === 'fog') continue; // 雾天停飞
            if (gold < colGold.carpetBomb) continue;
            let best = null, bestS = 0;
            for (const tile of gameState.tiles) {
                if (!tileVisible(tile)) continue;
                if (tile.camp === myCamp) continue;
                let nearbyValue = 0;
                let nearbyCount = 0;
                for (const [dq, dr] of [[0,0],[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]]) {
                    const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                    if (nb && nb.unit && nb.unit.camp !== myCamp) {
                        nearbyValue += nb.unit.hp * 0.5 + (nb.unit.commander ? 80 : 0);
                        nearbyCount++;
                    }
                    if (nb && nb.isCity && nb.camp !== myCamp) nearbyValue += 100;
                }
                const s = nearbyValue + nearbyCount * 20;
                if (s > bestS) { bestS = s; best = tile; }
            }
            if (bestS >= 80) {
                actions.push({ type: 'tacticalCard', cardId: 'carpetBomb', targetId: best.id });
                cardUses++;
            }
        } else if (cardId === 'airlift') {
            // 空运：将强力的己方已行动单位运到前线
            if (weather === 'fog') continue; // 雾天停飞
            if (gold < colGold.airlift) continue;
            if (primaryObjective) {
                // 寻找已行动的高价值单位空运到主攻目标附近
                const carriers = allUnits.filter(u => !u.canAct && u.commander);
                if (carriers.length > 0) {
                    carriers.sort((a, b) => (b.config.attack || 0) - (a.config.attack || 0));
                    actions.push({ type: 'tacticalCard', cardId: 'airlift', targetId: carriers[0].id });
                    cardUses++;
                }
            }
        }
    }

    // 查找己方空军上校单位
    function findColonelUnit() {
        for (const tile of gameState.tiles) {
            if (tile.unit && tile.unit.commander === 'colonel' && tile.unit.camp === myCamp && tile.unit.hp > 0) return tile.unit;
        }
        return null;
    }

    // ═══════════════════════════════════════════
    // 第零·五轮：占星者主动技能 — 星移
    // ═══════════════════════════════════════════

    if (cmdStrat.weatherControl && canForceWeather && astrologerUnit && !processed.has(astrologerUnit.id)) {
        // 判断当前天气是否有利进攻
        const weatherGood = (weather === 'fog' && cmdStrat.aggression >= 1.0)  // 雾天骑兵冲锋
            || (weather === 'wind' && cmdStrat.aggression >= 1.0)               // 风天炮兵
            || (weather === 'rain' && cmdStrat.aggression >= 0.7)               // 雨天步兵
            || (weather === 'clear');
        // 天气不利时主动更换
        if (!weatherGood) {
            const forceComposition = allUnits.reduce((counts, unit) => {
                if (unit.type === 'cavalry') counts.cavalry++;
                else if (unit.type === 'archer') counts.archer++;
                else if (unit.type === 'infantry') counts.infantry++;
                return counts;
            }, { cavalry: 0, archer: 0, infantry: 0 });
            const targetWeather = forceComposition.cavalry >= Math.max(forceComposition.archer, forceComposition.infantry)
                ? 'fog'
                : forceComposition.archer >= forceComposition.infantry ? 'wind' : 'rain';
            actions.push({
                type: 'activateSkill',
                unitId: astrologerUnit.id,
                targetWeather
            });
            processed.add(astrologerUnit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第零·六轮：狂战士/圣骑士/牧师 主动技能
    // ═══════════════════════════════════════════

    if (cmdStrat.useActiveSkill) {
        // 冷却/持续都在单位身上（executeAction 也会再校验一次）
        const skillUnits = allUnits.filter(u =>
            (u.commander === 'berserker' || u.commander === 'paladin' || u.commander === 'priest')
            && u.canAct
            && (u.activeSkillCD || 0) <= 0
            && (u.activeSkillDur || 0) <= 0);
        for (const skillUnit of skillUnits) {
            const reachableTargets = getAttackableTiles(skillUnit).filter(isEngageableTarget);
            const hasAttackTarget = reachableTargets.length > 0;
            const hasWoundedAlly = gameState.tiles.some(tile => {
                const ally = tile.unit;
                return ally
                    && ally !== skillUnit
                    && ally.camp === myCamp
                    && ally.hp < ally.maxHp
                    && hexDistance(skillUnit.tile, ally.tile) <= 2;
            });
            if (!shouldPlanActiveSkill(skillUnit, { hasAttackTarget, hasWoundedAlly })) continue;
            // 泣血消耗当前生命的 30%，只有这一击真能兑现时才划算。
            // 旧版“有目标就放”会让旗舰在整局里持续自残并把治疗资源全吃掉。
            if (skillUnit.commander === 'berserker') {
                const qixueBonus = 1 + BERSERKER_BALANCE.qixueDamageBonus;
                const convertsToKill = reachableTargets.some(tile =>
                    estimateDamage(skillUnit, tile.unit) * qixueBonus >= effectiveHp(tile.unit)
                    && estimateDamage(skillUnit, tile.unit) < effectiveHp(tile.unit));
                const highValueTarget = reachableTargets.some(tile =>
                    tile.unit.commander
                    || (tile.isCity && tile.camp !== myCamp)
                    || countHostileClusterAround(tile) >= 3);
                if (!shouldSpendBerserkerBlood({
                    hpRatio: skillUnit.hp / skillUnit.maxHp,
                    convertsToKill,
                    highValueTarget,
                    outnumbered: allEnemyUnits.length > allUnits.length + 2
                })) continue;
            }
            actions.push({ type: 'activateSkill', unitId: skillUnit.id });
            // 狂战士和圣骑士只是在为下一次攻击蓄力，仍需进入后续攻击规划。
            // 牧师祈祷本身是完整行动，发动后才结束该单位本回合规划。
            if (skillUnit.commander === 'priest') processed.add(skillUnit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第零·七轮：禁锢连击
    // ═══════════════════════════════════════════

    if (hand.includes('imprison') && cardUses < maxCardUseThisTurn) {
        for (const unit of units) {
            if (processed.has(unit.id)) continue;
            const atkTiles = getAttackableTiles(unit);
            const enemyTargets = atkTiles.filter(isEngageableTarget);
            if (enemyTargets.length === 0) continue;
            let bestImprison = null, bestImpScore = 0;
            for (const tile of enemyTargets) {
                const t = tile.unit;
                let score = t.config.attack * 2 + t.hp * 0.5;
                if (t.commander) score += 100;
                if (tile.isCity) score += 80;
                if (t.type === 'archer') score += 30;
                if (score > bestImpScore) { bestImpScore = score; bestImprison = t; }
            }
            if (bestImprison && bestImpScore >= 60) {
                actions.push({ type: 'tacticalCard', cardId: 'imprison', targetId: bestImprison.id });
                cardUses++;
                break;
            }
        }
    }

    // ═══════════════════════════════════════════
    // 第零·八轮：夺城结算 — 城市只能由近战单位进驻
    // ═══════════════════════════════════════════
    // 引擎里只有“突击类”攻击（步/骑）在击杀守军或打破城防后会推进到城市格。
    // 远程单位把城防打空却进不去，等于把城让给下一个走过来的对手——这正是
    // 前几轮“打赢每一仗却一座城都拿不到”的根因，所以夺城要先于普通攻击结算。
    // 结算完成的城市登记进 finalBlowReservedCities，普通攻击阶段不再插队开火。
    const finalBlowReservedCities = new Set();
    const capturedThisTurnCities = new Set();
    // 夺城阶段先占位，移动阶段的守城判定直接复用，避免刚占的城当回合被调走。
    const cityGarrisonPlannedKeys = new Set();

    {
        const captureTargets = gameState.tiles.filter(tile =>
            tile.isCity && tile.camp !== myCamp && tileExplored(tile));
        // 先打近的：同一回合内先落地的占领会让后面的单位重新分配。
        captureTargets.sort((left, right) =>
            avgDistanceFromMyForces(left) - avgDistanceFromMyForces(right));

        for (const city of captureTargets) {
            const cityKey = `${city.q},${city.r}`;
            const assaultUnits = units.filter(unit =>
                !processed.has(unit.id) && canCaptureCityByCombat(unit));

            // ── 情形一：城防已破且无驻军 → 本回合必须有人进驻，否则白送 ──
            if (!city.unit && city.hp <= 0) {
                const enterer = assaultUnits
                    .filter(unit => getMovableTiles(unit).includes(city))
                    .sort((left, right) => {
                        // 步兵守城有 +10% 防御，优先让它坐城；其次谁更健康谁进。
                        const rank = unit => (unit.type === 'infantry' ? 0 : 1);
                        if (rank(left) !== rank(right)) return rank(left) - rank(right);
                        return (right.hp / right.maxHp) - (left.hp / left.maxHp);
                    })[0];
                if (enterer) {
                    actions.push({ type: 'move', unitId: enterer.id, tileQ: city.q, tileR: city.r });
                    rememberPlannedMove(enterer);
                    processed.add(enterer.id);
                    capturedThisTurnCities.add(cityKey);
                    cityGarrisonPlannedKeys.add(cityKey);
                }
                finalBlowReservedCities.add(cityKey);
                continue;
            }

            // ── 情形二：有驻军，近战单位能一击击杀 → 击杀即进驻 ──
            if (city.unit && isCapturableOccupant(city.unit)) {
                const finisher = assaultUnits
                    .filter(unit => getAttackableTiles(unit).includes(city)
                        && hexDistance(unit.tile, city) <= 1
                        && willKill(unit, city.unit)
                        && !wouldDieToCounter(unit, city.unit))
                    .sort((left, right) =>
                        estimateDamage(right, city.unit) - estimateDamage(left, city.unit))[0];
                if (finisher) {
                    actions.push({ type: 'attack', unitId: finisher.id, targetId: city.unit.id });
                    recordPlannedAttack(finisher, city.unit);
                    processed.add(finisher.id);
                    capturedThisTurnCities.add(cityKey);
                    cityGarrisonPlannedKeys.add(cityKey);
                    finalBlowReservedCities.add(cityKey);
                }
                continue;
            }

            // ── 情形三：空城但城防未破 → 破城最后一击留给近战 ──
            if (!city.unit && city.hp > 0) {
                const siegeReady = assaultUnits.filter(unit =>
                    getAttackableTiles(unit).includes(city));
                const assaultDamages = siegeReady.map(unit => estimateSiegeDamage(unit, city));
                if (shouldReserveFinalSiegeBlow(city.hp, assaultDamages)) {
                    // 有近战能一击破城：让它单独完成，其余单位这回合别碰这座城。
                    const breaker = siegeReady
                        .map(unit => ({ unit, damage: estimateSiegeDamage(unit, city) }))
                        .filter(entry => entry.damage >= city.hp)
                        .sort((left, right) => left.damage - right.damage)[0];
                    if (breaker) {
                        actions.push({
                            type: 'siegeCityAttack',
                            unitId: breaker.unit.id,
                            tileQ: city.q,
                            tileR: city.r
                        });
                        processed.add(breaker.unit.id);
                        capturedThisTurnCities.add(cityKey);
                        cityGarrisonPlannedKeys.add(cityKey);
                    }
                    finalBlowReservedCities.add(cityKey);
                }
                // 近战一击破不掉：交给下面的攻城阶段用远程磨城防，
                // 但磨到刚好留一击的量时会被 shouldReserveFinalSiegeBlow 接管。
            }
        }
    }

    // ═══════════════════════════════════════════
    // 第一轮：攻击 — 天气感知 + 将领特化
    // ═══════════════════════════════════════════

    // 城市数才是胜负判定，交战本身是净支出：打光一支部队去换人头，
    // 城照样被第三方拿走。所以能占城的近战只要本回合够得着一座城，
    // 就把行动力留给占城，不参与普通对射。这是最高档与中档最实质的分野——
    // 中档见到目标就打，最高档会算「这一刀值不值一座城」。
    const cityBoundAssaults = new Set();
    for (const unit of units) {
        if (processed.has(unit.id) || !canCaptureCityByCombat(unit)) continue;
        // 本回合就能走进去的空城：那一步直接兑现成一座城。
        if (getMovableTiles(unit).some(tile =>
            tile.isCity && tile.camp !== myCamp && !tile.unit && tile.hp <= 0)) {
            cityBoundAssaults.add(unit.id);
            continue;
        }
        // 已经进入认领城市的最后两步：不为路边的杂兵停下来。停一回合打一架，
        // 城就可能被别人先摸进去——双人局里 Imperator 打出 39 次攻击 11 个击杀，
        // 移动却只有对手的一半，最终 0 占城输掉，就是这么耗掉的。
        const target = objectiveFor(unit);
        if (!target) continue;
        const stride = Math.max(1, Number(unit.config?.speed || 1));
        if (hexDistance(unit.tile, target) <= stride + 2) cityBoundAssaults.add(unit.id);
    }

    for (const unit of units) {
        if (processed.has(unit.id)) continue;

        const atkTiles = getAttackableTiles(unit);
        let targets = atkTiles.filter(isEngageableTarget);

        // 集火过滤：按账本已被锁定击杀的目标不再浪费输出
        targets = targets.filter(t => effectiveHp(t.unit) > 0);

        // 行军中的近战只为两件事停下：一刀拿下城市，或清掉挡在城门口的守军。
        if (cityBoundAssaults.has(unit.id)) {
            targets = targets.filter(tile => tile.isCity && tile.camp !== myCamp
                && (willKill(unit, tile.unit) || hexDistance(unit.tile, tile) <= 1));
        }

        if (targets.length === 0) continue;

        // 守城近战无友军→避免斩杀导致放空
        if (isOwnCity(unit.tile) && unit.type !== 'archer') {
            const adjAllies = countAdjacentAllies(unit.tile, unit.id);
            if (adjAllies === 0) {
                const nonLethal = targets.filter(t => !willKill(unit, t.unit));
                if (nonLethal.length > 0) targets = nonLethal;
            }
        }

        if (targets.length === 0) continue;

        let bestTile = null;
        let bestScore = -Infinity;

        for (const tile of targets) {
            const target = tile.unit;
            let score = 0;

            // 净交换否决：形不成击杀、又明显换血亏本的攻击直接不打。
            // 只在“确实脱得了身”时否决——射程 2 以上可以拉开距离，speed=0 的
            // 固定火力点追不上来。已经贴脸的近战不打也照样挨打，少打一次更亏。
            // 岸防炮射程 2、对舰 +30%，硬啃三回合就是白送三个单位：上一轮红军
            // 32 个损失里 9 个死于此。
            if (!willKill(unit, target)
                && !(tile.isCity && tile.camp !== myCamp)) {
                const staticEmplacement = Number(target.config?.speed || 0) === 0;
                const canDisengage = staticEmplacement
                    || Number(unit.config?.range || 1) >= 2;
                if (canDisengage) {
                    const inflicted = Math.min(effectiveHp(target), estimateDamage(unit, target, tile));
                    const netTrade = inflicted - estimateCounterDamage(unit, target);
                    if (netTrade < -unit.maxHp * 0.10) continue;
                }
            }

            // 斩杀
            if (willKill(unit, target)) {
                score += 200 * (cmdStrat.killBonus || 1.0);
                if (target.commander) score += 80;
                if (target.morale >= 3) score += 30;
                if (myCmdKeys.has('centurion')) score += 50;
            }

            // 主攻目标上的守军
            if (primaryObjective && tile === primaryObjective) score += 200;

            // 位于敌方/中立城市的守军
            if (tile.isCity && tile.camp !== myCamp) score += 150;

            // 制衡体现在「抢地」而不是「打人」：削弱垫底那家只是替领先者省事，
            // 所以压制期间对落后阵营的部队降低兴趣，但也不专门去追领先者的兵。
            if (runawayLeader && isEnemyCamp(target.camp) && target.camp !== runawayLeader) {
                score -= SUPPRESSION_PULL * 0.6;
            }

            // 残血收割
            const hpRatio = target.hp / target.maxHp;
            score += (1 - hpRatio) * 70 * (cmdStrat.aggression || 1.0);
            if (target.hp <= 30) score += 60;

            // 阶段1：积极清除中立单位
            if (!ownsNeutralCity && target.camp === CAMP.neutral) {
                score += 80;
                if (tile.isCity) score += 40;
            }

            // 谋士士气打击
            if (cmdStrat.preferConvert && target.morale <= 1) score += 120;
            if (cmdStrat.preferConvert && target.morale === 0) score += 250;

            // 顺克加成
            const adv = counterAdvantage(unit.type, target.type);
            if (adv > 1) {
                score += 40;
                // 魔术师：克制攻击额外+25%伤害 → 顺克收益更高
                if (myCmdKeys.has('magician')) score += 30;
            } else if (adv < 1) {
                score -= 30 * (cmdStrat.aggression > 1 ? 0.5 : 1);
                // 魔术师：被克时受伤-15%，被克攻击风险降低
                if (myCmdKeys.has('magician')) score += 15;
            }

            // 威胁评级
            if (target.type === 'archer') {
                score += 20;
                if (weather === 'wind') score += 15; // 风天炮兵威胁更大
            }
            if (target.type === 'cavalry') {
                score += 12;
                if (weather === 'fog') score += 15;  // 雾天骑兵威胁更大
            }
            // 风天：步兵防御-15% → 优先打步兵
            if (weather === 'wind' && target.type === 'infantry') score += 25;

            // 避免自杀
            const estimatedAttackDamage = estimateDamage(unit, target, tile);
            const estimatedCounterDamage = estimateCounterDamage(unit, target);
            const suicidePenalty = wouldDieToCounter(unit, target)
                ? 150 * Math.max(0.3, 2 - (cmdStrat.aggression || 1))
                    * 1.15
                : 0;
            score -= suicidePenalty;
            {
                const cappedDamage = Math.min(effectiveHp(target), estimatedAttackDamage);
                score += cappedDamage * 0.75 - estimatedCounterDamage * 0.7;
                if (unit.hp / unit.maxHp < 0.35 && !willKill(unit, target)) score -= 85;
                if (target.commander) score += 45;

                // 阵营协同也进入交换账本。天鹰火力跨过补给阈值时等价于额外经济；
                // 反过来，对已激活天鹰协议的敌军做无击杀碎伤，可能直接送出天基打击。
                if (ownEagleActive && ownEagleMeter
                    && (isEagleAirAttacker(unit) || isEagleFortressAttacker(unit))
                    && ownEagleMeter.progress + cappedDamage >= ownEagleMeter.threshold) {
                    score += 75;
                }
                if (visibleEnemyEagleCamps.has(target.camp?.id)) {
                    const enemyMeter = getEagleSynergyMeter(gameState, target.camp.id);
                    const grantsOrbital = enemyMeter.takenProgress + cappedDamage
                        >= enemyMeter.takenThreshold;
                    if (isEagleCommanderUnit(target)) score += 110;
                    if (grantsOrbital && !willKill(unit, target)
                        && !target.commander && tile !== primaryObjective) {
                        score -= 135;
                    }
                }
            }

            // 友军协击
            if (countAdjacentAllies(tile, target.id) > 0) score += 20;

            {
                // 炮兵优先把溅射打进密集编队，而不是只看主目标血量。
                if (unit.specializationKey === 'rocketArtillery') {
                    score += Math.max(0, countHostileClusterAround(tile) - 1) * 85;
                }

                // 海战角色分工：潜艇绕开反潜舰，优先伏击航母/巡洋舰；驱逐舰负责反潜。
                score += scoreTacticalRoleMatchup(unit, target);

                // 已被压低士气的目标更容易形成滚雪球；士气归零目标应立即清除。
                score += Math.max(0, 2 - Number(target.morale ?? 2)) * 45;
            }

            score += jitterScore(55);

            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }

        if (bestTile) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: bestTile.unit.id });
            recordPlannedAttack(unit, bestTile.unit);
            processed.add(unit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第一·五轮：攻城 — 没有普通目标时，对已清空驻军但HP>0的敌方/中立城市补一刀
    // ═══════════════════════════════════════════

    for (const unit of units) {
        if (processed.has(unit.id)) continue;
        const siegeTiles = getAttackableTiles(unit).filter(t => !t.unit && t.isCity && t.hp > 0
            && (isEnemyCamp(t.camp) || shouldEngageNeutralAt(t))
            // 破城最后一击已经指派给近战单位的城市，远程不再插队：
            // 远程把城防打空自己却进不去，只会把空城让给对手。
            && !finalBlowReservedCities.has(`${t.q},${t.r}`)
            // 远程磨城防必须有近战在跟进途中，否则整场攻城都是替对手拆门：
            // 上一轮红军把 (-3,0)、(1,-2) 的城防磨掉大半，两座城全被绿军收割。
            && (canCaptureCityByCombat(unit) || assaultReinforcementNearby(t)));
        if (siegeTiles.length === 0) continue;
        // 优先已经磨得比较低的城墙，争取尽快破城
        siegeTiles.sort((a, b) => a.hp - b.hp);
        actions.push({ type: 'siegeCityAttack', unitId: unit.id, tileQ: siegeTiles[0].q, tileR: siegeTiles[0].r });
        processed.add(unit.id);
    }

    // ═══════════════════════════════════════════
    // 第二轮：移动 — 天气感知向主攻目标推进
    // ═══════════════════════════════════════════

    const cityGarrisonPlanned = new Map();
    const reservedDestinationKeys = new Set();
    const plannedVacatedRecruitCities = new Set();
    const ownForceCount = gameState.tiles.filter(tile =>
        tile.unit?.camp === myCamp && tile.unit.hp > 0).length;
    // 只有能占城的近战才是真正的扩张手；兵力见底时不能把他们全锁在城里。
    const mobileAssaultCount = gameState.tiles.filter(tile =>
        tile.unit?.camp === myCamp && tile.unit.hp > 0
        && canCaptureCityByCombat(tile.unit)).length;
    const isLastMobileAttacker = () => mobileAssaultCount <= 2;

    // 疫情态势：己方有中毒单位时才启用疏散评分，平时不干扰正常集结。
    // 投毒每跳按最大生命 15% 结算、共 3 跳，并且每跳都向相邻单位（不分阵营）
    // 传播——密集编队被一张牌整锅端。回归局里红军 16 个损失有 15 个来自这条链，
    // 所以疏散权重必须压过集结与侧翼收益，否则等于没做。
    const poisonedAllyCount = gameState.tiles.filter(tile =>
        tile.unit?.camp === myCamp && tile.unit.hp > 0 && tile.unit._poison).length;
    /** 落点周围的传染面：中毒者按接触到的健康友军算，健康者按接触到的中毒友军算。 */
    const adjacentContagionRisk = (tile, movingUnit) => {
        let risk = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const neighbor = tileMap.get(`${tile.q + dq},${tile.r + dr}`)?.unit;
            if (!neighbor || neighbor.camp !== myCamp || neighbor.id === movingUnit.id) continue;
            if (movingUnit._poison ? !neighbor._poison : Boolean(neighbor._poison)) risk++;
        }
        return risk;
    };
    /** 所有移动分支共用的疏散罚分，不只在推进分支生效。 */
    // 权重要压过普通走位收益，但不能压过占城与守城——城市数才是胜负判定，
    // 调到 140 时部队会因为躲毒而不敢进城，五局占城直接从 13 掉到 8。
    const contagionPenaltyFor = (tile, movingUnit) => poisonedAllyCount > 0
        ? adjacentContagionRisk(tile, movingUnit) * 70
        : 0;

    const chooseRearSupportTile = (unit, validTiles) => {
        if (myCities.length === 0) return null;
        const currentRearDistance = Math.min(...myCities.map(city =>
            hexDistance(unit.tile, city)));
        let best = null;
        let bestScore = -Infinity;
        for (const tile of validTiles) {
            const rearDistance = Math.min(...myCities.map(city =>
                hexDistance(tile, city)));
            let score = -rearDistance * 24
                - estimateDestinationThreat(tile, unit) * 0.45
                - contagionPenaltyFor(tile, unit)
                - backtrackPenalty(unit, tile);
            if (tile.isCity && tile.camp === myCamp) score += 220;
            score += countAdjacentAllies(tile, unit.id) * 12;
            if (score > bestScore) {
                bestScore = score;
                best = tile;
            }
        }
        if (!best) return null;
        const bestRearDistance = Math.min(...myCities.map(city =>
            hexDistance(best, city)));
        return bestRearDistance < currentRearDistance
            || (best.isCity && best.camp === myCamp)
            ? best
            : null;
    };

    // 尚书让位后的下一回合，先令新兵离城，再按动作顺序把尚书送回原城。
    gameState._imperatorMinisterReturnCities ||= {};
    gameState._imperatorMinisterLastReturnRound ||= {};
    const ministerReturn = gameState._imperatorMinisterReturnCities[campKey];
    const returningMinister = units.find(unit => unit.commander === 'minister');
    if (ministerReturn && returningMinister && !processed.has(returningMinister.id)) {
        const returnCity = tileMap.get(`${ministerReturn.q},${ministerReturn.r}`);
        if (returnCity?.unit === returningMinister) {
            delete gameState._imperatorMinisterReturnCities[campKey];
            gameState._imperatorMinisterLastReturnRound[campKey] = currentRound;
        } else if (returnCity && hexDistance(returningMinister.tile, returnCity) === 1) {
            const occupyingUnit = returnCity.unit;
            if (occupyingUnit?.camp === myCamp && !processed.has(occupyingUnit.id)) {
                const occupantExit = getMovableTiles(occupyingUnit)
                    .filter(tile => !tile.unit && !tile.isCity
                        && !reservedDestinationKeys.has(`${tile.q},${tile.r}`))
                    .sort((left, right) =>
                        estimateDestinationThreat(left, occupyingUnit)
                        - estimateDestinationThreat(right, occupyingUnit))[0];
                if (occupantExit) {
                    actions.push({
                        type: 'move',
                        unitId: occupyingUnit.id,
                        tileQ: occupantExit.q,
                        tileR: occupantExit.r
                    });
                    rememberPlannedMove(occupyingUnit);
                    reservedDestinationKeys.add(`${occupantExit.q},${occupantExit.r}`);
                    processed.add(occupyingUnit.id);
                }
            }
            if (!returnCity.unit || processed.has(returnCity.unit.id)) {
                actions.push({
                    type: 'move',
                    unitId: returningMinister.id,
                    tileQ: returnCity.q,
                    tileR: returnCity.r
                });
                rememberPlannedMove(returningMinister);
                reservedDestinationKeys.add(`${returnCity.q},${returnCity.r}`);
                processed.add(returningMinister.id);
            }
        }
    }

    for (const unit of units) {
        if (processed.has(unit.id)) continue;

        const movTiles = getMovableTiles(unit);
        const validTiles = movTiles.filter(t =>
            !t.unit && !reservedDestinationKeys.has(`${t.q},${t.r}`));
        if (validTiles.length === 0) continue;

        const hpRatio = unit.hp / unit.maxHp;
        const commanderId = unit.commander || null;

        // ── 后方型将领 ──
        // 尚书只在没有其他空城且招募足够紧急时临时让出城位。
        if (commanderId === 'minister') {
            if (isOwnCity(unit.tile)) {
                const cityThreatened = allThreatUnits.some(enemyTile =>
                    hexDistance(enemyTile, unit.tile) <= 3);
                const hasOtherEmptyCity = myCities.some(city =>
                    city !== unit.tile && !city.unit);
                const shouldYield = shouldYieldMinisterCity({
                    gold,
                    minimumRecruitCost: UNIT_CONFIG.infantry.cost,
                    hasOtherEmptyCity,
                    cityThreatened,
                    ownForceCount,
                    ownedCityCount: myCities.length,
                    terminalPhase
                }) && hasMinisterYieldCooldownElapsed(
                    currentRound,
                    gameState._imperatorMinisterLastReturnRound[campKey]
                );
                if (!shouldYield) continue;

                const safestExit = validTiles
                    .filter(tile => !tile.isCity && hexDistance(unit.tile, tile) === 1)
                    .sort((left, right) =>
                        estimateDestinationThreat(left, unit)
                        - estimateDestinationThreat(right, unit))[0];
                if (!safestExit) continue;
                actions.push({
                    type: 'move',
                    unitId: unit.id,
                    tileQ: safestExit.q,
                    tileR: safestExit.r
                });
                rememberPlannedMove(unit);
                plannedVacatedRecruitCities.add(`${unit.tile.q},${unit.tile.r}`);
                gameState._imperatorMinisterReturnCities[campKey] = {
                    q: unit.tile.q,
                    r: unit.tile.r,
                    yieldRound: currentRound
                };
                reservedDestinationKeys.add(`${safestExit.q},${safestExit.r}`);
                processed.add(unit.id);
                continue;
            }

            const rearTile = chooseRearSupportTile(unit, validTiles);
            if (rearTile) {
                actions.push({ type: 'move', unitId: unit.id, tileQ: rearTile.q, tileR: rearTile.r });
                rememberPlannedMove(unit);
                reservedDestinationKeys.add(`${rearTile.q},${rearTile.r}`);
                processed.add(unit.id);
            }
            continue;
        }

        // 亡灵法师的回魂没有距离限制；默认留在本方城市或向最近后方城位收拢。
        if (commanderId === 'necromancer') {
            if (isOwnCity(unit.tile)) continue;
            const rearTile = chooseRearSupportTile(unit, validTiles);
            if (rearTile) {
                actions.push({ type: 'move', unitId: unit.id, tileQ: rearTile.q, tileR: rearTile.r });
                rememberPlannedMove(unit);
                reservedDestinationKeys.add(`${rearTile.q},${rearTile.r}`);
                processed.add(unit.id);
            }
            continue;
        }

        // 占星者默认后置；仅在自身状态良好、局部有掩护且整体兵力占优时随军前推。
        if (commanderId === 'astrologer') {
            const nearbyEnemyCount = allThreatUnits.filter(enemyTile =>
                hexDistance(enemyTile, unit.tile) <= 5).length;
            const nearbyAllyCount = gameState.tiles.filter(tile =>
                tile.unit?.camp === myCamp && tile.unit.id !== unit.id
                && hexDistance(tile, unit.tile) <= 3).length;
            const keepRear = shouldKeepAstrologerRear({
                hpRatio,
                nearbyEnemyCount,
                nearbyAllyCount,
                forceAdvantage: ownForceCount - allEnemyUnits.length,
                hasSecureForwardBase: ownsNeutralCity,
                terminalPhase
            });
            if (keepRear) {
                if (isOwnCity(unit.tile)) continue;
                const rearTile = chooseRearSupportTile(unit, validTiles);
                if (rearTile) {
                    actions.push({ type: 'move', unitId: unit.id, tileQ: rearTile.q, tileR: rearTile.r });
                    rememberPlannedMove(unit);
                    reservedDestinationKeys.add(`${rearTile.q},${rearTile.r}`);
                    processed.add(unit.id);
                }
                continue;
            }
        }

        // ── 守城 ──
        if (isOwnCity(unit.tile)) {
            const cityKey = `${unit.tile.q},${unit.tile.r}`;
            const isCapital = myHomeDistricts.has(unit.tile.districtId);
            const isForwardCity = !isCapital;
            const cityThreatened = allThreatUnits.some(enemyTile =>
                hexDistance(enemyTile, unit.tile) <= 5);
            // 城市数量本身就是胜负判定，前哨城空置一回合就可能被路过的近战摘走。
            // 只有能占城的近战留下才算真守住；远程留守挡不住突击进驻。
            const mustHoldForward = isForwardCity
                && canCaptureCityByCombat(unit)
                && !isLastMobileAttacker(unit);
            const mustHoldCapital = isCapital && canCaptureCityByCombat(unit)
                && (defensivePhase || capitalThreat >= 0.30 || ownForceCount <= 3);
            // 中毒守军照样得守：空城会被路过的近战直接摘走，比传染更亏。
            // 该走开的是旁边的健康友军，那由移动评分的疏散罚分负责。
            if (!cityGarrisonPlanned.has(cityKey) && !cityGarrisonPlannedKeys.has(cityKey)
                && (unit.type === 'infantry' || cityThreatened || mustHoldForward || mustHoldCapital
                    || (terminalPhase && isForwardCity))) {
                cityGarrisonPlanned.set(cityKey, unit.id);
                cityGarrisonPlannedKeys.add(cityKey);
                continue;
            }

            // 出击
            if (validTiles.length > 0) {
                let bestDest = validTiles[0];
                let bestDestScore = -Infinity;
                for (const t of validTiles) {
                    if (t.isCity) continue;
                    let score = 0;
                    if (primaryObjective) {
                        const curDist = hexDistance(unit.tile, primaryObjective);
                        const newDist = hexDistance(t, primaryObjective);
                        score += (curDist - newDist) * 3;
                    }
                    let defScore = t.terrain === 'mountain' ? 0.30 : t.terrain === 'forest' ? 0.20 : 0;
                    // 天气适配前进路径
                    if (weather === 'fog' && unit.type === 'cavalry') defScore += 0.15;
                    if (weather === 'wind' && unit.type === 'archer') defScore += 0.15;
                    score += defScore;
                    const threatPenalty = estimateDestinationThreat(t, unit)
                        / Math.max(1, unit.maxHp) * 35;
                    score += getRoleTargetBonus(t, unit) + countFlankSetups(t, unit.id) * 70
                        - threatPenalty - contagionPenaltyFor(t, unit)
                        - backtrackPenalty(unit, t) + jitterScore(30);
                    if (score > bestDestScore) { bestDestScore = score; bestDest = t; }
                }
                actions.push({ type: 'move', unitId: unit.id, tileQ: bestDest.q, tileR: bestDest.r });
                rememberPlannedMove(unit);
                reservedDestinationKeys.add(`${bestDest.q},${bestDest.r}`);
                processed.add(unit.id);
                continue;
            }
        }

        // ── 非守城单位：向主攻目标推进 ──
        let bestTile = null;
        let bestScore = -Infinity;

        const enemiesNear = gameState.tiles.filter(t =>
            t.unit && isEnemyCamp(t.unit.camp) && hexDistance(unit.tile, t) <= 5
        ).length;
        const currentThreat = estimateDestinationThreat(unit.tile, unit);
        const shouldRetreat = hpRatio < 0.30
            && (enemiesNear > 0 || currentThreat >= unit.hp * 0.35);

        if (shouldRetreat) {
            for (const tile of validTiles) {
                let score = 0;
                if (myCities.length > 0) {
                    const nearestOwn = myCities.reduce((b, c) =>
                        hexDistance(tile, c) < hexDistance(tile, b) ? c : b, myCities[0]);
                    score = -hexDistance(tile, nearestOwn) * 5;
                }
                let defScore = tile.terrain === 'mountain' ? 0.30 : tile.terrain === 'forest' ? 0.20 : 0;
                if (weather === 'rain' && unit.type === 'infantry') defScore += 0.15;
                score += defScore - contagionPenaltyFor(tile, unit) - backtrackPenalty(unit, tile);
                if (score > bestScore) { bestScore = score; bestTile = tile; }
            }
        } else if (isPinner(unit) && raidPlan.pinAnchor) {
            // 牵制分队：黏在对方主力的鼻子底下，让他不敢转身，但绝不冲进去送。
            // 理想站位是「他够得着我、我也够得着他」的那一圈——保持接触即可，
            // 打赢不是任务，把他的注意力钉在这里才是。
            const anchorTile = tileMap.get(`${raidPlan.pinAnchor.q},${raidPlan.pinAnchor.r}`)
                || raidPlan.pinAnchor;
            const contactRange = Math.max(2, Number(unit.config?.range || 1) + 1);
            for (const tile of validTiles) {
                const distance = hexDistance(tile, anchorTile);
                // 距离落在接触圈内得分最高，越靠近核心反而扣分（那是送死不是牵制）
                let score = 60 - Math.abs(distance - contactRange) * 22;
                score -= estimateDestinationThreat(tile, unit) / Math.max(1, unit.maxHp) * 30;
                score += countAdjacentAllies(tile, unit.id) * 10;
                if (tile.terrain === 'mountain') score += 8;
                else if (tile.terrain === 'forest') score += 5;
                score -= contagionPenaltyFor(tile, unit) + backtrackPenalty(unit, tile);
                if (score > bestScore) { bestScore = score; bestTile = tile; }
            }
        } else if (objectiveFor(unit)) {
            // 近战走自己认领的那座城，舰队与远程跟随主攻目标。
            const unitObjective = objectiveFor(unit);
            const curDist = hexDistance(unit.tile, unitObjective);

            for (const tile of validTiles) {
                const newDist = hexDistance(tile, unitObjective);
                // 拿到第一座城之后推进意愿不该衰减：城市数就是胜负判定，
                // 旧版把 pushWeight 直接砍半，部队从此在自家海域画圈到终局。
                const pushW = (cmdStrat.pushWeight || 1.0) * (ownsNeutralCity ? 1.6 : 2.0);
                // 推进按「拉近的比例」计分。改成绝对格数试过一轮：部队确实动起来了，
                // 但也变成一路冲进对射，杀 216 的同时自损 212，终局持城反而更少。
                // 这局游戏数的是城市不是人头，推进要有节制。
                const advanceScore = (curDist - newDist) / Math.max(curDist, 1) * 5 * pushW;

                // 直接占领空城：能走进去就是一座城，收益不随阶段打折。
                // 只有近战进得去，远程站上去也拿不到区划。
                const captureBonus = (tile.isCity && tile.camp !== myCamp && !tile.unit
                    && canCaptureCityByCombat(unit))
                    ? (terminalPhase
                        ? 240
                        : 60) * pushW
                        + (unit.type === 'infantry' ? 12 : 0)
                    : 0;

                const siegeReady = newDist <= 1 ? 2.5 * pushW : 0;

                let nearAnyTarget = 0;
                for (const c of gameState.tiles) {
                    if (c.isCity && c.camp !== myCamp && hexDistance(tile, c) <= 1) {
                        nearAnyTarget += 0.6;
                    }
                }

                let defScore = tile.terrain === 'mountain' ? 0.20 : tile.terrain === 'forest' ? 0.12 : 0;
                // 天气适配：雾天骑兵走开阔地有利，风天炮兵站高地有利
                if (weather === 'fog' && unit.type === 'cavalry') defScore += 0.15;
                if (weather === 'wind' && unit.type === 'archer') defScore += 0.15;
                if (weather === 'wind' && unit.type === 'infantry') defScore -= 0.10;

                let atkPotential = 0;
                for (const [dq, dr] of HEX_NEIGHBORS) {
                    const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                    if (nb && nb.unit && nb.unit.camp !== myCamp) atkPotential += 0.3;
                }

                const alliesNearby = countAdjacentAllies(tile, unit.id);
                const rallyBonus = alliesNearby * 0.15;

                const enemiesAdj = countAdjacentEnemies(tile);
                const exposurePenalty = enemiesAdj * (ownsNeutralCity ? 0.15 : 0.05);

                let safetyPenalty = 0;
                if (hpRatio < 0.35 && alliesNearby === 0 && enemiesAdj >= 2) {
                    safetyPenalty = 2.0;
                }

                const incomingThreat = estimateDestinationThreat(tile, unit);
                // 权重保持在 24：中立部队并入威胁集合后，incomingThreat 本身已经
                // 变大（岸防炮、中立航母都进来了），再提权重就是双重放大——
                // 实测提到 85 会让舰队为了躲炮而彻底不去占城，胜率反而从 60% 掉到 10%。
                // 占城格放宽到 10：为夺一座城挨一轮火力是划算的。
                const threatPenalty = incomingThreat / Math.max(1, unit.maxHp)
                    * (tile.isCity && tile.camp !== myCamp ? 10 : 24);
                const flankBonus = countFlankSetups(tile, unit.id) * 75;
                const roleTargetBonus = getRoleTargetBonus(tile, unit);

                // 首都防卫
                let capitalDefenseBonus = 0;
                const enemyNearCapital = capitalTile
                    ? allEnemyUnits.filter(enemyTile =>
                        hexDistance(enemyTile, capitalTile)
                            <= Math.max(5, Number(enemyTile.unit.config?.speed || 0)
                                + Number(enemyTile.unit.config?.range || 1))).length
                    : 0;
                if (enemyNearCapital >= 1 || defensivePhase) {
                    const nearestEnemyToCapital = allEnemyUnits.reduce((b, e) =>
                        hexDistance(e, capitalTile) < hexDistance(b, capitalTile) ? e : b
                    , allEnemyUnits[0]);
                    if (nearestEnemyToCapital) {
                        const distToThreat = hexDistance(tile, nearestEnemyToCapital);
                        const anchorDistance = hexDistance(tile, capitalTile);
                        capitalDefenseBonus = Math.max(0, 80 - distToThreat * 8 - anchorDistance * 3);
                    }
                }

                const villageBonus = tile.isVillage ? 20 : 0;

                // 集中兵力（阶段2）
                let concentrationBonus = 0;
                if (ownsNeutralCity) {
                    for (const ally of allUnits) {
                        if (ally.id === unit.id) continue;
                        const d = hexDistance(tile, ally.tile);
                        if (d <= 3) concentrationBonus += (3 - d) * 3;
                    }
                }

                // 疫区管制：中毒者自己散开，健康单位也别贴上去。
                const contagionPenalty = contagionPenaltyFor(tile, unit);

                // 隐蔽突击：偷袭分队走敌方视野之外的路。被提前看见的迂回不叫迂回，
                // 对方回防一次就白跑了。非迷雾局里这张视野图是空的，罚分自动失效。
                const stealthPenalty = isStriker(unit) && isUnderEnemyObservation(tile) ? 34 : 0;


                // 残血撤退回城
                let healRetreatBonus = 0;
                if (hpRatio < 0.30 && myCities.length > 0) {
                    const nearestOwnCity = myCities.reduce((b, c) =>
                        hexDistance(tile, c) < hexDistance(tile, b) ? c : b, myCities[0]);
                    healRetreatBonus = Math.max(0, 40 - hexDistance(tile, nearestOwnCity) * 3);
                }

                // 拦截敌人
                let interceptBonus = 0;
                for (const [dq, dr] of HEX_NEIGHBORS) {
                    const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                    if (nb && nb.unit && isEnemyCamp(nb.unit.camp) && !willKill(unit, nb.unit)) {
                        interceptBonus += 15;
                    }
                }

                // 亡灵法师：主动向有亡魂标记的区域移动（诅咒敌人）
                let soulMarkBonus = 0;
                if (cmdStrat.soulPlay && gameState._soulMarks) {
                    for (const mark of gameState._soulMarks) {
                        if (mark.campKey !== campKey) continue;
                        const d = hexDistance(tile, { q: mark.q, r: mark.r, s: -mark.q-mark.r });
                        if (d <= 2) soulMarkBonus += 25 - d * 8;
                    }
                }

                // 纵横家：向敌方行政区内推进（卡牌复制）
                let diplomatBonus = 0;
                if (cmdStrat.pushIntoEnemy) {
                    if (isEnemyCamp(tile.camp)) {
                        diplomatBonus += 30;
                    }
                    // 敌方空城
                    if (tile.isCity && isEnemyCamp(tile.camp)) diplomatBonus += 50;
                }

                // 空军上校：雾天不宜进攻
                let fogPenalty = 0;
                if (cmdStrat.airPower && weather === 'fog') {
                    fogPenalty = 20; // 雾天上校不能飞，整体进攻意愿降低
                }

                const score = advanceScore + captureBonus + siegeReady + nearAnyTarget +
                    defScore + atkPotential + rallyBonus + concentrationBonus +
                    capitalDefenseBonus + villageBonus + healRetreatBonus + interceptBonus +
                    soulMarkBonus + diplomatBonus + flankBonus + roleTargetBonus -
                    exposurePenalty - safetyPenalty - fogPenalty - threatPenalty -
                    contagionPenalty - stealthPenalty - backtrackPenalty(unit, tile)
                    + jitterScore(45);

                if (score > bestScore) { bestScore = score; bestTile = tile; }
            }
        } else {
            // 无主攻目标 → 扫荡残敌
            for (const tile of validTiles) {
                let score = 0;
                if (allEnemyUnits.length > 0) {
                    const nearestEnemy = allEnemyUnits.reduce((b, e) =>
                        hexDistance(tile, e) < hexDistance(tile, b) ? e : b, allEnemyUnits[0]);
                    score = -hexDistance(tile, nearestEnemy) * 2;
                }
                score += countAdjacentEnemies(tile) * 0.5;
                score -= contagionPenaltyFor(tile, unit) + backtrackPenalty(unit, tile);
                if (score > bestScore) { bestScore = score; bestTile = tile; }
            }
        }

        if (bestTile && !(bestTile.q === unit.tile.q && bestTile.r === unit.tile.r)) {
            const routeObjective = objectiveFor(unit);
            if (routeObjective) {
                const curDist = hexDistance(unit.tile, routeObjective);
                const newDist = hexDistance(bestTile, routeObjective);
                const tacticalDetour = (countFlankSetups(bestTile, unit.id) > 0 || getRoleTargetBonus(bestTile, unit) >= 70);
                const hasForwardOption = validTiles.some(tile =>
                    hexDistance(tile, routeObjective) < curDist);
                const routeDetour = !hasForwardOption
                    && newDist <= curDist + 2
                    && !isImmediateBacktrack(movementMemory[unit.id], bestTile, currentRound);
                if (newDist > curDist && !shouldRetreat && !defensivePhase
                    && !tacticalDetour && !routeDetour) continue;
            }
            actions.push({ type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r });
            rememberPlannedMove(unit);
            reservedDestinationKeys.add(`${bestTile.q},${bestTile.r}`);
            processed.add(unit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第二·五轮：补员 — 守城/驻村单位回血，前线不塌
    // ═══════════════════════════════════════════

    let reinforceCount = 0;
    const reinforceCandidates = gameState.tiles
        .filter(t => t.unit && t.unit.camp === myCamp
            && (t.unit.hp < t.unit.maxHp * 0.55 || t.unit._poison)
            && !t._reinforcedThisTurn
            && ((t.isCity && t.camp === myCamp) || t.isVillage))
        // 中毒还会再掉几跳血，按“当前缺口 + 未来毒伤”排序才不会补了就死。
        .sort((a, b) => {
            const deficit = tile => (tile.unit.maxHp - tile.unit.hp) + poisonPressure(tile.unit);
            return deficit(b) - deficit(a);
        });
    for (const tile of reinforceCandidates) {
        if (reinforceCount >= 2) break;
        const u = tile.unit;
        const healAmt = Math.min(Math.floor(u.maxHp * 0.50), u.maxHp - u.hp);
        if (healAmt <= 0) continue;
        const cost = Math.max(1, Math.ceil(u.config.cost * (healAmt / u.maxHp)));
        // 进攻型：保留至少 8 金招兵预算
        if (gold - cost < 8) break;
        actions.push({ type: 'reinforce', unitId: u.id });
        gold -= cost;
        reinforceCount++;
    }

    // ═══════════════════════════════════════════
    // 第三轮：招募 — 天气适配 + 将领特化
    // ═══════════════════════════════════════════

    const maxRecruits = gold >= 25 ? 3 : gold >= 12 ? 2 : 1;
    let recruitCount = 0;

    const emptyOwnCities = gameState.tiles.filter(t =>
        t.isCity && t.camp === myCamp
        && (!t.unit || plannedVacatedRecruitCities.has(`${t.q},${t.r}`)));
    const emptyOwnPorts = gameState.tiles.filter(t =>
        t.isPort && t.camp === myCamp && !t.unit);

    if (gold < 8 || (emptyOwnCities.length === 0 && emptyOwnPorts.length === 0)) {
        return actions;
    }

    // 统计敌人兵种分布
    const enemyTypeCounts = { infantry: 0, cavalry: 0, archer: 0 };
    for (const e of allEnemyUnits) {
        if (e.unit && enemyTypeCounts[e.unit.type] !== undefined) enemyTypeCounts[e.unit.type]++;
    }
    const dominantType = Object.entries(enemyTypeCounts).sort((a, b) => b[1] - a[1])[0];

    // 天气修正的招募优先级
    const weatherOrder = (weather === 'rain') ? ['infantry', 'cavalry', 'archer']
        : (weather === 'fog') ? ['cavalry', 'infantry', 'archer']
        : (weather === 'wind') ? ['archer', 'cavalry', 'infantry']
        : (cmdStrat.recruitPref || ['cavalry', 'archer', 'infantry']);

    let recruitPriority;
    if (dominantType && dominantType[1] > 0) {
        if (dominantType[0] === 'cavalry')      recruitPriority = ['infantry', 'archer', 'cavalry'];
        else if (dominantType[0] === 'archer')  recruitPriority = ['cavalry', 'infantry', 'archer'];
        else                                    recruitPriority = ['archer', 'cavalry', 'infantry'];
    } else {
        recruitPriority = weatherOrder;
    }
    // 将领特化：如果将领有特定招募偏好，覆盖天气优先级
    if (cmdStrat.recruitPref
        && !(dominantType && dominantType[1] > 0)) {
        recruitPriority = cmdStrat.recruitPref;
    }
    // 陆战队缺口优先：还没夺下的城至少要配一个能进城的近战单位，
    // 否则炮兵和舰队再多也只是把城防打空，等着对手走进去摘。
    const outstandingCityTargets = neutralCities.length + enemyCities.length;
    if (mobileAssaultCount < Math.min(4, outstandingCityTargets + 1)) {
        recruitPriority = ['infantry', 'cavalry', ...recruitPriority.filter(type =>
            type !== 'infantry' && type !== 'cavalry')];
    }

    const scoreCity = (city) => {
        let score = 0;
        if (primaryObjective) {
            score += Math.max(0, 100 - hexDistance(city, primaryObjective) * 6);
        }
        score += countAdjacentEnemies(city) * 35;
        const localDefense = evaluateCityDefense(city, myCamp);
        if (localDefense < 100) score += 50;
        return score;
    };

    emptyOwnCities.sort((a, b) => scoreCity(b) - scoreCity(a));

    const navalUnits = allLivingUnits.filter(unit => unit.config?.movementDomain === 'naval');
    const enemyNavalUnits = visibleRivalUnits.filter(unit => unit.config?.movementDomain === 'naval');
    const hostileNavalTypes = new Set(enemyNavalUnits.map(unit => unit.type));
    const navalPriority = hostileNavalTypes.has('submarine')
        ? ['destroyer', 'warship', 'submarine']
        : hostileNavalTypes.has('warship') || hostileNavalTypes.has('carrier')
            ? ['submarine', 'warship', 'destroyer']
            : hostileNavalTypes.has('destroyer')
                ? ['warship', 'destroyer', 'submarine']
                : ['destroyer', 'submarine', 'warship'];
    const needsFleet = oceanMap && emptyOwnPorts.length > 0
        && (navalUnits.length < Math.max(2, enemyNavalUnits.length)
            || portThreat >= 0.35)
        && navalUnits.length < Math.max(4, mobileAssaultCount * 2);
    const needsLandRecovery = emptyOwnCities.length > 0
        && (objectivePhase === 'recover' || mobileAssaultCount < 2 || ownForceCount <= 2);

    function planRecruit(site, priority) {
        if (!site || recruitCount >= maxRecruits) return false;
        for (const type of priority) {
            if (!UNIT_CONFIG[type] || gold < UNIT_CONFIG[type].cost) continue;
            if (canRecruitTypeAtSite && !plannedVacatedRecruitCities.has(`${site.q},${site.r}`)
                && !canRecruitTypeAtSite(type, site)) continue;
            actions.push({ type: 'recruit', unitType: type, tileQ: site.q, tileR: site.r });
            gold -= UNIT_CONFIG[type].cost;
            recruitCount++;
            return true;
        }
        return false;
    }

    // 崩盘时先恢复一名陆战占城手；其余海图局优先保住港口的舰队再生产能力。
    const usedCities = new Set();
    if (needsLandRecovery) {
        const recoveryCity = emptyOwnCities[0];
        if (planRecruit(recoveryCity, ['infantry', 'cavalry', 'archer'])) {
            usedCities.add(`${recoveryCity.q},${recoveryCity.r}`);
        }
    }
    if (needsFleet && recruitCount < maxRecruits) {
        emptyOwnPorts.sort((left, right) => strategicThreatAt(right) - strategicThreatAt(left)
            || (primaryObjective
                ? hexDistance(left, primaryObjective) - hexDistance(right, primaryObjective) : 0));
        planRecruit(emptyOwnPorts[0], navalPriority);
    }
    for (const city of emptyOwnCities) {
        if (recruitCount >= maxRecruits) break;
        if (usedCities.has(`${city.q},${city.r}`)) continue;
        const isFrontline = primaryObjective && hexDistance(city, primaryObjective) <= 4;
        const landTypes = isFrontline
            ? ['infantry', ...recruitPriority.filter(type => type !== 'infantry')]
            : recruitPriority;
        const types = recruitTypesForCity ? recruitTypesForCity(city, landTypes) : landTypes;
        planRecruit(city, types);
    }

    return actions;
}
