// 染血的鸢尾花 · 第一章「花旗向东」
// BI-T3 教学关「山有回声」
//
// 设计意图：
//   大纲要求：地形演练 + 克制三角；钩子是"操典不会告诉你谁在山后"。
//
//   旧版有一处会误导玩家的错误：它说"山地移动消耗 6 点，本次轻装演练（+1）
//   刚好让步兵登顶"。实际上 4+1=5 仍然小于 6；而引擎本来就有**末步豁免**
//   （js/gameLogic.js 移动 BFS：先 `if (curRem < 1) continue;`，再
//   `newRem = curRem >= stepCost ? curRem - stepCost : 0`）——只要还剩 ≥1 行动力，
//   就能踏进任意地形，代价是这一步之后行动力归零。
//   所以步兵 speed 4 本来就上得去，那个 buff 既多余又把规则教反了。本版删掉它，
//   改为正面把「末步豁免」讲清楚——这是全游戏最常用、也最少被讲明的一条移动规则。
//
//   旧版还漏掉了大纲明确要求的克制三角。本版三个假想敌分别扎成骑/步/弓，
//   必须用克制它的兵种去打（rules/units.js COUNTER_RELATION：
//   步克骑 1.25、弓克步 1.25、骑克弓 1.25，反向 0.75）。
//
//   "山后是谁"不再由马库斯说破，而是做成山脊北侧的一个**可选**观察点：
//   多爬一个回合才够得着，看到的是东境大道上正在向东移动的平民队列——
//   也就是下一关（BI-04 佩特拉撤离）玩家将亲手操作的那些人。
//
// 数值依据（rules/terrain.js、rules/constants.js）：
//   平原 stepCost 2 / 森林 3 / 山地 6；森林防御 +5%，**对远程另加 15%**
//   （COMBAT_BALANCE.defense.forestVsRangedBonus）；山地防御 +5%。
//   步兵 speed 4、弓 3、骑 8。turnLimit 运行时不裁决，写 0。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });
const NIA = Object.freeze({ name: '妮娅', portrait: 'npcFemale' });
const TITUS = Object.freeze({ name: '提图斯', portrait: 'npcMale' });

const RIDGE_CROWN = Object.freeze({ q: 0, r: -2 });   // 山脊顶，本关的视觉与战术中心
const VANTAGE_TILE = Object.freeze({ q: 1, r: -3 });  // 山脊北侧观察点（可选）
const FOREST_POST = Object.freeze({ q: -2, r: 1 });   // 弓手的林中射位
const RIDER_TARGET = Object.freeze({ q: 1, r: -2 });
const SPEAR_TARGET = Object.freeze({ q: 0, r: 1 });
const BOW_TARGET = Object.freeze({ q: 2, r: 0 });
const ASSEMBLY = Object.freeze([{ q: -1, r: 0 }, { q: -2, r: 0 }, { q: -3, r: 0 }]);

