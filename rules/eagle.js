// rules/eagle.js — A-07「天鹰」特遣队阵营协同规则【天基支援协议】。
// 这里只保存成员身份、平衡参数与无副作用的判定；伤害打点由 Unit 统一伤害入口
// 与各空袭/攻城结算点调用 accrueEagleSynergyDamage()/accrueEagleDamageTaken() 完成。
//
// 双计量表设计（对照奥雷利亚的"救援+加护"双效果）：
//   效果一【轨道补给】——只统计"造成"的合规伤害（含反击与溅射）：
//     空军伤害 —— 走防空管线的阵营空军资产：机场空军指令（扫射/轰炸）、空军上校
//                 专属卡（俯冲扫射/地毯轰炸）、航母舰载机、天眼无人机（含自爆）。
//                 通用对策卡【空袭】【空降】与天基打击不属于阵营空军资产，不计入。
//     要塞伤害 —— isStrongpointTarget(攻击者)：碉堡、岸防炮、城市/城郭驻军以及
//                 据守工事的单位造成的伤害（无人机显式排除，归空军口径）。
//     两类命中同一伤害时只计一次；对城市血池的结构伤害按血池剩余截断计入。
//   效果二【天基打击授权】——只统计"受到"的敌方伤害（按剩余生命+护盾截断）：
//     攻击者与目标敌对，或来自显式标记的敌方空军结算；中毒/地雷/传染等无攻击者
//     来源不计入，防止自残与误伤刷授权。城市血池结构伤害不计入（只统计单位）。

import { campToKey } from './camps.js';
import { campFromKey, isHostile } from './diplomacy.js';
import { isStrongpointTarget } from './units.js';
import {
    EAGLE_FACTION_SYNERGY,
    getCommanderFactionSynergy
} from './factionSynergies.js';

export const EAGLE_COMMANDER_IDS = EAGLE_FACTION_SYNERGY.commanderIds;

export const EAGLE_ORBITAL_STRIKE_CARD_ID = 'orbitalStrike';

/**
 * 平衡参数（唯一数值源，描述由此派生）：
 *   damageThreshold/goldPerTrigger —— 轨道补给：每累计多少合规伤害拨付多少金币；
 *   takenThreshold                 —— 天基打击授权：每累计受到多少敌方伤害发放一张卡。
 * 数值推导：
 *   $12/400伤害 = $3/100伤害，低于最廉价的纯刷伤害成本（机场扫射 $4≈45伤害 →
 *   回款约 $1.35；轰炸 $5 实战命中 60~100 伤害 → 回款 $1.8~3），杜绝空转刷钱；
 *   重交战回合约触发一次（$12/2回合），弱于尚书屯田上限（$12/回合）但叠加在真实
 *   战果之上。阈值刻意抬高：全屏 Hero 动画有仪式感，低频高赏比高频小额更保值。
 *   授权阈值 800 受创：按一个阵营整局承受 800~1600 点敌来源伤害的常态估算，
 *   通常一局只触发 1~2 次，极端劣势下才有第 3 张——定位是稀有的逆风底牌，
 *   不是常规循环；天基打击不计入任何一侧计量，避免自循环。
 */
export const EAGLE_SYNERGY_BALANCE = Object.freeze({
    damageThreshold: 400,
    goldPerTrigger: 12,
    takenThreshold: 800
});

export const EAGLE_SUPPLY_EFFECT = Object.freeze({
    name: '轨道补给',
    icon: '📦',
    color: '#f5d76e'
});

export const EAGLE_ORBITAL_EFFECT = Object.freeze({
    name: '天基打击授权',
    icon: '🛰️',
    color: '#7fd0ff'
});

export const EAGLE_FACTION_PASSIVE = Object.freeze({
    name: '天基支援协议',
    icon: EAGLE_FACTION_SYNERGY.marker.symbol,
    type: '阵营协同被动',
    color: '#7fd0ff',
    description: `场上同时存在两名天鹰特遣队将领时生效。【${EAGLE_SUPPLY_EFFECT.name}】本阵营空军与要塞单位（城市驻军、岸防炮、碉堡）每累计造成${EAGLE_SYNERGY_BALANCE.damageThreshold}点伤害，天基平台投送一次补给，立即拨付$${EAGLE_SYNERGY_BALANCE.goldPerTrigger}；【${EAGLE_ORBITAL_EFFECT.name}】本阵营单位每累计受到${EAGLE_SYNERGY_BALANCE.takenThreshold}点敌方伤害，获得一张对策卡【天基打击】。`
});

