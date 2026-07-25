// Claude — 防御型 AI v4
// 核心原则：保守反击、死守城市、优先击杀
// v4 升级：战斗模型对齐引擎 + 集火补刀 + 城内补员
//   · 克制 ±20%、士气 高昂+5~10%/低落-5~10%/混乱-10~-20%、反击 0.75×基础（对齐 rules/constants.js）
//   · 战壕只防近战、高射机枪只防远程、森林只对远程 +15%
//   · 集火账本：多单位合力锁定击杀，不再各自为战
//   · 城市/村庄驻军血量不足时补员回血，守得更久
//   · 炮兵拉开 2 格输出位；护盾计入斩杀判定
//   · 移除对策卡规划（中立阵营没有卡牌经济，drawCard 对 neutral 直接拒绝）

export const meta = {
    name: 'Claude',
    description: '防御型AI v4，引擎级战斗模型·集火补刀·驻军补员'
};

const MY_DISTRICTS = new Set([3, 4, 5]);

// ── 克制系数（对齐 COMBAT_BALANCE.counter：advantageDamage ±0.20）──
const COUNTER = {
    infantry: { archer: 0.80, cavalry: 1.20, infantry: 1 },
    archer:   { cavalry: 0.80, infantry: 1.20, archer: 1 },
    cavalry:  { infantry: 0.80, archer: 1.20, cavalry: 1 }
};

// 对齐 TERRAIN_CONFIG（config.js）
const TERRAIN_DEF = { plains: 0, forest: 0.05, mountain: 0.05 };

// 指挥官威胁评分（用于目标优先级判断）
const COMMANDER_THREAT = {
    berserker:    95,  // 高爆发，优先击杀
    centurion:    90,  // 连锁斩杀
    vampire:      80,  // 吸血续航
    magician:     75,  // 克制增伤
    paladin:      70,
    fallenAngel:  65,
    advisor:      60,
    minister:     50,
    ironGuard:    45,
    staller:      40,
    priest:       35,
    colonel:      85,  // 空军威胁
    astrologer:   55,
    diplomat:     40,
    necromancer:  70,
    engineer:     65
};

// 天气对兵种的偏好权重（招募/站位用）
const WEATHER_UNIT_PREF = {
    infantry: { rain: 1.3, fog: 0.8, wind: 0.6, clear: 1.0 },
    cavalry:  { rain: 0.7, fog: 1.4, wind: 1.0, clear: 1.0 },
    archer:   { rain: 0.8, fog: 0.6, wind: 1.5, clear: 1.0 }
};

