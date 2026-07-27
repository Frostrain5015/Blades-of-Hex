// 染血的鸢尾花 · 第一章「花旗向东」
// BI-T1 教学关「花与剑」
//
// 设计意图：
//   教学线——选中 / 移动 / 攻击，然后解锁自由操作，用一次「两回合内穿过校场」
//   把刚学的移动力经济立刻考一遍（教了就考，失败只挨骂不掉关）。
//   叙事线——建立玩家对摄政府的信任。塞维鲁不谈理想，只谈军饷、抚恤和名册；
//   正因为他说的都是真的、也确实做到了，后面的谎才立得住。
//
// 与后续关卡的连接：本关三名新兵提图斯／妮娅／艾利安即 BI-02、BI-05 里
//   马库斯的前卫班底。他们在这里领章，也在这里第一次问错问题。
//
// 数值依据（rules/）：
//   步兵 speed 4、平原 stepCost 2 → 每回合 2 格；末步豁免（js/gameLogic.js 的
//   移动 BFS：剩余行动力 ≥1 即可踏入任意地形）。列队区在 r=-2，新兵起点 r=3，
//   最快 3 个我方回合完成——所以主要目标不设回合限制，3 回合达成记为星级。
//   turnLimit 在运行时不裁决（scenarioFromConfig 只透传），故一律写 0，
//   真正的时限用 turnStarted 触发器实现。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const SEVERUS = Object.freeze({ name: '塞维鲁', portrait: 'advisor' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });
const NIA = Object.freeze({ name: '妮娅', portrait: 'npcFemale' });
const TITUS = Object.freeze({ name: '提图斯', portrait: 'npcMale' });

// 列队区：授章台南侧一排三格。
const OATH_LINE = Object.freeze([
    { q: -1, r: -2 }, { q: 0, r: -2 }, { q: 1, r: -2 }
]);
const DRILL_TILE = Object.freeze({ q: 1, r: 2 });
const DUMMY_TILE = Object.freeze({ q: 1, r: 1 });

