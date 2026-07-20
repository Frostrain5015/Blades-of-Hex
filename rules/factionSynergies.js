// rules/factionSynergies.js — 阵营协同注册表。
// 新阵营只需在此注册成员、将领卡标识与 Hero 共鸣配置；具体战斗结算仍由各阵营规则模块负责。

import { campToKey } from './camps.js';

function defineFactionSynergy(definition) {
    return Object.freeze({
        ...definition,
        commanderIds: Object.freeze([...definition.commanderIds]),
        marker: Object.freeze({ ...definition.marker }),
        activation: definition.activation ? Object.freeze({ ...definition.activation }) : null,
        effect: definition.effect ? Object.freeze({ ...definition.effect }) : null,
        hero: Object.freeze({
            ...definition.hero,
            emblem: Object.freeze({ ...definition.hero.emblem }),
            theme: Object.freeze({ ...definition.hero.theme }),
            followup: definition.hero.followup
                ? Object.freeze({
                    ...definition.hero.followup,
                    particleColors: definition.hero.followup.particleColors
                        ? Object.freeze([...definition.hero.followup.particleColors])
                        : undefined
                })
                : null
        })
    });
}

export const AURELIA_FACTION_SYNERGY = defineFactionSynergy({
    id: 'aurelia',
    factionName: '奥雷利亚王国',
    commanderIds: [
        'ironGuard',
        'minister',
        'advisor',
        'centurion',
        'berserker'
    ],
    marker: {
        symbol: '⚜️',
        label: '奥雷利亚王国',
        color: '#f5cf72',
        borderColor: 'rgba(244, 210, 126, 0.72)',
        background: 'rgba(25, 12, 8, 0.82)',
        glowColor: 'rgba(231, 191, 105, 0.16)'
    },
    hero: {
        id: 'aurelia-oath',
        emblem: {
            kind: 'text',
            value: '⚜️',
            label: '鸢尾花徽记'
        },
        kicker: '阵营协同',
        title: '同一个誓言',
        durationMs: 5600,
        followupStartMs: 3650,
        theme: {
            text: '#f5e8c8',
            brightText: '#f8e9c3',
            accent: '#f5cf72',
            accentSoft: '#dca84f',
            faction: '#a91f2b',
            shadow: '#8d1622',
            backdropGlow: 'rgba(104, 43, 65, 0.2)',
            backdropTop: 'rgba(3, 3, 5, 0.7)',
            backdropBottom: 'rgba(12, 5, 9, 0.8)'
        },
        followup: {
            kind: 'rescue-link',
            particleCount: 18,
            particleColors: ['#f3d68b', '#d89b62']
        }
    }
});

export const AURELIA_COMMANDER_IDS = AURELIA_FACTION_SYNERGY.commanderIds;

// A-07「天鹰」特遣队：空军上校、工程师、天眼。
// 协同被动【天基支援协议】的平衡参数与判定在 rules/eagle.js；此处只登记身份与 Hero 主题。
export const EAGLE_FACTION_SYNERGY = defineFactionSynergy({
    id: 'eagle',
    factionName: '天鹰特遣队',
    commanderIds: [
        'colonel',
        'engineer',
        'tianyan'
    ],
    marker: {
        symbol: '🦅',
        label: '天鹰特遣队',
        color: '#7fd0ff',
        borderColor: 'rgba(127, 208, 255, 0.66)',
        background: 'rgba(6, 16, 26, 0.84)',
        glowColor: 'rgba(127, 208, 255, 0.16)'
    },
    hero: {
        id: 'eagle-skylink',
        emblem: {
            kind: 'text',
            value: '🦅',
            label: '天鹰徽记'
        },
        kicker: '阵营协同',
        title: '天基支援协议',
        durationMs: 4600,
        followupStartMs: 2800,
        theme: {
            text: '#d9e8f5',
            brightText: '#f0f8ff',
            accent: '#7fd0ff',
            accentSoft: '#4a89c4',
            faction: '#1d4e89',
            shadow: '#0a2238',
            backdropGlow: 'rgba(43, 96, 143, 0.20)',
            backdropTop: 'rgba(2, 4, 7, 0.70)',
            backdropBottom: 'rgba(4, 10, 16, 0.80)'
        },
        followup: {
            kind: 'orbital-supply',
            particleCount: 26,
            particleColors: ['#8fd8ff', '#f5d76e']
        }
    }
});

export const EAGLE_COMMANDER_IDS = EAGLE_FACTION_SYNERGY.commanderIds;