export function planActions(gameState, helpers) {
    const { getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP, UNIT_CONFIG, recruitTypesForCity } = helpers;
    const tileMap = gameState.tileMap;
    const actions = [];
    const processed = new Set();
    const emergencySwapCities = new Set();

    const weather = gameState.weather || 'clear';

    // ═══════════════════════════════════════════
    // 辅助函数
    // ═══════════════════════════════════════════

    function isMyTurf(tile) {
        return MY_DISTRICTS.has(tile.districtId) && tile.camp === CAMP.neutral;
    }

    function isOnMyCity(tile) {
        return tile.isCity && isMyTurf(tile);
    }

    function isAdjacentToMyCity(tile) {
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && nb.isCity && isMyTurf(nb)) return nb;
        }
        return null;
    }

    function countAdjacentAllies(tile, excludeId) {
        let c = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && nb.unit && nb.unit.camp === CAMP.neutral && nb.unit.id !== excludeId) c++;
        }
        return c;
    }

    function countAdjacentEnemies(tile) {
        let c = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && nb.unit && nb.unit.camp !== CAMP.neutral) c++;
        }
        return c;
    }

    // 攻击是否属于远程（决定战壕/高射机枪/森林加成是否生效）
    function isRangedAttacker(attacker) {
        return attacker.type === 'archer' || attacker.type === 'mgNest' || attacker._isDrone === true;
    }

    // 地形+工事防御（对齐 rules/terrain.js：战壕 0.25 只防近战，高射机枪 0.25 只防远程，森林对远程额外 +0.15）
    function getEffectiveTerrainDef(tile, attackerRanged) {
        let def = TERRAIN_DEF[tile.terrain] || 0;
        if (tile.fortification === 'trench' && !attackerRanged) def += 0.25;
        if (tile.fortification === 'flak' && attackerRanged) def += 0.25;
        if (tile.terrain === 'forest' && attackerRanged) def += 0.15;
        return def;
    }

    // 天气修正后的城市防御
    function getCityDef(unitType, tile, weatherCond) {
        let def = 0;
        if (unitType === 'infantry' && tile.isCity) {
            def += 0.10;
            if (weatherCond === 'rain') def += 0.10; // 雨天步兵守城+10%
        }
        return def;
    }

    // 天气进攻加成（用于伤害预估）
    function getWeatherAtkBonus(unitType, weatherCond) {
        if (weatherCond === 'fog' && unitType === 'cavalry') return 0.20;
        if (weatherCond === 'wind' && unitType === 'archer') return 0.20;
        return 0;
    }

    // 天气防御惩罚（用于伤害预估）
    function getWeatherDefPenalty(unitType, weatherCond) {
        if (weatherCond === 'wind' && unitType === 'infantry') return -0.15;
        return 0;
    }

    function estimateDamage(attacker, defender, tile) {
        const tileObj = tile || defender.tile;
        const coeff = (COUNTER[attacker.type] && COUNTER[attacker.type][defender.type]) || 1;
        const tDef = getEffectiveTerrainDef(tileObj, isRangedAttacker(attacker));
        const cityDef = getCityDef(defender.type, tileObj, weather);
        const unitDef = defender.config.defense || 0;
        const weatherAtk = getWeatherAtkBonus(attacker.type, weather);
        const weatherDef = getWeatherDefPenalty(defender.type, weather);

        // ① 攻击乘区(增伤)：士气已进入 getEffectiveAttack，此处只补克制与天气。
        const offense = 1 + (coeff - 1) + weatherAtk;
        // ② 防御乘区
        const def = 1 - tDef - cityDef - unitDef - weatherDef;
        // 魔术师·千面：被克制目标攻击时受伤降低15%
        const magicianDef = (defender.commander === 'magician' && coeff > 1) ? 0.15 : 0;

        return attacker.getEffectiveAttack()
            * Math.max(0, offense)
            * Math.max(0.3, def - magicianDef);
    }

    // 集火账本：记录本回合已排入攻击的预估伤害，让后续单位能"补刀"锁定击杀
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
        const c = COUNTER[myType] && COUNTER[myType][enemyType];
        return c || 1;
    }

    // 判断单位是否已孤立（所在行政区已无己方城市）
    function isIsolated(unit) {
        const myCities = gameState.tiles.filter(t => t.isCity && isMyTurf(t));
        if (myCities.length === 0) return true;
        return !myCities.some(c => c.districtId === unit.tile.districtId);
    }

    function wouldDieToCounter(attacker, defender) {
        if (attacker.type === 'archer' && hexDistance(attacker.tile, defender.tile) > 1 && defender.type !== 'archer') {
            return false;
        }
        // 反击伤害期望 ≈ 基础估算 × 0.75(反击基础系数) × ~1.30(反击浮动均值) ≈ 0.98；
        // 承受反击的是进攻方，防御地形按进攻方自己站的格子算
        const counterDmg = estimateDamage(defender, attacker, attacker.tile) * 0.98;
        // 魔术师·千面：被克制时+15%防御
        const coeff = (COUNTER[defender.type] && COUNTER[defender.type][attacker.type]) || 1;
        const magiSave = (attacker.commander === 'magician' && coeff > 1) ? 0.15 : 0;
        return counterDmg * (1 - magiSave) >= attacker.hp + (attacker._shield || 0);
    }

    // 指挥官威胁等级
    function getCommanderThreat(commanderKey) {
        return COMMANDER_THREAT[commanderKey] || 50;
    }

    // ═══════════════════════════════════════════
    // 收集与分类
    // ═══════════════════════════════════════════

    const allUnits = gameState.tiles
        .filter(t => t.unit && t.unit.camp === CAMP.neutral && t.unit.canAct && !t.unit.isNewRecruit)
        .map(t => t.unit);

    // 行动顺序：炮 → 骑 → 步（远程先手，近战后手）
    const units = [...allUnits].sort((a, b) => {
        const order = { archer: 0, cavalry: 1, infantry: 2 };
        return order[a.type] - order[b.type];
    });

    const myCities = gameState.tiles.filter(t => t.isCity && isMyTurf(t));
    const enemyUnits = gameState.tiles.filter(t =>
        t.unit && t.unit.camp !== CAMP.neutral && isMyTurf(t)
    );
    const allEnemyTiles = gameState.tiles.filter(t =>
        t.unit && t.unit.camp !== CAMP.neutral
    );
    let gold = gameState.playerGold.neutral;

    // ═══════════════════════════════════════════
    // 对策卡：中立阵营没有卡牌经济——drawCard() 对 neutral 直接返回 null，
    // playerHands / playerDrawsThisTurn 也没有 neutral 键，免费发牌同样跳过中立。
    // 因此这里不做任何卡牌规划（历史版本的卡牌代码永远走不通，已移除）。
    // ═══════════════════════════════════════════
    // 第一轮：攻击 — 优先击杀、顺克、保护城市
    // ═══════════════════════════════════════════

    for (const unit of units) {
        if (processed.has(unit.id)) continue;

        // 急换防候选 → 跳过攻击，留给移动轮执行换防
        if (isOnMyCity(unit.tile) && unit.type !== 'archer') {
            const adjAllies = countAdjacentAllies(unit.tile, unit.id);
            if (adjAllies === 0) {
                const hpRatio = unit.hp / unit.maxHp;
                const threatened = allEnemyTiles.some(e => hexDistance(unit.tile, e) <= 4);
                if (hpRatio < 0.55 && threatened && gold >= 30) {
                    const movTiles = getMovableTiles(unit);
                    const canRetreat = movTiles.some(t => isMyTurf(t) && !t.unit && !t.isCity);
                    if (canRetreat) continue;
                }
            }
        }

        const atkTiles = getAttackableTiles(unit);
        let targets = atkTiles.filter(t => t.unit && t.unit.camp !== CAMP.neutral && isMyTurf(t));

        // 孤军后备：无可攻击的境内目标时，攻击任何相邻敌人
        if (targets.length === 0 && isIsolated(unit)) {
            targets = atkTiles.filter(t => t.unit && t.unit.camp !== CAMP.neutral);
        }

        // 集火过滤：按账本已被锁定击杀的目标不再浪费输出
        targets = targets.filter(t => effectiveHp(t.unit) > 0);

        if (targets.length === 0) continue;

        // 守城近战：无友军协防时，若攻击会斩杀（前压→放空城市）则只许攻击不斩杀的目标
        if (isOnMyCity(unit.tile) && unit.type !== 'archer') {
            const adjAllies = countAdjacentAllies(unit.tile, unit.id);
            if (adjAllies === 0) {
                targets = targets.filter(t => !willKill(unit, t.unit));
            }
            if (targets.length === 0) continue;
        }

        let bestTile = null;
        let bestScore = -Infinity;

        for (const tile of targets) {
            const target = tile.unit;
            let score = 0;

            // 斩杀 —— 最高优先级
            if (willKill(unit, target)) {
                score += 200;
                if (target.commander) score += 60;
                if (target.morale >= 3) score += 30;
                // 高威胁指挥官额外加分
                score += getCommanderThreat(target.commander) * 0.5;
            }

            // 城市防御
            if (isOnMyCity(tile)) score += 150;
            if (isAdjacentToMyCity(tile)) score += 80;

            // 残血收割
            const hpRatio = target.hp / target.maxHp;
            score += (1 - hpRatio) * 60;

            if (target.hp <= 25) score += 50;

            // 顺克加成
            const adv = counterAdvantage(unit.type, target.type);
            if (adv > 1) score += 35;
            else if (adv < 1) {
                // 魔术师·千面：被克制目标攻击时受伤降低15% → 顺克收益更高
                if (target.commander === 'magician') {
                    score -= 45; // 打魔术师还被克→更亏
                } else {
                    score -= 25;
                }
            }

            // 威胁评级
            if (target.type === 'archer') {
                score += 15;
                if (weather === 'wind') score += 15; // 风天炮兵威胁更大
            }
            if (target.type === 'cavalry') {
                score += 10;
                if (weather === 'fog') score += 15;  // 雾天骑兵威胁更大
            }

            // 避免自杀
            if (wouldDieToCounter(unit, target)) score -= 120;

            // 友军协击
            if (countAdjacentAllies(tile, target.id) > 0) score += 15;

            // 天气打击：风天优先杀步兵（-15%防御）
            if (weather === 'wind' && target.type === 'infantry') score += 20;

            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }

        if (bestTile) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: bestTile.unit.id });
            recordPlannedAttack(unit, bestTile.unit);
            processed.add(unit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第一·五轮：攻城 — 没有普通目标时，对已清空驻军但HP>0的敌方城市补一刀
    // ═══════════════════════════════════════════

    for (const unit of units) {
        if (processed.has(unit.id)) continue;
        const siegeTiles = getAttackableTiles(unit).filter(t => !t.unit && t.isCity && t.hp > 0 && t.camp !== CAMP.neutral);
        if (siegeTiles.length === 0) continue;
        // 优先已经磨得比较低的城墙，争取尽快破城
        siegeTiles.sort((a, b) => a.hp - b.hp);
        actions.push({ type: 'siegeCityAttack', unitId: unit.id, tileQ: siegeTiles[0].q, tileR: siegeTiles[0].r });
        processed.add(unit.id);
    }

    // ═══════════════════════════════════════════
    // 第二轮：移动 — 紧急换防、步兵守城、残血撤退、天气适应站位
    // ═══════════════════════════════════════════

    for (const unit of units) {
        if (processed.has(unit.id)) continue;

        // ── 城市驻军逻辑 ──
        if (isOnMyCity(unit.tile)) {
            const cityTile = unit.tile;
            const cityThreatened = allEnemyTiles.some(e => hexDistance(cityTile, e) <= 4);
            const hpRatio = unit.hp / unit.maxHp;

            // ① 紧急换防：守军残血 + 城市受威胁 + 资金充足
            if (hpRatio < 0.55 && cityThreatened && gold >= 30) {
                const movTiles = getMovableTiles(unit);
                const retreatTiles = movTiles.filter(t =>
                    isMyTurf(t) && !t.unit && !t.isCity && countAdjacentEnemies(t) === 0
                );
                const fallbackTiles = movTiles.filter(t =>
                    isMyTurf(t) && !t.unit && !t.isCity
                );
                const candidates = retreatTiles.length > 0 ? retreatTiles : fallbackTiles;

                if (candidates.length > 0) {
                    const nearbyEnemies = allEnemyTiles.filter(e => hexDistance(cityTile, e) <= 5);
                    const pivot = nearbyEnemies.length > 0 ? nearbyEnemies[0] : gameState.tiles[0];
                    const best = candidates.reduce((best, t) =>
                        hexDistance(t, pivot) > hexDistance(best, pivot) ? t : best
                    , candidates[0]);
                    actions.push({ type: 'move', unitId: unit.id, tileQ: best.q, tileR: best.r });
                    processed.add(unit.id);
                    emergencySwapCities.add(`${cityTile.q},${cityTile.r}`);
                    continue;
                }
            }

            // ①b 紧急软换防（备用）：资金不足
            if (hpRatio < 0.55 && cityThreatened && gold < 30) {
                const movTiles = getMovableTiles(unit);
                const retreatTiles = movTiles.filter(t =>
                    isMyTurf(t) && !t.unit && !t.isCity && countAdjacentEnemies(t) === 0
                );
                const fallbackTiles = movTiles.filter(t =>
                    isMyTurf(t) && !t.unit && !t.isCity
                );
                const retreatCandidates = retreatTiles.length > 0 ? retreatTiles : fallbackTiles;

                if (retreatCandidates.length > 0) {
                    let bestReplacement = null;
                    let bestReplScore = -Infinity;
                    for (const other of units) {
                        if (other.id === unit.id) continue;
                        if (processed.has(other.id)) continue;
                        if (other.hp < other.maxHp * 0.60) continue;
                        if (isOnMyCity(other.tile)) continue;

                        const otherMov = getMovableTiles(other);
                        const canReachCity = otherMov.some(t => t.q === cityTile.q && t.r === cityTile.r);
                        if (!canReachCity) continue;

                        let score = other.hp / other.maxHp * 50;
                        if (other.type === 'infantry') score += 40;
                        if (other.type === 'infantry' && weather === 'rain') score += 20; // 雨天步兵守城更强
                        if (isAdjacentToMyCity(other.tile)) score += 10;
                        if (score > bestReplScore) { bestReplScore = score; bestReplacement = other; }
                    }

                    if (bestReplacement) {
                        const nearbyEnemies = allEnemyTiles.filter(e => hexDistance(cityTile, e) <= 5);
                        const pivot = nearbyEnemies.length > 0 ? nearbyEnemies[0] : gameState.tiles[0];
                        const bestRetreat = retreatCandidates.reduce((best, t) =>
                            hexDistance(t, pivot) > hexDistance(best, pivot) ? t : best
                        , retreatCandidates[0]);
                        actions.push({ type: 'move', unitId: unit.id, tileQ: bestRetreat.q, tileR: bestRetreat.r });
                        processed.add(unit.id);
                        actions.push({ type: 'move', unitId: bestReplacement.id, tileQ: cityTile.q, tileR: cityTile.r });
                        processed.add(bestReplacement.id);
                        continue;
                    }
                }
            }

            // ② 非步兵守安全城市 + 资金充足 → 移走让位给步兵
            if (unit.type !== 'infantry' && !cityThreatened && gold >= 30) {
                const movTiles = getMovableTiles(unit);
                const inTurf = movTiles.filter(t => isMyTurf(t) && !t.unit && !t.isCity);
                if (inTurf.length > 0) {
                    let bestDest = inTurf[0];
                    let bestDestScore = -Infinity;
                    for (const t of inTurf) {
                        let defScore = t.terrain === 'mountain' ? 0.30 : t.terrain === 'forest' ? 0.20 : 0;
                        // 天气适配站位
                        if (weather === 'fog' && unit.type === 'cavalry') defScore += 0.15;  // 雾天骑兵阵地加成
                        if (weather === 'wind' && unit.type === 'archer') defScore += 0.15;  // 风天炮兵阵地加成
                        if (weather === 'wind' && unit.type === 'infantry') defScore -= 0.15; // 风天步兵避开
                        const adjCity = isAdjacentToMyCity(t) ? 0.35 : 0;
                        const score = defScore + adjCity;
                        if (score > bestDestScore) { bestDestScore = score; bestDest = t; }
                    }
                    actions.push({ type: 'move', unitId: unit.id, tileQ: bestDest.q, tileR: bestDest.r });
                    processed.add(unit.id);
                    continue;
                }
            }

            // ③ 其他情况 → 死守不退
            continue;
        }

        // ── 非城市单位移动 ──
        const movTiles = getMovableTiles(unit);
        let inTurf = movTiles.filter(t => isMyTurf(t) && !t.unit);

        if (inTurf.length === 0 && isIsolated(unit)) {
            inTurf = movTiles.filter(t => !t.unit || t.unit.camp === CAMP.neutral);
        }

        if (inTurf.length === 0) continue;

        const hpRatio = unit.hp / unit.maxHp;
        const shouldRetreat = hpRatio < 0.30;
        const enemiesNearby = enemyUnits.filter(e => hexDistance(unit.tile, e) <= 5);

        let bestTile = null;
        let bestScore = -Infinity;

        if (shouldRetreat || enemiesNearby.length === 0) {
            const targets = myCities.length > 0 ? myCities : gameState.tiles.filter(t => t.isCity && t.camp === CAMP.neutral);
            if (targets.length === 0) {
                for (const tile of inTurf) {
                    let defScore = tile.terrain === 'mountain' ? 0.30 : tile.terrain === 'forest' ? 0.20 : 0;
                    // 天气适配
                    if (weather === 'rain' && unit.type === 'infantry') defScore += 0.15; // 雨天步兵蹲城市/林地
                    if (weather === 'wind' && unit.type === 'infantry') defScore -= 0.15;
                    if (defScore > bestScore) { bestScore = defScore; bestTile = tile; }
                }
            } else {
                const nearestCity = targets.reduce((best, t) =>
                    hexDistance(unit.tile, t) < hexDistance(unit.tile, best) ? t : best
                , targets[0]);
                const maxDist = Math.max(...inTurf.map(t => hexDistance(t, nearestCity)), 1);

                for (const tile of inTurf) {
                    const distScore = 1 - hexDistance(tile, nearestCity) / maxDist;
                    let defScore = tile.terrain === 'mountain' ? 0.25 : tile.terrain === 'forest' ? 0.15 : 0;
                    if (weather === 'rain' && unit.type === 'infantry') defScore += 0.15;
                    if (weather === 'wind' && unit.type === 'infantry') defScore -= 0.15;
                    const onCity = (tile.isCity && isMyTurf(tile)) ? 0.6 : 0;
                    const adjCity = isAdjacentToMyCity(tile) ? 0.25 : 0;
                    const enemiesAdj = countAdjacentEnemies(tile);
                    const safetyPenalty = enemiesAdj * 0.15;
                    const score = distScore * 0.4 + defScore * 0.2 + onCity + adjCity - safetyPenalty;
                    if (score > bestScore) { bestScore = score; bestTile = tile; }
                }
            }
        } else {
            // 有近敌：向敌推进（但保持防御优势）
            const nearestEnemy = enemiesNearby.reduce((best, t) =>
                hexDistance(unit.tile, t) < hexDistance(unit.tile, best) ? t : best
            , enemiesNearby[0]);

            const maxDist = Math.max(...inTurf.map(t => hexDistance(t, nearestEnemy)), 1);

            for (const tile of inTurf) {
                const dToEnemy = hexDistance(tile, nearestEnemy);
                // 炮兵卡 2 格射程位输出，近战贴脸推进
                const distScore = unit.type === 'archer'
                    ? 1 - Math.abs(dToEnemy - 2) / Math.max(maxDist, 2)
                    : 1 - dToEnemy / maxDist;
                let defScore = tile.terrain === 'mountain' ? 0.25 : tile.terrain === 'forest' ? 0.15 : 0;
                if (weather === 'rain' && unit.type === 'infantry') defScore += 0.15;
                if (weather === 'wind' && unit.type === 'infantry') defScore -= 0.15;
                const cityGrav = myCities.length > 0
                    ? 1 - Math.min(hexDistance(tile, myCities.reduce((b, c) =>
                        hexDistance(tile, c) < hexDistance(tile, b) ? c : b, myCities[0])) / 10, 1)
                    : 0;
                let atkPotential = 0;
                for (const [dq, dr] of HEX_NEIGHBORS) {
                    const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                    if (nb && nb.unit && nb.unit.camp !== CAMP.neutral && isMyTurf(nb)) {
                        atkPotential += 0.2;
                    }
                }
                const enemiesAdj = countAdjacentEnemies(tile);
                // 炮兵暴露惩罚加重：被贴脸就废了
                const exposurePenalty = enemiesAdj * (unit.type === 'archer' ? 0.3 : 0.1);
                // 站住村庄拿收入（步兵优先）
                const villageHold = tile.isVillage ? (unit.type === 'infantry' ? 0.3 : 0.15) : 0;

                const score = distScore * 0.35 + defScore * 0.2 + cityGrav * 0.25 + atkPotential + villageHold - exposurePenalty;
                if (score > bestScore) { bestScore = score; bestTile = tile; }
            }
        }

        if (bestTile && !(bestTile.q === unit.tile.q && bestTile.r === unit.tile.r)) {
            actions.push({ type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r });
            processed.add(unit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第二·五轮：补员 — 城市/村庄驻军回血（防御核心：养住驻军比换新兵划算）
    // ═══════════════════════════════════════════

    const hasEmptyCityNeedingRecruit = gameState.tiles.some(t => t.isCity && isMyTurf(t) && !t.unit);
    const recruitReserve = hasEmptyCityNeedingRecruit ? UNIT_CONFIG.infantry.cost : 0;
    let reinforceCount = 0;
    const reinforceCandidates = gameState.tiles
        .filter(t => t.unit && t.unit.camp === CAMP.neutral
            && t.unit.hp < t.unit.maxHp * 0.65
            && !t._reinforcedThisTurn
            && ((t.isCity && isMyTurf(t)) || t.isVillage))
        .sort((a, b) => (a.unit.hp / a.unit.maxHp) - (b.unit.hp / b.unit.maxHp));
    for (const tile of reinforceCandidates) {
        if (reinforceCount >= 2) break;
        const u = tile.unit;
        const healAmt = Math.min(Math.floor(u.maxHp * 0.50), u.maxHp - u.hp);
        if (healAmt <= 0) continue;
        const cost = Math.max(1, Math.ceil(u.config.cost * (healAmt / u.maxHp)));
        if (gold - cost < recruitReserve) continue;
        actions.push({ type: 'reinforce', unitId: u.id });
        gold -= cost;
        reinforceCount++;
    }

    // ═══════════════════════════════════════════
    // 第三轮：招募 — 天气适配+反制兵种
    // ═══════════════════════════════════════════

    const maxRecruits = gold >= 16 ? 2 : 1;
    let recruitCount = 0;

    const emptyCities = gameState.tiles.filter(t =>
        t.isCity && isMyTurf(t) && !t.unit
    );

    if (gold < 8 || (emptyCities.length === 0 && emergencySwapCities.size === 0)) {
        return actions;
    }

    // 统计境内敌人兵种分布 → 反制招募
    const enemyTypeCounts = { infantry: 0, cavalry: 0, archer: 0 };
    for (const e of enemyUnits) {
        if (e.unit && enemyTypeCounts[e.unit.type] !== undefined) {
            enemyTypeCounts[e.unit.type]++;
        }
    }
    const dominantType = Object.entries(enemyTypeCounts).sort((a, b) => b[1] - a[1])[0];

    // 天气修正的招募优先级（雨天→步兵, 雾天→骑兵, 风天→炮兵）
    const weatherOrder = (weather === 'rain') ? ['infantry', 'archer', 'cavalry']
        : (weather === 'fog') ? ['cavalry', 'infantry', 'archer']
        : (weather === 'wind') ? ['archer', 'infantry', 'cavalry']
        : ['infantry', 'archer', 'cavalry']; // 晴天标准

    // 反制优先于天气，但天气作为第二因子
    let recruitPriority;
    if (dominantType && dominantType[1] > 0) {
        if (dominantType[0] === 'cavalry')      recruitPriority = ['infantry', 'archer', 'cavalry'];
        else if (dominantType[0] === 'archer')  recruitPriority = ['infantry', 'cavalry', 'archer'];
        else                                    recruitPriority = ['infantry', 'archer', 'cavalry'];
    } else {
        recruitPriority = weatherOrder;
    }

    // 城市威胁评分
    const scoreCity = (city) => {
        let score = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${city.q + dq},${city.r + dr}`);
            if (nb && nb.unit && nb.unit.camp !== CAMP.neutral) score += 80;
        }
        score += gameState.tiles.filter(t =>
            t.unit && t.unit.camp !== CAMP.neutral && t.districtId === city.districtId
        ).length * 20;
        return score;
    };

    // 紧急换防城市绝对优先
    const emergencyList = [];
    for (const key of emergencySwapCities) {
        const city = tileMap.get(key);
        if (city && city.isCity && isMyTurf(city)) {
            emergencyList.push(city);
        }
    }
    emergencyList.sort((a, b) => scoreCity(b) - scoreCity(a));

    const normalList = [];
    for (const city of emptyCities) {
        if (!emergencySwapCities.has(`${city.q},${city.r}`)) {
            normalList.push(city);
        }
    }
    normalList.sort((a, b) => scoreCity(b) - scoreCity(a));

    const cityQueue = [...emergencyList, ...normalList];

    for (let i = 0; i < Math.min(maxRecruits, cityQueue.length); i++) {
        if (recruitCount >= maxRecruits) break;
        const city = cityQueue[i];
        const isEmergency = emergencySwapCities.has(`${city.q},${city.r}`);
        const landTypes = isEmergency ? ['infantry'] : recruitPriority;
        const types = recruitTypesForCity ? recruitTypesForCity(city, landTypes) : landTypes;
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
