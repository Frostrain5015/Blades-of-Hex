// 染血的鸢尾花 · 第一章「花旗向东」
// BI-T1 教学关「花与剑」v3
// 东征前的校场整训：选择 → 移动 → 攻击 → 全员列队授章。
// 表层目标是让玩家相信军纪与摄政府；底层伏笔是马库斯尚未察觉
// “持剑者决定方向”与“军令决定方向”之间的矛盾。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const SEVERUS = Object.freeze({ name: '塞维鲁', portrait: 'advisor' });

export const config = {
    schemaVersion: 2,
    id: 'bi-t1-sheath',
    title: '花与剑',
    displayId: 'BI-T1',
    chronicleId: 'blood-iris',
    seed: 0x1234,
    turnLimit: 2,

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

    // 第一课只开放基础棋盘操作，其余机制由后续教学关逐项解锁。
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
    gold: { player1: 0, targets: 0 },
    commanders: { player1: 'centurion' },
    hands: { player1: [] },
    storyCommanders: [
        { id: 'severus', name: '塞维鲁', archetype: 'advisor' },
        { id: 'marcus', name: '马库斯', archetype: 'centurion' }
    ],
    collectibles: [],

    board: {
        radius: 3,
        // 北端城市仅承担校场旗台和区划颜色来源，不是本关攻防目标。
        cities: [
            { q: 0, r: -3, districtId: 1, camp: 'player1' }
        ],
        terrain: [
            { q: -3, r: 0, type: 'forest' },
            { q: -2, r: 2, type: 'forest' },
            { q: 2, r: -2, type: 'forest' },
            { q: 3, r: -1, type: 'forest' }
        ],
        villages: [],
        fortifications: [],
        districts: []
    },

    units: [
        {
            // 塞维鲁亲临校场主持授章：从开场就在北端授章台上，避免对白角色凭空入场。
            id: 'severus_regent',
            type: 'infantry',
            camp: 'player1',
            q: 0,
            r: -3,
            hpPct: 100,
            morale: 2,
            canAct: false,
            storyCommander: 'severus'
        },
        {
            id: 'marcus_instructor',
            type: 'infantry',
            camp: 'player1',
            q: 0,
            r: -2,
            hpPct: 100,
            morale: 2,
            canAct: false,
            storyCommander: 'marcus'
        },
        {
            id: 'recruit_sword',
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
            id: 'recruit_flower',
            type: 'infantry',
            camp: 'player1',
            q: -2,
            r: 1,
            hpPct: 100,
            morale: 2,
            canAct: true,
            commander: ''
        },
        {
            id: 'recruit_banner',
            type: 'infantry',
            camp: 'player1',
            q: -1,
            r: -1,
            hpPct: 100,
            morale: 2,
            canAct: true,
            commander: ''
        },
        {
            id: 'training_dummy',
            type: 'infantry',
            camp: 'targets',
            q: 1,
            r: 0,
            hpPct: 100,
            morale: 2,
            canAct: false,
            commander: ''
        }
    ],

    unitGroups: [
        { id: 'new_recruits', unitIds: ['recruit_sword', 'recruit_flower', 'recruit_banner'] },
        { id: 'training_targets', unitIds: ['training_dummy'] }
    ],

    areas: [
        {
            id: 'oath_line',
            tiles: [
                { q: 0, r: 0 },
                { q: 0, r: 1 },
                { q: 1, r: -1 }
            ]
        }
    ],
    interactables: [],
    variables: [],

    objectives: {
        learn_basics: {
            title: '完成第一课',
            detail: '依次完成选择、移动与攻击训练',
            active: true,
            main: true
        },
        take_oath: {
            title: '在授章台前列队',
            detail: '让三名新兵全部抵达红旗前的指定位置',
            active: false,
            status: 'hidden',
            main: true,
            highlight: { area: 'oath_line' }
        }
    },

    triggers: [
        {
            id: 'start_story',
            enabled: true,
            once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                { kind: 'setUnitState', target: { group: 'new_recruits' }, state: 'canAct', value: false },
                { kind: 'setUnitState', target: { unit: 'recruit_sword' }, state: 'canAct', value: true },
                {
                    kind: 'showStep',
                    speaker: MARCUS,
                    text: '先别看授章台。鸢尾誓章要跟你们十二年，若连校场都走不过去，它只会比你们更早回家。'
                },
                {
                    kind: 'showStep',
                    speaker: MARCUS,
                    text: '第一课只有三件事：看清自己的人，走到该站的位置，然后把剑送到目标身上。少一步，都可能让旁边的人替你送命。'
                },
                {
                    kind: 'showStep',
                    text: '马库斯用剑鞘点了点队列最前方的新兵。点击这段话开始操练。',
                    next: '__begin_selection'
                },
                {
                    kind: 'setUnitState',
                    target: { group: 'training_targets' },
                    state: 'canCounterattack',
                    value: false
                },
                { kind: 'setTriggerEnabled', trigger: 'begin_selection', enabled: true }
            ]
        },
        {
            id: 'begin_selection',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__begin_selection' }],
            do: [
                {
                    kind: 'showStep',
                    text: '先认清你要下令的人。点击队列最前方的步兵，将其选中。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'recruit_sword',
                        hint: '点击高亮的新兵完成选择'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'recruit_selected', enabled: true }
            ]
        },
        {
            id: 'recruit_selected',
            enabled: false,
            once: true,
            when: [{ kind: 'unitSelected', target: { unit: 'recruit_sword' }, camp: 'player1' }],
            do: [
                {
                    kind: 'showStep',
                    speaker: MARCUS,
                    text: '看见他能走到哪里了吗？别急着找敌人，先把队形站稳。命令他移动到授章台前的中央位置。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'recruit_sword',
                        tiles: [{ q: 0, r: 0 }],
                        hint: '移动到高亮的中央位置'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'recruit_reached_center', enabled: true }
            ]
        },
        {
            id: 'recruit_reached_center',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitMovesToTile',
                    target: { unit: 'recruit_sword' },
                    camp: 'player1',
                    tiles: [{ q: 0, r: 0 }]
                }
            ],
            do: [
                {
                    kind: 'showStep',
                    speaker: MARCUS,
                    text: '位置对了，剑才有用。训练靶就在你右前方——点击它，完成一次攻击。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'recruit_sword',
                        tiles: [{ q: 1, r: 0 }],
                        hint: '攻击高亮的训练靶'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'training_strike', enabled: true }
            ]
        },
        {
            id: 'training_strike',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitAttacksUnit',
                    attacker: { unit: 'recruit_sword' },
                    defender: { unit: 'training_dummy' },
                    attackerCamp: 'player1',
                    defenderCamp: 'targets'
                }
            ],
            do: [
                // 必须先启用下一主要目标，再完成当前目标，避免目标系统提前结算。
                { kind: 'setObjectiveStatus', objective: 'take_oath', status: 'active' },
                { kind: 'setObjectiveStatus', objective: 'learn_basics', status: 'completed' },
                { kind: 'setUnitState', target: { unit: 'recruit_flower' }, state: 'canAct', value: true },
                {
                    kind: 'showStep',
                    speaker: MARCUS,
                    text: '选择、移动、攻击。操典写得很短，因为战场不会等人读第二遍。现在把另外两人带到红旗前。'
                },
                {
                    kind: 'showStep',
                    text: '选择左侧新兵，让他站到授章队列左翼。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'recruit_flower',
                        tiles: [{ q: 0, r: 1 }],
                        hint: '选择左侧新兵并移动到高亮位置'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'second_recruit_arrived', enabled: true }
            ]
        },
        {
            id: 'second_recruit_arrived',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitMovesToTile',
                    target: { unit: 'recruit_flower' },
                    camp: 'player1',
                    tiles: [{ q: 0, r: 1 }]
                }
            ],
            do: [
                { kind: 'setUnitState', target: { unit: 'recruit_banner' }, state: 'canAct', value: true },
                {
                    kind: 'showStep',
                    speaker: MARCUS,
                    text: '左翼到位。最后一人站右翼。队伍不是三把各自挥舞的剑——彼此看得见，才算一队。'
                },
                {
                    kind: 'showStep',
                    text: '选择最后一名新兵，让他站到授章队列右翼。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'recruit_banner',
                        tiles: [{ q: 1, r: -1 }],
                        hint: '选择最后一名新兵并移动到高亮位置'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'assembly_complete', enabled: true }
            ]
        },
        {
            id: 'assembly_complete',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitMovesToTile',
                    target: { unit: 'recruit_banner' },
                    camp: 'player1',
                    tiles: [{ q: 1, r: -1 }]
                },
                { kind: 'unitsInArea', area: 'oath_line', camp: 'player1', op: '>=', value: 3 }
            ],
            do: [
                { kind: 'unlockInput' },
                { kind: 'setUnitState', target: { group: 'new_recruits' }, state: 'canAct', value: false },
                {
                    kind: 'showStep',
                    text: '三名新兵在红旗前站成一线。塞维鲁从授章台上走下，把三枚铁芯鎏金的鸢尾誓章放在名册旁。'
                },
                {
                    kind: 'showStep',
                    speaker: SEVERUS,
                    text: '誓章不是王冠赏给你们的饰物，是王冠签给你们的欠据。你们守奥雷利亚，奥雷利亚便欠你们军饷、疗伤，也欠阵亡者一个归家的名字。'
                },
                {
                    kind: 'showStep',
                    speaker: SEVERUS,
                    text: '东征在即。我只给你们三条军令：服从军纪，不取百姓一钱，不让王国的伤口再深一寸。做到这些，你们便是在替国王止血。'
                },
                {
                    kind: 'showStep',
                    text: '三根拇指依次按进军籍上的红蜡。\n\n“以血印此花：我守奥雷利亚，不负陛下，不负众民。”'
                },
                {
                    kind: 'showStep',
                    speaker: MARCUS,
                    text: '章收好。摄政大人负责记王国欠你们什么；我负责教你们别让它太早还债。'
                },
                {
                    kind: 'showStep',
                    text: '队列里有人望着即将东去的红旗，小声问：“百夫长，剑该朝哪边？”'
                },
                {
                    kind: 'showStep',
                    speaker: MARCUS,
                    text: '剑不问方向，问方向的是持剑的人。先把剑握稳。至于方向——军令会告诉你们。',
                    next: '__complete_lesson'
                },
                { kind: 'setTriggerEnabled', trigger: 'finish_lesson', enabled: true }
            ]
        },
        {
            id: 'finish_lesson',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__complete_lesson' }],
            do: [
                { kind: 'unlockInput' },
                { kind: 'setObjectiveStatus', objective: 'take_oath', status: 'completed' }
            ]
        }
    ],

    result: {
        winText: '红旗向东，花与剑同行。那一天，没有人觉得马库斯的两句话彼此矛盾——包括他自己。',
        loseText: '操练中断。重新列队，再来一次。',
        eliminateEnemy: false,
        starRules: []
    }
};
