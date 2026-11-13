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
    color: '#4ea8ff',
    desc: '友军承受暴击后振奋全军：周围1格友军士气上升，持续1回合。'
});

export const FIRE_SEA_CONFIG = Object.freeze({
    id: 'de_fire_sea',
    name: '火海',
    icon: '🔥',
    durationRounds: 2,
    maxLayers: 2,
    hpLossPctPerLayer: 0.10,
    color: '#ff6422',
    desc: '与地块绑定的焦土火海，持续2回合（最多叠加2层），每层每回合使格上单位流失10%生命值。'
});

export const BANZAI_CHARGE_CONFIG = Object.freeze({
    id: 'jp_banzai_charge',
    name: '万岁冲锋',
    icon: '⚔️',
    range: 2,
    cooldown: 1,
    selfDamageCurrentHpPct: 0.75,
    damageMultiplier: 1.85,
    killHealMaxHpPct: 0.60,
    desc: '向2格内敌军发起绝死突击（冷却1回合）：先自损75%当前生命值，造成重创并突进贴敌；若成功击杀敌军，无视禁疗回复60%最大生命值。'
});

export const CULTURE_CONFIG = deepFreeze({
    us: {
        id: 'us',
        name: '美国',
        flagPreset: 'img/flags/svg/us.svg',
        colorId: 'usaTeal',
        uniqueUnitType: 'us_marine',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.28, cy: 0.46, sizeRatio: 0.92 },
        tier1: {
            title: '海军陆战队',
            abilityName: '两栖登陆',
            summary: '以骑兵为基础模板的高机动精锐，可在己方城市或港口招募；进入浅海不额外消耗行动力，下海不损失攻防属性，从水域攻击陆地单位时伤害提高30%。'
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
        badgeCrop: { cx: 0.5, cy: 0.5, sizeRatio: 0.98 },
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
        badgeCrop: { cx: 0.5, cy: 0.5, sizeRatio: 1.0 },
        tier1: {
            title: '巨炮',
            abilityName: '远程重炮',
            summary: '超远射程（4格）与高杀伤重炮，无视陆军攻击海军的减伤规则并附带35%溅射；法国回合开始时自动随机炮击射程内一名敌军（该回合仍可移动，但不可再次手动攻击）。'
        },
        tier2: {
            title: '自由不屈',
            summary: '每当己方单位受到暴击伤害时，其周围1格（6邻格）范围内所有友军士气上升1回合。'
        }
    },
    ru: {
        id: 'ru',
        name: '苏联',
        flagPreset: 'img/flags/soviet-union.svg',
        colorId: 'red',
        uniqueUnitType: 'ru_katyusha',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.187, cy: 0.253, sizeRatio: 0.483 },
        tier1: {
            title: '喀秋莎火箭炮',
            abilityName: '火力覆盖',
            summary: '每次普通攻击均自动激发火箭弹幕并触发35%溅射伤害；全军普通炮兵取消火箭炮专精以保留溅射稀缺性。'
        },
        tier2: {
            title: '严冬铁卫',
            summary: '炮兵造价-1；己方全阵营单位免疫任何天气带来的负面效果。'
        }
    },
    kmt: {
        id: 'kmt',
        name: '中国国民党',
        flagPreset: 'img/flags/kuomintang.svg',
        colorId: 'blue',
        uniqueUnitType: 'kmt_training_brigade',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.5, cy: 0.5, sizeRatio: 0.88 },
        tier1: {
            title: '中央教导旅',
            abilityName: '血肉长城',
            summary: '驻守己方城市、城区或要塞工事时防御力额外提升25%，且在其中免疫暴击伤害。'
        },
        tier2: {
            title: '同心同德',
            summary: '己方城市生命上限+25%；部队在城市内补员时费用降低1/3。'
        }
    },
    cpc: {
        id: 'cpc',
        name: '中国共产党',
        flagPreset: 'img/flags/chinese-communist-party-old.svg',
        colorId: 'orange',
        uniqueUnitType: 'cpc_guerrilla',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.5, cy: 0.52, sizeRatio: 0.88 },
        tier1: {
            title: '游击纵队',
            abilityName: '敌后游击',
            summary: '无视任何负面地形与天气的行动力减益；平时对非己方隐藏行踪（皇帝AI除外），仅在敌军逼近至1格内或占领非己方原本控制的村庄时显形。'
        },
        tier2: {
            title: '军民鱼水',
            summary: '全军进入森林（-1）与山地（-2）的行动力消耗降低；部队在村庄补员时费用减半。'
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
            summary: '机场建造费用降至7金；己方空军攻击将在目标地块（轰炸含溅射格）附加2回合「火海」，每层每回合流失10%生命值，最多叠加2层。'
        }
    },
    jp: {
        id: 'jp',
        name: '日本',
        flagPreset: 'img/flags/svg/jp.svg',
        colorId: 'japanOlive',
        uniqueUnitType: 'jp_samurai',
        uniqueAirCommand: null,
        badgeCrop: { cx: 0.5, cy: 0.5, sizeRatio: 0.84 },
        tier1: {
            title: '帝国武士',
            abilityName: '武士信条 / 万岁冲锋',
            summary: '常驻禁疗（可在城市/村庄补员）；普攻1格，主动技【万岁冲锋】向2格内敌军绝死突击（冷却1回合，自损75%当前生命），若击杀敌军则无视禁疗回复60%最大生命。'
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
    if (terrain === 'mountain') return -2;
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