export const config = {
    schemaVersion: 4,
    id: 'bi-t3-mountain',
    title: '山有回声',
    displayId: 'BI-T3',
    chronicleId: 'blood-iris',
    seed: 0x2303,
    turnLimit: 0,

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
            note: '在峡谷外侧就地演练的东征军前卫',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'targets',
            ...BLOOD_IRIS_FACTION_PRESETS.trainingTargets,
            note: '按兵种扎的三个草人',
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
        airCommands: false,
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
    storyCommanders: [{ id: 'marcus', name: '马库斯', archetype: 'centurion' }],
    collectibles: [],

    board: {
        layout: 'hex',
        radius: 3,
        cities: [{ q: -3, r: 3, districtId: 1, camp: 'expedition' }],
        surface: [],
        // 构图：一道自西南向东北的山脊斜贯上半图，西南一簇矮林，
        // 东侧留大片开阔河滩给骑兵。三种地形各只出现一处，读图不含糊。
        terrain: [
            { q: -2, r: -1, type: 'mountain' },
            { q: -1, r: -1, type: 'mountain' },
            { q: 0, r: -2, type: 'mountain' },
            { q: 1, r: -3, type: 'mountain' },
            { q: 2, r: -3, type: 'mountain' },
            { q: -2, r: 1, type: 'forest' },
            { q: -1, r: 1, type: 'forest' },
            { q: -2, r: 2, type: 'forest' },
            { q: -3, r: 2, type: 'forest' }
        ],
        villages: [],
        fortifications: [],
        installations: [],
        districts: [],
        rivers: [],
        crossings: [],
        ports: []
    },

    units: [
        {
            id: 'marcus_observer', type: 'infantry', camp: 'expedition', q: -3, r: 1,
            storyCommander: 'marcus', hpPct: 100, morale: 2, canAct: false
        },
        { id: 'titus_infantry', type: 'infantry', camp: 'expedition', q: 0, r: 0, hpPct: 100, morale: 2, canAct: true },
        { id: 'nia_archer', type: 'archer', camp: 'expedition', q: -2, r: 0, hpPct: 100, morale: 2, canAct: true },
        { id: 'elian_cavalry', type: 'cavalry', camp: 'expedition', q: 1, r: 2, hpPct: 100, morale: 2, canAct: true },

        // 三个草人按兵种扎，正好构成一轮克制三角。
        { id: 'dummy_rider', type: 'cavalry', camp: 'targets', q: RIDER_TARGET.q, r: RIDER_TARGET.r, hpPct: 100, morale: 2, canAct: false },
        { id: 'dummy_spear', type: 'infantry', camp: 'targets', q: SPEAR_TARGET.q, r: SPEAR_TARGET.r, hpPct: 100, morale: 2, canAct: false },
        { id: 'dummy_bow', type: 'archer', camp: 'targets', q: BOW_TARGET.q, r: BOW_TARGET.r, hpPct: 100, morale: 2, canAct: false }
    ],

    unitGroups: [
        { id: 'drill_squad', unitIds: ['titus_infantry', 'nia_archer', 'elian_cavalry'] },
        { id: 'straw_targets', unitIds: ['dummy_rider', 'dummy_spear', 'dummy_bow'] }
    ],

    areas: [
        { id: 'assembly_point', tiles: ASSEMBLY },
        { id: 'ridge_line', tiles: [RIDGE_CROWN, VANTAGE_TILE] }
    ],

    interactables: [
        {
            id: 'east_vantage',
            q: VANTAGE_TILE.q, r: VANTAGE_TILE.r,
            label: '望向东境大道',
            enabled: false,
            unitIds: ['titus_infantry']
        }
    ],

    variables: [
        { id: 'looked_east', scope: 'level', type: 'boolean', initial: false },
        { id: 'drill_done', scope: 'level', type: 'boolean', initial: false },
        { id: 'drill_slow', scope: 'level', type: 'boolean', initial: false }
    ],

    objectives: {
        run_the_drill: {
            title: '完成三课地形演练',
            detail: '登上山脊、借林射击、开阔地冲锋——每一课都用克制对方的兵种。',
            active: true,
            main: true
        },
        fall_out: {
            title: '收队',
            detail: '演练结束后，把提图斯带回西侧集合点。',
            active: false,
            main: true,
            highlight: { area: 'assembly_point' }
        },
        look_east: {
            title: '（可选）山脊北侧能看见什么',
            detail: '从山顶再往北爬一格，望一眼东境大道。要多花一个回合。',
            active: false,
            main: false,
            highlight: { tiles: [VANTAGE_TILE] }
        }
    },

    triggers: [
        {
            id: 'start_drill',
            title: '开场：就地演练',
            enabled: true,
            once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                // 草人不还手也打不烂，三课可以反复练。
                {
                    kind: 'applyEffect', target: { group: 'straw_targets' }, effectId: 'straw_target_rule',
                    name: '草人', desc: '演练用草人：不会被打倒，也不会还手。', emoji: '🎯', duration: 0,
                    rule: 'minHp', rulePercent: 1
                },
                { kind: 'setUnitState', target: { group: 'straw_targets' }, state: 'canCounterattack', value: false },
                { kind: 'setUnitState', target: { group: 'drill_squad' }, state: 'canAct', value: false },
                { kind: 'setUnitState', target: { unit: 'titus_infantry' }, state: 'canAct', value: true },
                {
                    kind: 'showStep',
                    text: '峡谷外侧有一道斜插向东北的石脊，西南一片矮林，东边是开阔的河滩地。前卫在这里停了半日，扎了三个草人。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '三课。山、林、平地各一课，一课一个人，都在这个下午练完。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '百夫长，那山后头呢？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '操典里没有"山后头"。操典只写：山让谁走得慢，让谁站得久。先学会这半句。',
                    next: '__lesson_ridge'
                },
                { kind: 'setTriggerEnabled', trigger: 'lesson_ridge', enabled: true }
            ]
        },

        {
            id: 'lesson_ridge',
            title: '第一课：山地与末步豁免',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__lesson_ridge' }],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '提图斯，上脊。山地一步要六点行动力，你只有四点。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '……那就是上不去。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '上得去。最后一步不算够不够，只算你还剩没剩——手里还有一点力气，就能迈进去。代价是迈进去以后，这一回合别想再动。'
                },
                {
                    kind: 'showStep',
                    text: '把提图斯移动到高亮的山脊顶。他会先走两格平地，再用最后一点行动力踏上山。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'titus_infantry',
                        tiles: [RIDGE_CROWN],
                        hint: '把步兵移动到高亮的山脊顶'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'titus_on_ridge', enabled: true }
            ]
        },
        {
            id: 'titus_on_ridge',
            title: '登顶：讲第一条克制，开放可选观察点',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitMovesToTile',
                    target: { unit: 'titus_infantry' }, camp: 'expedition',
                    tiles: [RIDGE_CROWN]
                }
            ],
            do: [
                { kind: 'setInteractionState', interactable: 'east_vantage', state: 'available' },
                { kind: 'setObjectiveStatus', objective: 'look_east', status: 'active' },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '站上去了。山上多五分防御，更要紧的是：马冲不上来，只能仰着打。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '第一条克制，矛压马。你脚下那个草人扎的是骑兵——打它。'
                },
                {
                    kind: 'showStep',
                    text: '攻击高亮的骑兵草人。步兵打骑兵是顺克，伤害更高。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'titus_infantry',
                        tiles: [RIDER_TARGET],
                        hint: '用山上的步兵攻击骑兵草人'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'lesson_forest', enabled: true }
            ]
        },

        {
            id: 'lesson_forest',
            title: '第二课：森林与远程掩护',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitAttacksUnit',
                    attacker: { unit: 'titus_infantry' }, defender: { unit: 'dummy_rider' },
                    attackerCamp: 'expedition', defenderCamp: 'targets'
                }
            ],
            do: [
                { kind: 'setUnitState', target: { unit: 'nia_archer' }, state: 'canAct', value: true },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '妮娅，进林子。树挡不住刀，挡得住箭——在林子里挨远程打，要少挨一成半。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '林子里看得见外面吗？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '看得见。射程两格，你在林缘就够得着平地上那个。'
                },
                {
                    kind: 'showStep',
                    text: '先把弓手移进高亮的林中射位。森林一步 3 点，她刚好走得进去。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'nia_archer',
                        tiles: [FOREST_POST],
                        hint: '把弓手移动到高亮的林中射位'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'nia_in_forest', enabled: true }
            ]
        },
        {
            id: 'nia_in_forest',
            title: '林中射击：第二条克制',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitMovesToTile',
                    target: { unit: 'nia_archer' }, camp: 'expedition',
                    tiles: [FOREST_POST]
                }
            ],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '第二条克制，箭压步。两格外那个草人扎的是步兵，射它。'
                },
                {
                    kind: 'showStep',
                    text: '从林中射位攻击两格外的步兵草人。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'nia_archer',
                        tiles: [SPEAR_TARGET],
                        hint: '用林中的弓手攻击步兵草人'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'lesson_open', enabled: true }
            ]
        },

        {
            id: 'lesson_open',
            title: '第三课：开阔地与骑兵',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitAttacksUnit',
                    attacker: { unit: 'nia_archer' }, defender: { unit: 'dummy_spear' },
                    attackerCamp: 'expedition', defenderCamp: 'targets'
                }
            ],
            do: [
                { kind: 'setUnitState', target: { unit: 'elian_cavalry' }, state: 'canAct', value: true },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '艾利安，河滩。林子里马跑不起来，这儿能。第三条克制，马踩弓。'
                },
                {
                    kind: 'showStep',
                    text: '骑兵一回合能走四格。冲到开阔地上的弓手草人旁边，攻击它。',
                    boardLock: true,
                    dialogLock: true,
                    highlight: {
                        unit: 'elian_cavalry',
                        tiles: [BOW_TARGET],
                        hint: '用骑兵攻击开阔地上的弓手草人'
                    }
                },
                { kind: 'setTriggerEnabled', trigger: 'drill_complete', enabled: true }
            ]
        },
        {
            id: 'drill_complete',
            title: '三课完成，解除引导',
            enabled: false,
            once: true,
            when: [
                {
                    kind: 'unitAttacksUnit',
                    attacker: { unit: 'elian_cavalry' }, defender: { unit: 'dummy_bow' },
                    attackerCamp: 'expedition', defenderCamp: 'targets'
                }
            ],
            do: [
                { kind: 'unlockInput' },
                { kind: 'setVariable', variable: 'drill_done', operation: 'set', value: true },
                { kind: 'setObjectiveStatus', objective: 'fall_out', status: 'active' },
                { kind: 'setObjectiveStatus', objective: 'run_the_drill', status: 'completed' },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '矛压马，箭压步，马踩弓。三样都不绝对，地形能把它掀过来——所以先看地，再看人。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '收队。提图斯从脊上下来，回西边集合。'
                },
                {
                    kind: 'showStep',
                    text: '提图斯还站在脊顶。往北再爬一格，能看见山那边的东境大道——那要多花一个回合，也没人下这个令。'
                }
            ]
        },

        {
            id: 'east_vantage_seen',
            title: '可选：望向东境大道',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'east_vantage' }],
            do: [
                { kind: 'setVariable', variable: 'looked_east', operation: 'set', value: true },
                { kind: 'setObjectiveStatus', objective: 'look_east', status: 'completed' },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '教头。山那边有队伍。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '多少人，什么兵种。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '……不是兵。板车、牲口、抱孩子的。往东走，走了很长一条。'
                },
                {
                    kind: 'showStep',
                    text: '尘土沿东境大道拉得很长，一直拉到佩特拉的方向。看不见护送的人马——那些人是自己在走。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '记下时辰和方向。下山。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '要不要报上去？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '照实报。别写"逃"，也别写"撤"。写：东行，约百人，无甲。'
                }
            ]
        },

        {
            id: 'drill_dragging',
            title: '第二个回合仍未跑完三课：失去动作经济星级',
            enabled: true,
            once: true,
            when: [
                { kind: 'turnStarted', camp: 'expedition', turn: 1 },
                { kind: 'variableCompare', scope: 'level', variable: 'drill_done', op: '==', value: false }
            ],
            do: [
                { kind: 'setVariable', variable: 'drill_slow', operation: 'set', value: true },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '三个人，三件事，本来一个下午就够。再来一遍——这回三个人同时动。'
                }
            ]
        },

        {
            id: 'titus_regroups',
            title: '收队，本关结束',
            enabled: true,
            once: true,
            when: [
                { kind: 'objectiveStatusIs', objective: 'fall_out', status: 'active' },
                {
                    kind: 'unitMovesToTile',
                    target: { unit: 'titus_infantry' }, camp: 'expedition',
                    tiles: ASSEMBLY
                }
            ],
            do: [
                { kind: 'setInteractionState', interactable: 'east_vantage', state: 'disabled' },
                { kind: 'setObjectiveStatus', objective: 'look_east', status: 'hidden' },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '明天过峡谷。过了峡谷是佩特拉——城里有守军，有官署，也有还没走的人。分得清哪个是哪个，你们才活得到回来。'
                },
                { kind: 'setObjectiveStatus', objective: 'fall_out', status: 'completed' }
            ]
        }
    ],

    result: {
        winText: '山风把草人吹得轻响。三个人学会了借山、借林、借势——下一座城会让同一堂课替另一边的人活命。',
        loseText: '演练未能完成。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '一个回合内跑完三课',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'drill_slow', op: '==', value: false }]
            },
            {
                label: '上山看了一眼东境大道',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'looked_east', op: '==', value: true }]
            }
        ]
    }
};
