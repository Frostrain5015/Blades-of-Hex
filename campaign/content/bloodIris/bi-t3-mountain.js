// 染血的鸢尾花 · 第一章「花旗向东」
// BI-T3 教学关「山有回声」
// 行军途中的地形演练：步兵登高、弓手借林、骑兵择机。它把“地形是半支军队”
// 教成一个战术事实，也把“山后是谁”留成一个马库斯暂不追问的问题。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });

export const config = {
    schemaVersion: 2,
    id: 'bi-t3-mountain',
    title: '山有回声',
    displayId: 'BI-T3',
    chronicleId: 'blood-iris',
    seed: 0x2303,
    turnLimit: 2,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '花旗向东',
        scenarioSubtitle: 'BI-T3 山有回声'
    },

    weather: 'clear',
    localPlayerCamp: 'expedition',
    factions: [
        {
            id: 'expedition',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '在峡谷外侧进行演练的东征军前卫',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'targets',
            ...BLOOD_IRIS_FACTION_PRESETS.trainingTargets,
            note: '按兵种布置的木制假想敌',
            controller: 'ai',
            participatesInTurns: false,
            active: true
        }
    ],
    turnOrder: ['expedition'],
    diplomacy: {
        expedition: { targets: 'enemy' },
        targets: { expedition: 'enemy' }
    },

    mechanics: {
        tacticalCards: false,
        recruitment: false,
        reinforcement: false,
        commanderSkills: false,
        weatherEffects: false,
        morale: false,
        fortifications: false,
        fogOfWar: false,
        alliedVision: false
    },

    aiOpponentCamp: '',
    aiDifficulty: 0.1,
    gold: { expedition: 0, targets: 0 },
    commanders: { expedition: 'centurion' },
    hands: { expedition: [], targets: [] },

    board: {
        radius: 3,
        cities: [{ q: -3, r: 3, districtId: 1, camp: 'expedition' }],
        terrain: [
            { q: -1, r: -1, type: 'mountain' },
            { q: 0, r: -2, type: 'mountain' },
            { q: -1, r: 0, type: 'forest' },
            { q: 0, r: -1, type: 'forest' },
            { q: 1, r: -2, type: 'forest' },
            { q: 2, r: -2, type: 'mountain' }
        ],
        villages: [],
        fortifications: [],
        districts: []
    },

    units: [
        {
            id: 'marcus_observer', type: 'infantry', camp: 'expedition', q: -2, r: -1,
            commander: 'centurion', hpPct: 100, morale: 2, canAct: false
        },
        {
            id: 'ridge_infantry', type: 'infantry', camp: 'expedition', q: -2, r: 0,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'forest_archer', type: 'archer', camp: 'expedition', q: -2, r: 1,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'open_cavalry', type: 'cavalry', camp: 'expedition', q: 0, r: 1,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'ridge_target', type: 'infantry', camp: 'targets', q: 0, r: -1,
            commander: '', hpPct: 100, morale: 2, canAct: false
        },
        {
            id: 'forest_target', type: 'archer', camp: 'targets', q: 1, r: -1,
            commander: '', hpPct: 100, morale: 2, canAct: false
        },
        {
            id: 'open_target', type: 'cavalry', camp: 'targets', q: 1, r: 0,
            commander: '', hpPct: 100, morale: 2, canAct: false
        }
    ],

    unitGroups: [
        { id: 'training_squad', unitIds: ['ridge_infantry', 'forest_archer', 'open_cavalry'] },
        { id: 'training_targets', unitIds: ['ridge_target', 'forest_target', 'open_target'] }
    ],
    areas: [
        { id: 'ridge_position', tiles: [{ q: -1, r: -1 }] },
        { id: 'forest_position', tiles: [{ q: -1, r: 0 }] }
    ],
    interactables: [],
    variables: [],

    objectives: {
        learn_terrain: {
            title: '完成峡谷地形演练',
            detail: '依次利用山地、森林与开阔地完成三次示范。',
            active: true,
            main: true
        }
    },

    triggers: [
        {
            id: 'start_drill', enabled: true, once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                { kind: 'setUnitState', target: { group: 'training_squad' }, state: 'canAct', value: false },
                { kind: 'setUnitState', target: { group: 'training_targets' }, state: 'canCounterattack', value: false },
                {
                    kind: 'applyEffect', target: { unit: 'ridge_infantry' }, effectId: 'training_light_kit',
                    name: '轻装演练', desc: '仅本次演练：行动力 +1，足以登上山脊。', emoji: '🎒', duration: 0,
                    statMods: { spdFlat: 1 }
                },
                { kind: 'setUnitState', target: { unit: 'ridge_infantry' }, state: 'canAct', value: true },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '峡谷前不能只靠一条路。高地、树林、开阔地，各会替不同的人说话。你们要学会先听地形，再听我。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '那山后要是有人呢？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '操典里没有“山后的人”。操典只告诉你：山会让谁走得慢，让谁活得久。先学会这半句，剩下半句上战场再问。',
                    next: '__infantry_to_ridge'
                },
                { kind: 'setTriggerEnabled', trigger: 'infantry_to_ridge', enabled: true }
            ]
        },
        {
            id: 'infantry_to_ridge', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__infantry_to_ridge' }],
            do: [
                {
                    kind: 'showStep',
                    text: '步兵能守住山脊，但山地移动消耗 6 点行动力。本次轻装演练刚好让他能登顶：选择步兵，移动到高亮山地。',
                    boardLock: true, dialogLock: true,
                    highlight: { unit: 'ridge_infantry', tiles: [{ q: -1, r: -1 }], hint: '让轻装步兵登上山脊。' }
                },
                { kind: 'setTriggerEnabled', trigger: 'infantry_on_ridge', enabled: true }
            ]
        },
        {
            id: 'infantry_on_ridge', enabled: false, once: true,
            when: [{ kind: 'unitMovesToTile', target: { unit: 'ridge_infantry' }, tiles: [{ q: -1, r: -1 }], camp: 'expedition' }],
            do: [
                { kind: 'setUnitState', target: { unit: 'forest_archer' }, state: 'canAct', value: true },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '山会拖慢你，也会替你挡掉一部分伤害。现在轮到弓手：森林移动消耗 3 点，却给远处的人一层看不见的盾。'
                },
                {
                    kind: 'showStep',
                    text: '选择弓手进入森林，再从林缘攻击右前方的训练靶。',
                    boardLock: true, dialogLock: true,
                    highlight: { unit: 'forest_archer', tiles: [{ q: -1, r: 0 }], hint: '先让弓手进入高亮森林。' }
                },
                { kind: 'setTriggerEnabled', trigger: 'archer_in_forest', enabled: true }
            ]
        },
        {
            id: 'archer_in_forest', enabled: false, once: true,
            when: [{ kind: 'unitMovesToTile', target: { unit: 'forest_archer' }, tiles: [{ q: -1, r: 0 }], camp: 'expedition' }],
            do: [
                {
                    kind: 'showStep',
                    text: '弓手射程为 2。现在攻击森林外、两格之外的训练靶。',
                    boardLock: true, dialogLock: true,
                    highlight: { unit: 'forest_archer', tiles: [{ q: 1, r: -1 }], hint: '从森林边缘攻击高亮训练靶。' }
                },
                { kind: 'setTriggerEnabled', trigger: 'archer_strikes', enabled: true }
            ]
        },
        {
            id: 'archer_strikes', enabled: false, once: true,
            when: [{ kind: 'unitAttacksUnit', attacker: { unit: 'forest_archer' }, defender: { unit: 'forest_target' }, attackerCamp: 'expedition' }],
            do: [
                { kind: 'setUnitState', target: { unit: 'open_cavalry' }, state: 'canAct', value: true },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '林子替弓手省下了挨箭的命，不会替他冲锋。开阔地留给骑兵——等敌人露出侧翼，再把速度押上去。'
                },
                {
                    kind: 'showStep',
                    text: '选择骑兵，攻击开阔地上的最后一个训练靶。',
                    boardLock: true, dialogLock: true,
                    highlight: { unit: 'open_cavalry', tiles: [{ q: 1, r: 0 }], hint: '以骑兵攻击高亮训练靶。' }
                },
                { kind: 'setTriggerEnabled', trigger: 'cavalry_strikes', enabled: true }
            ]
        },
        {
            id: 'cavalry_strikes', enabled: false, once: true,
            when: [{ kind: 'unitAttacksUnit', attacker: { unit: 'open_cavalry' }, defender: { unit: 'open_target' }, attackerCamp: 'expedition' }],
            do: [
                { kind: 'unlockInput' },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '记住：地形不是奖赏。它只是让你把同一把剑放在更合适的手里。等进了佩特拉，这句话也许会换一个意思。'
                },
                {
                    kind: 'showStep',
                    text: '山风从峡谷深处吹来，训练靶在风里轻响，像远处有人敲了一次没有回信的门。',
                    next: '__finish_drill'
                },
                { kind: 'setTriggerEnabled', trigger: 'finish_drill', enabled: true }
            ]
        },
        {
            id: 'finish_drill', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__finish_drill' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'learn_terrain', status: 'completed' }
            ]
        }
    ],

    result: {
        winText: '马库斯教会新兵如何借山、借林、借势；他还不知道，下一座城会让同一堂课替另一边的人活命。',
        loseText: '演练未能完成。',
        eliminateEnemy: false,
        starRules: []
    }
};