export const config = {
    schemaVersion: 4,
    id: 'bi-t1-sheath',
    title: '花与剑',
    displayId: 'BI-T1',
    chronicleId: 'blood-iris',
    seed: 0x1234,
    turnLimit: 0,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '花旗向东',
        scenarioSubtitle: 'BI-T1 花与剑'
    },

    weather: 'clear',
    localPlayerCamp: 'player1',

    factions: [
        {
            id: 'player1',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '东征前最后一次整训的王国远征军',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'targets',
            ...BLOOD_IRIS_FACTION_PRESETS.trainingTargets,
            note: '校场木桩',
            controller: 'ai',
            participatesInTurns: false,
            active: true
        }
    ],

    turnOrder: ['player1'],

    diplomacy: {
        player1: { targets: 'enemy' },
        targets: { player1: 'enemy' }
    },

    // 第一课只开放基础棋盘操作，其余机制由后续教学关逐项解锁。
    mechanics: {
        tacticalCards: false,
        recruitment: false,
        reinforcement: false,
        commanderSkills: false,
        airCommands: false,
        weatherEffects: false,
        morale: false,
        fortifications: false,
        fogOfWar: false,
        alliedVision: false
    },

    aiOpponentCamp: '',
    aiDifficulty: 1.0,
    gold: { player1: 0, targets: 0 },
    commanders: { player1: 'centurion' },
    hands: { player1: [], targets: [] },
    storyCommanders: [
        { id: 'severus', name: '塞维鲁', archetype: 'advisor' },
        { id: 'marcus', name: '马库斯', archetype: 'centurion' }
    ],
    collectibles: [],

    board: {
        layout: 'hex',
        radius: 4,
        // 北端城市只承担授章台与区划颜色，不是攻防目标。
        cities: [
            { q: 0, r: -4, districtId: 1, camp: 'player1' }
        ],
        // 构图（VISUAL_DESIGN §4.1）：中央 q=0 草道自南贯北保持全空，
        // 林带压西南、山脊封东北，两座补给村给大校场生活尺度。
        terrain: [
            { q: -4, r: 1, type: 'forest' },
            { q: -4, r: 2, type: 'forest' },
            { q: -4, r: 3, type: 'forest' },
            { q: -3, r: 1, type: 'forest' },
            { q: -3, r: 2, type: 'forest' },
            { q: -2, r: 4, type: 'forest' },
            { q: -1, r: 4, type: 'forest' },
            { q: 0, r: 4, type: 'forest' },
            { q: 2, r: 1, type: 'forest' },
            { q: 3, r: -1, type: 'forest' },
            { q: 3, r: 0, type: 'forest' },
            { q: 4, r: -2, type: 'forest' },
            { q: 4, r: -1, type: 'forest' },
            { q: 1, r: -4, type: 'mountain' },
            { q: 2, r: -4, type: 'mountain' },
            { q: 3, r: -4, type: 'mountain' },
            { q: -2, r: -2, type: 'mountain' },
            { q: -3, r: -1, type: 'mountain' },
            { q: -4, r: 0, type: 'mountain' }
        ],
        surface: [],
        villages: [
            { q: -4, r: 4, districtId: 1 },
            { q: 4, r: 0, districtId: 1 }
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
            // 塞维鲁开场就在授章台上，避免后面对白角色凭空入场。
            id: 'severus_regent',
            type: 'infantry', camp: 'player1', q: 0, r: -4,
            hpPct: 100, morale: 2, canAct: false, storyCommander: 'severus'
        },
        {
            id: 'marcus_instructor',
            type: 'infantry', camp: 'player1', q: 0, r: -3,
            hpPct: 100, morale: 2, canAct: false, storyCommander: 'marcus'
        },
        { id: 'recruit_titus', type: 'infantry', camp: 'player1', q: 0, r: 3, hpPct: 100, morale: 2, canAct: true },
        { id: 'recruit_nia', type: 'infantry', camp: 'player1', q: -1, r: 3, hpPct: 100, morale: 2, canAct: true },
        { id: 'recruit_elian', type: 'infantry', camp: 'player1', q: 1, r: 3, hpPct: 100, morale: 2, canAct: true },
        {
            id: 'straw_dummy',
            type: 'infantry', camp: 'targets', q: DUMMY_TILE.q, r: DUMMY_TILE.r,
            hpPct: 100, morale: 2, canAct: false
        }
    ],

    unitGroups: [
        { id: 'new_recruits', unitIds: ['recruit_titus', 'recruit_nia', 'recruit_elian'] }
    ],

    areas: [
        { id: 'oath_line', tiles: OATH_LINE }
    ],
    interactables: [],
    variables: [
        // 三人各自打过一次木桩 → 星级；只有提图斯是引导内完成的。
        { id: 'strikes_landed', scope: 'level', type: 'number', initial: 0 },
        // 超过 3 个我方回合仍未列队 → 失去行军星级（不掉关）。
        { id: 'slow_march', scope: 'level', type: 'boolean', initial: false }
    ],

    objectives: {
        learn_basics: {
            title: '完成第一课',
            detail: '按教头口令依次完成选中、移动与攻击。',
            active: true,
            main: true,
            highlight: { unit: 'recruit_titus' }
        },
        form_line: {
            title: '在授章台前列队',
            detail: '沿中央草道向北，让三名新兵全部进入红旗前的列队区。',
            active: false,
            main: true,
            highlight: { area: 'oath_line' }
        }
    },

    triggers: [
        {
            id: 'start_drill',
            title: '开场：点名与第一课',
            enabled: true,
            once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                // 木桩不还手也不会被打死，三个人都能轮流练。
                {
                    kind: 'applyEffect', target: { unit: 'straw_dummy' }, effectId: 'straw_dummy_rule',
                    name: '草人', desc: '训练用木桩，不会被打倒，也不会还手。', emoji: '🎯', duration: 0,
                    rule: 'minHp', rulePercent: 1
                },
                { kind: 'setUnitState', target: { unit: 'straw_dummy' }, state: 'canCounterattack', value: false },
                { kind: 'setUnitState', target: { group: 'new_recruits' }, state: 'canAct', value: false },
                { kind: 'setUnitState', target: { unit: 'recruit_titus' }, state: 'canAct', value: true },
                {
                    kind: 'showStep',
                    text: '校场北端立着授章台。三十七名新兵按番号站成三列，等着念到自己的名字。这是东征前的最后一次整训。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: 'A-147，马库斯，前卫百夫长，本月教头。点到名的出列——提图斯、妮娅、艾利安。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '到！百夫长，能不能先问一句，我们什么时候领章——'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '出列。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '操典第一章三条：认人，站位，出手。今天只练这三条。练不熟的，明天接着练。'
                },
                {
                    kind: 'showStep',
                    text: '他用剑鞘敲了敲队列最前面那个人的胫甲。',
                    next: '__begin_select'
                },
                { kind: 'setTriggerEnabled', trigger: 'select_titus', enabled: true }
            ]
        },
        {
            id: 'select_titus',
            title: '第一步：选中',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__begin_select' }],
            do: [
                {
                    kind: 'showStep',
                    text: '第一条，认人：点击出列的提图斯，把他选中。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: { unit: 'recruit_titus', hint: '点击高亮的新兵把他选中' }
                },
                { kind: 'setTriggerEnabled', trigger: 'titus_selected', enabled: true }
            ]
        },
        {
            id: 'titus_selected',
            title: '第二步：移动',
            enabled: false,
            once: true,
            when: [{ kind: 'unitSelected', target: { unit: 'recruit_titus' }, camp: 'player1' }],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '蓝色的格子是他这一回合走得到的地方。步兵一回合两格，别指望第三格。'
                },
                {
                    kind: 'showStep',
                    text: '第二条，站位：把提图斯移动到木桩左侧的高亮位置。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'recruit_titus',
                        tiles: [DRILL_TILE],
                        hint: '把提图斯移动到高亮的训练位'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'titus_in_position', enabled: true }
            ]
        },
        {
            id: 'titus_in_position',
            title: '第三步：攻击',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitMovesToTile',
                    target: { unit: 'recruit_titus' }, camp: 'player1',
                    tiles: [DRILL_TILE]
                }
            ],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '站住了才有第三条。木桩就在你右手边——一格之内，够得着。'
                },
                {
                    kind: 'showStep',
                    text: '第三条，出手：攻击高亮的木桩。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'recruit_titus',
                        tiles: [DUMMY_TILE],
                        hint: '攻击高亮的训练木桩'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'titus_strikes', enabled: true }
            ]
        },
        {
            id: 'titus_strikes',
            title: '第一课完成，转入自由操作',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitAttacksUnit',
                    attacker: { unit: 'recruit_titus' }, defender: { unit: 'straw_dummy' },
                    attackerCamp: 'player1', defenderCamp: 'targets'
                }
            ],
            do: [
                // 先激活下一个主要目标，再完成当前目标，避免目标系统提前结算胜利。
                { kind: 'setObjectiveStatus', objective: 'form_line', status: 'active' },
                { kind: 'setObjectiveStatus', objective: 'learn_basics', status: 'completed' },
                { kind: 'setUnitState', target: { group: 'new_recruits' }, state: 'canAct', value: true },
                { kind: 'unlockInput' },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '教头。木桩不还手，人会还手。这条也照第三条打？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '人会还手，所以第二条要先站对。站错了，第三条就是别人打你。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '不再一步一步教了。三个人，自己走到北面红旗前列队。木桩留着，谁想再练就再练。'
                },
                {
                    kind: 'showStep',
                    text: '中央草道贯穿整座校场。三名新兵全部进入列队区后开始授章——两个回合走得完，第三个回合走得完但要挨骂。'
                }
            ]
        },
        {
            id: 'nia_strikes_dummy',
            title: '记录：妮娅练过木桩',
            enabled: true,
            once: true,
            when: [
                {
                    kind: 'unitAttacksUnit',
                    attacker: { unit: 'recruit_nia' }, defender: { unit: 'straw_dummy' },
                    attackerCamp: 'player1', defenderCamp: 'targets'
                }
            ],
            do: [{ kind: 'setVariable', variable: 'strikes_landed', operation: 'add', value: 1 }]
        },
        {
            id: 'elian_strikes_dummy',
            title: '记录：艾利安练过木桩',
            enabled: true,
            once: true,
            when: [
                {
                    kind: 'unitAttacksUnit',
                    attacker: { unit: 'recruit_elian' }, defender: { unit: 'straw_dummy' },
                    attackerCamp: 'player1', defenderCamp: 'targets'
                }
            ],
            do: [{ kind: 'setVariable', variable: 'strikes_landed', operation: 'add', value: 1 }]
        },
        {
            id: 'march_too_slow',
            title: '第四个我方回合仍未列队：失去行军星级',
            enabled: true,
            once: true,
            when: [
                { kind: 'turnStarted', camp: 'player1', turn: 3 },
                { kind: 'not', condition: { kind: 'objectiveStatusIs', objective: 'form_line', status: 'completed' } }
            ],
            do: [
                { kind: 'setVariable', variable: 'slow_march', operation: 'set', value: true },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '第四趟了。校场是平地，没有敌人，没有雨。到了东边，这样走的人排在最后面，最后面的人先死。'
                }
            ]
        },
        {
            id: 'line_formed',
            title: '三人列队完成，进入授章',
            enabled: true,
            once: true,
            when: [
                { kind: 'objectiveStatusIs', objective: 'form_line', status: 'active' },
                { kind: 'unitsInArea', area: 'oath_line', camp: 'player1', op: '>=', value: 3 }
            ],
            do: [
                { kind: 'setUnitState', target: { group: 'new_recruits' }, state: 'canAct', value: false },
                {
                    kind: 'showStep',
                    text: '三个人在红旗下站成一线。塞维鲁从授章台上下来，手里是名册，不是讲稿。',
                    next: '__oath'
                },
                { kind: 'setTriggerEnabled', trigger: 'oath_ceremony', enabled: true }
            ]
        },
        {
            id: 'oath_ceremony',
            title: '授章',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__oath' }],
            do: [
                { kind: 'unlockInput' },
                { kind: 'addUnitXp', target: { group: 'new_recruits' }, value: 5, fx: true },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '提图斯，A-411。妮娅，A-412。艾利安，A-413。章上刻着军团、番号和你们的名字，丢了要补，补一次扣半月饷——所以别丢。'
                },
                {
                    kind: 'showStep',
                    text: '三根拇指依次按进军籍上的红蜡。\n\n“以血印此花：我守奥雷利亚，奥雷利亚不负于我。”'
                },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '后半句是王冠欠你们的，我替它记着：饷钱每月十五发，从没拖过十六。阵亡的，章随人回家，抚恤按四十个月算。这两条写在册子上，不写在旗上。'
                },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '东征的事，你们的百夫长会讲。我只多说一句：别让我在名册上把你们从领饷那栏挪到抚恤那栏。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '百夫长——我听人说过您一句话。剑不问方向，问方向的是持剑的人。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '我没说过。我说的是：剑归你管，方向归军令管。后半句谁给你添的？'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '……忘了。听着好听。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '好听的话，等你活到退役再编。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '教头。明天几时？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '卯时，全甲，西门。散。',
                    next: '__dismiss'
                },
                { kind: 'setTriggerEnabled', trigger: 'dismiss', enabled: true }
            ]
        },
        {
            id: 'dismiss',
            title: '结束教学关',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__dismiss' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'form_line', status: 'completed' }
            ]
        }
    ],

    result: {
        winText: '红旗次日向东。那天没有人觉得马库斯的两句话彼此矛盾——包括他自己。',
        loseText: '操练中断。重新列队，再来一次。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '行军整齐：三个回合内全员列队',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'slow_march', op: '==', value: false }]
            },
            {
                label: '三人都上过木桩',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'strikes_landed', op: '>=', value: 2 }]
            }
        ]
    }
};
