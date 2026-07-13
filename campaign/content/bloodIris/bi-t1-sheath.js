// 染血的鸢尾花 · T1 教学关「出鞘」
// 闪回 · 东征前整训，马库斯任教官带新兵操练
// 教学内容：选择 → 移动 → 攻击
//
// 剧情要点：
//   开场：马库斯主持血印金币授予仪式，新兵宣誓
//   操练：新兵完成三项基础动作
//   收束：马库斯说"剑不问方向，问方向的是持剑的人"
//   反讽：此刻他自己也还没做到这句话
//
// 棋盘：R=3 战神校场（Campus Martius），阿克罗斯城外
// 天气：晴
// 回合：2
// 难度：★

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';

export const config = {
    schemaVersion: 2,
    id: 'bi-t1-sheath',
    title: '出鞘',
    displayId: 'BI-T1',
    chronicleId: 'blood-iris',
    seed: 0x1234,
    turnLimit: 2,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '雨夜孤城',
        scenarioSubtitle: 'T1 出鞘'
    },

    weather: 'clear',
    localPlayerCamp: 'player1',

    // ── 阵营 ────────────────────────────────────────────────
    factions: [
        {
            id: 'player1',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'targets',
            ...BLOOD_IRIS_FACTION_PRESETS.trainingTargets,
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

    // 教学关：关闭所有非核心机制
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
    aiDifficulty: 1.0,

    gold: { player1: 0 },
    commanders: { player1: 'centurion' },
    hands: {},

    // ── 棋盘 ────────────────────────────────────────────────
    board: {
        radius: 3,

        cities: [
            { q: 0, r: 0, districtId: 1, camp: 'player1' }
        ],

        terrain: [
            { q: -3, r:  0, type: 'forest' },
            { q: -2, r:  1, type: 'forest' },
            { q:  3, r: -1, type: 'forest' },
            { q:  2, r: -2, type: 'forest' },
            { q: -1, r:  2, type: 'forest' }
        ],

        villages: [],
        fortifications: [],
        districts: []
    },

    // ── 单位 ────────────────────────────────────────────────
    units: [
        {
            id: 'recruit1',
            type: 'infantry',
            camp: 'player1',
            q: -2,
            r: 0,
            hpPct: 100,
            morale: 2,
            canAct: true,
            commander: ''
        },
        {
            id: 'target1',
            type: 'infantry',
            camp: 'targets',
            q: 1,
            r: 0,
            hpPct: 100,
            morale: 2,
            canAct: false
        },
        {
            id: 'target2',
            type: 'infantry',
            camp: 'targets',
            q: 2,
            r: -1,
            hpPct: 100,
            morale: 2,
            canAct: false
        }
    ],

    unitGroups: [
        { id: 'training_targets', unitIds: ['target1', 'target2'] }
    ],

    areas: [],
    interactables: [],
    variables: [],

    // ── 目标 ────────────────────────────────────────────────
    objectives: {
        'main_training': {
            title: '完成基础训练',
            detail: '依次完成选择、移动、攻击三项基础操练',
            active: true,
            main: true
        }
    },

    // ── 触发器（新版异步链条：timer 开场 → 链式 setTriggerEnabled 推进）─
    triggers: [
        // 0. 开场对话（开场启用的计时器从关卡开始时计时）
        {
            id: 'start_dialogue',
            when: [{ kind: 'timer', value: 1500 }],
            do: [
                { kind: 'showStep',
                  speaker: { name: '马库斯', portrait: 'centurion' },
                  text: '新兵，欢迎来到塞雷利亚王国的北境校场。\n这枚血印金币是你们与王国的契约，选择走上这条路的那一刻起，你就要随时准备为它献出生命。',
                  boardLock: true },
                { kind: 'showStep',
                  speaker: { name: '马库斯', portrait: 'centurion' },
                  text: '我的职责是教会你们在战场上活下去。我们会从最基本的内容开始。',
                  boardLock: true },
                { kind: 'showStep',
                  text: '点击你的单位将其选中。选中的单位会高亮显示，同时面板会展示它的状态。',
                  boardLock: true, dialogLock: true,
                  highlight: { unit: 'recruit1', hint: '请点击你的步兵' } },
                // 训练靶禁用反击，避免教学期间意外伤害玩家
                { kind: 'setUnitState', target: { group: 'training_targets' }, state: 'canCounterattack', value: false },
                { kind: 'setTriggerEnabled', trigger: 'advance_to_move', enabled: true }
            ],
            once: true,
            enabled: true
        },
        // 1. 选中 recruit1 → 展示移动引导
        {
            id: 'advance_to_move',
            when: [{ kind: 'unitSelected', target: { unit: 'recruit1' } }],
            do: [
                { kind: 'showStep',
                  text: '好。现在点击高亮地块，命令单位前进。移动后可以继续执行其他指令。',
                  boardLock: true, dialogLock: true,
                  highlight: { tiles: [{ q: 0, r: 0 }], hint: '点击高亮地块移动到这里' } },
                { kind: 'setTriggerEnabled', trigger: 'advance_to_attack', enabled: true }
            ],
            once: true,
            enabled: false
        },
        // 2. recruit1 移动到 (0,0) → 展示攻击引导
        {
            id: 'advance_to_attack',
            when: [{ kind: 'unitMovesToTile', target: { unit: 'recruit1' }, q: 0, r: 0 }],
            do: [
                { kind: 'showStep',
                  text: '现在攻击训练草靶。点击假人所在位置进行攻击。',
                  boardLock: true, dialogLock: true,
                  highlight: { tiles: [{ q: 1, r: 0 }], hint: '攻击训练草靶' } },
                { kind: 'setTriggerEnabled', trigger: 'advance_to_outro', enabled: true }
            ],
            once: true,
            enabled: false
        },
        // 3. 攻击任一训练靶 → 展示收束剧情（通过 unit group 引用，不绑死单个单位 id）
        {
            id: 'advance_to_outro',
            when: [{ kind: 'unitAttacksUnit', attacker: { unit: 'recruit1' }, defender: { group: 'training_targets' } }],
            do: [
                { kind: 'showStep',
                  speaker: { name: '马库斯', portrait: 'centurion' },
                  text: '很好。选择——移动——攻击。这是战场上的三个基本动作。你们已经掌握了。' },
                { kind: 'showStep',
                  speaker: { name: '马库斯', portrait: '百夫长' },
                  text: '刀剑无影，重要的是谁拿着他们。今天就到这里。',
                  boardLock: true },
                { kind: 'setTriggerEnabled', trigger: 'check_complete', enabled: true }
            ],
            once: true,
            enabled: false
        },
        // 4. showStep 连播结束 → 完成关卡
        {
            id: 'check_complete',
            when: [{ kind: 'eventNextIs', value: '__chain_end__' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'main_training', status: 'completed' },
                { kind: 'unlockInput' },
                { kind: 'endScenario', result: 'win', ending: '' }
            ],
            once: true,
            enabled: false
        }
    ],

    // ── 结算 ────────────────────────────────────────────────
    result: {
        winText: '第一课完成。你的剑已经出鞘——方向尚未可知，但你已经在路上了。',
        loseText: '训练中断。重新集结，再来一次。',
        eliminateEnemy: false,
        starRules: []
    }
};
