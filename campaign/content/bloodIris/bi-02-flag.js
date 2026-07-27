// 染血的鸢尾花 · 第一章「花旗向东」
// BI-02 普通关「泥中鸢尾」
//
// 关名取自路障那面旗：上面也有鸢尾，被泥糊住，看不清花瓣。
// 与第四章「窗前鸢尾」成对——同一朵花，一朵糊在军旗上，一朵开在市民窗台上。
//
// 设计意图：
//   大纲要求：清除驿道路障、抵达峡谷入口，可选保护村民；军令强调不得劫掠；
//   钩子是"旗帜越整齐，谎言越容易被相信"。
//
//   旧版把它做成"杀光三个人再往东走"，没有选择。这一版给出真正的两难：
//   路障是**东境巡道队**——同一支王国军，扛同样的鸢尾旗，奉佩特拉的命令封路。
//   他们的任务是拖延，不是打赢：第二个敌方回合开始时会自行撤走。
//   于是玩家面对一个有代价的选择——
//     · 强攻：立刻打开驿道，但杀的是自己人，失去「军纪」记录；
//     · 对峙：等他们撤，代价是站在弓手面前白挨两轮箭。
//   村口是第三条线：北面林道绕到村庄要花机动力，救人就得分兵。
//
// 关键信息只在撤退时给出（伤员身上的誓章编号与前卫同一批），
//   所以无论玩家选哪条路都会看到——但只有动过手的人，看到时含义不同。
//
// 数值依据（rules/）：驿道全平原 stepCost 2；北面林道 forest 3；
//   步兵 speed 4 = 2 格/回合，骑兵 speed 8 = 4 格/回合（林道 3+3+2 刚好一回合到村口）。
//   turnLimit 运行时不裁决，写 0；本关刻意不设时限——压力来自挨打，不是来自钟。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const SEVERUS = Object.freeze({ name: '塞维鲁', portrait: 'advisor' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });
const NIA = Object.freeze({ name: '妮娅', portrait: 'npcFemale' });
const AULUS = Object.freeze({ name: '奥卢斯', portrait: 'npcMale' });

const CANYON_MOUTH = Object.freeze([{ q: 4, r: -1 }, { q: 4, r: 0 }]);
const ROADBLOCK_TILES = Object.freeze([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: -1 }]);
const VILLAGE_TILE = Object.freeze({ q: 0, r: -3 });
// 马库斯走到路障正面这一圈时触发喊话。
const PARLEY_TILES = Object.freeze([
    { q: -1, r: 0 }, { q: -1, r: -1 }, { q: 0, r: -1 }, { q: 0, r: 1 }
]);

