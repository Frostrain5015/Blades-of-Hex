import { campToKey } from './camps.js';
import { deepFreeze } from './freeze.js';
import { getRoundIndex } from './turns.js';

export const FACTION_RULE_MODES = Object.freeze({
    NONE: 'none',
    CULTURE: 'culture',
    SYNERGY: 'synergy'
});

export const NEVER_SURRENDER_CONFIG = Object.freeze({
    id: 'gb_never_surrender',
    name: '永不言弃',
    icon: '🇬🇧',
    roundsPerStack: 2,
    bonusPerStackPct: 0.025,
    maxStacks: 6
});

export const FREE_RESISTANCE_EFFECT = Object.freeze({
    id: 'fr_free_resistance',
    name: '自由不屈',
    icon: '🇫🇷',
    radius: 1,
    durationRounds: 1,
    cooldownRounds: 2,
    shield: 24,
    color: '#4ea8ff',
    desc: '己方部队受到暴击伤害或阵亡时，周围1格友军士气上升并获得24点临时护盾，持续至各自下一次行动回合结束。每2回合最多触发1次。'
});

export function getFreeResistanceTurnDeadline(state, camp) {
    const order = state.turnOrder || [];
    const current = order.indexOf(campToKey(state.currentCamp));
    const target = order.indexOf(campToKey(camp));
    if (current < 0 || target < 0) return state.turnCounter + Math.max(1, order.length);
    // A grant before this faction's action lasts through that action. A grant
    // during its own action lasts through the following cycle.
    const distance = (target - current + order.length) % order.length || order.length;
    return state.turnCounter + distance + 1;
}

export const FIRE_SEA_CONFIG = Object.freeze({
    id: 'de_fire_sea',
    name: '火海',
    icon: '🔥',
    durationRounds: 2,
    maxLayers: 2,
    hpLossPctPerLayer: 0.10,
    color: '#ff6422',
    desc: '焦土火海持续2回合（最多叠加2层），每层每回合使格上非己方单位流失10%最大生命值。'
});

export const BANZAI_CHARGE_CONFIG = Object.freeze({
    id: 'jp_banzai_charge',
    name: '万岁冲锋',
    icon: '⚔️',
    range: 2,
    cooldown: 1,
    movementCost: 2,
    selfDamageCurrentHpPct: 0.25,
    missingHpDamagePct: 0.30,
    maxBonusDamage: 60,
    killHealMaxHpPct: 0.35,
    killMovementRefund: 2,
    desc: '消耗2点行动力与25%当前生命值（至少保留1点生命），向2格内敌军发起突击并贴近目标，在常规攻击基础上追加目标已损失生命值30%的伤害（上限60点）。若击杀目标，立即恢复35%最大生命值；本回合首次冲锋击杀还将返还1次行动机会与2点行动力。施放后下一己方回合进入冷却。'
});

export const GUERRILLA_CONCEALMENT_CONFIG = Object.freeze({
    name: '敌后隐匿',
    icon: '🌿',
    movementCost: 2,
    durationRounds: 1,
    cooldown: 1,
    ambushDamagePct: 0.65,
    desc: '消耗2点行动力隐蔽行踪，施放后本回合仍可继续移动与攻击，效果最长持续至下一次己方回合结束。隐匿期间首次主动攻击敌军将触发【奇袭】，造成的伤害提高65%并立即显形（攻击被闪避同样消耗并显形）。1格内有敌军时会被敌方看见，但不会失去当次【奇袭】效果。显形后下一己方回合进入冷却。'
});

export function getBanzaiBonusDamage(target) {
    return Math.min(BANZAI_CHARGE_CONFIG.maxBonusDamage,
        Math.max(0, target.maxHp - target.hp) * BANZAI_CHARGE_CONFIG.missingHpDamagePct);
}

export function getBanzaiCooldown(unit, state) {
    return unit._banzaiFollowupTurn === state.turnCounter ? 0
        : Math.max(0, (unit._banzaiReadyRound || 0) - getRoundIndex(state));
}

export function getGuerrillaConcealmentReason(unit, state) {
    if (unit._guerrillaHiddenThroughRound != null) return '隐匿生效中';
    if ((unit._guerrillaReadyRound || 0) > getRoundIndex(state)) return '冷却1回合';
    if (unit._imprisoned) return '被禁锢';
    if (!unit.canAct || unit.isNewRecruit || unit.isEmbarked || unit._transportTransitionedThisTurn
        || unit._campaignCanAct === false || unit.hp <= 0 || unit.morale === 0) return '本回合无法行动';
    if (!(unit.remainingMP >= GUERRILLA_CONCEALMENT_CONFIG.movementCost)) return '行动力不足（需2点）';
    return '';
}

