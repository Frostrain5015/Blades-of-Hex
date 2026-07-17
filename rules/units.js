// rules/units.js — 0 阶标准兵种、专精与克制关系的单一规则源。

import { deepFreeze } from './freeze.js';

/**
 * 所有可招募常规单位都从这里的 0 阶标准面板创建。
 * 专精面板差值与逐阶能力不得反写到本对象，避免招募阶段泄露专精。
 */
export const UNIT_CONFIG = deepFreeze({
    infantry: { name: '步', hp: 180, attack: 40, defense: 0, speed: 4, range: 1, cost: 8, color: '#0a0a0a', movementDomain: 'land' },
    cavalry: { name: '骑', hp: 150, attack: 50, defense: 0, speed: 8, range: 1, cost: 10, color: '#0a0a0a', movementDomain: 'land' },
    archer: { name: '炮', hp: 90, attack: 55, defense: 0, speed: 3, range: 2, cost: 12, color: '#0a0a0a', movementDomain: 'land' },
    mgNest: { name: '碉堡', hp: 200, attack: 40, defense: 0.05, speed: 0, range: 2, cost: 0, color: '#8B7355', movementDomain: 'land', rankLocked: true, building: true },
    shoreBattery: { name: '岸防炮', hp: 150, attack: 50, defense: 0, speed: 0, range: 2, cost: 10, color: '#6f6657', movementDomain: 'land', rankLocked: true, building: true },
    drone: { name: '无人机', hp: 75, attack: 30, defense: 0, speed: 8, range: 2, cost: 0, color: '#6bbcff', movementDomain: 'land', rankLocked: true, building: true },
    destroyer: { name: '驱逐舰', hp: 140, attack: 40, defense: 0, speed: 6, range: 1, cost: 10, color: '#477b8c', movementDomain: 'naval' },
    // 保留 warship 内部 ID 兼容旧存档与战役，显示及数值为 0 阶巡洋舰。
    warship: { name: '巡洋舰', hp: 180, attack: 55, defense: 0, speed: 4, range: 2, cost: 15, color: '#315f78', movementDomain: 'naval' },
    submarine: { name: '潜艇', hp: 100, attack: 50, defense: 0, speed: 8, range: 1, cost: 12, color: '#233f50', movementDomain: 'naval' },
    carrier: { name: '航母', hp: 250, attack: 45, defense: 0.08, speed: 3, range: 5, cost: 20, color: '#244d69', movementDomain: 'naval', attackRole: 'carrierStrafe' }
});

/** v2 四阶奖励合同。所有待校准数值集中在此处。 */
export const UNIT_RANK_CONFIG = deepFreeze({
    xpThresholds: [5, 15, 25, 35],
    rankUpHealLostPct: 0.25,
    rank2: { hp: 15, attack: 10 },
    rank4: { regenPct: 0.15, critBonus: 0.25 }
});

const spec = (name, panel, abilities, description) => ({ name, panel, abilities, description });

/**
 * 专精键保持全局唯一，便于联机校验、战役预设和旧存档迁移。
 * abilities 中带斜线语义的数值以 rank1/rank3 保存。
 */
