// Claude — 防御型 AI
// 核心原则：不越行政区边界，只在敌人入侵领地时反击，守城为最高优先

export const meta = {
    name: 'Claude',
    description: '防御型AI，固守行政区，不越界侵略，只在敌人进入领地时反击'
};

const MY_DISTRICTS = new Set([3, 4, 5]);

export function planActions(gameState, helpers) {
    const { getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP, UNIT_CONFIG } = helpers;

    function isMyTurf(tile) {
        return MY_DISTRICTS.has(tile.districtId) && tile.camp === CAMP.neutral;
    }

    function isOnMyCity(tile) {
        return tile.isCity && isMyTurf(tile);
    }
    const tileMap = gameState.tileMap;
    const actions = [];
    const processed = new Set();

    function isAdjacentToMyCity(tile) {
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && nb.isCity && isMyTurf(nb)) return true;
        }
        return false;
    }

    function countAdjacentAllies(tile) {
        let c = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && nb.unit && nb.unit.camp === tile.camp) c++;
        }
        return c;
    }

    // ── 收集可行动的中立单位，按炮→骑→步排序 ──
    const units = gameState.tiles
        .filter(t => t.unit && t.unit.camp === CAMP.neutral && t.unit.canAct && !t.unit.isNewRecruit)
        .map(t => t.unit)
        .sort((a, b) => {
            const order = { archer: 0, cavalry: 1, infantry: 2 };
            return order[a.type] - order[b.type];
        });

    // ── 第一轮：攻击入侵者 ──
    for (const unit of units) {
        if (processed.has(unit.id)) continue;
        const atkTiles = getAttackableTiles(unit);
        // 只攻击已进入己方领地的敌人
        const inTurf = atkTiles.filter(t => isMyTurf(t));

        if (inTurf.length === 0) continue;

        // 守城单位不得擅自离城（近战击杀后会前压，导致城市放空）
        if (isOnMyCity(unit.tile) && unit.type !== 'archer') {
            let hasDefender = false;
            for (const [dq, dr] of HEX_NEIGHBORS) {
                const nb = tileMap.get(`${unit.tile.q + dq},${unit.tile.r + dr}`);
                if (nb && nb.unit && nb.unit.camp === CAMP.neutral && nb.unit.id !== unit.id) {
                    hasDefender = true;
                    break;
                }
            }
            if (!hasDefender) continue;
        }

        let bestTile = null;
        let bestScore = -1;
        for (const tile of inTurf) {
            const target = tile.unit;
            let score = 0;
            if (isOnMyCity(tile)) score += 100;
            if (isAdjacentToMyCity(tile)) score += 50;
            score += (1 - target.hp / target.maxHp) * 30;
            if (countAdjacentAllies(tile) > 0) score += 15;
            if (target.type === 'cavalry') score += 10;
            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }
        if (bestTile) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: bestTile.unit.id });
            processed.add(unit.id);
        }
    }

    // ── 第二轮：境内移动 ──
    for (const unit of units) {
        if (processed.has(unit.id)) continue;
        const movTiles = getMovableTiles(unit);
        // 只在自己行政区的地块上移动
        const inTurf = movTiles.filter(t => isMyTurf(t));
        if (inTurf.length === 0) continue;

        // 找最近的境内敌人
        const enemyUnits = gameState.tiles.filter(t =>
            t.unit && t.unit.camp !== CAMP.neutral && isMyTurf(t)
        );
        let bestTile = null;
        if (enemyUnits.length > 0) {
            // 向最近境内敌人移动
            const nearestEnemy = enemyUnits.reduce((best, t) =>
                hexDistance(unit.tile, t) < hexDistance(unit.tile, best) ? t : best
            , enemyUnits[0]);

            // 打分可达地块
            const maxDist = Math.max(...inTurf.map(t => hexDistance(t, nearestEnemy)), 1);
            let bestScore = -1;
            for (const tile of inTurf) {
                const distScore = 1 - hexDistance(tile, nearestEnemy) / maxDist;
                const defenseScore = tile.terrain === 'forest' ? 0.15 : tile.terrain === 'mountain' ? 0.25 : 0;
                const cityBonus = isAdjacentToMyCity(tile) ? 0.25 : 0;
                const score = distScore * 0.5 + defenseScore * 0.25 + cityBonus;
                if (score > bestScore) { bestScore = score; bestTile = tile; }
            }
        } else {
            // 无敌军时向最近己方城市靠拢
            const myCities = gameState.tiles.filter(t => t.isCity && isMyTurf(t));
            if (myCities.length > 0) {
                const nearestCity = myCities.reduce((best, t) =>
                    hexDistance(unit.tile, t) < hexDistance(unit.tile, best) ? t : best
                , myCities[0]);
                bestTile = inTurf.reduce((best, t) =>
                    hexDistance(t, nearestCity) < hexDistance(best, nearestCity) ? t : best
                , inTurf[0]);
            } else {
                bestTile = inTurf[0];
            }
        }
        if (bestTile) {
            actions.push({ type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r });
            processed.add(unit.id);
        }
    }

    // ── 招募（限 1 次/回合，优先危城）──
    const gold = gameState.playerGold.neutral;
    const emptyCities = gameState.tiles.filter(t =>
        t.isCity && isMyTurf(t) && !t.unit
    );
    if (emptyCities.length > 0 && gold >= 25) {
        // 按威胁度排序：邻敌 > 区内有敌 > 安全
        const scored = emptyCities.map(city => {
            let score = 0;
            for (const [dq, dr] of HEX_NEIGHBORS) {
                const nb = tileMap.get(`${city.q + dq},${city.r + dr}`);
                if (nb && nb.unit && nb.unit.camp !== CAMP.neutral) {
                    score += 50;
                }
            }
            score += gameState.tiles.filter(t =>
                t.unit && t.unit.camp !== CAMP.neutral && t.districtId === city.districtId
            ).length * 15;
            return { city, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const bestCity = scored[0].city;

        const priority = ['infantry', 'archer', 'cavalry'];
        for (const type of priority) {
            if (gold >= UNIT_CONFIG[type].cost) {
                actions.push({ type: 'recruit', unitType: type, tileQ: bestCity.q, tileR: bestCity.r });
                break;
            }
        }
    }

    return actions;
}
