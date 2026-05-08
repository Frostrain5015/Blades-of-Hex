// Claude — 防御型 AI v2
// 核心原则：保守反击、死守城市、优先击杀
// v2 升级：孤军奋战、城防固守、斩杀优先、残血自保、顺克打击、战术站位

export const meta = {
    name: 'Claude',
    description: '防御型AI，固守行政区，不越界侵略，优先击杀与城防'
};

const MY_DISTRICTS = new Set([3, 4, 5]);

// ── 克制系数（本地副本，避免频繁属性访问）──
const COUNTER = {
    infantry: { archer: 0.75, cavalry: 1.25, infantry: 1 },
    archer:   { cavalry: 0.75, infantry: 1.25, archer: 1 },
    cavalry:  { infantry: 0.75, archer: 1.25, cavalry: 1 }
};

const TERRAIN_DEF = { plains: 0, forest: 0.10, mountain: 0.20 };

export function planActions(gameState, helpers) {
    const { getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP, UNIT_CONFIG } = helpers;
    const tileMap = gameState.tileMap;
    const actions = [];
    const processed = new Set();
    const emergencySwapCities = new Set(); // 需要紧急招募步兵接防的城市

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

    // 简化伤害预估：用于相对比较，无需完美精确
    function estimateDamage(attacker, defender) {
        const coeff = (COUNTER[attacker.type] && COUNTER[attacker.type][defender.type]) || 1;
        const tDef = TERRAIN_DEF[defender.tile.terrain] || 0;
        const cityDef = (defender.type === 'infantry' && defender.tile.isCity) ? 0.20 : 0;
        const unitDef = defender.config.defense || 0;
        const dmgBonus = coeff - 1 - tDef - cityDef - unitDef;
        return attacker.getEffectiveAttack() * Math.max(0.1, 1 + dmgBonus);
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
        // 远程攻击者不受近战反击（敌方非archer且距离>1时无法反击）
        if (attacker.type === 'archer' && hexDistance(attacker.tile, defender.tile) > 1 && defender.type !== 'archer') {
            return false;
        }
        const counterDmg = estimateDamage(defender, attacker) * 0.5;
        return counterDmg >= attacker.hp;
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
    // 第一轮：攻击 — 优先击杀、顺克、保护城市
    // ═══════════════════════════════════════════

    for (const unit of units) {
        if (processed.has(unit.id)) continue;

        // 急换防候选 → 跳过攻击，留给移动轮执行换防（攻击会消耗行动权导致无法移动）
        if (isOnMyCity(unit.tile) && unit.type !== 'archer') {
            const adjAllies = countAdjacentAllies(unit.tile, unit.id);
            if (adjAllies === 0) {
                const hpRatio = unit.hp / unit.maxHp;
                const threatened = allEnemyTiles.some(e => hexDistance(unit.tile, e) <= 4);
                if (hpRatio < 0.55 && threatened && gold >= 40) {
                    const movTiles = getMovableTiles(unit);
                    const canRetreat = movTiles.some(t => isMyTurf(t) && !t.unit && !t.isCity);
                    if (canRetreat) continue; // 交给移动轮换防
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

            // 斩杀 —— 最高优先级（经验+除敌+士气）
            if (willKill(unit, target)) {
                score += 200;
                if (target.commander) score += 60;   // 斩杀将领额外奖励
                if (target.morale >= 3) score += 30;  // 打断高昂士气
            }

            // 城市防御
            if (isOnMyCity(tile)) score += 150;
            if (isAdjacentToMyCity(tile)) score += 80;

            // 残血收割 —— hp 越低分越高
            const hpRatio = target.hp / target.maxHp;
            score += (1 - hpRatio) * 60;

            // 绝对低血量 —— 一刀的事
            if (target.hp <= 25) score += 50;

            // 顺克加成
            const adv = counterAdvantage(unit.type, target.type);
            if (adv >= 1.25) score += 35;
            else if (adv <= 0.75) score -= 25;

            // 威胁评级：远程 > 高速
            if (target.type === 'archer') score += 15;
            if (target.type === 'cavalry') score += 10;

            // 避免自杀
            if (wouldDieToCounter(unit, target)) score -= 120;

            // 友军协击
            if (countAdjacentAllies(tile, target.id) > 0) score += 15;

            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }

        if (bestTile) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: bestTile.unit.id });
            processed.add(unit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第二轮：移动 — 紧急换防、步兵守城、残血撤退、战术前压
    // ═══════════════════════════════════════════

    for (const unit of units) {
        if (processed.has(unit.id)) continue;

        // ── 城市驻军逻辑 ──
        if (isOnMyCity(unit.tile)) {
            const cityTile = unit.tile;
            const cityThreatened = allEnemyTiles.some(e => hexDistance(cityTile, e) <= 4);
            const hpRatio = unit.hp / unit.maxHp;

            // ① 紧急换防：守军残血 + 城市受威胁 + 有金币 → 移走残血、招募满血步兵
            if (hpRatio < 0.55 && cityThreatened && gold >= 40) {
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
                // 无路可退 → 死守不换
            }

            // ①b 紧急软换防（备用）：金币不足 → 移走残血，调邻近健康单位接替城防
            if (hpRatio < 0.55 && cityThreatened && gold < 40) {
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
                // 无撤退路径或无合适替补 → 死守不换
            }

            // ② 非步兵守安全城市 + 有金币 → 移走让位给步兵长期驻守
            if (unit.type !== 'infantry' && !cityThreatened && gold >= 40) {
                const movTiles = getMovableTiles(unit);
                const inTurf = movTiles.filter(t => isMyTurf(t) && !t.unit && !t.isCity);
                if (inTurf.length > 0) {
                    let bestDest = inTurf[0];
                    let bestDestScore = -Infinity;
                    for (const t of inTurf) {
                        const defScore = t.terrain === 'mountain' ? 0.30 : t.terrain === 'forest' ? 0.20 : 0;
                        const adjCity = isAdjacentToMyCity(t) ? 0.35 : 0;
                        const score = defScore + adjCity;
                        if (score > bestDestScore) { bestDestScore = score; bestDest = t; }
                    }
                    actions.push({ type: 'move', unitId: unit.id, tileQ: bestDest.q, tileR: bestDest.r });
                    processed.add(unit.id);
                    continue;
                }
            }

            // ③ 其他情况（步兵守城 / 无金币换防 / 无路可退）→ 死守不退
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
                    const defScore = tile.terrain === 'mountain' ? 0.30 : tile.terrain === 'forest' ? 0.20 : 0;
                    if (defScore > bestScore) { bestScore = defScore; bestTile = tile; }
                }
            } else {
                const nearestCity = targets.reduce((best, t) =>
                    hexDistance(unit.tile, t) < hexDistance(unit.tile, best) ? t : best
                , targets[0]);
                const maxDist = Math.max(...inTurf.map(t => hexDistance(t, nearestCity)), 1);

                for (const tile of inTurf) {
                    const distScore = 1 - hexDistance(tile, nearestCity) / maxDist;
                    const defScore = tile.terrain === 'mountain' ? 0.25 : tile.terrain === 'forest' ? 0.15 : 0;
                    const onCity = (tile.isCity && isMyTurf(tile)) ? 0.6 : 0;
                    const adjCity = isAdjacentToMyCity(tile) ? 0.25 : 0;
                    const enemiesAdj = countAdjacentEnemies(tile);
                    const safetyPenalty = enemiesAdj * 0.15;
                    const score = distScore * 0.4 + defScore * 0.2 + onCity + adjCity - safetyPenalty;
                    if (score > bestScore) { bestScore = score; bestTile = tile; }
                }
            }
        } else {
            const nearestEnemy = enemiesNearby.reduce((best, t) =>
                hexDistance(unit.tile, t) < hexDistance(unit.tile, best) ? t : best
            , enemiesNearby[0]);

            const maxDist = Math.max(...inTurf.map(t => hexDistance(t, nearestEnemy)), 1);

            for (const tile of inTurf) {
                const distScore = 1 - hexDistance(tile, nearestEnemy) / maxDist;
                const defScore = tile.terrain === 'mountain' ? 0.25 : tile.terrain === 'forest' ? 0.15 : 0;
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
    // 第三轮：招募 — 紧急接防优先、步兵守城、反制兵种
    // ═══════════════════════════════════════════

    const maxRecruits = gold >= 80 ? 2 : 1;
    let recruitCount = 0;

    const emptyCities = gameState.tiles.filter(t =>
        t.isCity && isMyTurf(t) && !t.unit
    );

    if (gold < 40 || (emptyCities.length === 0 && emergencySwapCities.size === 0)) {
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

    // 招募优先级：步兵始终第一（契合城市驻守+每回合回血特性）
    let recruitPriority;
    if (dominantType && dominantType[1] > 0) {
        if (dominantType[0] === 'cavalry')      recruitPriority = ['infantry', 'archer', 'cavalry'];
        else if (dominantType[0] === 'archer')  recruitPriority = ['infantry', 'cavalry', 'archer'];
        else                                    recruitPriority = ['infantry', 'archer', 'cavalry'];
    } else {
        recruitPriority = ['infantry', 'archer', 'cavalry'];
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

    // 紧急换防城市绝对优先（从 key 解析 tile，此时城市可能仍被残血单位占据）
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
        // 紧急换防 → 强制步兵；普通招募 → 按优先级
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