export const UNIT_SPECIALIZATION_CONFIG = deepFreeze({
    infantry: {
        garrisonInfantry: spec('卫戍步兵', { hp: 200, attack: 40, defense: 0.10, speed: 4, range: 1 }, {
            cityRegen: { rank1: 0.10, rank3: 0.20 },
            holdFirstHitReduction: { rank1: 0.15, rank3: 0.25 }
        }, '固守：擅长城市恢复与阵地防御'),
        assaultInfantry: spec('突击步兵', { hp: 180, attack: 48, defense: 0.05, speed: 6, range: 1 }, {
            fortificationDamage: { rank1: 0.15, rank3: 0.30 },
            killHeal: { rank1: 0.10, rank3: 0.20 }
        }, '攻坚：擅长突破城市、工事与建筑单位')
    },
    cavalry: {
        lightCavalry: spec('轻骑兵', { hp: 150, attack: 55, defense: 0.05, speed: 9, range: 1 }, {
            chargePerStep: { rank1: 0.10, rank3: 0.15, maxStacks: 3 },
            skirmishVisionBonus: 1
        }, '冲锋：移动距离转化为伤害'),
        heavyCavalry: spec('重骑兵', { hp: 170, attack: 50, defense: 0.10, speed: 5, range: 1 }, {
            counterDamageReduction: { rank1: 0.25, rank3: 0.40 },
            rangedArmorPierce: { rank1: 0.10, rank3: 0.15 }
        }, '铁蹄：降低受到的反击并穿透远程单位防御')
    },
    archer: {
        fieldGun: spec('野战炮', { hp: 100, attack: 60, defense: 0, speed: 3, range: 2 }, {
            armorPierce: { rank1: 0.08, rank3: 0.12, terrainOrWindMultiplier: 2 }
        }, '穿甲榴弹：专注单体穿甲'),
        rocketArtillery: spec('火箭炮', { hp: 90, attack: 40, defense: 0, speed: 3, range: 2 }, {
            splash: { rank1: 0.25, rank3: 0.35, totalDamageCap: 1 }
        }, '齐射：对主目标周围敌军造成溅射'),
        antiAirArtillery: spec('防空炮', { hp: 110, attack: 0, defense: 0.05, speed: 4, range: 2 }, {
            antiAir: { radius: 2, rank1: 0.35, rank3: 0.50 },
            cannotAttack: true
        }, '高射：只提供区域防空，不能普通攻击')
    },
    destroyer: {
        antiAirDestroyer: spec('防空驱逐舰', { hp: 140, attack: 40, defense: 0.05, speed: 6, range: 1 }, {
            antiAir: { radius: 2, rank1: 0.35, rank3: 0.50 }
        }, '防空机枪：为舰队提供区域防空'),
        antiSubDestroyer: spec('反潜驱逐舰', { hp: 150, attack: 40, defense: 0.05, speed: 7, range: 1 }, {
            submarineDetectionRadius: 2,
            submarineDamage: { rank1: 0.25, rank3: 0.40 }
        }, '猎潜：持续侦测并重创潜艇')
    },
    warship: {
        fleetCruiser: spec('制海型巡洋舰', { hp: 200, attack: 55, defense: 0.10, speed: 4, range: 2 }, {
            shipDamage: { rank1: 0.15, rank3: 0.25 },
            extraSalvo: { rank1: 0.15, rank3: 0.25, multiplier: 0.5 }
        }, '大口径舰炮：专注舰队决战'),
        supportCruiser: spec('支援型巡洋舰', { hp: 180, attack: 60, defense: 0.05, speed: 5, range: 3 }, {
            landDamage: 0.50,
            shoreSplashChance: { rank1: 0.15, rank3: 0.25, multiplier: 0.30, totalDamageCap: 1 }
        }, '火控雷达：专注对岸与攻城支援')
    }
});

export const UNBRANCHED_UNIT_REWARDS = deepFreeze({
    submarine: {
        rank1: { ability: 'submerge', nextAttackDamage: 0.25 },
        rank3: { ability: 'submerge', nextAttackDamage: 0.40 }
    },
    carrier: {
        rank1: { ability: 'carrierAviation', damageBonus: 0.15 },
        rank3: { ability: 'carrierAviation', damageBonus: 0.30 }
    }
});

const BUILDING_TYPES = new Set(Object.entries(UNIT_CONFIG)
    .filter(([, config]) => config.building === true || config.rankLocked === true)
    .map(([type]) => type));

const SPECIALIZATION_TO_TYPE = new Map();
for (const [type, options] of Object.entries(UNIT_SPECIALIZATION_CONFIG)) {
    for (const key of Object.keys(options)) SPECIALIZATION_TO_TYPE.set(key, type);
}

export function isBuildingUnit(unitOrType) {
    const type = typeof unitOrType === 'string' ? unitOrType : unitOrType?.type;
    return BUILDING_TYPES.has(type);
}

export function isRankLockedUnit(unitOrType) {
    const type = typeof unitOrType === 'string' ? unitOrType : unitOrType?.type;
    return UNIT_CONFIG[type]?.rankLocked === true;
}

export function getSpecializationOptions(unitOrType) {
    const type = typeof unitOrType === 'string' ? unitOrType : unitOrType?.type;
    const options = UNIT_SPECIALIZATION_CONFIG[type] || {};
    return Object.entries(options).map(([key, value]) => ({ key, ...value }));
}

export function getSpecialization(type, specializationKey) {
    return UNIT_SPECIALIZATION_CONFIG[type]?.[specializationKey] || null;
}

export function getSpecializationBaseType(specializationKey) {
    return SPECIALIZATION_TO_TYPE.get(specializationKey) || null;
}

export function isValidSpecialization(type, specializationKey) {
    return !!specializationKey && getSpecializationBaseType(specializationKey) === type;
}

export function unitNeedsSpecialization(unit) {
    return !!unit
        && !isRankLockedUnit(unit)
        && Number(unit._rank ?? unit.rank ?? 0) >= 1
        && getSpecializationOptions(unit).length > 0
        && !unit.specializationKey;
}

export function getSpecializationAbilityValue(unit, abilityKey) {
    const rank = Math.max(0, Number(unit?._rank ?? unit?.rank ?? 0));
    const ability = getSpecialization(unit?.type, unit?.specializationKey)?.abilities?.[abilityKey];
    if (ability == null) return null;
    if (typeof ability !== 'object' || Array.isArray(ability)) return ability;
    if (rank >= 3 && ability.rank3 != null) return ability.rank3;
    if (rank >= 1 && ability.rank1 != null) return ability.rank1;
    return ability;
}

