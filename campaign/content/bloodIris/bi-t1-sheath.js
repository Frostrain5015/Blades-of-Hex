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
            name: '奥雷利亚王国',
            color: '#ffaaaa',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'targets',
            name: '训练靶',
            color: '#b0b0b0', // 调色板 gray.tile
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
    commanders: { player1: 'centurion' }, // 红方主将百夫长（对策卡被禁用，仅标识不部署）
    hands: {},

    // ── 棋盘 ────────────────────────────────────────────────
    // 战神校场：中央指挥哨(城市)，四周平原开阔地，
    // 边缘点缀林地，远端立着训练草靶。
    board: {
        radius: 3,

        // 中央指挥哨（阵营颜色来源）
        cities: [
            { q: 0, r: 0, districtId: 1, camp: 'player1' }
        ],

        // 装饰性林地——为空旷的校场提供视觉纵深
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
    // 玩家操控一名新兵，对面立着两个训练靶（不可行动）
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

    // ── 剧情步骤 ─────────────────────────────────────────────
    // 步骤分两类：
    //   有 next → 对话框，显示「下一步」按钮，控制器自动推进
    //   无 next → 等待态，由触发器捕捉玩家操作后 showStep 推进
    //   allow 定义该步骤下的输入白名单（仅等待态有效）
    steps: {
        // 【开场】马库斯授予血印金币
        'intro1': {
            mode: 'character',
            speaker: { name: '马库斯', portrait: '百夫长' },
            text: '新兵，欢迎来到塞雷利亚王国的北境校场。\n这枚血印金币是你们与王国的契约，选择走上这条路的那一刻起，你就要随时准备为它献出生命。',
            next: 'intro2'
        },
        'intro2': {
            mode: 'character',
            speaker: { name: '马库斯', portrait: '百夫长' },
            text: '我的职责是教会你们在战场上活下去。我们会从最基本的内容开始。',
            next: 'select_guide'
        },

        // 【教学一：选择】让玩家点击选中 recruit1
        'select_guide': {
            mode: 'narrator',
            text: '点击你的单位将其选中。选中的单位会高亮显示，同时面板会展示它的状态。',
            allow: { units: ['recruit1'], hint: '请点击你的步兵' }
        },

        // 【教学二：移动】让玩家将 recruit1 移动到指定位置
        'move_guide': {
            mode: 'narrator',
            text: '好。现在点击高亮地块，命令单位前进。移动后可以继续执行其他指令。',
            allow: { tiles: [{ q: 0, r: 0 }], hint: '点击高亮地块移动到这里' }
        },

        // 【教学三：攻击】让玩家攻击训练靶
        'attack_guide': {
            mode: 'narrator',
            text: '现在攻击训练草靶。点击假人所在位置进行攻击。',
            allow: { tiles: [{ q: 1, r: 0 }], hint: '攻击训练草靶' }
        },

        // 【收束】马库斯点评
        'outro1': {
            mode: 'character',
            speaker: { name: '马库斯', portrait: '百夫长' },
            text: '很好。选择——移动——攻击。这是战场上的三个基本动作。你们已经掌握了。',
            next: 'outro2'
        },
        'outro2': {
            mode: 'character',
            speaker: { name: '马库斯', portrait: '百夫长' },
            text: '刀剑无影，重要的是谁拿着他们。今天就到这里。',
            next: '__complete__'
        }
    },

    // ── 目标 ────────────────────────────────────────────────
    objectives: {
        'main_training': {
            title: '完成基础训练',
            detail: '依次完成选择、移动、攻击三项基础操练',
            active: true,
            main: true
        }
    },

    initialStep: '',

    // ── 触发器 ──────────────────────────────────────────────
    // 教学关的核心流程由触发器驱动：玩家动作 → 条件匹配 → 推进到下一步
    triggers: [
        // 0. 关卡开始时展示开场对话
        {
            id: 'start_dialogue',
            when: [{ kind: 'levelStarted' }],
            do: [{ kind: 'showStep', step: 'intro1' }],
            once: true,
            enabled: true
        },
        // 1. 选中 recruit1 → 展示移动引导
        {
            id: 'advance_to_move',
            when: [{
                kind: 'unitSelected',
                target: { unit: 'recruit1' }
            }],
            do: [{ kind: 'showStep', step: 'move_guide' }],
            once: true,
            enabled: true
        },

        // 2. recruit1 移动到 (0,0) → 展示攻击引导
        {
            id: 'advance_to_attack',
            when: [{
                kind: 'unitMovesToTile',
                target: { unit: 'recruit1' },
                q: 0,
                r: 0
            }],
            do: [{ kind: 'showStep', step: 'attack_guide' }],
            once: true,
            enabled: true
        },

        // 3. recruit1 攻击 target1 → 展示收束剧情
        {
            id: 'advance_to_outro',
            when: [{
                kind: 'unitAttacksUnit',
                attacker: { unit: 'recruit1' },
                defender: { unit: 'target1' }
            }],
            do: [{ kind: 'showStep', step: 'outro1' }],
            once: true,
            enabled: true
        },

        // 4. 收束剧情结束（点击"下一步"触发 __complete__）→ 完成关卡
        {
            id: 'complete_level',
            when: [{
                kind: 'eventNextIs',
                value: '__complete__'
            }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'main_training', status: 'completed' },
                { kind: 'unlockInput' },
                { kind: 'endScenario', result: 'win', ending: '' }
            ],
            once: true,
            enabled: true
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

// 注意：不要加 export default config，否则 catalog.js 的 loadScenario 会误判为手写 scenario，
// 直接返回原始配置对象而不经 scenarioFromConfig 包装（缺失 buildBattlefield 等方法）。
