// rules/celestine.js — 塞莱斯廷圣国阵营协同【神谕】规则。
// 这里只保存平衡参数与无副作用的判定；脉冲结算由 gameLogic 在 isRoundAnchor 内调用
// resolveOraclePulse 完成，表现层经 visualEventBridge 分发。

import { campToKey } from './camps.js';
import { getRound, getRoundIndex } from './turns.js';
import {
    CELESTINE_FACTION_SYNERGY,
    getCommanderFactionSynergy
} from './factionSynergies.js';

// 神谕身份组：牧师/殉道者共享 sacredVessel，激活计数时只算 1 名。
export const CELESTINE_IDENTITY_GROUPS = Object.freeze({
    priest: 'sacredVessel',
    martyr: 'sacredVessel',
    paladin: 'paladin',
    fallenAngel: 'fallenAngel'
});

/**
 * 平衡参数（唯一数值源，描述由此派生）：
 *   stagePercents —— 每阶段对应的神罚最大生命值百分比；
 *   roundsPerStage —— 每阶段持续回合数。
 */
export const CELESTINE_ORACLE_BALANCE = Object.freeze({
    // 封顶 3 阶（50%）：神罚不再升到 70%/100%，避免随时长滚雪球（平衡评审结论）。
    stagePercents: [0.10, 0.30, 0.50],
    roundsPerStage: 4
});

export const CELESTINE_FACTION_PASSIVE = Object.freeze({
    name: '神谕',
    icon: '🔆',
    type: '阵营协同被动',
    color: '#f5d76e',
    description: `场上同时存在≥2名不同身份的圣国将领时激活。【神罚】每整轮对全场攻击力最高的单位降下神罚，造成目标最大生命值${(CELESTINE_ORACLE_BALANCE.stagePercents[0] * 100).toFixed(0)}%~${(CELESTINE_ORACLE_BALANCE.stagePercents[CELESTINE_ORACLE_BALANCE.stagePercents.length - 1] * 100).toFixed(0)}%的真实伤害（随神临阶段递增）；【赐福】对全场防御力最低的单位附加等量护盾。神临阶段：每${CELESTINE_ORACLE_BALANCE.roundsPerStage}回合提升一级。`
});

export function isCelestineCommanderId(commanderId) {
    return getCommanderFactionSynergy(commanderId)?.id === CELESTINE_FACTION_SYNERGY.id;
}

export function isCelestineCommanderUnit(unit) {
    return Boolean(unit?.isCommanderUnit && isCelestineCommanderId(unit.commander));
}

export function getLivingCelestineCommanders(gameState, campOrKey) {
    if (!gameState?.tiles || !campOrKey) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    return gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.hp > 0
            && campToKey(unit.camp) === campKey
            && isCelestineCommanderUnit(unit));
}

/**
 * 按 identityGroup 去重后 ≥2 名不同身份的圣国将领时激活。
 * priest + martyr 同时在场也只算 1 名（同属 sacredVessel）。
 */
export function hasCelestineSynergyActive(gameState, campOrKey) {
    const commanders = getLivingCelestineCommanders(gameState, campOrKey);
    const identityGroups = new Set();
    for (const unit of commanders) {
        const group = CELESTINE_IDENTITY_GROUPS[unit.commander];
        if (group) identityGroups.add(group);
    }
    return identityGroups.size >= 2;
}

/**
 * 获取神谕当前阶段（1-5）。
 * @param {number} activeRounds - 神谕激活后经过的整轮数（0 = 首轮激活）
 * @returns {number} 1..5
 */
export function getOracleStage(activeRounds) {
    const { roundsPerStage, stagePercents } = CELESTINE_ORACLE_BALANCE;
    const stage = Math.floor(activeRounds / roundsPerStage);
    return Math.min(stagePercents.length, Math.max(1, stage + 1));
}

/**
 * 获取神罚伤害百分比。
 * @param {number} activeRounds
 * @returns {number} 0.10 ~ 1.00
 */
export function getOracleDamagePct(activeRounds) {
    const { stagePercents, roundsPerStage } = CELESTINE_ORACLE_BALANCE;
    const stageIndex = Math.min(stagePercents.length - 1, Math.floor(activeRounds / roundsPerStage));
    return stagePercents[stageIndex];
}

/**
 * 获取神谕计量状态（供 HUD 读取）。
 */
export function getCelestineOracleState(gameState, campKey) {
    const oracle = gameState?._celestineOracle?.[campKey];
    if (!oracle) return null;
    const activeRounds = oracle.activeRounds || 0;
    const stage = getOracleStage(activeRounds);
    const pct = getOracleDamagePct(activeRounds);
    return {
        activeRounds,
        stage,
        damagePct: pct,
        active: hasCelestineSynergyActive(gameState, campKey)
    };
}

/**
 * 选择神罚目标：全场所有单位中面板攻击力（getEffectiveAttack）最高者。
 * 并列取 unit.id 最小者。
 */