export const SAMURAI_PASSIVE_DESCRIPTION = '无法接受常规治疗，仅可在城市或村庄补员。主动技【万岁冲锋】可消耗2点行动力与25%当前生命值突击2格内敌军，追加目标已损失生命值30%的伤害（至多60点）；击杀目标时恢复35%最大生命值，且每回合首次冲锋击杀后额外获得1次行动机会与2点行动力。';
export const GUERRILLA_PASSIVE_DESCRIPTION = '移动不受地形与天气的额外行动力消耗影响。可消耗2点行动力进入【隐匿】状态（持续至下一次己方回合结束，显形后冷却1回合）；隐匿期间首次主动攻击触发【奇袭】，造成的伤害提高65%并显形。1格内有敌军时会被侦测，但仍保留当次奇袭加成。';

export const CULTURE_CONFIG = deepFreeze({
    us: {
        id: 'us',
        name: '美国',
        flagPreset: 'img/flags/svg/us.svg',
        colorId: 'usaTeal',
        uniqueUnitType: 'us_marine',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.28, cy: 0.46, sizeRatio: 0.92, fillScale: 0.81 },
        tier1: {
            title: '海军陆战队',
            abilityName: '两栖登陆',
            summary: '可在城市或港口招募，也可在己方已启用的港口补员。入水保持原攻防属性，从水上攻击陆地单位、或在陆地与水上攻击舰船均免除陆海交战的50%减伤；登陆后仍可行动。'
        },
        tier2: {
            title: '海洋霸权',
            summary: '己方所有位于海上的单位行动力+1；舰船在港口维修费用降低50%。'
        }
    },
    gb: {
        id: 'gb',
        name: '英国',
        flagPreset: 'img/flags/svg/gb.svg',
        colorId: 'yellow',
        uniqueUnitType: 'gb_battleship',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.5, cy: 0.5, sizeRatio: 0.98, fillScale: 0.81 },
        tier1: {
            title: '皇家战列舰',
            abilityName: '天佑女王',
            summary: '常驻2格反潜侦测能力；受到敌方攻击时有20%概率闪避全部伤害。'
        },
        tier2: {
            title: '永不言弃',
            summary: '战局每进行2回合，己方全阵营单位攻击力+2.5%、防御力+2.5%，最高叠加6层（+15%）。'
        }
    },
    fr: {
        id: 'fr',
        name: '法国',
        flagPreset: 'img/flags/svg/fr.svg',
        colorId: 'franceSky',
        uniqueUnitType: 'fr_heavy_cannon',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.5, cy: 0.5, sizeRatio: 1.0, fillScale: 0.783 },
        tier1: {
            title: '法国巨炮',
            abilityName: '远程重炮',
            summary: '射程5格，攻击附带35%溅射伤害，且攻击海军不受陆军对海减伤影响。回合开始时自动炮击射程内随机敌军，触发后本回合仍可移动，但无法再次攻击。'
        },
        tier2: {
            title: '自由不屈',
            summary: FREE_RESISTANCE_EFFECT.desc
        }
    },
    ru: {
        id: 'ru',
        name: '苏联',
        flagPreset: 'img/flags/soviet-union.svg',
        colorId: 'red',
        uniqueUnitType: 'ru_katyusha',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.187, cy: 0.253, sizeRatio: 0.535 },
        tier1: {
            title: '喀秋莎火箭炮',
            abilityName: '火力覆盖',
            summary: '每次攻击均发射火箭弹幕，对目标相邻敌军造成35%溅射伤害。'
        },
        tier2: {
            title: '严冬铁卫',
            summary: '炮兵造价-1；己方全阵营单位免疫任何天气带来的负面效果。'
        }
    },
    kmt: {
        id: 'kmt',
        name: '中华民国',
        flagPreset: 'img/flags/kuomintang.svg',
        colorId: 'blue',
        uniqueUnitType: 'kmt_training_brigade',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.5, cy: 0.5, sizeRatio: 0.905 },
        tier1: {
            title: '中央教导旅',
            abilityName: '同心同德',
            summary: '场上存在至少2支己方陆上教导旅时彼此休戚与共，共享生命与治疗，所获城防、工事及地形防御加成提高50%，并使自身与相邻友军造成的伤害提高15%（多支教导旅的伤害加成不叠加）。'
        },
        tier2: {
            title: '一寸山河一寸血',
            summary: '己方城市生命上限+25%；部队在城市内补员时费用降低1/3。'
        }
    },
    cpc: {
        id: 'cpc',
        name: '中共苏区',
        flagPreset: 'img/flags/chinese-communist-party-old.svg',
        colorId: 'orange',
        uniqueUnitType: 'cpc_guerrilla',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.5, cy: 0.52, sizeRatio: 0.88 },
        tier1: {
            title: '游击纵队',
            abilityName: '敌后游击',
            summary: GUERRILLA_PASSIVE_DESCRIPTION
        },
        tier2: {
            title: '军民鱼水',
            summary: '部队不受地形额外行动力消耗影响，在村庄补员时费用减半。'
        }
    },
    de: {
        id: 'de',
        name: '德国',
        flagPreset: 'img/flags/germany-iron-cross.svg',
        colorId: 'germanyGray',
        uniqueUnitType: null,
        uniqueAirCommand: 'stukaDiveBomb',
        badgeCrop: { cx: 0.461, cy: 0.5, sizeRatio: 0.88 },
        tier1: {
            title: '斯图卡俯冲轰炸',
            abilityName: '俯冲精准打击',
            summary: '德国专属机场空军指令：精准俯冲轰炸目标区域并无视50%敌方防空火力减伤（可附加火海）。'
        },
        tier2: {
            title: '焦土空袭',
            summary: '机场建造费用降至7金；己方空军攻击会在命中地块（含轰炸波及的相邻地块）燃起持续2回合的「火海」，每层每回合使格上敌军流失10%最大生命值，最多叠加2层。'
        }
    },
    jp: {
        id: 'jp',
        name: '日本',
        flagPreset: 'img/flags/svg/jp.svg',
        colorId: 'japanOlive',
        uniqueUnitType: 'jp_samurai',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.5, cy: 0.5, sizeRatio: 1.0, fillScale: 0.94 },
        tier1: {
            title: '帝国武士',
            abilityName: '武士信条',
            summary: SAMURAI_PASSIVE_DESCRIPTION
        },
        tier2: {
            title: '武运长久',
            summary: '己方所有单位获取经验值速度+20%，更快晋升授勋。'
        }
    }
});