// 未命中任何文化阵营专属协同时的混编兜底项。
// 名称取自《诗经·秦风·无衣》“岂曰无衣？与子同袍”。
export const FELLOW_ROBE_FACTION_SYNERGY = defineFactionSynergy({
    id: 'fellow-robe',
    factionName: '异乡同袍',
    commanderIds: [],
    marker: {
        symbol: '🛡️',
        label: '与子同袍',
        color: '#d8c79e',
        borderColor: 'rgba(216, 199, 158, 0.68)',
        background: 'rgba(17, 20, 23, 0.84)',
        glowColor: 'rgba(216, 199, 158, 0.14)'
    },
    activation: {
        kind: 'fallback',
        minLivingCommanders: 2,
        excludesSpecialSynergies: true
    },
    effect: {
        name: '与子同袍',
        icon: '🛡️',
        type: '阵营协同',
        defenseBonusPct: 0.10,
        description: '同一阵营有至少两名来自不同势力的将领并肩作战，且未激活任何特殊阵营协同时，这些将领的防御力提高10%。'
    },
    hero: {
        id: 'fellow-robe',
        emblem: {
            kind: 'text',
            value: '袍',
            label: '同袍之印'
        },
        kicker: '阵营协同',
        title: '与子同袍',
        durationMs: 4200,
        followupStartMs: 0,
        theme: {
            text: '#eee4cb',
            brightText: '#fff5d9',
            accent: '#d8c79e',
            accentSoft: '#aa9163',
            faction: '#6f7880',
            shadow: '#252c32',
            backdropGlow: 'rgba(112, 120, 128, 0.18)',
            backdropTop: 'rgba(4, 6, 8, 0.70)',
            backdropBottom: 'rgba(12, 14, 17, 0.82)'
        },
        followup: null
    }
});

const FACTION_SYNERGIES = Object.freeze([
    AURELIA_FACTION_SYNERGY,
    EAGLE_FACTION_SYNERGY,
    FELLOW_ROBE_FACTION_SYNERGY
]);

const FACTION_SYNERGY_BY_ID = new Map(
    FACTION_SYNERGIES.map(synergy => [synergy.id, synergy])
);

const FACTION_SYNERGY_BY_COMMANDER_ID = new Map(
    FACTION_SYNERGIES.flatMap(synergy =>
        synergy.commanderIds.map(commanderId => [commanderId, synergy]))
);

export function getFactionSynergy(factionSynergyId) {
    return FACTION_SYNERGY_BY_ID.get(factionSynergyId) || null;
}

export function getCommanderFactionSynergy(commanderId) {
    return FACTION_SYNERGY_BY_COMMANDER_ID.get(commanderId) || null;
}

export function getLivingCommanderUnits(gameState, camp) {
    if (!gameState?.tiles || !camp) return [];
    const campId = campToKey(camp);
    return gameState.tiles
        .map(tile => tile.unit)
        .filter(unit => unit && unit.hp > 0
            && campToKey(unit.camp) === campId
            && unit.isCommanderUnit
            && unit.commander);
}

function getSpecialFactionSynergiesForCommanders(commanders) {
    const counts = new Map();
    for (const unit of commanders) {
        const synergy = getCommanderFactionSynergy(unit.commander);
        if (!synergy || synergy.activation?.kind === 'fallback') continue;
        counts.set(synergy.id, (counts.get(synergy.id) || 0) + 1);
    }
    return [...counts.entries()]
        .filter(([, count]) => count >= 2)
        .map(([synergyId]) => getFactionSynergy(synergyId));
}

export function getActiveSpecialFactionSynergies(gameState, camp) {
    return getSpecialFactionSynergiesForCommanders(getLivingCommanderUnits(gameState, camp));
}

// 所有模式统一从这里查询某个战场阵营当前生效的协同。
// 专属协同优先；只有完全未命中专属协同时，才返回混编兜底项。
export function getActiveFactionSynergies(gameState, camp) {
    const commanders = getLivingCommanderUnits(gameState, camp);
    const specialSynergies = getSpecialFactionSynergiesForCommanders(commanders);
    if (specialSynergies.length > 0) return specialSynergies;
    return commanders.length >= FELLOW_ROBE_FACTION_SYNERGY.activation.minLivingCommanders
        ? [FELLOW_ROBE_FACTION_SYNERGY]
        : [];
}

export function hasFellowRobeSynergy(gameState, camp) {
    return getActiveFactionSynergies(gameState, camp)
        .some(synergy => synergy.id === FELLOW_ROBE_FACTION_SYNERGY.id);
}

export function getFellowRobeDefenseBonus(unit, gameState) {
    return unit?.isCommanderUnit && hasFellowRobeSynergy(gameState, unit.camp)
        ? FELLOW_ROBE_FACTION_SYNERGY.effect.defenseBonusPct
        : 0;
}
