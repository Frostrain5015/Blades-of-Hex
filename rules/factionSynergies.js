// rules/factionSynergies.js — 阵营协同注册表。
// 新阵营只需在此注册成员、将领卡标识与 Hero 共鸣配置；具体战斗结算仍由各阵营规则模块负责。

function defineFactionSynergy(definition) {
    return Object.freeze({
        ...definition,
        commanderIds: Object.freeze([...definition.commanderIds]),
        marker: Object.freeze({ ...definition.marker }),
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

const FACTION_SYNERGIES = Object.freeze([
    AURELIA_FACTION_SYNERGY
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