export const config = {
    schemaVersion: 4,
    id: 'bi-02-flag',
    title: '泥中鸢尾',
    displayId: 'BI-02',
    chronicleId: 'blood-iris',
    seed: 0x2202,
    turnLimit: 0,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '花旗向东',
        scenarioSubtitle: 'BI-02 泥中鸢尾'
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
            id: 'road_watch',
            name: '东境巡道队',
            color: 'gray',
            note: '奉佩特拉之命封锁驿道的王国东境驻军',
            controller: 'ai',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'villagers',
            name: '驿道村民',
            color: 'white',
            note: '尚未撤离的村口住户',
            controller: 'scripted',
            participatesInTurns: false,
            active: true
        }
    ],

    turnOrder: ['expedition', 'road_watch'],
    diplomacy: {
        expedition: { road_watch: 'enemy', villagers: 'neutral' },
        road_watch: { expedition: 'enemy', villagers: 'neutral' },
        villagers: { expedition: 'neutral', road_watch: 'neutral' }
    },

    mechanics: {
        tacticalCards: false,
        recruitment: false,
        reinforcement: false,
        commanderSkills: false,
        airCommands: false,
        weatherEffects: false,
        morale: true,
        fortifications: false,
        fogOfWar: false,
        alliedVision: false
    },

    aiOpponentCamp: '',
    // 巡道队的任务是拖延不是取胜，AI 压得很低；真正的压力来自"你不还手就一直挨箭"。
    aiDifficulty: 0.6,
    gold: { expedition: 0, road_watch: 0, villagers: 0 },
    commanders: { expedition: 'centurion' },
    hands: { expedition: [], road_watch: [], villagers: [] },
    storyCommanders: [
        { id: 'marcus', name: '马库斯', archetype: 'centurion' },
        { id: 'aulus', name: '奥卢斯', portrait: 'npcMale' }
    ],
    collectibles: [],

    board: {
        layout: 'hex',
        radius: 4,
        cities: [
            { q: -4, r: 0, districtId: 1, camp: 'expedition' }
        ],
        surface: [],
        // 构图：r=0 一整行是驿道（全平原、九格贯通东西），北面 r=-2 林带是绕行路，
        // 东端南北两簇山脊夹出峡谷口，西南林带收口。中央通道全程不放装饰。
        terrain: [
            { q: -3, r: -1, type: 'forest' },
            { q: -2, r: -2, type: 'forest' },
            { q: -1, r: -2, type: 'forest' },
            { q: 0, r: -2, type: 'forest' },
            { q: 1, r: -2, type: 'forest' },
            { q: 2, r: -2, type: 'forest' },
            { q: 0, r: 1, type: 'forest' },
            { q: 1, r: 1, type: 'forest' },
            { q: -4, r: 2, type: 'forest' },
            { q: -3, r: 2, type: 'forest' },
            { q: -2, r: 2, type: 'forest' },
            { q: 3, r: -3, type: 'mountain' },
            { q: 4, r: -3, type: 'mountain' },
            { q: 4, r: -4, type: 'mountain' },
            { q: 2, r: 1, type: 'mountain' },
            { q: 3, r: 1, type: 'mountain' },
            { q: 2, r: 2, type: 'mountain' }
        ],
        villages: [
            { q: VILLAGE_TILE.q, r: VILLAGE_TILE.r, districtId: 1 }
        ],
        fortifications: [],
        installations: [],
        districts: [],
        rivers: [],
        crossings: [],
        ports: []
    },

    units: [
        {
            id: 'marcus_vanguard', type: 'infantry', camp: 'expedition', q: -3, r: 0,
            storyCommander: 'marcus', hpPct: 100, morale: 2, canAct: true
        },
        { id: 'titus_shield', type: 'infantry', camp: 'expedition', q: -3, r: 1, hpPct: 100, morale: 2, canAct: true },
        { id: 'nia_bow', type: 'archer', camp: 'expedition', q: -4, r: 1, hpPct: 100, morale: 2, canAct: true },
        { id: 'elian_scout', type: 'cavalry', camp: 'expedition', q: -3, r: -1, hpPct: 100, morale: 3, canAct: true },

        {
            id: 'watch_aulus', type: 'infantry', camp: 'road_watch', q: 0, r: 0,
            storyCommander: 'aulus', hpPct: 100, morale: 2, canAct: true
        },
        { id: 'watch_shield', type: 'infantry', camp: 'road_watch', q: 1, r: 0, hpPct: 100, morale: 2, canAct: true },
        { id: 'watch_bow', type: 'archer', camp: 'road_watch', q: 1, r: -1, hpPct: 90, morale: 2, canAct: true },

        { id: 'villager_mira', type: 'infantry', camp: 'villagers', q: -1, r: -3, hpPct: 100, morale: 1, canAct: false },
        { id: 'villager_orin', type: 'infantry', camp: 'villagers', q: 1, r: -3, hpPct: 100, morale: 1, canAct: false },
        { id: 'villager_boy', type: 'infantry', camp: 'villagers', q: 1, r: -4, hpPct: 100, morale: 1, canAct: false }
    ],

    unitGroups: [
        { id: 'vanguard', unitIds: ['marcus_vanguard', 'titus_shield', 'nia_bow', 'elian_scout'] },
        { id: 'road_watch_squad', unitIds: ['watch_aulus', 'watch_shield', 'watch_bow'] },
        { id: 'village_folk', unitIds: ['villager_mira', 'villager_orin', 'villager_boy'] }
    ],

    areas: [
        { id: 'canyon_mouth', tiles: CANYON_MOUTH },
        { id: 'roadblock_line', tiles: ROADBLOCK_TILES }
    ],

    interactables: [
        {
            id: 'village_call',
            q: VILLAGE_TILE.q, r: VILLAGE_TILE.r,
            label: '让村民向西撤',
            enabled: true,
            unitIds: ['elian_scout', 'marcus_vanguard', 'titus_shield', 'nia_bow']
        }
    ],

    variables: [
        // 只要杀了巡道队的人或伤了村民，就失去「军纪」记录。
        { id: 'discipline_kept', scope: 'level', type: 'boolean', initial: true },
        { id: 'villagers_evacuated', scope: 'level', type: 'boolean', initial: false }
    ],

    objectives: {
        open_road: {
            title: '打开驿道',
            detail: '让占据驿道的东境巡道队离开路障——打退、打散，或者等他们自己撤。',
            active: true,
            main: true,
            highlight: { area: 'roadblock_line' }
        },
        reach_canyon: {
            title: '将前卫旗带到峡谷入口',
            detail: '驿道打通后，由马库斯亲自抵达东端峡谷口。',
            active: false,
            main: true,
            highlight: { area: 'canyon_mouth' }
        },
        evacuate_village: {
            title: '（可选）打发村口的人先走',
            detail: '派任意前卫单位走到北面村庄，让还没撤的三户人家向西离开。',
            active: true,
            main: false,
            highlight: { tiles: [VILLAGE_TILE] }
        }
    },

    triggers: [
        {
            id: 'opening_orders',
            title: '开场：宰相府军令与斥候回报',
            enabled: true,
            once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                {
                    kind: 'showStep',
                    text: '东征第三天，驿道。传令骑手在午前追上前卫，交来一片封蜡的军令抄本，印是宰相府的。'
                },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '前卫百夫长马库斯：峡谷之前有一支不肯让路的驻军。开路。伤员放回去，粮车不动，井不动，村里的人一个不许碰。回执照旧交驿站。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '艾利安，前面什么情况。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '报——人数三，步二弓一，横在路上。有旗，看不清号，泥糊住了。北面林子里有条道能绕，慢，但通。村口还有三户没走。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '记下：他们不动，我们就慢慢走过去。他们动了，再说别的。'
                },
                {
                    kind: 'showStep',
                    text: '驿道是九格直路，最快。北面林道绕过村口，慢一半。峡谷口在最东端。'
                }
            ]
        },

        {
            id: 'parley_at_roadblock',
            title: '接敌前的喊话',
            enabled: true,
            once: true,
            when: [
                {
                    kind: 'unitMovesToTile',
                    target: { unit: 'marcus_vanguard' }, camp: 'expedition',
                    tiles: PARLEY_TILES
                }
            ],
            do: [
                {
                    kind: 'showStep', speaker: AULUS,
                    text: '站住。东境巡道队，什长奥卢斯。这条路封了。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '王国远征军前卫。奉宰相府令东进。谁封的？'
                },
                {
                    kind: 'showStep', speaker: AULUS,
                    text: '佩特拉。要过，拿东境的通行凭据来。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '我手里的是讨逆令。'
                },
                {
                    kind: 'showStep', speaker: AULUS,
                    text: '那我手里的也是军令。百夫长，我们不追，也不让。你自己掂量。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '教头，他们弓手已经架起来了。站在这儿是要挨的。'
                }
            ]
        },

        {
            id: 'watch_withdraws',
            title: '巡道队按时撤离（拖延任务达成）',
            enabled: true,
            once: true,
            when: [
                { kind: 'turnStarted', camp: 'road_watch', turn: 1 },
                { kind: 'factionUnitCount', camp: 'road_watch', op: '>=', value: 1 }
            ],
            do: [
                {
                    kind: 'showStep',
                    text: '巡道队没有再放箭。他们把伤员架上肩，沿驿道往东退，退得很整齐——像是本来就只打算站到这个时辰。'
                },
                { kind: 'removeUnits', target: { group: 'road_watch_squad' }, mode: 'despawn' },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '报——他们伤员身上有章。A 字头，四位数，跟我们同一批的编号。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……把号码记下来。别的不用记。'
                }
            ]
        },

        {
            id: 'road_is_open',
            title: '驿道打通，转向峡谷口',
            enabled: true,
            once: true,
            when: [{ kind: 'factionUnitCount', camp: 'road_watch', op: '<=', value: 0 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'reach_canyon', status: 'active' },
                { kind: 'setObjectiveStatus', objective: 'open_road', status: 'completed' },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '路通了。全队沿驿道向东，旗跟着我。艾利安在前二百步，看见人先回来报，别自己去问。'
                }
            ]
        },

        {
            id: 'marcus_at_canyon',
            title: '前卫抵达峡谷口',
            enabled: true,
            once: true,
            when: [
                {
                    kind: 'unitMovesToTile',
                    target: { unit: 'marcus_vanguard' }, camp: 'expedition',
                    tiles: CANYON_MOUTH
                }
            ],
            do: [
                {
                    kind: 'showStep',
                    text: '两侧山壁把路收成两车宽。风从东边下来，带着远处的炊烟——佩特拉的方向。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '百夫长。刚才那队人……他们要是也算叛军，那佩特拉城里得有多少个叛军？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '这不是前卫该算的账。传令：前卫已抵峡谷，敌情三人、步二弓一、东撤——按实报。',
                    next: '__report_filed'
                },
                { kind: 'setTriggerEnabled', trigger: 'report_filed', enabled: true }
            ]
        },
        {
            id: 'report_filed',
            title: '回报归档，本关完成',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__report_filed' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'reach_canyon', status: 'completed' }
            ]
        },

        {
            id: 'village_evacuated',
            title: '村民撤离',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'village_call' }],
            do: [
                { kind: 'setVariable', variable: 'villagers_evacuated', operation: 'set', value: true },
                {
                    kind: 'showStep',
                    text: '村里只剩三户。听说前面在对峙，他们把锅和孩子一起装上板车，往西走了。走之前把井绳收进屋——像是打算回来的。'
                },
                { kind: 'removeUnits', target: { group: 'village_folk' }, mode: 'despawn' },
                { kind: 'setObjectiveStatus', objective: 'evacuate_village', status: 'completed' },
                { kind: 'setInteractionState', interactable: 'village_call', state: 'disabled' }
            ]
        },

        {
            id: 'watch_casualty',
            title: '打死了巡道队的人',
            enabled: true,
            once: true,
            when: [{ kind: 'unitKilled', target: { group: 'road_watch_squad' } }],
            do: [
                { kind: 'setVariable', variable: 'discipline_kept', operation: 'set', value: false },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '停。……不，接着打，打完再停。这会儿停下来，死的就是我们的人。'
                },
                {
                    kind: 'showStep',
                    text: '他没有再看倒下的那个。军令上写着"开路"，没写开路要花多少——那一栏历来是空的，由前卫自己填。'
                }
            ]
        },

        {
            id: 'villager_harmed',
            title: '误伤村民',
            enabled: true,
            once: true,
            when: [{ kind: 'unitKilled', target: { group: 'village_folk' } }],
            do: [
                { kind: 'setVariable', variable: 'discipline_kept', operation: 'set', value: false },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '谁下的手。——不用答。回去自己写在回执上，一个字不许改。'
                }
            ]
        },

        {
            id: 'marcus_falls',
            title: '失败：前卫失去指挥',
            enabled: true,
            once: true,
            when: [{ kind: 'unitKilled', target: { unit: 'marcus_vanguard' } }],
            do: [
                { kind: 'endScenario', result: 'lose', reason: '前卫百夫长阵亡，东征军无法在峡谷前维持队形。' }
            ]
        }
    ],

    result: {
        winText: '红旗越过峡谷口。回执上要填一个数字——无论填几，都由前卫自己填，也由前卫自己记住。',
        loseText: '前卫未能完成东进命令。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '恪守军纪：巡道队与村民无一阵亡',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'discipline_kept', op: '==', value: true }]
            },
            {
                label: '村口的人先走了',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'villagers_evacuated', op: '==', value: true }]
            }
        ]
    }
};