export function isEagleCommanderId(commanderId) {
    return getCommanderFactionSynergy(commanderId)?.id === EAGLE_FACTION_SYNERGY.id;
}

export function isEagleCommanderUnit(unit) {
    return Boolean(unit?.isCommanderUnit && isEagleCommanderId(unit.commander));
}

export function getLivingEagleCommanders(gameState, campOrKey) {
    if (!gameState?.tiles || !campOrKey) return [];
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    return gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.hp > 0
            && campToKey(unit.camp) === campKey
            && isEagleCommanderUnit(unit));
}

export function hasEagleSynergyActive(gameState, campOrKey) {
    return getLivingEagleCommanders(gameState, campOrKey).length >= 2;
}

/** 空军资产判定：航母舰载机与天眼无人机（自爆同源）。 */
export function isEagleAirAttacker(unit) {
    return unit?.type === 'carrier' || unit?._isDrone === true;
}

/** 要塞单位判定：沿用全局"要塞单位"口径，显式排除无人机（归空军）。 */
export function isEagleFortressAttacker(unit) {
    return Boolean(unit) && unit._isDrone !== true && isStrongpointTarget(unit);
}

function ensureEagleMeter(gameState, campKey) {
    if (!gameState._eagleSynergy) gameState._eagleSynergy = {};
    const meter = gameState._eagleSynergy[campKey] ||= { total: 0, triggers: 0, taken: 0, takenTriggers: 0 };
    if (meter.taken == null) meter.taken = 0;
    if (meter.takenTriggers == null) meter.takenTriggers = 0;
    return meter;
}

function buildCommanderAnchors(gameState, campKey) {
    // 表现锚点取棋子落格中心（与奥雷利亚一致），不读带位移插值的视觉坐标。
    return getLivingEagleCommanders(gameState, campKey).map(unit => ({
        unitId: unit.id,
        commanderId: unit.commander,
        name: unit.getCommanderDisplayName?.() || unit.commander,
        x: unit.tile?.x,
        y: unit.tile?.y
    }));
}

function queueEagleEvent(gameState, event, deferred) {
    if (deferred) return;
    if (!Array.isArray(gameState._pendingEagleSynergyEvents)) {
        gameState._pendingEagleSynergyEvents = [];
    }
    gameState._pendingEagleSynergyEvents.push(event);
}

/**
 * 统一伤害入口的分类（造成侧）：返回应记账的阵营 key，不合规返回 null。
 * airForceCampKey 由机场空军指令/上校空军卡的结算点显式传入（这些来源没有
 * 攻击者实体）；其余来源按攻击者单位分类。带 target 时校验敌对关系，防止
 * 传染/误伤类结算把非敌对伤害记入战功。
 */
export function resolveEagleDamageCreditCampKey({ attacker = null, airForceCampKey = null, target = null, gameState = null } = {}) {
    if (airForceCampKey) {
        return hasEagleSynergyActive(gameState, airForceCampKey) ? airForceCampKey : null;
    }
    if (!attacker?.camp) return null;
    if (!isEagleAirAttacker(attacker) && !isEagleFortressAttacker(attacker)) return null;
    if (target?.camp && gameState && !isHostile(gameState, attacker.camp, target.camp)) return null;
    const campKey = campToKey(attacker.camp);
    return hasEagleSynergyActive(gameState, campKey) ? campKey : null;
}

/**
 * 统一伤害入口的分类（受到侧）：目标所属阵营激活协议且伤害来自敌方时，
 * 返回目标阵营 key，否则返回 null。无攻击者来源（中毒/地雷/自残）一律不计。
 */
export function resolveEagleDamageTakenCampKey({ target = null, attacker = null, airForceCampKey = null, gameState = null } = {}) {
    if (!target?.camp || !gameState) return null;
    const campKey = campToKey(target.camp);
    if (!hasEagleSynergyActive(gameState, campKey)) return null;
    if (attacker?.camp) {
        return isHostile(gameState, attacker.camp, target.camp) ? campKey : null;
    }
    if (airForceCampKey) {
        const airCamp = campFromKey(airForceCampKey, gameState);
        return airCamp && isHostile(gameState, airCamp, target.camp) ? campKey : null;
    }
    return null;
}

