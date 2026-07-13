// 染血的鸢尾花 · 第一章「花旗向东」
// BI-02 普通关「向东的旗」
// 誓师后的第一场实战。塞维鲁的命令在这里显得克制、体面而无可挑剔；
// 玩家必须以刚学会的基础操作清除路障，再将前卫旗带到峡谷入口。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const SEVERUS = Object.freeze({ name: '塞维鲁', portrait: 'advisor' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });

export const config = {
    schemaVersion: 2,
    id: 'bi-02-flag',
    title: '向东的旗',
    displayId: 'BI-02',
    chronicleId: 'blood-iris',
    seed: 0x2202,
    turnLimit: 3,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '花旗向东',
        scenarioSubtitle: 'BI-02 向东的旗'
    },

    weather: 'clear',
    localPlayerCamp: 'expedition',

    factions: [
        {
            id: 'expedition',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '奉摄政令东进的王国远征军前卫',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'roadblock',
            name: '峡谷前哨',
            color: 'gray',
            note: '拒绝让开驿道的武装斥候',
            controller: 'ai',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'villagers',
            name: '驿道村民',
            color: 'white',
            note: '正在撤离路边村落的平民',
            controller: 'scripted',
            participatesInTurns: false,
            active: true
        }
    ],

    turnOrder: ['expedition', 'roadblock'],
    diplomacy: {
        expedition: { roadblock: 'enemy', villagers: 'neutral' },
        roadblock: { expedition: 'enemy', villagers: 'neutral' },
        villagers: { expedition: 'neutral', roadblock: 'neutral' }
    },

    mechanics: {
        tacticalCards: false,
        recruitment: false,
        reinforcement: false,
        commanderSkills: false,
        weatherEffects: false,
        morale: true,
        fortifications: false,
        fogOfWar: false,
        alliedVision: false
    },

    aiOpponentCamp: '',
    aiDifficulty: 0.7,
    gold: { expedition: 0, roadblock: 0, villagers: 0 },
    commanders: { expedition: 'centurion' },
    hands: { expedition: [], roadblock: [], villagers: [] },

    board: {
        radius: 3,
        cities: [
            { q: -3, r: 3, districtId: 1, camp: 'expedition' },
            { q: 2, r: -2, districtId: 2, camp: 'roadblock' }
        ],
        terrain: [
            { q: -2, r: 1, type: 'forest' },
            { q: -1, r: 1, type: 'forest' },
            { q: 0, r: -1, type: 'forest' },
            { q: 1, r: -2, type: 'mountain' },
            { q: 2, r: -3, type: 'mountain' },
            { q: 3, r: -3, type: 'mountain' }
        ],
        villages: [{ q: -2, r: 2, districtId: 1 }],
        fortifications: [],
        districts: []
    },

    units: [
        {
            id: 'marcus_vanguard', type: 'infantry', camp: 'expedition', q: -3, r: 1,
            commander: 'centurion', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'shieldman_titus', type: 'infantry', camp: 'expedition', q: -3, r: 2,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'scout_elian', type: 'cavalry', camp: 'expedition', q: -2, r: 0,
            commander: '', hpPct: 90, morale: 3, canAct: true
        },
        {
            id: 'bowman_nia', type: 'archer', camp: 'expedition', q: -2, r: 1,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'blocker_spear', type: 'infantry', camp: 'roadblock', q: 0, r: 0,
            commander: '', hpPct: 100, morale: 2, canAct: true
        },
        {
            id: 'blocker_bow', type: 'archer', camp: 'roadblock', q: 1, r: -1,
            commander: '', hpPct: 85, morale: 2, canAct: true
        },
        {
            id: 'blocker_rider', type: 'cavalry', camp: 'roadblock', q: 1, r: 0,
            commander: '', hpPct: 80, morale: 1, canAct: true
        },
        {
            id: 'villager_mira', type: 'infantry', camp: 'villagers', q: -2, r: 2,
            commander: '', hpPct: 100, morale: 1, canAct: false
        },
        {
            id: 'villager_orin', type: 'infantry', camp: 'villagers', q: -1, r: 2,
            commander: '', hpPct: 100, morale: 1, canAct: false
        }
    ],

    unitGroups: [
        { id: 'vanguard', unitIds: ['marcus_vanguard', 'shieldman_titus', 'scout_elian', 'bowman_nia'] },
        { id: 'roadblock_patrol', unitIds: ['blocker_spear', 'blocker_bow', 'blocker_rider'] },
        { id: 'civilians', unitIds: ['villager_mira', 'villager_orin'] }
    ],

    areas: [
        { id: 'canyon_entrance', tiles: [{ q: 2, r: -2 }, { q: 3, r: -3 }] }
    ],
    interactables: [],
    variables: [
        { id: 'discipline_kept', scope: 'level', type: 'boolean', initial: true }
    ],

    objectives: {
        clear_road: {
            title: '清除驿道路障',
            detail: '击退占据中央驿道的峡谷前哨。',
            active: true,
            main: true
        },
        reach_canyon: {
            title: '将前卫旗带到峡谷入口',
            detail: '让马库斯抵达东侧的峡谷入口。',
            active: false,
            main: true
        }
    },

    triggers: [
        {
            id: 'opening_orders', enabled: true, once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                {
                    kind: 'showStep',
                    text: '东征军离开阿克罗斯的第三天，红旗沿驿道向东铺开。路边村庄已收到征调令，门窗紧闭，只有井绳还在风里轻响。'
                },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '前卫百夫长马库斯：峡谷之前有一支拒令的斥候。拿下路障，放他们的伤员回去。村民、粮车、井水，一样也不许动。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '听见了。我们是来开路，不是来把一条路踩成仇。盾在前，弓手看住树林；谁看见白布，先放下刀再说。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '百夫长，前面那面旗也有鸢尾。只是被泥糊得看不清花瓣。',
                    next: '__march_east'
                },
                { kind: 'setTriggerEnabled', trigger: 'march_east', enabled: true }
            ]
        },
        {
            id: 'march_east', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__march_east' }],
            do: [
                {
                    kind: 'showStep',
                    text: '清除中央路障，再由马库斯率前卫进入峡谷。侧翼的森林能掩护弓手，但也会遮住敌人的脚步。'
                }
            ]
        },
        {
            id: 'roadblock_cleared', enabled: true, once: true,
            when: [{ kind: 'groupState', group: 'roadblock_patrol', state: 'allDead' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'reach_canyon', status: 'active' },
                { kind: 'setObjectiveStatus', objective: 'clear_road', status: 'completed' },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '路通了。他们撤得很快，像是在替谁守住时间，不像是在守一堆石头。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '斥候不是用来猜心思的。把旗带到峡谷口，回报他们的兵种、人数、去向——只回报看见的。'
                }
            ]
        },
        {
            id: 'marcus_at_canyon', enabled: true, once: true,
            when: [{ kind: 'unitMovesToTile', target: { unit: 'marcus_vanguard' }, tiles: [{ q: 2, r: -2 }, { q: 3, r: -3 }], camp: 'expedition' }],
            do: [
                {
                    kind: 'showStep',
                    text: '峡谷像一条合拢的伤口。两侧的山把红旗压得很低，尽头却有一缕炊烟从佩特拉方向升起。',
                    next: '__report_canyon'
                },
                { kind: 'setTriggerEnabled', trigger: 'report_canyon', enabled: true }
            ]
        },
        {
            id: 'report_canyon', enabled: false, once: true,
            when: [{ kind: 'eventNextIs', value: '__report_canyon' }],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '传令：前卫已抵峡谷。明天之前，给全军留出能走、也能回头的路。'
                },
                { kind: 'setObjectiveStatus', objective: 'reach_canyon', status: 'completed' }
            ]
        },
        {
            id: 'civilian_harmed', enabled: true, once: true,
            when: [{ kind: 'unitKilled', target: { group: 'civilians' } }],
            do: [
                { kind: 'setVariable', variable: 'discipline_kept', operation: 'set', value: false },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '停手。我们带着军令来的，军令不是替任何人把无辜者写进伤亡簿。'
                }
            ]
        },
        {
            id: 'marcus_falls', enabled: true, once: true,
            when: [{ kind: 'unitKilled', target: { unit: 'marcus_vanguard' } }],
            do: [{ kind: 'endScenario', result: 'lose', reason: '前卫失去百夫长，东征军无法在峡谷前维持队形。' }]
        }
    ],

    result: {
        winText: '旗帜越过峡谷口。马库斯仍相信，整齐的旗帜总会指向整齐的答案。',
        loseText: '前卫未能完成东进命令。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '恪守军纪：村民无人伤亡',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'discipline_kept', op: '==', value: true }]
            },
            {
                label: '全员抵达峡谷入口',
                when: [{ kind: 'unitsInArea', area: 'canyon_entrance', camp: 'expedition', op: '>=', value: 4 }]
            }
        ]
    }
};
