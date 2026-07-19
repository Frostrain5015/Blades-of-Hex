// Grok — 进攻型 AI v7 (困难模式优化)
// 核心原则：经济全投兵力 → 少抽牌多招兵 → 全线压制
// v7 升级：战斗模型对齐引擎 + 集火补刀 + 守军补员 + 修复两处崩溃隐患
//   · 克制 ±20%、士气 ±7.5%、反击 0.75×基础、战壕只防近战（对齐 rules/）
//   · 集火账本：多单位合力锁定击杀
//   · 守城步兵血量不足时补员，前线不塌
//   · 修复：上校阵亡后俯冲扫射评分对 null 调用崩溃；占星者/主动技能
//     冷却误读不存在的 gameState.activeSkillP*CD（真实冷却在 unit.activeSkillCD）
//   · 保留 v6：4新将领策略 + 天气感知进攻

export const meta = {
    name: 'Grok',
    description: '进攻型AI v7，引擎级战斗模型·集火补刀·守军补员'
};

const COMMANDER_PREFERENCE = [
    'vampire', 'paladin', 'advisor', 'berserker', 'colonel', 'necromancer',
    'ironGuard', 'minister', 'centurion', 'magician', 'fallenAngel',
    'astrologer', 'diplomat', 'priest', 'staller'
];

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
    priest:       { aggression: 0.6, carrierPref: ['infantry', 'archer', 'cavalry'], pushWeight: 0.5, killBonus: 0.6, recruitPref: ['infantry', 'archer', 'cavalry'], holdCity: true, useActiveSkill: true },
    // ≪≪≪ 新将领策略 ≫≫≫
    astrologer:   { aggression: 0.9, carrierPref: ['infantry', 'cavalry', 'archer'], pushWeight: 0.9, killBonus: 0.9, recruitPref: ['infantry', 'archer', 'cavalry'], weatherControl: true, useActiveSkill: true },
    diplomat:     { aggression: 1.0, carrierPref: ['cavalry', 'infantry', 'archer'], pushWeight: 1.1, killBonus: 0.8, recruitPref: ['cavalry', 'archer', 'infantry'], cardFocus: true, pushIntoEnemy: true },
    necromancer:  { aggression: 1.1, carrierPref: ['infantry', 'cavalry', 'archer'], pushWeight: 1.0, killBonus: 1.2, recruitPref: ['infantry', 'cavalry', 'archer'], soulPlay: true },
    colonel:      { aggression: 1.3, carrierPref: ['cavalry', 'archer', 'infantry'], pushWeight: 1.2, killBonus: 1.3, recruitPref: ['cavalry', 'archer', 'infantry'], airPower: true },
    engineer:     { aggression: 0.55, carrierPref: ['infantry', 'archer', 'cavalry'], pushWeight: 0.45, killBonus: 0.75, recruitPref: ['infantry', 'archer', 'cavalry'], holdCity: true }
};

// 克制系数（对齐 COMBAT_BALANCE.counter：advantageDamage ±0.20）
const COUNTER = {
    infantry: { archer: 0.80, cavalry: 1.20, infantry: 1 },
    archer:   { cavalry: 0.80, infantry: 1.20, archer: 1 },
    cavalry:  { infantry: 0.80, archer: 1.20, cavalry: 1 }
};

// 对齐 TERRAIN_CONFIG（config.js）
const TERRAIN_DEF = { plains: 0, forest: 0.05, mountain: 0.05 };

export function selectCommander(pool) {
    for (const pref of COMMANDER_PREFERENCE) {
        if (pool.includes(pref)) return pref;
    }
    return pool[0];
}