/** 派生当前军衔与专精应有的面板；不会修改传入对象。 */
export function resolveUnitRankProfile(type, rank = 0, specializationKey = null) {
    const base = UNIT_CONFIG[type];
    if (!base) return null;
    const normalizedRank = Math.max(0, Math.min(4, Math.trunc(Number(rank) || 0)));
    const selected = normalizedRank >= 1 && isValidSpecialization(type, specializationKey)
        ? getSpecialization(type, specializationKey)
        : null;
    const pendingSpecialization = normalizedRank >= 1
        && getSpecializationOptions(type).length > 0
        && !selected;
    const rewardRank = pendingSpecialization ? 0 : normalizedRank;
    const panel = selected?.panel || base;
    const rank2 = rewardRank >= 2 ? UNIT_RANK_CONFIG.rank2 : { hp: 0, attack: 0 };
    const carrierAttack = type === 'carrier' ? rank2.attack : 0;
    return {
        hp: panel.hp + rank2.hp,
        attack: panel.attack + rank2.attack,
        defense: panel.defense,
        speed: panel.speed,
        range: panel.range,
        rankCritBonus: rewardRank >= 4 ? UNIT_RANK_CONFIG.rank4.critBonus : 0,
        rankRegenPct: rewardRank >= 4 ? UNIT_RANK_CONFIG.rank4.regenPct : 0,
        carrierAirPowerBonus: carrierAttack,
        specializationKey: selected ? specializationKey : null,
        pendingSpecialization,
        unbranchedReward: rewardRank >= 3
            ? UNBRANCHED_UNIT_REWARDS[type]?.rank3 || null
            : rewardRank >= 1 ? UNBRANCHED_UNIT_REWARDS[type]?.rank1 || null : null
    };
}

export function getUnitDisplayName(unit) {
    return getSpecialization(unit?.type, unit?.specializationKey)?.name
        || UNIT_CONFIG[unit?.type]?.name
        || unit?.type
        || '';
}

/** AI 与无控制者使用的确定性兜底；不含随机数，保证联机重放一致。 */
export function chooseDefaultSpecialization(unit, state = null) {
    const options = getSpecializationOptions(unit);
    if (!options.length) return null;
    const units = (state?.tiles || []).map(tile => tile.unit).filter(Boolean);
    const hostileUnits = units.filter(other => other.camp !== unit.camp);
    if (unit.type === 'archer') {
        const hostileAirPlatforms = hostileUnits.filter(other => other.type === 'carrier' || other._isDrone).length;
        return hostileAirPlatforms > 0 ? 'antiAirArtillery'
            : hostileUnits.filter(other => other.config?.building || other.tile?.isCity).length >= 2 ? 'rocketArtillery'
                : 'fieldGun';
    }
    if (unit.type === 'destroyer') {
        return hostileUnits.some(other => other.type === 'submarine') ? 'antiSubDestroyer' : 'antiAirDestroyer';
    }
    if (unit.type === 'warship') {
        return hostileUnits.filter(other => other.config?.movementDomain === 'naval').length
            >= hostileUnits.filter(other => other.config?.movementDomain !== 'naval').length
            ? 'fleetCruiser' : 'supportCruiser';
    }
    if (unit.type === 'infantry') return unit.tile?.isCity ? 'garrisonInfantry' : 'assaultInfantry';
    if (unit.type === 'cavalry') return 'lightCavalry';
    return options[0].key;
}

/** 行为克制关系。专精继续使用基础 type 的行列。 */
const targetTypes = Object.keys(UNIT_CONFIG);
const relationRow = overrides => Object.fromEntries(targetTypes.map(type => [type, overrides[type] ?? 1]));

export const COUNTER_RELATION = deepFreeze({
    infantry: relationRow({ archer: 0.75, cavalry: 1.25, mgNest: 0.75 }),
    archer: relationRow({ cavalry: 0.75, infantry: 1.25, mgNest: 1.25 }),
    cavalry: relationRow({ infantry: 0.75, archer: 1.25, mgNest: 0.75 }),
    mgNest: relationRow({ infantry: 1.25, archer: 0.75, cavalry: 1.25 }),
    shoreBattery: relationRow({ destroyer: 1.25, warship: 1.25, submarine: 1.25, carrier: 1.25 }),
    drone: relationRow({ infantry: 1.25 }),
    destroyer: relationRow({ warship: 0.75, submarine: 1.25 }),
    warship: relationRow({ destroyer: 1.25, submarine: 0.75, carrier: 1.25 }),
    submarine: relationRow({ destroyer: 0.75, warship: 1.25, carrier: 1.25 }),
    carrier: relationRow({})
});