export const CULTURE_ORDER = Object.freeze(['us', 'gb', 'fr', 'ru', 'kmt', 'cpc', 'de', 'jp']);

const FLAG_TO_CULTURE_ID = Object.freeze(
    Object.fromEntries(CULTURE_ORDER.map(id => [CULTURE_CONFIG[id].flagPreset, id]))
);

export function normalizeFactionRuleMode(mode) {
    if (mode === FACTION_RULE_MODES.CULTURE) return FACTION_RULE_MODES.CULTURE;
    if (mode === FACTION_RULE_MODES.SYNERGY) return FACTION_RULE_MODES.SYNERGY;
    return FACTION_RULE_MODES.NONE;
}

export function isCultureSystemEnabled(state) {
    return !state?.campaignMode && normalizeFactionRuleMode(state?.factionRuleMode) === FACTION_RULE_MODES.CULTURE;
}

export function isFactionSynergyRuleActive(state) {
    if (state?.campaignMode) return true;
    return normalizeFactionRuleMode(state?.factionRuleMode) === FACTION_RULE_MODES.SYNERGY;
}

export function getCultureById(cultureId) {
    return cultureId ? CULTURE_CONFIG[cultureId] || null : null;
}

export function getCultureIdForFlagPreset(flagPreset) {
    return typeof flagPreset === 'string' ? FLAG_TO_CULTURE_ID[flagPreset] || null : null;
}

export function getCultureForFaction(faction) {
    return getCultureById(getCultureIdForFlagPreset(faction?.flagPreset));
}

export function getActiveFactionCulture(state, campOrFaction) {
    if (!isCultureSystemEnabled(state) || !campOrFaction) return null;
    if (typeof campOrFaction === 'object' && campOrFaction.flagPreset) {
        return getCultureForFaction(campOrFaction);
    }
    const campKey = campToKey(campOrFaction);
    if (!campKey || campKey === 'neutral') return null;
    const faction = state?.factions?.[campKey];
    return getCultureForFaction(faction);
}

export function getActiveCultureId(state, campOrFaction) {
    return getActiveFactionCulture(state, campOrFaction)?.id || null;
}

export function isCampCulture(state, campOrFaction, cultureId) {
    return Boolean(cultureId) && getActiveCultureId(state, campOrFaction) === cultureId;
}

export function getCultureUniqueUnitType(cultureId) {
    return CULTURE_CONFIG[cultureId]?.uniqueUnitType || null;
}

export function getCulturalBadgeCropForUnit(unitOrType, cultureIdHint = null) {
    const cultureId = cultureIdHint || unitOrType?.config?.cultureId || unitOrType?.cultureId || null;
    const culture = getCultureById(cultureId);
    if (!culture) return null;
    return {
        cultureId: culture.id,
        flagPreset: culture.flagPreset,
        badgeCrop: culture.badgeCrop,
        colorId: culture.colorId,
        name: culture.name
    };
}