export function getEagleSynergyMeter(gameState, campOrKey) {
    const campKey = typeof campOrKey === 'string' ? campOrKey : campToKey(campOrKey);
    const meter = gameState?._eagleSynergy?.[campKey];
    const { damageThreshold, goldPerTrigger, takenThreshold } = EAGLE_SYNERGY_BALANCE;
    const total = meter?.total || 0;
    const triggers = meter?.triggers || 0;
    const taken = meter?.taken || 0;
    const takenTriggers = meter?.takenTriggers || 0;
    return {
        total,
        triggers,
        progress: total - triggers * damageThreshold,
        goldPaid: triggers * goldPerTrigger,
        threshold: damageThreshold,
        taken,
        takenTriggers,
        takenProgress: taken - takenTriggers * takenThreshold,
        takenThreshold
    };
}

/**
 * 记入合规伤害（造成侧）并结算跨过的阈值：直接拨付金币、生成表现事件。
 * 单次大额伤害一次跨过多个阈值时合并为一个事件（goldAwarded 累计）。
 * deferred=true 表示延迟结算路径（空袭落弹、远端重放）：两端各自确定性重算，
 * 事件只在本地发射、不进入待广播队列，靠 presentationEventId 去重。
 * 返回事件对象（未触发结算返回 null），fx 发射与日志由表现层负责。
 */
export function accrueEagleSynergyDamage(gameState, campKey, amount, { deferred = false } = {}) {
    const dealt = Math.max(0, Math.round(Number(amount) || 0));
    if (!gameState || !campKey || dealt <= 0) return null;
    const meter = ensureEagleMeter(gameState, campKey);
    meter.total += dealt;

    const { damageThreshold, goldPerTrigger } = EAGLE_SYNERGY_BALANCE;
    const reached = Math.floor(meter.total / damageThreshold);
    const crossings = reached - meter.triggers;
    if (crossings <= 0) return null;

    const firstTrigger = meter.triggers === 0;
    meter.triggers = reached;
    const goldAwarded = crossings * goldPerTrigger;
    if (gameState.playerGold) {
        gameState.playerGold[campKey] = (gameState.playerGold[campKey] || 0) + goldAwarded;
    }

    const event = {
        kind: 'supply',
        presentationEventId: `eagleSupply:${campKey}:${meter.triggers}`,
        campKey,
        goldAwarded,
        crossings,
        triggerIndex: meter.triggers,
        firstTrigger,
        totalDamage: meter.total,
        thresholdDamage: damageThreshold,
        commanders: buildCommanderAnchors(gameState, campKey)
    };
    queueEagleEvent(gameState, event, deferred);
    return event;
}

/**
 * 记入敌来源伤害（受到侧）并结算跨过的阈值：直接发放【天基打击】对策卡、
 * 生成轻量表现事件（不走全屏 Hero，仪式感集中在轨道补给上）。
 * 发卡直接写入手牌数组，状态随快照同步；手牌满时仍发放（超出的卡仅限制抽牌，
 * 不影响使用），避免"卡住授权"的隐性惩罚。
 * deferred 语义与 accrueEagleSynergyDamage 相同。
 */
export function accrueEagleDamageTaken(gameState, campKey, amount, { deferred = false } = {}) {
    const taken = Math.max(0, Math.round(Number(amount) || 0));
    if (!gameState || !campKey || taken <= 0) return null;
    const meter = ensureEagleMeter(gameState, campKey);
    meter.taken += taken;

    const { takenThreshold } = EAGLE_SYNERGY_BALANCE;
    const reached = Math.floor(meter.taken / takenThreshold);
    const crossings = reached - meter.takenTriggers;
    if (crossings <= 0) return null;

    meter.takenTriggers = reached;
    if (Array.isArray(gameState.playerHands?.[campKey])) {
        for (let i = 0; i < crossings; i++) {
            gameState.playerHands[campKey].push(EAGLE_ORBITAL_STRIKE_CARD_ID);
        }
    }

    const event = {
        kind: 'orbitalGrant',
        presentationEventId: `eagleGrant:${campKey}:${meter.takenTriggers}`,
        campKey,
        cardsGranted: crossings,
        triggerIndex: meter.takenTriggers,
        totalTaken: meter.taken,
        thresholdDamage: takenThreshold,
        commanders: buildCommanderAnchors(gameState, campKey)
    };
    queueEagleEvent(gameState, event, deferred);
    return event;
}
