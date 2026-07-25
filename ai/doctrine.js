// 条令层 —— Optio / Legatus / Imperator 三档共享的「规则认知」。
//
// 这里只放**关于游戏规则的事实**：克制关系、跨域伤害、占城资格、攻城估伤、
// 地图城区归属、将领机制常量。三个档次对规则的了解完全一致，差别只在**指挥**
// ——用多少信息、算多远、敢不敢下判断。把规则事实集中在这里，是为了防止
// 引擎改了系数而三份脚本各自静默失准。
//
// 反过来说，任何「怎么打」的决策（目标怎么选、走位怎么评分、要不要冒险）
// 都不属于条令层，必须留在各自的档位脚本里，否则档次差异会退化成开关。

import { COUNTER_RELATION, getMachineGunDamageBonus, isStrongpointTarget } from '../rules/units.js';
import { NAVAL_RULES } from '../rules/naval.js';
import { isWaterTile } from '../rules/surfaces.js';
import { getCannonSiegeDamageBonus } from '../rules/citySiege.js';
import { COMMANDER_CONFIG } from '../rules/commanders.js';

export const BERSERKER_BALANCE = COMMANDER_CONFIG.berserker.balance;

export const COMMANDER_PREFERENCE = [
    'vampire', 'paladin', 'advisor', 'berserker', 'colonel', 'tianyan', 'necromancer',
    'ironGuard', 'engineer', 'minister', 'centurion', 'magician', 'fallenAngel',
    'astrologer', 'diplomat', 'priest', 'staller'
];

