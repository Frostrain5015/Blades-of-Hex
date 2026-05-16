// Grok — 进攻型 AI v4
// 核心原则：先夺中立跳板 → 再全线推进破敌城 → 合围主城
// v4 升级：将领特化策略——根据所选将领技能调整进攻/移动/招募决策
//   · 百夫长 → 优先斩杀连锁、骑兵承载
//   · 狂战士 → 首动激活技能、全力冲锋
//   · 吸血鬼 → 高攻单位回血续航、激进换血
//   · 堕天使 → 黑白双形态切换、士气管控
//   · 铁卫   → 步兵守城坦克、保护友军
//   · 停滞者 → 防守牵制、阻断敌行军
//   · 谋士   → 远程降士气、感化招降
//   · 尚书   → 驻扎产金、经济碾压

export const meta = {
    name: 'Grok',
    description: '进攻型AI v4，将领特化策略——部署→破城→合围，每个将领独有打法'
};

const COMMANDER_PREFERENCE = ['vampire', 'paladin', 'advisor', 'berserker', 'ironGuard', 'minister', 'centurion', 'magician', 'fallenAngel', 'priest', 'staller'];

// 各将领打法偏好权重（用于攻击/移动/招募决策修饰）
const COMMANDER_STRATEGY = {
    centurion:    { aggression: 1.4, carrierPref: ['cavalry', 'infantry', 'archer'], pushWeight: 1.3, killBonus: 1.5, recruitPref: ['cavalry', 'archer', 'infantry'] },
    berserker:    { aggression: 1.5, carrierPref: ['cavalry', 'infantry', 'archer'], pushWeight: 1.4, killBonus: 1.3, recruitPref: ['cavalry', 'infantry', 'archer'], useActiveSkill: true },
    vampire:      { aggression: 1.3, carrierPref: ['cavalry', 'archer', 'infantry'], pushWeight: 1.2, killBonus: 1.2, recruitPref: ['cavalry', 'archer', 'infantry'] },
    fallenAngel:  { aggression: 1.1, carrierPref: ['cavalry', 'archer', 'infantry'], pushWeight: 1.1, killBonus: 1.1, recruitPref: ['cavalry', 'archer', 'infantry'] },
    ironGuard:    { aggression: 0.7, carrierPref: ['infantry', 'cavalry', 'archer'], pushWeight: 0.6, killBonus: 0.8, recruitPref: ['infantry', 'archer', 'cavalry'], holdCity: true },
    staller:      { aggression: 0.6, carrierPref: ['infantry', 'archer', 'cavalry'], pushWeight: 0.5, killBonus: 0.7, recruitPref: ['infantry', 'archer', 'cavalry'], zoneControl: true },
    advisor:      { aggression: 1.0, carrierPref: ['archer', 'cavalry', 'infantry'], pushWeight: 0.9, killBonus: 1.0, recruitPref: ['archer', 'cavalry', 'infantry'], preferConvert: true },
    minister:     { aggression: 0.8, carrierPref: ['infantry', 'archer', 'cavalry'], pushWeight: 0.7, killBonus: 0.9, recruitPref: ['infantry', 'cavalry', 'archer'], economyFirst: true },
    magician:     { aggression: 1.2, carrierPref: ['cavalry', 'infantry', 'archer'], pushWeight: 1.1, killBonus: 1.4, recruitPref: ['cavalry', 'infantry', 'archer'], preferCounterKill: true },
    paladin:      { aggression: 1.3, carrierPref: ['cavalry', 'infantry', 'archer'], pushWeight: 1.2, killBonus: 1.2, recruitPref: ['cavalry', 'infantry', 'archer'], useActiveSkill: true },
    priest:       { aggression: 0.6, carrierPref: ['infantry', 'archer', 'cavalry'], pushWeight: 0.5, killBonus: 0.6, recruitPref: ['infantry', 'archer', 'cavalry'], holdCity: true, useActiveSkill: true }
};

const COUNTER = {
    infantry: { archer: 0.75, cavalry: 1.25, infantry: 1 },
    archer:   { cavalry: 0.75, infantry: 1.25, archer: 1 },
    cavalry:  { infantry: 0.75, archer: 1.25, cavalry: 1 }
};

const TERRAIN_DEF = { plains: 0, forest: 0.10, mountain: 0.10 };