function selectSmiteTarget(gameState) {
    let target = null;
    let highestAtk = -1;
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (!unit || unit.hp <= 0) continue;
        const atk = unit.getEffectiveAttack();
        if (atk > highestAtk || (atk === highestAtk && target && unit.id < target.id)) {
            highestAtk = atk;
            target = unit;
        }
    }
    return target;
}

/**
 * 选择护盾目标：全场所有单位中 config.defense + _rankPanelDefenseBonus 最低者。
 * 并列取 unit.id 最小者。
 */
function selectShieldTarget(gameState) {
    let target = null;
    let lowestDef = Infinity;
    for (const tile of gameState.tiles) {
        const unit = tile.unit;
        if (!unit || unit.hp <= 0) continue;
        const def = (unit.config?.defense || 0) + (unit._rankPanelDefenseBonus || 0);
        if (def < lowestDef || (def === lowestDef && target && unit.id < target.id)) {
            lowestDef = def;
            target = unit;
        }
    }
    return target;
}

/**
 * 获取神像锚点城市：该阵营控制的城市列表，按 (districtId, q, r) 排序取首座。
 * 无己方城市时返回 null。
 */
export function getOracleStatueAnchor(gameState, campKey) {
    const cities = gameState.tiles.filter(t => t.isCity && campToKey(t.camp) === campKey);
    if (cities.length === 0) return null;
    cities.sort((a, b) => a.districtId - b.districtId || a.q - b.q || a.r - b.r);
    return cities[0];
}

/**
 * 神谕脉冲结算（每整轮调用一次）。
 *
 * 失效检测（将领数不足/投降）→ 失效则清零并返回 null。
 * 否则 activeRounds+1，选神罚目标 → 真伤结算 → 选护盾目标 → 附加护盾。
 * 返回脉冲载荷供广播和表现层使用。
 *
 * @param {object} state - gameState
 * @param {string} campKey - 阵营 key
 * @returns {object|null} { campKey, activeRounds, stage, smite, shield } 或 null（失效）
 */
export function resolveOraclePulse(state, campKey) {
    // 失效检测
    if (!state) return null;
    const surrendered = state.surrenderedCamps || [];
    const camp = state.factions?.[campKey];
    if (!camp) return null;
    if (surrendered.some(c => campToKey(c) === campKey)) {
        // 失效：清零计量
        if (state._celestineOracle?.[campKey]) {
            delete state._celestineOracle[campKey];
        }
        return null;
    }
    if (!hasCelestineSynergyActive(state, campKey)) {
        // 失效：清零计量
        if (state._celestineOracle?.[campKey]) {
            delete state._celestineOracle[campKey];
        }
        return null;
    }

    // 确保计量对象
    if (!state._celestineOracle) state._celestineOracle = {};
    const oracle = state._celestineOracle[campKey] ||= { activeRounds: 0, stage: 1, _lastHeroStage: 0 };
    oracle.activeRounds = (oracle.activeRounds || 0) + 1;
    const activeRounds = oracle.activeRounds;
    const stage = getOracleStage(activeRounds);
    const stageChanged = stage !== oracle._lastHeroStage;
    oracle.stage = stage;
    if (stageChanged) oracle._lastHeroStage = stage;

    // 选神罚目标
    const smiteTarget = selectSmiteTarget(state);
    let smiteResult = null;
    if (smiteTarget) {
        const pct = getOracleDamagePct(activeRounds);
        const maxHp = smiteTarget.maxHp;
        const dmg = Math.max(1, Math.round(maxHp * pct));
        const hpBefore = smiteTarget.hp;
        smiteTarget.applyDamage(dmg, { source: 'true', attacker: null });
        const hpAfter = Math.max(0, smiteTarget.hp);
        const actualDealt = Math.max(0, hpBefore - hpAfter);
        const killed = hpAfter <= 0;
        smiteResult = {
            unitId: smiteTarget.id,
            q: smiteTarget.tile?.q,
            r: smiteTarget.tile?.r,
            dmg: actualDealt,
            killed
        };

        // 选护盾目标
        const shieldTarget = selectShieldTarget(state);
        let shieldResult = null;
        if (shieldTarget && actualDealt > 0) {
            shieldTarget._shield = (shieldTarget._shield || 0) + actualDealt;
            shieldTarget._shieldMax = Math.max(shieldTarget._shieldMax || 0, shieldTarget._shield);
            shieldTarget._shieldTurns = 1; // 仅当回合有效，下次脉冲即消失
            shieldResult = {
                unitId: shieldTarget.id,
                q: shieldTarget.tile?.q,
                r: shieldTarget.tile?.r,
                amount: actualDealt
            };
        }

        return {
            campKey,
            activeRounds,
            stage,
            stageChanged,
            smite: smiteResult,
            shield: shieldResult
        };
    }

    return {
        campKey,
        activeRounds,
        stage,
        stageChanged,
        smite: null,
        shield: null
    };
}