export function getNeverSurrenderStacks(state, camp) {
    if (!isCampCulture(state, camp, 'gb')) return 0;
    const roundIdx = Math.max(0, Number(getRoundIndex(state)) || 0);
    return Math.min(
        NEVER_SURRENDER_CONFIG.maxStacks,
        Math.floor(roundIdx / NEVER_SURRENDER_CONFIG.roundsPerStack)
    );
}

export function getNeverSurrenderStatBonus(state, camp) {
    return getNeverSurrenderStacks(state, camp) * NEVER_SURRENDER_CONFIG.bonusPerStackPct;
}

export function getArtilleryCostDiscount(state, camp, unitType) {
    if (!isCampCulture(state, camp, 'ru')) return 0;
    return unitType === 'archer' || unitType === 'ru_katyusha' ? 1 : 0;
}

export function hasNegativeWeatherImmunity(state, camp) {
    return isCampCulture(state, camp, 'ru');
}

export function getCulturalCityMaxHpBonusPct(state, camp) {
    return isCampCulture(state, camp, 'kmt') ? 0.25 : 0;
}

export function getCulturalCityMaxHp(baseMaxHp, state, camp) {
    const base = Math.max(0, Number(baseMaxHp) || 0);
    const bonus = getCulturalCityMaxHpBonusPct(state, camp);
    return bonus > 0 ? Math.round(base * (1 + bonus)) : base;
}

export function getCulturalReinforceCostScale(state, tile, camp) {
    const cultureId = getActiveCultureId(state, camp);
    if (cultureId === 'kmt' && (tile?.isCity || tile?.isUrban)) {
        return 2 / 3;
    }
    if (cultureId === 'cpc' && tile?.isVillage) {
        return 0.5;
    }
    return 1;
}

export function getCulturalPortRepairCostScale(state, camp) {
    return isCampCulture(state, camp, 'us') ? 0.5 : 1;
}

export function getCulturalAirfieldCost(baseCost, state, camp) {
    return isCampCulture(state, camp, 'de') ? 7 : baseCost;
}

export function getCulturalWaterMovementBonus(state, camp) {
    return isCampCulture(state, camp, 'us') ? 1 : 0;
}

export function getCulturalTerrainStepDelta(state, camp, terrain) {
    if (!isCampCulture(state, camp, 'cpc')) return 0;
    if (terrain === 'forest') return -1;
    if (terrain === 'mountain') return -4;
    return 0;
}

export function getCulturalXpMultiplier(state, camp) {
    return isCampCulture(state, camp, 'jp') ? 1.20 : 1;
}

export function getFireSeaState(tile) {
    const fs = tile?.fireSea;
    if (!fs || typeof fs !== 'object') return null;
    const layers = Math.max(0, Math.min(FIRE_SEA_CONFIG.maxLayers, Math.round(Number(fs.layers) || 0)));
    const roundsRemaining = Math.max(0, Math.round(Number(fs.roundsRemaining) || 0));
    if (layers <= 0 || roundsRemaining <= 0) return null;
    return {
        layers,
        roundsRemaining,
        casterCampKey: fs.casterCampKey || null
    };
}

export function getFireSeaDamagePct(tile) {
    const fs = getFireSeaState(tile);
    return fs ? fs.layers * FIRE_SEA_CONFIG.hpLossPctPerLayer : 0;
}

export function applyFireSeaToTile(tile, casterCamp, state, rounds = FIRE_SEA_CONFIG.durationRounds) {
    if (!tile || !isCampCulture(state, casterCamp, 'de')) return null;
    const prev = getFireSeaState(tile);
    const nextLayers = Math.min(FIRE_SEA_CONFIG.maxLayers, (prev?.layers || 0) + 1);
    const nextRounds = Math.max(prev?.roundsRemaining || 0, rounds);
    tile.fireSea = {
        layers: nextLayers,
        roundsRemaining: nextRounds,
        casterCampKey: campToKey(casterCamp)
    };
    return tile.fireSea;
}

export function clearFireSeaOnTile(tile) {
    if (tile) tile.fireSea = null;
}

export function expireFireSeaForStartingCamp(state, startingCamp) {
    const campKey = campToKey(startingCamp);
    const expired = [];
    for (const tile of state?.tiles || []) {
        const fs = getFireSeaState(tile);
        if (!fs) {
            if (tile?.fireSea) tile.fireSea = null;
            continue;
        }
        if (fs.casterCampKey !== campKey) continue;
        const nextRounds = fs.roundsRemaining - 1;
        if (nextRounds <= 0) {
            tile.fireSea = null;
            expired.push(tile);
        } else {
            tile.fireSea = {
                ...fs,
                roundsRemaining: nextRounds
            };
        }
    }
    return expired;
}