export function selectCommander(pool) {
    for (const pref of COMMANDER_PREFERENCE) {
        if (pool.includes(pref)) return pref;
    }
    return pool[0];
}

export function planActions(gameState, helpers, myCamp) {
    const { getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP, UNIT_CONFIG } = helpers;
    const tileMap = gameState.tileMap;
    const actions = [];
    const processed = new Set();

    const enemyCamp = myCamp === CAMP.player1 ? CAMP.player2 : CAMP.player1;
    const enemyCapitalDistrict = enemyCamp === CAMP.player1 ? 1 : 2;
    const myCapitalDistrict = myCamp === CAMP.player1 ? 1 : 2;

    // ═══════════════════════════════════════════
    // 辅助函数
    // ═══════════════════════════════════════════

    function isOwnCity(tile) { return tile.isCity && tile.camp === myCamp; }
    function isEnemyCity(tile) { return tile.isCity && tile.camp === enemyCamp; }
    function isNeutralCity(tile) { return tile.isCity && tile.camp === CAMP.neutral; }

    function countAdjacentAllies(tile, excludeId) {
        let c = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && nb.unit && nb.unit.camp === myCamp && nb.unit.id !== excludeId) c++;
        }
        return c;
    }

    function countAdjacentEnemies(tile, targetCamp) {
        let c = 0;
        for (const [dq, dr] of HEX_NEIGHBORS) {
            const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
            if (nb && nb.unit && nb.unit.camp === targetCamp) c++;
        }
        return c;
    }

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

    function wouldDieToCounter(attacker, defender) {
        if (attacker.type === 'archer' && hexDistance(attacker.tile, defender.tile) > 1 && defender.type !== 'archer') {
            return false;
        }
        const counterDmg = estimateDamage(defender, attacker) * 0.5;
        return counterDmg >= attacker.hp;
    }

    // 城市防御力评估：周围 4 格内守军总战力
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

    // ═══════════════════════════════════════════
    // 收集战局数据
    // ═══════════════════════════════════════════

    const allUnits = gameState.tiles
        .filter(t => t.unit && t.unit.camp === myCamp && t.unit.canAct && !t.unit.isNewRecruit)
        .map(t => t.unit);

    // 初始排序：先按兵种（炮>骑>步），primaryObjective 确定后再按距离重排
    const units = [...allUnits].sort((a, b) => {
        const order = { archer: 0, cavalry: 1, infantry: 2 };
        return order[a.type] - order[b.type];
    });

    const myCities = gameState.tiles.filter(t => t.isCity && t.camp === myCamp);
    const enemyCities = gameState.tiles.filter(t => t.isCity && t.camp === enemyCamp);
    const neutralCities = gameState.tiles.filter(t => t.isCity && t.camp === CAMP.neutral);
    const allEnemyUnits = gameState.tiles.filter(t => t.unit && t.unit.camp === enemyCamp);
    const campKey = myCamp === CAMP.player1 ? 'player1' : 'player2';
    let gold = gameState.playerGold[campKey];

    // 中立城区编号（不属于红蓝主城的城区都是中立区）
    const NEUTRAL_DISTRICTS = new Set([3, 4, 5]);

    // 是否已拥有中立城（判断进入阶段1还是阶段2）
    const ownsNeutralCity = myCities.some(c => NEUTRAL_DISTRICTS.has(c.districtId));

    // 敌方占据的中立城（防守薄弱，优先夺回）
    const enemyHeldNeutralCities = enemyCities.filter(c => NEUTRAL_DISTRICTS.has(c.districtId));

    // ═══════════════════════════════════════════
    // 战略阶段判定 + 选定主攻目标
    // ═══════════════════════════════════════════

    let primaryObjective = null;

    if (!ownsNeutralCity) {
        // ══ 阶段 1：夺取一个中立城作为跳板 ══
        // 优先 1：敌方占据的中立城（防守薄弱，夺回速度快）
        // 优先 2：中立 AI 占据的中立城（选最近 + 最弱的）

        let bestScore = Infinity;

        // 先评估敌方占据的中立城
        for (const ec of enemyHeldNeutralCities) {
            const defense = evaluateCityDefense(ec, enemyCamp);
            const avgDist = avgDistanceFromMyForces(ec);
            // 敌方占据的中立城权重更高（防守薄弱，速战速决）
            const score = avgDist * 1.5 + defense * 0.008;
            if (score < bestScore) {
                bestScore = score;
                primaryObjective = ec;
            }
        }

        // 如果没有敌方占据的中立城，选 Claude 的中立城（随机性：top 2 中随机选）
        if (!primaryObjective && neutralCities.length > 0) {
            const candidates = [];
            for (const nc of neutralCities) {
                const defense = evaluateCityDefense(nc, CAMP.neutral);
                const avgDist = avgDistanceFromMyForces(nc);
                const score = avgDist * 2 + defense * 0.01;
                candidates.push({ city: nc, score });
            }
            candidates.sort((a, b) => a.score - b.score);
            const topN = Math.min(2, candidates.length);
            primaryObjective = candidates[Math.floor(Math.random() * topN)].city;
        }

        // 如果没有任何中立城可夺（极端情况），转为阶段2
        if (!primaryObjective && enemyCities.length > 0) {
            // fall through to phase 2 logic below
        }
    }

    if (!primaryObjective && enemyCities.length > 0) {
        // ══ 阶段 2：全线推进，找防守最薄弱的敌城突破 ══
        // 策略：优先打击非主城的敌城（外城），最后合围敌主城
        // 但如果敌主城防守空虚，直接偷主城

        let bestScore = Infinity;

        // 分类敌城：主城 vs 外城
        const enemyCapital = enemyCities.find(c => c.districtId === enemyCapitalDistrict);
        const enemyOuterCities = enemyCities.filter(c => c.districtId !== enemyCapitalDistrict);

        // 先评估外城（优先各个击破）
        for (const ec of enemyOuterCities) {
            const defense = evaluateCityDefense(ec, enemyCamp);
            const avgDist = avgDistanceFromMyForces(ec);
            const score = avgDist * 1.5 + defense * 0.015;
            if (score < bestScore) {
                bestScore = score;
                primaryObjective = ec;
            }
        }

        // 如果外城已全灭或主城防守极弱，攻打主城
        if (enemyCapital) {
            const capDefense = evaluateCityDefense(enemyCapital, enemyCamp);
            const capAvgDist = avgDistanceFromMyForces(enemyCapital);
            // 如果主城防守比最弱外城还弱30%以上，直接打主城
            const outerBest = enemyOuterCities.length > 0
                ? Math.min(...enemyOuterCities.map(c => evaluateCityDefense(c, enemyCamp) * 0.015 + avgDistanceFromMyForces(c) * 1.5))
                : Infinity;
            const capScore = capAvgDist * 1.5 + capDefense * 0.015;

            if (enemyOuterCities.length === 0 || capScore < outerBest * 0.7) {
                if (capScore < bestScore) {
                    bestScore = capScore;
                    primaryObjective = enemyCapital;
                }
            }
        }
    }

    // 确定主攻目标后，按离目标由近到远重新排序全军
    // 近者先动 → 清障后远方单位不会被己方挡住去路
    if (primaryObjective) {
        const typeOrder = { archer: 0, cavalry: 1, infantry: 2 };
        units.sort((a, b) => {
            const da = hexDistance(a.tile, primaryObjective);
            const db = hexDistance(b.tile, primaryObjective);
            if (da !== db) return da - db;
            return typeOrder[a.type] - typeOrder[b.type];
        });
    }

    // ═══════════════════════════════════════════
    // 第零轮：对策卡 — 抽牌 + 使用
    // ═══════════════════════════════════════════

    const isDeployed = myCamp === CAMP.player1 ? gameState.commanderP1Deployed : gameState.commanderP2Deployed;
    const hand = gameState.playerHands[campKey] || [];
    let cardUses = gameState.playerUsesThisTurn[campKey] || 0;
    let drawsUsed = gameState.playerDrawsThisTurn[campKey] || 0;

    // 抽牌（Grok 激进，有金就抽）
    if (gold >= 5 && drawsUsed < 1 && hand.length < 3
        && (gameState.cardDrawPile.length > 0 || gameState.cardDiscardPile.length > 0)) {
        actions.push({ type: 'drawCard' });
        gold -= 5; drawsUsed++;
    }

    // 部署将领（via hand card）
    if (!isDeployed && hand.includes('commanderDeploy')) {
        const myCmdKey = myCamp === CAMP.player1 ? gameState.commanderP1 : gameState.commanderP2;
        const cmdStrat = COMMANDER_STRATEGY[myCmdKey] || {};
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
                if (unit.commander) score = -Infinity;
                if (score > bestCarrierScore) { bestCarrierScore = score; bestCarrier = unit; }
            }
            if (bestCarrier) {
                actions.push({ type: 'tacticalCard', cardId: 'commanderDeploy', targetId: bestCarrier.id });
                processed.add(bestCarrier.id); cardUses++;
            }
        }
    }

    // 遍历手牌使用（最多 2 张）
    for (const cardId of hand) {
        if (cardUses >= 2) break;
        if (cardId === 'commanderDeploy') continue;

        if (cardId === 'lightning') {
            let bestTarget = null, bestScore = 0;
            for (const tile of gameState.tiles) {
                const target = tile.unit;
                if (!target || target.camp === myCamp) continue;
                if (target.camp === CAMP.neutral && ownsNeutralCity) continue;
                let score = 0;
                if (target.commander) score += 100;
                if (target.hp <= 25) score += 100;
                if (primaryObjective && target.tile === primaryObjective) score += 120;
                if (target.tile.isCity && target.camp === enemyCamp) score += 50;
                if (target.hp <= 50) score += 70;
                if (target.morale >= 3) score += 40;
                if (target.type === 'archer') score += 20;
                if (!ownsNeutralCity && target.camp === CAMP.neutral) score += 90;
                if (score > bestScore) { bestScore = score; bestTarget = target; }
            }
            if (bestScore >= 40) {
                actions.push({ type: 'tacticalCard', cardId: 'lightning', targetId: bestTarget.id });
                cardUses++;
            }
        } else if (cardId === 'heal') {
            const healable = allUnits
                .filter(u => u.hp < u.maxHp * 0.4)
                .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
            if (healable.length > 0) {
                actions.push({ type: 'tacticalCard', cardId: 'heal', targetId: healable[0].id });
                cardUses++;
            }
        } else if (cardId === 'imprison') {
            // 禁锢最强的敌方单位
            let bestTarget = null, bestScore = 0;
            for (const tile of gameState.tiles) {
                const target = tile.unit;
                if (!target || target.camp === myCamp) continue;
                let score = target.hp + target.config.attack * 2;
                if (target.commander) score += 80;
                if (primaryObjective && target.tile === primaryObjective) score += 100;
                if (score > bestScore) { bestScore = score; bestTarget = target; }
            }
            if (bestScore >= 40) {
                actions.push({ type: 'tacticalCard', cardId: 'imprison', targetId: bestTarget.id });
                cardUses++;
            }
        } else if (cardId === 'mgNest') {
            // 在主攻目标附近的己方空地部署机枪堡
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
            // target strongest enemy city near primary objective
            const enemyCities = gameState.tiles.filter(t =>
                t.isCity && t.camp !== myCamp);
            if (enemyCities.length > 0) {
                enemyCities.sort((a, b) => {
                    const da = primaryObjective ? hexDistance(a, primaryObjective) : 50;
                    const db = primaryObjective ? hexDistance(b, primaryObjective) : 50;
                    return da - db;
                });
                actions.push({ type: 'tacticalCard', cardId: 'airstrike', targetId: enemyCities[0].id });
                cardUses++;
            }
        } else if (cardId === 'shield') {
            // shield the unit with highest attack stat or commander
            let best = null, bestScore = 0;
            for (const u of allUnits) {
                let s = u.config.attack * 2 + u.hp * 0.3;
                if (u.commander) s += 50;
                if (s > bestScore) { bestScore = s; best = u; }
            }
            if (bestScore >= 40) {
                actions.push({ type: 'tacticalCard', cardId: 'shield', targetId: best.id });
                cardUses++;
            }
        } else if (cardId === 'landmine') {
            // place mine on empty friendly tile near primary objective or own city
            if (primaryObjective) {
                const mineSpots = gameState.tiles.filter(t =>
                    !t.unit && !t.isCity && t.camp === myCamp
                    && hexDistance(t, primaryObjective) <= 4);
                if (mineSpots.length > 0) {
                    mineSpots.sort((a, b) => hexDistance(a, primaryObjective) - hexDistance(b, primaryObjective));
                    actions.push({ type: 'tacticalCard', cardId: 'landmine', targetId: mineSpots[0].id });
                    cardUses++;
                }
            }
        } else if (cardId === 'forceMarch') {
            // use on a unit that already acted, to give it a second action
            const exhausted = allUnits.filter(u => !u.canAct && u.commander);
            if (exhausted.length > 0) {
                exhausted.sort((a, b) => (b.config.attack || 0) - (a.config.attack || 0));
                actions.push({ type: 'tacticalCard', cardId: 'forceMarch', targetId: exhausted[0].id });
                cardUses++;
            }
        }
    }

    // ═══════════════════════════════════════════
    // 第零·五轮：狂战士激活主动技能
    // ═══════════════════════════════════════════

    const myCmdKey2 = myCamp === CAMP.player1 ? gameState.commanderP1 : gameState.commanderP2;
    const cmdStrat2 = COMMANDER_STRATEGY[myCmdKey2] || {};
    if (cmdStrat2.useActiveSkill) {
        // 狂战士：激活狂暴技能（为后续攻击做准备）
        const berserkerUnit = allUnits.find(u => u.commander === 'berserker' && u.canAct);
        if (berserkerUnit) {
            const cdKey = myCamp === CAMP.player1 ? 'activeSkillP1CD' : 'activeSkillP2CD';
            const currentCD = gameState[cdKey] || 0;
            if (currentCD <= 0) {
                actions.push({ type: 'activateSkill', unitId: berserkerUnit.id });
            }
        }
    }

    // ═══════════════════════════════════════════
    // 第一轮：攻击 — 斩杀 > 破城主攻目标 > 清障 > 残血收割
    // ═══════════════════════════════════════════

    for (const unit of units) {
        if (processed.has(unit.id)) continue;

        const atkTiles = getAttackableTiles(unit);
        // 阶段1：可攻击中立单位；阶段2：只攻击敌人
        let targets = atkTiles.filter(t => {
            if (!t.unit) return false;
            if (t.unit.camp === myCamp) return false;
            if (!ownsNeutralCity) return t.unit.camp !== myCamp; // 阶段1打中立+敌人
            return t.unit.camp === enemyCamp;                    // 阶段2只打敌人
        });

        if (targets.length === 0) continue;

        // 守城近战无友军→避免斩杀导致放空（阶段1主城例外：全力扩张）
        if (isOwnCity(unit.tile) && unit.type !== 'archer') {
            const isCapital = unit.tile.districtId === myCapitalDistrict;
            if (!ownsNeutralCity && isCapital) {
                // 阶段1主城：不限制斩杀，全力出击
            } else {
                const adjAllies = countAdjacentAllies(unit.tile, unit.id);
                if (adjAllies === 0) {
                    const nonLethal = targets.filter(t => !willKill(unit, t.unit));
                    if (nonLethal.length > 0) targets = nonLethal;
                }
            }
        }

        if (targets.length === 0) continue;

        let bestTile = null;
        let bestScore = -Infinity;

        for (const tile of targets) {
            const target = tile.unit;
            let score = 0;

            // 斩杀（百夫长加权）
            if (willKill(unit, target)) {
                score += 200 * (cmdStrat2.killBonus || 1.0);
                if (target.commander) score += 80;
                if (target.morale >= 3) score += 30;
                // 百夫长斩杀可连锁，额外加分
                if (myCmdKey2 === 'centurion') score += 50;
            }

            // 主攻目标上的守军
            if (primaryObjective && tile === primaryObjective) score += 200;

            // 位于敌方/中立城市的守军
            if (tile.isCity && tile.camp !== myCamp) score += 150;

            // 残血收割
            const hpRatio = target.hp / target.maxHp;
            score += (1 - hpRatio) * 70 * (cmdStrat2.aggression || 1.0);
            if (target.hp <= 30) score += 60;

            // 阶段1：积极清除中立单位以加速夺城
            if (!ownsNeutralCity && target.camp === CAMP.neutral) {
                score += 80;
                if (tile.isCity) score += 40; // 优先清除中立城守军
            }

            // 谋士：优先打击已士气低下的目标（感化）
            if (cmdStrat2.preferConvert && target.morale <= 1) score += 120;
            if (cmdStrat2.preferConvert && target.morale === 0) score += 250;

            // 顺克加成
            const adv = counterAdvantage(unit.type, target.type);
            if (adv >= 1.25) score += 40;
            else if (adv <= 0.75) score -= 30 * (cmdStrat2.aggression > 1 ? 0.5 : 1);

            // 威胁评级
            if (target.type === 'archer') score += 20;
            if (target.type === 'cavalry') score += 12;

            // 避免自杀（高侵略将领容忍更高风险）
            if (wouldDieToCounter(unit, target)) score -= 150 * Math.max(0.4, 2 - (cmdStrat2.aggression || 1));

            // 友军协击
            if (countAdjacentAllies(tile, target.id) > 0) score += 20;

            if (score > bestScore) { bestScore = score; bestTile = tile; }
        }

        if (bestTile) {
            actions.push({ type: 'attack', unitId: unit.id, targetId: bestTile.unit.id });
            processed.add(unit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第二轮：移动 — 多城多线全军向主攻目标推进
    // ═══════════════════════════════════════════

    // 每城留 1 步兵守城，其余全部出击
    const cityGarrisonPlanned = new Map();

    for (const unit of units) {
        if (processed.has(unit.id)) continue;

        const movTiles = getMovableTiles(unit);
        const validTiles = movTiles.filter(t => !t.unit);
        if (validTiles.length === 0) continue;

        const hpRatio = unit.hp / unit.maxHp;

        // ── 守城：每城留1步（阶段1主城例外，全力扩张）──
        if (isOwnCity(unit.tile)) {
            const cityKey = `${unit.tile.q},${unit.tile.r}`;
            const isCapital = unit.tile.districtId === myCapitalDistrict;

            if (unit.type === 'infantry' && !cityGarrisonPlanned.has(cityKey)) {
                if (!ownsNeutralCity && isCapital) {
                    // 阶段1主城不留守军，该步兵也出击
                } else {
                    cityGarrisonPlanned.set(cityKey, unit.id);
                    continue;
                }
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
                    const defScore = t.terrain === 'mountain' ? 0.30 : t.terrain === 'forest' ? 0.20 : 0;
                    score += defScore;
                    if (score > bestDestScore) { bestDestScore = score; bestDest = t; }
                }
                actions.push({ type: 'move', unitId: unit.id, tileQ: bestDest.q, tileR: bestDest.r });
                processed.add(unit.id);
                continue;
            }
        }

        // ── 非守城单位：向主攻目标推进 ──
        let bestTile = null;
        let bestScore = -Infinity;

        const enemiesNear = gameState.tiles.filter(t =>
            t.unit && t.unit.camp === enemyCamp && hexDistance(unit.tile, t) <= 5
        ).length;
        const shouldRetreat = hpRatio < 0.20 && enemiesNear === 0;

        if (shouldRetreat) {
            for (const tile of validTiles) {
                let score = 0;
                if (myCities.length > 0) {
                    const nearestOwn = myCities.reduce((b, c) =>
                        hexDistance(tile, c) < hexDistance(tile, b) ? c : b, myCities[0]);
                    score = -hexDistance(tile, nearestOwn) * 5;
                }
                const defScore = tile.terrain === 'mountain' ? 0.30 : tile.terrain === 'forest' ? 0.20 : 0;
                score += defScore;
                if (score > bestScore) { bestScore = score; bestTile = tile; }
            }
        } else if (primaryObjective) {
            const curDist = hexDistance(unit.tile, primaryObjective);

            for (const tile of validTiles) {
                const newDist = hexDistance(tile, primaryObjective);
                // 核心得分：向目标靠近
                const pushW = cmdStrat2.pushWeight || 1.0;
                const advanceScore = (curDist - newDist) / Math.max(curDist, 1) * 5 * pushW;

                // 直接占领空城（中立或敌方空城）
                const captureBonus = (tile.isCity && tile.camp !== myCamp && !tile.unit) ? 3.5 * pushW : 0;

                // 邻接主攻目标
                const siegeReady = newDist <= 1 ? 2.5 * pushW : 0;

                // 邻接任何非我方城市（未来可夺）
                let nearAnyTarget = 0;
                for (const c of gameState.tiles) {
                    if (c.isCity && c.camp !== myCamp && hexDistance(tile, c) <= 1) {
                        nearAnyTarget += 0.6;
                    }
                }

                const defScore = tile.terrain === 'mountain' ? 0.20 : tile.terrain === 'forest' ? 0.12 : 0;

                // 可下回合攻击的敌人
                let atkPotential = 0;
                for (const [dq, dr] of HEX_NEIGHBORS) {
                    const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                    if (nb && nb.unit && nb.unit.camp !== myCamp) atkPotential += 0.3;
                }

                const alliesNearby = countAdjacentAllies(tile, unit.id);
                const rallyBonus = alliesNearby * 0.15;

                const enemiesAdj = countAdjacentEnemies(tile, enemyCamp);
                const exposurePenalty = enemiesAdj * 0.15;

                let safetyPenalty = 0;
                if (hpRatio < 0.35 && alliesNearby === 0 && enemiesAdj >= 2) {
                    safetyPenalty = 2.0;
                }

                const score = advanceScore + captureBonus + siegeReady + nearAnyTarget +
                    defScore + atkPotential + rallyBonus - exposurePenalty - safetyPenalty;

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
                score += countAdjacentEnemies(tile, enemyCamp) * 0.5;
                if (score > bestScore) { bestScore = score; bestTile = tile; }
            }
        }

        if (bestTile && !(bestTile.q === unit.tile.q && bestTile.r === unit.tile.r)) {
            if (primaryObjective) {
                const curDist = hexDistance(unit.tile, primaryObjective);
                const newDist = hexDistance(bestTile, primaryObjective);
                if (newDist > curDist && !shouldRetreat) continue;
            }
            actions.push({ type: 'move', unitId: unit.id, tileQ: bestTile.q, tileR: bestTile.r });
            processed.add(unit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第三轮：招募 — 前线补守军、后方出进攻兵种
    // ═══════════════════════════════════════════

    const maxRecruits = gold >= 16 ? 2 : 1;
    let recruitCount = 0;

    const emptyOwnCities = gameState.tiles.filter(t => t.isCity && t.camp === myCamp && !t.unit);

    if (gold < 8 || emptyOwnCities.length === 0) {
        return actions;
    }

    // 统计敌人兵种分布
    const enemyTypeCounts = { infantry: 0, cavalry: 0, archer: 0 };
    for (const e of allEnemyUnits) {
        if (e.unit && enemyTypeCounts[e.unit.type] !== undefined) enemyTypeCounts[e.unit.type]++;
    }
    const dominantType = Object.entries(enemyTypeCounts).sort((a, b) => b[1] - a[1])[0];

    let recruitPriority;
    if (dominantType && dominantType[1] > 0) {
        if (dominantType[0] === 'cavalry')      recruitPriority = ['infantry', 'archer', 'cavalry'];
        else if (dominantType[0] === 'archer')  recruitPriority = ['cavalry', 'infantry', 'archer'];
        else                                    recruitPriority = ['archer', 'cavalry', 'infantry'];
    } else {
        recruitPriority = cmdStrat2.recruitPref || ['cavalry', 'archer', 'infantry'];
    }

    const scoreCity = (city) => {
        let score = 0;
        if (primaryObjective) {
            score += Math.max(0, 100 - hexDistance(city, primaryObjective) * 8);
        }
        score += countAdjacentEnemies(city, enemyCamp) * 30;
        const otherCities = myCities.filter(c => c !== city);
        if (otherCities.length > 0) {
            const minDist = Math.min(...otherCities.map(c => hexDistance(city, c)));
            if (minDist > 4) score += 40;
        }
        return score;
    };

    emptyOwnCities.sort((a, b) => scoreCity(b) - scoreCity(a));

    for (let i = 0; i < Math.min(maxRecruits, emptyOwnCities.length); i++) {
        if (recruitCount >= maxRecruits) break;
        const city = emptyOwnCities[i];
        // 前线城市（离目标 ≤4 格）→ 步兵守城；后方 → 进攻兵种
        const isFrontline = primaryObjective && hexDistance(city, primaryObjective) <= 4;
        const types = isFrontline ? ['infantry'] : recruitPriority;
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
