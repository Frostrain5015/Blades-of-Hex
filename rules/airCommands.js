import { campToKey } from './camps.js';
import { getRoundIndex } from './turns.js';
import { isMechanicEnabled } from './mechanics.js';
import { COMMANDER_CONFIG } from './commanders.js';
import { areCommanderMechanicsSuppressed } from './movement.js';

export const AIR_COMMAND_CONFIG = Object.freeze({
    strafe: Object.freeze({ name: '扫射', icon: '✈️', cost: 4, range: 5, cooldown: 2, targeting: 'enemyGlobal', multiplier: 1 }),
    bombing: Object.freeze({ name: '轰炸', icon: '💣', cost: 5, range: 5, cooldown: 2, targeting: 'anyTileGlobal', multiplier: 1 }),
    airdrop: Object.freeze({ name: '空降', icon: '🪂', cost: 10, range: 5, cooldown: 3, targeting: 'emptyTile', multiplier: 0 }),
    recon: Object.freeze({ name: '侦察机', icon: '🔭', cost: 4, range: 5, cooldown: 2, targeting: 'anyTileGlobal', multiplier: 0 })
});

export const AIRFIELD_BASE_POWER = 40;
export const COLONEL_AIR_DAMAGE_BONUS = 0.20;
export const COLONEL_AIR_STACK_BONUS = 0.05;
export const COLONEL_AIR_MAX_STACKS = 6;
export const COLONEL_AIR_RANGE_BONUS = 1;
export const COLONEL_ANTI_AIR_PIERCE = 0.15;
export const AIR_COMMAND_IMPACT_DELAY_MS = Object.freeze({
    strafe: 1200,
    bombing: 1200
});

/**
 * 把机场空军指令的结算结果转换为本地表现层的伤害数字。
 * 结算广播使用 damage 字段；兼容历史空袭结果的 dmg 字段。
 */
export function buildAirCommandDamageTexts(results, tileMap, now) {
    if (!Array.isArray(results) || !tileMap || typeof tileMap.get !== 'function') return [];
    const timestamp = Number.isFinite(now) ? now : performance.now();
    const texts = [];
    for (const result of results) {
        const tile = tileMap.get(`${result?.q},${result?.r}`);
        const value = Number(result?.damage ?? result?.dmg);
        if (!tile || !Number.isFinite(value) || value <= 0) continue;
        texts.push({
            x: tile.x,
            y: tile.y,
            value,
            isCrit: result?.isCrit === true,
            isAirDamage: true,
            timeLeft: 900,
            lastUpdate: timestamp
        });
    }
    return texts;
}

/**
 * 空军平台只读取所挂将领本人的面板攻击修正，不读取宿主兵种 ATK。
 * 以空军基础火力换算成定值，语义与普通单位构造时的将领攻击加成一致。
 */
export function getMountedCommanderAirAttackBonus(unit, baseAirPower) {
    if (!unit?.commander || unit.hp <= 0 || areCommanderMechanicsSuppressed(unit)) return 0;
    const modifier = Number(COMMANDER_CONFIG[unit.commander]?.definition?.atkBonusPct) || 0;
    return Math.round(Math.max(0, Number(baseAirPower) || 0) * modifier);
}

export function getAirfieldCommander(cityTile) {
    const unit = cityTile?.unit;
    return unit?.commander && unit.hp > 0 && unit.camp === cityTile.camp ? unit : null;
}

export function getAirfieldColonel(cityTile) {
    const unit = getAirfieldCommander(cityTile);
    return unit?.commander === 'colonel' && !areCommanderMechanicsSuppressed(unit) ? unit : null;
}

export function getAirCommandRange(cityTile) {
    return AIR_COMMAND_CONFIG.strafe.range + (getAirfieldColonel(cityTile) ? COLONEL_AIR_RANGE_BONUS : 0);
}

export function getAirCommandAvailability(kind, cityTile, state) {
    const config = AIR_COMMAND_CONFIG[kind];
    const installation = cityTile?.installation;
    if (!config || !cityTile?.isCity || installation?.type !== 'airfield') return { available: false, reason: '没有机场' };
    if (!isMechanicEnabled(state, 'airCommands')) return { available: false, reason: '本关未开放空军' };
    if (installation.status !== 'ready') return { available: false, reason: '机场尚未建成' };
    if (cityTile.camp !== state?.currentCamp) return { available: false, reason: '不是当前阵营的机场' };
    if (cityTile._cityDisabledUntil > getRoundIndex(state)) return { available: false, reason: '城市处于瘫痪' };
    if (state.weather === 'fog') return { available: false, reason: '雾天停飞' };
    // 每种指令按 (机场 × 指令) 独立冷却；同回合可出动多种不同指令，不设机场级共享闸。
    const currentRound = getRoundIndex(state);
    const readyRound = installation.airCommandReadyRound?.[kind];
    const legacyCooldown = installation.cooldowns?.[kind] || 0;
    const cooldown = Number.isFinite(readyRound)
        ? Math.max(0, readyRound - currentRound)
        : Math.max(0, legacyCooldown);
    if (cooldown > 0) return { available: false, reason: `冷却${cooldown}回合`, cooldown };
    if (kind === 'recon' && (!state.skirmishFog || state.campaignMode)) return { available: false, reason: '仅遭遇战迷雾可用' };
    const campKey = campToKey(cityTile.camp);
    if ((state.playerGold?.[campKey] || 0) < config.cost) return { available: false, reason: '金币不足' };
    return { available: true, reason: '', range: getAirCommandRange(cityTile), cooldown: 0 };
}

export function markAirCommandUsed(kind, cityTile, state) {
    const config = AIR_COMMAND_CONFIG[kind];
    if (!config || !cityTile?.installation) return;
    cityTile.installation.airCommandReadyRound ||= {};
    // R 回合使用后，冷却 N 回合意味着 R+N+1 回合恢复。
    cityTile.installation.airCommandReadyRound[kind] = getRoundIndex(state) + config.cooldown + 1;
    if (cityTile.installation.cooldowns) cityTile.installation.cooldowns[kind] = 0;
    state.playerGold[campToKey(cityTile.camp)] -= config.cost;
}