// 各将领打法偏好权重（用于攻击/移动/招募决策修饰）
export const COMMANDER_STRATEGY = {
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

// 克制关系直接取规则源（含海军与岸防炮行列）；旧版只有步/骑/炮三行，
// 海图上一切交换都按“无克制”估算，才会出现驱逐舰硬啃岸防炮这类亏本攻击。
// 引擎的克制不再给固定增减伤：顺克把浮动区间上移 40%（暴击率提升）、逆克下移 40%。
// 区间平移不改变宽度，期望倍率变化恰好 ±0.40 × 0.5（攻击浮动宽度）= ±0.20，与本估算值一致。
const COUNTER_DAMAGE_BONUS = 0.20;
export function counterCoefficient(attackerType, defenderType) {
    return COUNTER_RELATION[attackerType]?.[defenderType] ?? 1;
}
export function counterDamageBonus(attackerType, defenderType) {
    const coeff = counterCoefficient(attackerType, defenderType);
    return coeff > 1 ? COUNTER_DAMAGE_BONUS : coeff < 1 ? -COUNTER_DAMAGE_BONUS : 0;
}

const NAVAL_TYPES = new Set(['destroyer', 'warship', 'submarine', 'carrier']);

/** 对齐 rules/naval.getCrossDomainDamageBonus，但只依赖 AI 手上的地块信息。 */
export function crossDomainDamageBonus(attacker, defenderTile, defender = null) {
    if (!attacker || !defenderTile) return 0;
    const defenderAfloat = isWaterTile(defenderTile)
        && (NAVAL_TYPES.has(defender?.type) || defender?.isEmbarked === true);
    if (attacker.type === 'shoreBattery') {
        return defenderAfloat
            ? NAVAL_RULES.shoreBatteryVsShipDamage
            : NAVAL_RULES.shoreBatteryVsLandDamage;
    }
    if (NAVAL_TYPES.has(attacker.type) && !isWaterTile(defenderTile)) {
        return NAVAL_RULES.shipVsLandDamage;
    }
    if (!NAVAL_TYPES.has(attacker.type) && attacker.type !== 'drone'
        && NAVAL_TYPES.has(defender?.type)) {
        return NAVAL_RULES.landVsShipDamage;
    }
    return 0;
}

// 只有“突击类”攻击者能在击杀守军/打破城防后进驻城市（对齐
// rules/attackPresentation.classifyAttackPresentation）。远程单位把城防打空
// 却进不去，等于把城直接送给下一个走进来的对手。
const NON_ASSAULT_TYPES = new Set([
    'archer', 'warship', 'shoreBattery', 'submarine', 'carrier', 'destroyer', 'drone', 'mgNest'
]);
export function canCaptureCityByCombat(unit) {
    if (!unit) return false;
    if (unit._isDrone) return false;
    return !NON_ASSAULT_TYPES.has(unit.type);
}

// 火炮类攻城 +50%（对齐 rules/citySiege.CANNON_SIEGE_ATTACKER_TYPES）。
const CANNON_SIEGE_TYPES = new Set(['archer', 'warship', 'shoreBattery']);
const CANNON_SIEGE_BONUS = 0.50;

// 对齐 TERRAIN_CONFIG（config.js）
export const TERRAIN_DEF = { plains: 0, forest: 0.05, mountain: 0.05 };

export function scoreTacticalRoleMatchup(attacker, target) {
    if (!attacker || !target) return 0;
    if (attacker.type === 'submarine') {
        if (target.type === 'carrier') return 190;
        if (target.type === 'warship') return 125;
        if (target.type === 'destroyer') return -90;
    }
    if (attacker.type === 'destroyer' && target.type === 'submarine') {
        return attacker.specializationKey === 'antiSubDestroyer' ? 180 : 100;
    }
    if (attacker.type === 'warship'
        && (target.type === 'carrier' || target.type === 'destroyer')) {
        return 70;
    }
    if ((attacker.type === 'cavalry' || attacker._isDrone)
        && (target.type === 'archer' || target.type === 'mgNest')) {
        return 105;
    }
    if (target.type === 'carrier') return 80;
    return 0;
}

export function scoreCommanderCarrierCandidate(unit, commanderId, mapDefinition) {
    if (!unit || !unit.tile || unit.hp <= 0 || unit.commander) return -Infinity;
    const attack = Number(unit.getEffectiveAttack?.() ?? unit.config?.attack ?? 0);
    const maxHp = Math.max(1, Number(unit.maxHp ?? unit.config?.hp ?? unit.hp ?? 1));
    const hpRatio = Math.max(0, Math.min(1, Number(unit.hp ?? 0) / maxHp));
    let score = attack * 2 + maxHp * 0.15 + hpRatio * 50;

    // 后方型将领先满足其机制位置，再考虑载体面板。
    if (commanderId === 'minister') {
        return score + (unit.tile.isCity ? 900 : 0)
            + (unit.config?.movementDomain === 'land' ? 120 : 0);
    }
    if (commanderId === 'necromancer') {
        return score + (unit.tile.isCity ? 650 : 0)
            + (unit.config?.movementDomain === 'land' ? 100 : 0);
    }
    if (commanderId === 'astrologer') {
        return score + (unit.tile.isCity ? 520 : 0)
            + (unit.config?.movementDomain === 'land' ? 80 : 0);
    }

    // 无主航路的胜负先由制海权决定：高属性主力舰是将领的首选载体。
    if (mapDefinition?.familyId === 'uncharted-passage') {
        const navalFlagshipBonus = {
            carrier: 230,
            warship: 210,
            destroyer: 125,
            submarine: 65
        };
        score += navalFlagshipBonus[unit.type] || 0;
        // 空军上校与航母的舰载航空体系拥有额外协同。
        if (commanderId === 'colonel' && unit.type === 'carrier') score += 90;
    } else if (unit.config?.movementDomain === 'naval') {
        // 陆战为主的地图：将领挂军舰 = 脱离主战场（打不到城、护不了陆军）。
        score -= 140;
    }

    // 各将领的载体偏好（COMMANDER_STRATEGY.carrierPref）：输出型将领要进战斗序列。
    const carrierPref = COMMANDER_STRATEGY[commanderId]?.carrierPref;
    if (carrierPref) {
        const prefIndex = carrierPref.indexOf(unit.type);
        if (prefIndex >= 0) score += (carrierPref.length - prefIndex) * 25;
    }

    return score;
}

export function shouldYieldMinisterCity({
    gold = 0,
    minimumRecruitCost = 8,
    hasOtherEmptyCity = false,
    cityThreatened = false,
    ownForceCount = 0,
    ownedCityCount = 1,
    terminalPhase = false
} = {}) {
    if (hasOtherEmptyCity || gold < minimumRecruitCost) return false;
    const forceFloor = Math.max(6, Number(ownedCityCount || 1) * 4 + 2);
    return cityThreatened || terminalPhase || ownForceCount <= forceFloor;
}

/**
 * 攻城结构伤害估算（对齐 gameLogic._resolveGroundNavalSiegeDamage）：
 * 攻击力 ×（1 + 跨域修正 + 火炮攻城加成）×浮动。浮动取期望 1.0。
 * 空城无守军防御乘区，所以不复用 estimateDamage。
 */
export function estimateSiegeDamage(attacker, cityTile) {
    if (!attacker || !cityTile) return 0;
    const attack = Number(attacker.getEffectiveAttack?.() ?? attacker.config?.attack ?? 0);
    const bonus = crossDomainDamageBonus(attacker, cityTile)
        + (CANNON_SIEGE_TYPES.has(attacker.type) ? CANNON_SIEGE_BONUS : 0);
    return Math.max(1, attack * Math.max(0, 1 + bonus));
}

/**
 * 破城最后一击的分配：城防余量若在某个近战单位的一击之内，就把这一击留给它，
 * 由它进驻占城；远程单位此时开火只会把空城让给下一个走过来的对手。
 */
export function shouldReserveFinalSiegeBlow(cityHp, assaultSiegeDamages = []) {
    if (!(Number(cityHp) > 0)) return true;
    return assaultSiegeDamages.some(damage => damage >= cityHp);
}

/** 投毒：15% 最大生命×3 跳，且每跳向相邻单位（不分阵营）传播。 */
export function poisonPressure(unit) {
    if (!unit?._poison) return 0;
    const ticks = Math.max(1, Number(unit._poison.remainingTicks) || 1);
    return Math.max(1, Math.round(Number(unit.maxHp || 0) * 0.15)) * ticks;
}

/**
 * 狂战士【泣血】消耗当前生命的 30% 换下一击增伤与溅射，
 * 只有这一击真能兑现（形成击杀或打高价值目标）时才值得。
 */
export function shouldSpendBerserkerBlood({
    hpRatio = 1,
    convertsToKill = false,
    highValueTarget = false,
    outnumbered = false
} = {}) {
    if (hpRatio <= 0.35) return false;
    if (convertsToKill) return true;
    return highValueTarget && hpRatio >= 0.60 && !outnumbered;
}

/**
 * 尚书让位冷却：距上次回城满 3 回合才允许再次让位，
 * 否则会在“让位招兵—回城产金”之间反复横跳，两头都做不成。
 */
export function hasMinisterYieldCooldownElapsed(currentRound, lastReturnRound) {
    return Number(currentRound) - Number(lastReturnRound ?? -Infinity) >= 3;
}

export function shouldKeepAstrologerRear({
    hpRatio = 1,
    nearbyEnemyCount = 0,
    nearbyAllyCount = 0,
    forceAdvantage = 0,
    hasSecureForwardBase = false,
    terminalPhase = false
} = {}) {
    if (terminalPhase) return false;
    if (!hasSecureForwardBase) return true;
    if (hpRatio < 0.70 || nearbyEnemyCount > 0) return true;
    return nearbyAllyCount < 2 || forceAdvantage < 3;
}

export function getStrategicCityDistrictProfile(mapDefinition, myCampKey, enemyCampKeys = []) {
    const cities = Array.isArray(mapDefinition?.board?.cities)
        ? mapDefinition.board.cities
        : [];
    const enemyKeys = new Set(enemyCampKeys);
    return {
        neutralDistricts: new Set(cities
            .filter(city => city.camp === 'neutral')
            .map(city => city.districtId)),
        myHomeDistricts: new Set(cities
            .filter(city => city.camp === myCampKey)
            .map(city => city.districtId)),
        enemyHomeDistricts: new Set(cities
            .filter(city => enemyKeys.has(city.camp))
            .map(city => city.districtId))
    };
}

export function readStrategicObjectiveCommitment(entry, phase, currentRound) {
    if (!entry || entry.phase !== phase) return null;
    if (!Number.isFinite(entry.q) || !Number.isFinite(entry.r)) return null;
    if (Number(entry.expiresRound) < Number(currentRound)) return null;
    return { q: entry.q, r: entry.r };
}

export function isImmediateBacktrack(entry, tile, currentRound) {
    if (!entry || !tile) return false;
    if (Number(currentRound) - Number(entry.round) > 2) return false;
    return entry.q === tile.q && entry.r === tile.r;
}

export function shouldPlanActiveSkill(unit, {
    hasAttackTarget = false,
    hasWoundedAlly = false
} = {}) {
    if (!unit?.commander || !unit.canAct) return false;
    if ((unit.activeSkillCD || 0) > 0 || (unit.activeSkillDur || 0) > 0) return false;
    if (unit.commander === 'berserker') {
        return hasAttackTarget && !unit._berserkerQixue && unit.hp > 1;
    }
    if (unit.commander === 'paladin') {
        return hasAttackTarget && !unit._smiteReady && Number(unit._faith || 0) >= 1;
    }
    if (unit.commander === 'priest') return hasWoundedAlly;
    return false;
}

export function selectCommander(pool) {
    for (const pref of COMMANDER_PREFERENCE) {
        if (pool.includes(pref)) return pref;
    }
    return pool[0];
}

export function selectCommanderPair(pool) {
    const candidates = [...new Set(pool || [])];
    const preferenceRank = new Map(COMMANDER_PREFERENCE.map((id, index) => [id, index]));
    const synergyGroups = [
        new Set(['ironGuard', 'minister', 'advisor', 'centurion', 'berserker']),
        new Set(['colonel', 'engineer', 'tianyan']),
        new Set(['priest', 'martyr', 'paladin', 'fallenAngel']),
        new Set(['vampire', 'necromancer', 'magician']),
        new Set(['astrologer', 'staller', 'diplomat'])
    ];
    const pairs = [];
    for (let left = 0; left < candidates.length; left++) {
        for (let right = left + 1; right < candidates.length; right++) {
            const pair = [candidates[left], candidates[right]];
            if (!synergyGroups.some(group => pair.every(id => group.has(id)))) continue;
            pairs.push(pair);
        }
    }
    if (pairs.length > 0) {
        pairs.sort((left, right) => {
            const score = pair => pair.reduce((sum, id) => sum + (preferenceRank.get(id) ?? 999), 0);
            return score(left) - score(right);
        });
        return pairs[0].sort((left, right) =>
            (preferenceRank.get(left) ?? 999) - (preferenceRank.get(right) ?? 999));
    }
    const first = selectCommander(candidates);
    const incompatible = first === 'colonel' ? 'diplomat' : first === 'diplomat' ? 'colonel' : null;
    const second = selectCommander(candidates.filter(id => id !== first && id !== incompatible));
    return [first, second].filter(Boolean);
}

// ═══════════════════════════════════════════
// 战斗估算模型 —— 对齐 Unit._resolveDamage 的四层乘算
// ═══════════════════════════════════════════
// 这是「规则事实」而非「决策」：三档对同一次交换应当算出同一个数字，
// 差别只在于它们**愿不愿意去算**、以及算完之后怎么用这个数字。
// Optio 只调用 estimateDamage 判断能否斩杀；Legatus 会一并读反击；
// Imperator 还会把它喂给集火账本与净交换否决。

/** 远程攻击者：战壕只挡近战、高射机枪只挡远程、森林对远程额外加成。 */
export function isRangedAttacker(attacker) {
    return attacker?.type === 'archer' || attacker?.type === 'mgNest' || attacker?._isDrone === true;
}

/**
 * 建立一个绑定当前天气的战斗估算器。
 * 所有档次共用，保证「同一次交换算出同一个数」。
 */
export function createCombatModel({ weather = 'clear', hexDistance } = {}) {
    // 地形+工事防御（对齐 rules/terrain.js）
    function terrainDefense(tile, attackerRanged) {
        let def = TERRAIN_DEF[tile?.terrain] || 0;
        if (tile?.fortification === 'trench' && !attackerRanged) def += 0.25;
        if (tile?.fortification === 'flak' && attackerRanged) def += 0.25;
        if (tile?.terrain === 'forest' && attackerRanged) def += 0.15;
        return def;
    }

    function cityDefense(unitType, tile) {
        if (unitType !== 'infantry' || !tile?.isCity) return 0;
        return weather === 'rain' ? 0.20 : 0.10;
    }

    function weatherAttackBonus(unitType) {
        if (weather === 'fog' && unitType === 'cavalry') return 0.20;
        if (weather === 'wind' && unitType === 'archer') return 0.20;
        return 0;
    }

    function weatherDefensePenalty(unitType) {
        return weather === 'wind' && unitType === 'infantry' ? -0.15 : 0;
    }

    /** 单次攻击的期望伤害。士气已含在 getEffectiveAttack 内，不重复叠加。 */
    function estimateDamage(attacker, defender, tile) {
        const tileObj = tile || defender?.tile;
        if (!attacker || !defender || !tileObj) return 0;
        const coeff = counterCoefficient(attacker.type, defender.type);
        const offense = 1
            + counterDamageBonus(attacker.type, defender.type)
            + weatherAttackBonus(attacker.type)
            + crossDomainDamageBonus(attacker, tileObj, defender)
            + getMachineGunDamageBonus(attacker.type, defender?.type)
            // 火炮攻城修正已并入引擎②增伤乘区：对要塞单位（城市驻军/碉堡/岸防炮/工事格）+50%
            + (isStrongpointTarget({ ...defender, tile: tileObj }) ? getCannonSiegeDamageBonus(attacker) : 0);
        const def = 1
            - terrainDefense(tileObj, isRangedAttacker(attacker))
            - cityDefense(defender.type, tileObj)
            - (defender.config?.defense || 0)
            - weatherDefensePenalty(defender.type);
        const magicianDef = (defender.commander === 'magician' && coeff > 1) ? 0.15 : 0;
        return Number(attacker.getEffectiveAttack?.() ?? attacker.config?.attack ?? 0)
            * Math.max(0, offense)
            * Math.max(0.3, def - magicianDef);
    }

    /**
     * 反击期望。防守方够不着进攻方就不会反击，航母没有反击。
     * 0.98 ≈ 0.75（反击基础系数）× 1.30（反击浮动均值）。
     */
    function estimateCounterDamage(attacker, defender) {
        if (!attacker?.tile || !defender?.tile) return 0;
        if (defender.type === 'carrier') return 0;
        const distance = hexDistance ? hexDistance(attacker.tile, defender.tile) : 1;
        if (Math.max(1, Number(defender.config?.range || 1)) < distance) return 0;
        // 承受反击的是进攻方，防御地形按进攻方自己站的格子算。
        return estimateDamage(defender, attacker, attacker.tile) * 0.98;
    }

    function wouldDieToCounter(attacker, defender) {
        const counterDamage = estimateCounterDamage(attacker, defender);
        if (counterDamage <= 0) return false;
        const coeff = counterCoefficient(defender.type, attacker.type);
        const magicianSave = (attacker.commander === 'magician' && coeff > 1) ? 0.15 : 0;
        return counterDamage * (1 - magicianSave) >= attacker.hp + (attacker._shield || 0);
    }

    return { estimateDamage, estimateCounterDamage, wouldDieToCounter, counterCoefficient };
}


// ═══════════════════════════════════════════
// 遭遇战视野 —— 对齐 js/fogOfWar._getEffectiveVision
// ═══════════════════════════════════════════
// 视野半径是公开规则：任何玩家都能从对方棋子的兵种推断它能看多远。
// 高档 AI 用它反推「敌人此刻看得见哪些格子」，从而规划不被发现的迂回路线；
// 这与偷看迷雾是两回事——推算只用到我方已经看见的敌方棋子。

export const UNIT_VISION = Object.freeze({
    infantry: 1, cavalry: 2, archer: 2, mgNest: 2, shoreBattery: 2,
    drone: 2, destroyer: 2, warship: 3, submarine: 2, carrier: 3
});
export const CITY_VISION_RANGE = 1;

/** 某单位的视野半径。炮兵按射程并吃天气/地形修正，与引擎同一套分支。 */
export function estimateUnitVisionRadius(unit, weather = 'clear') {
    if (!unit) return 1;
    let range;
    if (unit.type === 'archer') {
        range = Number(unit.config?.range ?? 2);
        if (weather === 'fog') range -= 1;
        let bonus = 0;
        if (unit.tile?.terrain === 'mountain') bonus = 1;
        if (weather === 'wind') bonus = Math.max(bonus, 1);
        range = Math.max(1, Math.min(4, range + bonus));
    } else {
        range = UNIT_VISION[unit.type] || 1;
    }
    range += unit.getSpecializationAbility?.('skirmishVisionBonus') || 0;
    if (unit.commander === 'tianyan') range += 1;
    return Math.max(1, Math.min(5, range));
}
