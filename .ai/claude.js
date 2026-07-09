// Claude — 防御型 AI v3
// 核心原则：保守反击、死守城市、优先击杀
// v3 升级：天气感知防御、补全对策卡使用、精准威胁评估、数据对齐
//   · 雨天步兵守城+雾天骑兵拦截+风天龟缩防炮
//   · shield/landmine/forceMarch/airstrike/scout 全卡使用
//   · 敌方指挥官威胁识别+士气打击+魔术师避克
//   · 地形防御/城市防御/抽卡费用对齐最新游戏配置

export const meta = {
    name: 'Claude',
    description: '防御型AI v3，天气感知·全卡使用·精准威胁评估'
};

const MY_DISTRICTS = new Set([3, 4, 5]);

// ── 克制系数（本地副本，避免频繁属性访问）──
const COUNTER = {
    infantry: { archer: 0.75, cavalry: 1.25, infantry: 1 },
    archer:   { cavalry: 0.75, infantry: 1.25, archer: 1 },
    cavalry:  { infantry: 0.75, archer: 1.25, cavalry: 1 }
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
    const { getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP, UNIT_CONFIG } = helpers;
    const tileMap = gameState.tileMap;
    const actions = [];
    const processed = new Set();
    const emergencySwapCities = new Set();

    const weather = gameState.weather || 'clear';
    const drawCost = helpers.CARD_SYSTEM_CONFIG ? helpers.CARD_SYSTEM_CONFIG.drawCost : 4;

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

    // 天气修正后的地形防御
    function getEffectiveTerrainDef(tile, unitType) {
        let def = TERRAIN_DEF[tile.terrain] || 0;
        if (tile.fortification === 'trench') def += 0.30;
        // 森林：对远程额外+0.15
        if (tile.terrain === 'forest' && unitType === 'archer') def += 0.15;
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
        const tDef = getEffectiveTerrainDef(tileObj, defender.type);
        const cityDef = getCityDef(defender.type, tileObj, weather);
        const unitDef = defender.config.defense || 0;
        const moraleDmg = attacker.morale === 3 ? 0.15 : attacker.morale === 1 ? -0.20 : attacker.morale === 0 ? -1 : 0;
        const weatherAtk = getWeatherAtkBonus(attacker.type, weather);
        const weatherDef = getWeatherDefPenalty(defender.type, weather);

        // ① 攻击乘区(增伤)：克制系数 + 士气 + 天气攻击加成
        const offense = 1 + (coeff - 1) + moraleDmg + weatherAtk;
        // ② 防御乘区
        const def = 1 - tDef - cityDef - unitDef - weatherDef;
        // 魔术师·千面：被克制目标攻击时受伤降低15%
        const magicianDef = (defender.commander === 'magician' && coeff > 1) ? 0.15 : 0;

        return attacker.getEffectiveAttack()
            * Math.max(0, offense)
            * Math.max(0.3, def - magicianDef);
    }

    function willKill(attacker, defender) {
        return estimateDamage(attacker, defender) >= defender.hp;
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
        const counterDmg = estimateDamage(defender, attacker, defender.tile) * 0.5;
        // 魔术师·千面：被克制时+15%防御
        const coeff = (COUNTER[defender.type] && COUNTER[defender.type][attacker.type]) || 1;
        const magiSave = (attacker.commander === 'magician' && coeff > 1) ? 0.15 : 0;
        return counterDmg * (1 - magiSave) >= attacker.hp;
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
    // ══ 第零轮：对策卡 — 抽牌 + 使用 ══
    const allUnitsN = [];
    for (const tile of gameState.tiles) {
        if (tile.unit && tile.unit.camp === CAMP.neutral) allUnitsN.push(tile.unit);
    }
    const campKeyNeutral = 'neutral';
    const handN = gameState.playerHands[campKeyNeutral] || [];
    let cardUsesN = gameState.playerUsesThisTurn[campKeyNeutral] || 0;
    const goldN = gameState.playerGold[campKeyNeutral];

    // Claude 保守抽牌：有足够余钱时才抽（drawCost 对齐最新配置）
    if (goldN >= drawCost && handN.length < 3
        && gameState.playerDrawsThisTurn[campKeyNeutral] < 1
        && (gameState.cardDrawPile.length > 0 || gameState.cardDiscardPile.length > 0)) {
        actions.push({ type: 'drawCard' });
    }

    for (const cardId of handN) {
        if (cardUsesN >= 2) break;
        if (cardId === 'commanderDeploy') continue;

        if (cardId === 'heal') {
            const wounded = allUnitsN
                .filter(u => u.hp < u.maxHp * 0.4)
                .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
            if (wounded.length > 0) {
                actions.push({ type: 'tacticalCard', cardId: 'heal', targetId: wounded[0].id });
                cardUsesN++;
            }
        } else if (cardId === 'lightning') {
            let best = null, bestS = 0;
            const rainBonus = weather === 'rain' ? 1.5 : 1.0;
            for (const tile of gameState.tiles) {
                const t = tile.unit;
                if (!t || t.camp === CAMP.neutral) continue;
                let s = (t.hp * 0.5 + t.config.attack) * rainBonus;
                if (t.commander) s += 80;
                if (tile.isCity && t.camp !== CAMP.neutral) s += 60;
                if (t.morale >= 3) s += 40;         // 打断高昂士气
                if (tile.terrain === 'mountain') s += 30;
                if (s > bestS) { bestS = s; best = t; }
            }
            if (bestS >= 60) {
                actions.push({ type: 'tacticalCard', cardId: 'lightning', targetId: best.id });
                cardUsesN++;
            }
        } else if (cardId === 'imprison') {
            let best = null, bestS = 0;
            for (const tile of gameState.tiles) {
                const t = tile.unit;
                if (!t || t.camp === CAMP.neutral) continue;
                let s = t.config.attack * 2 + t.hp * 0.3;
                if (t.commander) s += 60;
                if (getCommanderThreat(t.commander) >= 70) s += 50; // 禁锢高威胁指挥官
                if (t.morale >= 3) s += 40;
                if (s > bestS) { bestS = s; best = t; }
            }
            if (bestS >= 30) {
                actions.push({ type: 'tacticalCard', cardId: 'imprison', targetId: best.id });
                cardUsesN++;
            }
        } else if (cardId === 'shield') {
            // 护盾给残血指挥官或高价值单位
            let best = null, bestS = 0;
            for (const u of allUnitsN) {
                let s = u.config.attack + u.hp * 0.2;
                if (u.commander) s += 60;
                if (u.hp < u.maxHp * 0.4) s += 40; // 残血需要保护
                if (isOnMyCity(u.tile)) s += 30;    // 守城单位
                if (s > bestS) { bestS = s; best = u; }
            }
            if (bestS >= 40) {
                actions.push({ type: 'tacticalCard', cardId: 'shield', targetId: best.id });
                cardUsesN++;
            }
        } else if (cardId === 'airstrike') {
            // 空袭：优先打击敌城（瘫痪经济），其次高密度敌军
            let best = null, bestS = 0;
            for (const tile of gameState.tiles) {
                if (tile.camp === CAMP.neutral) continue;
                if (!tile.unit && !tile.isCity) continue;
                let s = 0;
                if (tile.isCity && tile.camp !== CAMP.neutral) s += 200;
                if (tile.unit && tile.unit.commander) s += 80;
                let nearbyCount = 0;
                for (const [dq, dr] of HEX_NEIGHBORS) {
                    const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                    if (nb && nb.unit && nb.unit.camp !== CAMP.neutral) nearbyCount++;
                }
                s += nearbyCount * 40;
                if (s > bestS) { bestS = s; best = tile; }
            }
            if (bestS >= 100) {
                actions.push({ type: 'tacticalCard', cardId: 'airstrike', targetId: best.id });
                cardUsesN++;
            }
        } else if (cardId === 'landmine') {
            // 在城市空位或要道部署
            let best = null, bestS = 0;
            // 优先在空城中部署（敌人可能来占）
            const emptyCities = gameState.tiles.filter(t =>
                t.isCity && isMyTurf(t) && !t.unit && !t._minePlanted
            );
            for (const city of emptyCities) {
                const threat = countAdjacentEnemies(city);
                if (threat > 0) { best = city; bestS = threat * 50; break; }
            }
            if (!best) {
                // 在通往城市的要道上部署
                const myCityTiles = gameState.tiles.filter(t => t.isCity && isMyTurf(t));
                for (const t of gameState.tiles) {
                    if (t.unit || t.isCity || t._minePlanted) continue;
                    if (t.camp !== CAMP.neutral) continue;
                    let s = 0;
                    for (const city of myCityTiles) {
                        const d = hexDistance(t, city);
                        if (d <= 2) s += 30 - d * 5;
                    }
                    if (s > bestS) { bestS = s; best = t; }
                }
            }
            if (bestS >= 15) {
                actions.push({ type: 'tacticalCard', cardId: 'landmine', targetId: best.id });
                cardUsesN++;
            }
        } else if (cardId === 'forceMarch') {
            // 给残血守城步兵强行军撤退
            const retreatCandidates = allUnitsN.filter(u =>
                !u.canAct && u.hp < u.maxHp * 0.4 && isOnMyCity(u.tile)
            );
            if (retreatCandidates.length > 0) {
                retreatCandidates.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
                actions.push({ type: 'tacticalCard', cardId: 'forceMarch', targetId: retreatCandidates[0].id });
                cardUsesN++;
            }
        } else if (cardId === 'scout') {
            // 迷雾模式：探索敌军密集区或未探索区域
            if (gameState.skirmishFog) {
                let best = null, bestS = 0;
                // 探索已知敌军最密集的未知区域
                for (const tile of gameState.tiles) {
                    if (isTileVisible(tile, CAMP.neutral, gameState)) continue;
                    let s = 0;
                    // 估算附近可能存在的敌军
                    for (const knownEnemy of allEnemyTiles) {
                        const d = hexDistance(tile, knownEnemy);
                        if (d <= 3) s += 30 - d * 8;
                    }
                    if (s > bestS) { bestS = s; best = tile; }
                }
                if (best && bestS >= 10) {
                    actions.push({ type: 'tacticalCard', cardId: 'scout', targetId: best.id });
                    cardUsesN++;
                }
            }
        }
    }

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
            if (adv >= 1.25) score += 35;
            else if (adv <= 0.75) {
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
            processed.add(unit.id);
        }
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
                const distScore = 1 - hexDistance(tile, nearestEnemy) / maxDist;
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
                const exposurePenalty = enemiesAdj * 0.1;

                const score = distScore * 0.35 + defScore * 0.2 + cityGrav * 0.25 + atkPotential - exposurePenalty;
                if (score > bestScore) { bestScore = score; bestTile = tile; }
            }
        }

        if (bestTile && !(bestTile.q === unit.tile.q && bestTile.r === unit.tile.r)) {
            actions.push({ type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r });
            processed.add(unit.id);
        }
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
        const types = isEmergency ? ['infantry'] : recruitPriority;
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