export function planActions(gameState, helpers, myCamp) {
    const { getMovableTiles, getAttackableTiles, hexDistance, HEX_NEIGHBORS, CAMP, UNIT_CONFIG, isHostileFaction, recruitTypesForCity } = helpers;
    const tileMap = gameState.tileMap;
    const actions = [];
    const processed = new Set();

    const weather = gameState.weather || 'clear';

    let enemyKey = (gameState.turnOrder || Object.keys(CAMP)).find(key => {
        const faction = CAMP[key];
        return faction && faction !== myCamp && key !== 'neutral'
            && (!isHostileFaction || isHostileFaction(myCamp, faction));
    });
    // 兜底：若未找到敌对阵营（如外交未初始化），取第一个非自身、非中立阵营
    if (!enemyKey) {
        enemyKey = (gameState.turnOrder || Object.keys(CAMP)).find(key => {
            const faction = CAMP[key];
            return faction && faction !== myCamp && key !== 'neutral';
        });
    }
    const enemyCamp = enemyKey ? CAMP[enemyKey] : null;
    if (!enemyCamp) return actions;
    const enemyCapitalDistrict = gameState.tiles.find(tile => tile.isCity && tile.camp === enemyCamp)?.districtId;
    const myCapitalDistrict = gameState.tiles.find(tile => tile.isCity && tile.camp === myCamp)?.districtId;

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
    function getCityDef(unitType, tile) {
        let def = 0;
        if (unitType === 'infantry' && tile.isCity) {
            def += 0.10;
            if (weather === 'rain') def += 0.10;
        }
        return def;
    }

    // 天气进攻加成
    function getWeatherAtkBonus(unitType) {
        if (weather === 'fog' && unitType === 'cavalry') return 0.20;
        if (weather === 'wind' && unitType === 'archer') return 0.20;
        return 0;
    }

    // 天气防御惩罚
    function getWeatherDefPenalty(unitType) {
        if (weather === 'wind' && unitType === 'infantry') return -0.15;
        return 0;
    }

    function estimateDamage(attacker, defender, tile) {
        const tileObj = tile || defender.tile;
        const coeff = (COUNTER[attacker.type] && COUNTER[attacker.type][defender.type]) || 1;
        const tDef = getEffectiveTerrainDef(tileObj, isRangedAttacker(attacker));
        const cityDef = getCityDef(defender.type, tileObj);
        const unitDef = defender.config.defense || 0;
        const weatherAtk = getWeatherAtkBonus(attacker.type);
        const weatherDef = getWeatherDefPenalty(defender.type);

        // 士气已经进入 getEffectiveAttack，不在AI估伤中重复叠加。
        const offense = 1 + (coeff - 1) + weatherAtk;
        const def = 1 - tDef - cityDef - unitDef - weatherDef;
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

    function wouldDieToCounter(attacker, defender) {
        if (attacker.type === 'archer' && hexDistance(attacker.tile, defender.tile) > 1 && defender.type !== 'archer') {
            return false;
        }
        // 反击伤害期望 ≈ 基础估算 × 0.75(反击基础系数) × ~1.30(反击浮动均值) ≈ 0.98；
        // 承受反击的是进攻方，防御地形按进攻方自己站的格子算
        const counterDmg = estimateDamage(defender, attacker, attacker.tile) * 0.98;
        const coeff = (COUNTER[defender.type] && COUNTER[defender.type][attacker.type]) || 1;
        const magiSave = (attacker.commander === 'magician' && coeff > 1) ? 0.15 : 0;
        return counterDmg * (1 - magiSave) >= attacker.hp + (attacker._shield || 0);
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
    const myCommanderUnit = gameState.tiles.find(tile => tile.unit?.camp === myCamp && tile.unit.commander)?.unit;
    const myCmdKey = myCommanderUnit?.commander || null;
    const cmdStrat = COMMANDER_STRATEGY[myCmdKey] || {};

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
    const campKey = myCamp.id;
    let gold = gameState.playerGold[campKey];

    const NEUTRAL_DISTRICTS = new Set([3, 4, 5]);
    const ownsNeutralCity = myCities.some(c => NEUTRAL_DISTRICTS.has(c.districtId));
    const enemyHeldNeutralCities = enemyCities.filter(c => NEUTRAL_DISTRICTS.has(c.districtId));

    // 占星者天气控制：如果己方有占星者且天气不利，主动放星移
    // （冷却在单位身上：unit.activeSkillCD / activeSkillDur，不存在 gameState.activeSkillP*CD 字段）
    const astrologerUnit = allUnits.find(u => u.commander === 'astrologer' && u.canAct);
    const canForceWeather = astrologerUnit
        && (astrologerUnit.activeSkillCD || 0) <= 0
        && (astrologerUnit.activeSkillDur || 0) <= 0;

    // ═══════════════════════════════════════════
    // 战略阶段判定 + 选定主攻目标
    // ═══════════════════════════════════════════

    let primaryObjective = null;

    if (!ownsNeutralCity) {
        // ══ 阶段 1：夺取一个中立城作为跳板 ══
        let bestScore = Infinity;

        for (const ec of enemyHeldNeutralCities) {
            const defense = evaluateCityDefense(ec, enemyCamp);
            const avgDist = avgDistanceFromMyForces(ec);
            const score = avgDist * 1.5 + defense * 0.008;
            if (score < bestScore) {
                bestScore = score;
                primaryObjective = ec;
            }
        }

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

        if (!primaryObjective && enemyCities.length > 0) {
            // fall through to phase 2
        }
    }

    if (!primaryObjective && enemyCities.length > 0) {
        // ══ 阶段 2：全线推进 ══
        let bestScore = Infinity;
        const enemyCapital = enemyCities.find(c => c.districtId === enemyCapitalDistrict);
        const enemyOuterCities = enemyCities.filter(c => c.districtId !== enemyCapitalDistrict);

        for (const ec of enemyOuterCities) {
            const defense = evaluateCityDefense(ec, enemyCamp);
            const avgDist = avgDistanceFromMyForces(ec);
            const score = avgDist * 1.5 + defense * 0.015;
            if (score < bestScore) {
                bestScore = score;
                primaryObjective = ec;
            }
        }

        if (enemyCapital) {
            const capDefense = evaluateCityDefense(enemyCapital, enemyCamp);
            const capAvgDist = avgDistanceFromMyForces(enemyCapital);
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

    const isDeployed = !!myCommanderUnit;
    const hand = gameState.playerHands[campKey] || [];
    let cardUses = gameState.playerUsesThisTurn[campKey] || 0;
    let drawsUsed = gameState.playerDrawsThisTurn[campKey] || 0;
    const drawCost = helpers.CARD_SYSTEM_CONFIG ? helpers.CARD_SYSTEM_CONFIG.drawCost : 4;
    const maxHandSize = helpers.CARD_SYSTEM_CONFIG ? helpers.CARD_SYSTEM_CONFIG.maxHandSize : 3;
    const colGold = helpers.COLONEL_CARD_GOLD || { diveStrafe: 4, carpetBomb: 5, airlift: 4 };

    // 抽牌（v6: 纵横家多抽牌，其他少抽）
    if (cmdStrat.cardFocus) {
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
    } else {
        // 通用：余钱≥8且手牌空时才抽1张
        if (gold >= 8 && drawsUsed < 1 && hand.length === 0
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

    for (const cardId of hand) {
        if (cardUses >= maxCardUseThisTurn) break;
        if (cardId === 'commanderDeploy') continue;

        if (cardId === 'lightning') {
            let bestTarget = null, bestScore = 0;
            const rainBonus = weather === 'rain' ? 1.5 : 1.0;
            for (const tile of gameState.tiles) {
                const target = tile.unit;
                if (!target || target.camp === myCamp) continue;
                if (target.camp === CAMP.neutral && ownsNeutralCity) continue;
                let score = 0;
                if (target.commander) score += 150 * rainBonus;
                if (target.hp <= 30) score += 120 * rainBonus;
                if (target.hp <= 60) score += 80 * rainBonus;
                if (primaryObjective && target.tile === primaryObjective) score += 150;
                if (target.tile.isCity && target.camp === enemyCamp) score += 70;
                if (target.morale >= 3) score += 50;
                if (target.type === 'archer') score += 30;
                if (!ownsNeutralCity && target.camp === CAMP.neutral) score += 100;
                // 雨天闪电加成已计入
                if (score > bestScore) { bestScore = score; bestTarget = target; }
            }
            if (bestScore >= (weather === 'rain' ? 50 : 80)) {
                actions.push({ type: 'tacticalCard', cardId: 'lightning', targetId: bestTarget.id });
                cardUses++;
            }
        } else if (cardId === 'heal') {
            // 疗愈：优先残血指挥官
            const healable = allUnits
                .filter(u => u._poison || u.hp < u.maxHp * 0.4)
                .sort((a, b) => {
                    const aCmd = a.commander ? 100 : 0;
                    const bCmd = b.commander ? 100 : 0;
                    return (a.hp / a.maxHp - aCmd) - (b.hp / b.maxHp - bCmd);
                });
            if (healable.length > 0) {
                actions.push({ type: 'tacticalCard', cardId: 'heal', targetId: healable[0].id });
                cardUses++;
            }
        } else if (cardId === 'poison') {
            let best = null, bestScore = -Infinity;
            for (const tile of gameState.tiles) {
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
                if (tile.camp === myCamp) continue;
                if (!tile.unit && !tile.isCity) continue;
                let score = 0;
                if (tile.isCity && tile.camp === enemyCamp) score += 200;
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
            // 手动选择目标天气：根据当前最优策略
            // 占星者主动技能会弹出选择界面，AI 无法直接选 → 通过 setWeather 标记
            // 此处先激活，后续由游戏逻辑处理
            actions.push({ type: 'activateSkill', unitId: astrologerUnit.id });
            processed.add(astrologerUnit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第零·六轮：狂战士/圣骑士/牧师 主动技能
    // ═══════════════════════════════════════════

    if (cmdStrat.useActiveSkill) {
        // 冷却/持续都在单位身上（executeAction 也会再校验一次）
        const skillUnit = allUnits.find(u =>
            (u.commander === 'berserker' || u.commander === 'paladin' || u.commander === 'priest')
            && u.canAct
            && (u.activeSkillCD || 0) <= 0
            && (u.activeSkillDur || 0) <= 0);
        if (skillUnit) {
            actions.push({ type: 'activateSkill', unitId: skillUnit.id });
            processed.add(skillUnit.id);
        }
    }

    // ═══════════════════════════════════════════
    // 第零·七轮：禁锢连击
    // ═══════════════════════════════════════════

    if (hand.includes('imprison') && cardUses < maxCardUseThisTurn) {
        for (const unit of units) {
            if (processed.has(unit.id)) continue;
            const atkTiles = getAttackableTiles(unit);
            const enemyTargets = atkTiles.filter(t =>
                t.unit && t.unit.camp !== myCamp &&
                (ownsNeutralCity ? t.unit.camp === enemyCamp : true));
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
    // 第一轮：攻击 — 天气感知 + 将领特化
    // ═══════════════════════════════════════════

    for (const unit of units) {
        if (processed.has(unit.id)) continue;

        const atkTiles = getAttackableTiles(unit);
        let targets = atkTiles.filter(t => {
            if (!t.unit) return false;
            if (t.unit.camp === myCamp) return false;
            if (!ownsNeutralCity) return t.unit.camp !== myCamp;
            return t.unit.camp === enemyCamp;
        });

        // 集火过滤：按账本已被锁定击杀的目标不再浪费输出
        targets = targets.filter(t => effectiveHp(t.unit) > 0);

        if (targets.length === 0) continue;

        // 守城近战无友军→避免斩杀导致放空
        if (isOwnCity(unit.tile) && unit.type !== 'archer') {
            const isCapital = unit.tile.districtId === myCapitalDistrict;
            if (!ownsNeutralCity && isCapital) {
                // 阶段1主城：不限制斩杀
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

            // 斩杀
            if (willKill(unit, target)) {
                score += 200 * (cmdStrat.killBonus || 1.0);
                if (target.commander) score += 80;
                if (target.morale >= 3) score += 30;
                if (myCmdKey === 'centurion') score += 50;
            }

            // 主攻目标上的守军
            if (primaryObjective && tile === primaryObjective) score += 200;

            // 位于敌方/中立城市的守军
            if (tile.isCity && tile.camp !== myCamp) score += 150;

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
                if (myCmdKey === 'magician') score += 30;
            } else if (adv < 1) {
                score -= 30 * (cmdStrat.aggression > 1 ? 0.5 : 1);
                // 魔术师：被克时受伤-15%，被克攻击风险降低
                if (myCmdKey === 'magician') score += 15;
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
            const suicidePenalty = wouldDieToCounter(unit, target)
                ? 150 * Math.max(0.3, 2 - (cmdStrat.aggression || 1)) * (ownsNeutralCity ? 1.0 : 0.4)
                : 0;
            score -= suicidePenalty;

            // 友军协击
            if (countAdjacentAllies(tile, target.id) > 0) score += 20;

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
            && (ownsNeutralCity ? t.camp === enemyCamp : t.camp !== myCamp));
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

    for (const unit of units) {
        if (processed.has(unit.id)) continue;

        const movTiles = getMovableTiles(unit);
        const validTiles = movTiles.filter(t => !t.unit);
        if (validTiles.length === 0) continue;

        const hpRatio = unit.hp / unit.maxHp;

        // ── 守城 ──
        if (isOwnCity(unit.tile)) {
            const cityKey = `${unit.tile.q},${unit.tile.r}`;
            const isCapital = unit.tile.districtId === myCapitalDistrict;

            if (unit.type === 'infantry' && !cityGarrisonPlanned.has(cityKey)) {
                if (!ownsNeutralCity && isCapital) {
                    // 阶段1主城不留守军
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
                    let defScore = t.terrain === 'mountain' ? 0.30 : t.terrain === 'forest' ? 0.20 : 0;
                    // 天气适配前进路径
                    if (weather === 'fog' && unit.type === 'cavalry') defScore += 0.15;
                    if (weather === 'wind' && unit.type === 'archer') defScore += 0.15;
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
                let defScore = tile.terrain === 'mountain' ? 0.30 : tile.terrain === 'forest' ? 0.20 : 0;
                if (weather === 'rain' && unit.type === 'infantry') defScore += 0.15;
                score += defScore;
                if (score > bestScore) { bestScore = score; bestTile = tile; }
            }
        } else if (primaryObjective) {
            const curDist = hexDistance(unit.tile, primaryObjective);

            for (const tile of validTiles) {
                const newDist = hexDistance(tile, primaryObjective);
                const pushW = (cmdStrat.pushWeight || 1.0) * (ownsNeutralCity ? 1.0 : 2.0);
                const advanceScore = (curDist - newDist) / Math.max(curDist, 1) * 5 * pushW;

                // 直接占领空城
                const captureBonus = (tile.isCity && tile.camp !== myCamp && !tile.unit)
                    ? (ownsNeutralCity ? 3.5 : 8.0) * pushW : 0;

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

                const enemiesAdj = countAdjacentEnemies(tile, enemyCamp);
                const exposurePenalty = enemiesAdj * (ownsNeutralCity ? 0.15 : 0.05);

                let safetyPenalty = 0;
                if (hpRatio < 0.35 && alliesNearby === 0 && enemiesAdj >= 2) {
                    safetyPenalty = 2.0;
                }

                // 首都防卫
                let capitalDefenseBonus = 0;
                const enemyNearCapital = allEnemyUnits.filter(e =>
                    e.tile && hexDistance(e.tile, gameState.tiles.find(c => c.isCity && c.districtId === myCapitalDistrict)) <= 5
                ).length;
                if (enemyNearCapital >= 2) {
                    const nearestEnemyToCapital = allEnemyUnits.reduce((b, e) =>
                        hexDistance(e.tile, gameState.tiles.find(c => c.isCity && c.districtId === myCapitalDistrict)) <
                        hexDistance(b.tile, gameState.tiles.find(c => c.isCity && c.districtId === myCapitalDistrict)) ? e : b
                    , allEnemyUnits[0]);
                    const distToThreat = hexDistance(tile, nearestEnemyToCapital.tile);
                    capitalDefenseBonus = Math.max(0, 60 - distToThreat * 8);
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

                // 残血撤退回城
                let healRetreatBonus = 0;
                if (hpRatio < 0.30 && enemiesNear === 0 && ownsNeutralCity) {
                    const nearestOwnCity = myCities.reduce((b, c) =>
                        hexDistance(tile, c) < hexDistance(tile, b) ? c : b, myCities[0]);
                    healRetreatBonus = Math.max(0, 40 - hexDistance(tile, nearestOwnCity) * 3);
                }

                // 拦截敌人
                let interceptBonus = 0;
                for (const [dq, dr] of HEX_NEIGHBORS) {
                    const nb = tileMap.get(`${tile.q + dq},${tile.r + dr}`);
                    if (nb && nb.unit && nb.unit.camp === enemyCamp && !willKill(unit, nb.unit)) {
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
                    const enemyDistricts = new Set([1, 2]);
                    if (enemyDistricts.has(tile.districtId) && tile.camp === enemyCamp) {
                        diplomatBonus += 30;
                    }
                    // 敌方空城
                    if (tile.isCity && tile.camp === enemyCamp) diplomatBonus += 50;
                }

                // 空军上校：雾天不宜进攻
                let fogPenalty = 0;
                if (cmdStrat.airPower && weather === 'fog') {
                    fogPenalty = 20; // 雾天上校不能飞，整体进攻意愿降低
                }

                const score = advanceScore + captureBonus + siegeReady + nearAnyTarget +
                    defScore + atkPotential + rallyBonus + concentrationBonus +
                    capitalDefenseBonus + villageBonus + healRetreatBonus + interceptBonus +
                    soulMarkBonus + diplomatBonus -
                    exposurePenalty - safetyPenalty - fogPenalty;

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
    // 第二·五轮：补员 — 守城/驻村单位回血，前线不塌
    // ═══════════════════════════════════════════

    let reinforceCount = 0;
    const reinforceCandidates = gameState.tiles
        .filter(t => t.unit && t.unit.camp === myCamp
            && t.unit.hp < t.unit.maxHp * 0.55
            && !t._reinforcedThisTurn
            && ((t.isCity && t.camp === myCamp) || t.isVillage))
        .sort((a, b) => (a.unit.hp / a.unit.maxHp) - (b.unit.hp / b.unit.maxHp));
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
    if (cmdStrat.recruitPref && !(dominantType && dominantType[1] > 0)) {
        recruitPriority = cmdStrat.recruitPref;
    }

    const scoreCity = (city) => {
        let score = 0;
        if (primaryObjective) {
            score += Math.max(0, 100 - hexDistance(city, primaryObjective) * 6);
        }
        score += countAdjacentEnemies(city, enemyCamp) * 35;
        const localDefense = evaluateCityDefense(city, myCamp);
        if (localDefense < 100) score += 50;
        return score;
    };

    emptyOwnCities.sort((a, b) => scoreCity(b) - scoreCity(a));

    for (let i = 0; i < Math.min(maxRecruits, emptyOwnCities.length); i++) {
        if (recruitCount >= maxRecruits) break;
        const city = emptyOwnCities[i];
        const isFrontline = primaryObjective && hexDistance(city, primaryObjective) <= 4;
        const landTypes = isFrontline ? ['infantry', ...recruitPriority.filter(t => t !== 'infantry')] : recruitPriority;
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
