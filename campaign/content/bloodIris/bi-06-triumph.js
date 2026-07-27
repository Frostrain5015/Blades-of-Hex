// 染血的鸢尾花 · 第二章「我心如火」
// BI-06 普通关「凯旋者不归」
//
// 佩特拉陷落的消息比军队先到王都。塞维鲁主持凯旋礼，向市民承诺加冕礼如期举行。
// 庆典当夜，阿德里安失踪。马库斯奉命封锁外出路线。
//
// 设计意图（普通关，标准路线 10–15 分钟）：
//   大纲要求：夜间庆典区，火盆看台把道路切成窄路；在不伤及市民的前提下封锁三处街口，
//   并调查王子离开的痕迹；市民伤亡达阈值即失败——"封锁"不是"镇压"。
//
//   本关**没有一个敌人**。压力全部来自约束：
//     · 市民是中立单位，会挡住移动，且主动攻击会立刻转为敌对；
//     · 三处街口分散在地图三个方向，六个人不够同时站满，必须分兵取舍；
//     · 每封住一处，人流改道，才会露出下一条线索——所以封锁顺序决定调查顺序。
//   这是全剧第一关"赢的方式不是打赢"，也是马库斯第一次执行一道他不理解的命令。
//
// 钩子：三条线索合起来指向同一件事——侧门是从**里面**闩开的。
//   真正离开王宫的人不是被劫走的。但这一晚没有人敢把这句话写进回执。
//
// 收藏品：`bi06_cloak_clasp` 王室斗篷扣（搭扣从内侧解开）。
//
// 数值依据：中立单位阻挡移动（rules 层 ZoC 与占位规则）；步兵 2 格/回合、
//   骑兵 4 格/回合。turnLimit 运行时不裁决，写 0；本关不设时限，
//   压力来自"人手不够"而不是"时间不够"。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';
import { collectiblesForScenario } from './collectibles.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const SEVERUS = Object.freeze({ name: '塞维鲁', portrait: 'advisor' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });
const NIA = Object.freeze({ name: '妮娅', portrait: 'npcFemale' });
const TITUS = Object.freeze({ name: '提图斯', portrait: 'npcMale' });
const WOMAN = Object.freeze({ name: '卖酒的妇人', portrait: 'npcFemale' });

// 三处街口：西、南、东，互相隔着整个庆典区。
const WEST_MOUTH = Object.freeze({ q: -7, r: 1 });
const SOUTH_MOUTH = Object.freeze({ q: 0, r: 5 });
const EAST_MOUTH = Object.freeze({ q: 7, r: -1 });

// 三条线索：马厩、侧门、泥地。
const CLUE_STABLE = Object.freeze({ q: -3, r: -4 });
const CLUE_POSTERN = Object.freeze({ q: 1, r: -5 });
const CLUE_MUD = Object.freeze({ q: 3, r: -3 });
const CLUE_TILES = Object.freeze([CLUE_STABLE, CLUE_POSTERN, CLUE_MUD]);

export const config = {
    schemaVersion: 4,
    id: 'bi-06-triumph',
    title: '凯旋者不归',
    displayId: 'BI-06',
    chronicleId: 'blood-iris',
    seed: 0x2606,
    turnLimit: 0,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '我心如火',
        scenarioSubtitle: 'BI-06 凯旋者不归'
    },

    weather: 'clear',
    localPlayerCamp: 'patrol',

    factions: [
        {
            id: 'patrol',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '奉封锁令巡查庆典区的东征军前卫',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'citizens',
            name: '庆典市民',
            color: 'white',
            note: '还在街上的阿克罗斯居民；他们挡路，但不是敌人',
            controller: 'scripted',
            participatesInTurns: false,
            active: true
        }
    ],

    turnOrder: ['patrol'],
    diplomacy: {
        patrol: { citizens: 'neutral' },
        citizens: { patrol: 'neutral' }
    },

    mechanics: {
        tacticalCards: false,
        recruitment: false,
        reinforcement: false,
        commanderSkills: true,
        airCommands: false,
        weatherEffects: false,
        morale: true,
        fortifications: false,
        fogOfWar: false,
        alliedVision: false
    },

    aiOpponentCamp: '',
    aiDifficulty: 0.5,
    gold: { patrol: 0, citizens: 0 },
    commanders: { patrol: 'centurion' },
    hands: { patrol: [], citizens: [] },
    storyCommanders: [{ id: 'marcus', name: '马库斯', archetype: 'centurion' }],
    collectibles: collectiblesForScenario('bi-06-triumph'),

    board: {
        layout: 'borderless',
        radius: 4,
        cities: [
            // 卫城上的王宫：本关不攻不守，只作为北端地标与区划颜色来源。
            { q: 0, r: -6, radius: 1, districtId: 1, camp: 'patrol' }
        ],
        surface: [],
        terrain: [
            // 看台、酒棚与货摊：把广场切成几条窄路。这些"林子"就是人造的街景。
            { q: -2, r: -1, type: 'forest' }, { q: -1, r: -1, type: 'forest' },
            { q: 1, r: -2, type: 'forest' }, { q: 2, r: -2, type: 'forest' },
            { q: -3, r: 1, type: 'forest' }, { q: -2, r: 2, type: 'forest' },
            { q: 2, r: 1, type: 'forest' }, { q: 3, r: 0, type: 'forest' },
            { q: -1, r: 3, type: 'forest' }, { q: 0, r: 3, type: 'forest' },
            { q: -5, r: 3, type: 'forest' }, { q: 4, r: 2, type: 'forest' },
            { q: -5, r: -1, type: 'forest' }, { q: 5, r: -3, type: 'forest' },
            // 卫城岩壁：把王宫托在高处，也堵死除侧门以外的北向通路。
            { q: -2, r: -6, type: 'mountain' }, { q: -1, r: -6, type: 'mountain' },
            { q: 2, r: -6, type: 'mountain' }, { q: 3, r: -6, type: 'mountain' },
            { q: -3, r: -5, type: 'mountain' }, { q: 4, r: -5, type: 'mountain' },
            { q: -4, r: -3, type: 'mountain' }, { q: 5, r: -5, type: 'mountain' }
        ],
        villages: [
            { q: -6, r: 4, districtId: 1 },
            { q: 6, r: 1, districtId: 1 }
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
            id: 'marcus_patrol', type: 'infantry', camp: 'patrol', q: 0, r: -3,
            storyCommander: 'marcus', hpPct: 100, morale: 2, rank: 1, specializationKey: 'assaultInfantry', canAct: true
        },
        { id: 'titus_patrol', type: 'infantry', camp: 'patrol', q: -1, r: -2, hpPct: 100, morale: 2, rank: 1, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'nia_patrol', type: 'archer', camp: 'patrol', q: 1, r: -3, hpPct: 100, morale: 2, rank: 1, specializationKey: 'fieldGun', canAct: true },
        { id: 'elian_patrol', type: 'cavalry', camp: 'patrol', q: 0, r: -2, hpPct: 100, morale: 2, rank: 1, specializationKey: 'lightCavalry', canAct: true },
        { id: 'patrol_spear_a', type: 'infantry', camp: 'patrol', q: -2, r: -2, hpPct: 100, morale: 2, canAct: true },
        { id: 'patrol_rider_a', type: 'cavalry', camp: 'patrol', q: 2, r: -3, hpPct: 100, morale: 2, canAct: true },

        // 市民散在广场上。他们不会动，但会挡路——今晚的地形有一半是人。
        { id: 'cit_wine_woman', type: 'infantry', camp: 'citizens', q: -1, r: 0, hpPct: 100, morale: 2, canAct: false },
        { id: 'cit_drunk', type: 'infantry', camp: 'citizens', q: 0, r: 1, hpPct: 100, morale: 1, canAct: false },
        { id: 'cit_child', type: 'infantry', camp: 'citizens', q: 1, r: 0, hpPct: 100, morale: 1, canAct: false },
        { id: 'cit_porter', type: 'infantry', camp: 'citizens', q: -3, r: 2, hpPct: 100, morale: 2, canAct: false },
        { id: 'cit_singer', type: 'infantry', camp: 'citizens', q: 3, r: 1, hpPct: 100, morale: 2, canAct: false },
        { id: 'cit_old_man', type: 'infantry', camp: 'citizens', q: -4, r: 0, hpPct: 100, morale: 1, canAct: false },
        { id: 'cit_couple', type: 'infantry', camp: 'citizens', q: 4, r: -1, hpPct: 100, morale: 2, canAct: false },
        { id: 'cit_beggar', type: 'infantry', camp: 'citizens', q: -2, r: 4, hpPct: 100, morale: 1, canAct: false }
    ],

    unitGroups: [
        {
            id: 'patrol_squad',
            unitIds: ['marcus_patrol', 'titus_patrol', 'nia_patrol', 'elian_patrol', 'patrol_spear_a', 'patrol_rider_a']
        },
        {
            id: 'city_folk',
            unitIds: [
                'cit_wine_woman', 'cit_drunk', 'cit_child', 'cit_porter',
                'cit_singer', 'cit_old_man', 'cit_couple', 'cit_beggar'
            ]
        }
    ],

    areas: [
        { id: 'west_mouth', tiles: [WEST_MOUTH] },
        { id: 'south_mouth', tiles: [SOUTH_MOUTH] },
        { id: 'east_mouth', tiles: [EAST_MOUTH] },
        { id: 'clue_sites', tiles: CLUE_TILES }
    ],

    interactables: [
        {
            id: 'clue_stable', q: CLUE_STABLE.q, r: CLUE_STABLE.r,
            label: '查看王宫马厩', enabled: false,
            unitIds: ['marcus_patrol', 'elian_patrol', 'titus_patrol', 'nia_patrol', 'patrol_rider_a']
        },
        {
            id: 'clue_postern', q: CLUE_POSTERN.q, r: CLUE_POSTERN.r,
            label: '查看宫墙侧门', enabled: false,
            unitIds: ['marcus_patrol', 'elian_patrol', 'titus_patrol', 'nia_patrol', 'patrol_rider_a']
        },
        {
            id: 'clue_mud', q: CLUE_MUD.q, r: CLUE_MUD.r,
            label: '查看侧门外的泥地', enabled: false,
            unitIds: ['marcus_patrol', 'elian_patrol', 'titus_patrol', 'nia_patrol', 'patrol_rider_a'],
            collectibleId: 'bi06_cloak_clasp'
        }
    ],

    variables: [
        { id: 'mouths_sealed', scope: 'level', type: 'number', initial: 0 },
        { id: 'clues_found', scope: 'level', type: 'number', initial: 0 },
        { id: 'citizens_hurt', scope: 'level', type: 'number', initial: 0 },
        // 跨关：马库斯是否亲眼确认侧门是从内侧闩开的。第九关猎宫对话会读它。
        { id: 'knows_postern_opened_inside', scope: 'campaign', type: 'boolean', initial: false }
    ],

    objectives: {
        seal_three_mouths: {
            title: '封锁三处街口',
            detail: '西、南、东三个街口各站一个人。人手不够同时站满——先封哪个，就先看见哪条线索。',
            active: true,
            main: true,
            highlight: { tiles: [WEST_MOUTH, SOUTH_MOUTH, EAST_MOUTH] }
        },
        find_the_trail: {
            title: '查清王子离开的痕迹',
            detail: '每封住一处街口，人流改道，就会露出一处能走到的地方。三处都要查。',
            active: false,
            main: true,
            highlight: { area: 'clue_sites' }
        },
        keep_the_peace: {
            title: '封锁不是镇压',
            detail: '市民是中立的，会挡路，但动手就会变成敌人。两名以上市民死亡，本次封锁失败。',
            active: true,
            main: false
        }
    },

    triggers: [
        {
            id: 'opening_lockdown',
            title: '开场：庆典夜的封锁令',
            enabled: true,
            once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                {
                    kind: 'showStep',
                    text: '凯旋礼当天。东征军的旗从南门进城，塞维鲁在元老院阶前宣布加冕礼如期举行。入夜，广场上的火盆还没灭，酒棚还在卖第三轮。'
                },
                {
                    kind: 'showStep',
                    text: '亥时前后，王宫传出消息：陛下不在寝宫。'
                },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '马库斯。今夜封锁三处街口，西、南、东，一处不许漏。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '摄政大人，封锁什么名义？'
                },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '巡查。加冕礼前夜清街，年年都清。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……是搜人还是清街。'
                },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '有区别吗。——有。你把街清了，市民回家睡觉；你去搜人，明天早上全城都知道王宫丢了东西。所以是清街。'
                },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '还有一句：不许推人，不许拔刀，不许有一个市民躺在街上过夜。做到这一条，别的都算你办成了。',
                    next: '__begin_lockdown'
                },
                { kind: 'setTriggerEnabled', trigger: 'lockdown_brief', enabled: true }
            ]
        },
        {
            id: 'lockdown_brief',
            title: '任务说明',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__begin_lockdown' }],
            do: [
                { kind: 'unlockInput' },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '六个人，三个街口。分三组，一组两个人。走小路，别从人堆里穿。'
                },
                {
                    kind: 'showStep',
                    text: '街上的市民会挡住去路，绕开就行——攻击他们会立刻变成敌对，那不叫封锁。每封住一处街口，人流改道，就会露出一处新的地方能走过去。',
                    highlight: { tiles: [WEST_MOUTH, SOUTH_MOUTH, EAST_MOUTH] }
                }
            ]
        },

        {
            id: 'seal_west',
            title: '封住西街口 → 露出马厩',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'west_mouth', camp: 'patrol', op: '>=', value: 1 }],
            do: [
                { kind: 'setVariable', variable: 'mouths_sealed', operation: 'add', value: 1 },
                { kind: 'setObjectiveStatus', objective: 'find_the_trail', status: 'active' },
                { kind: 'setInteractionState', interactable: 'clue_stable', state: 'available' },
                { kind: 'revealTiles', camp: 'patrol', target: { tiles: [CLUE_STABLE] } },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '西口站住了。人往北退了，退开以后……马厩那条道空出来了。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '去看看。马厩是宫里的，今夜该锁。'
                }
            ]
        },
        {
            id: 'seal_south',
            title: '封住南街口 → 露出侧门',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'south_mouth', camp: 'patrol', op: '>=', value: 1 }],
            do: [
                { kind: 'setVariable', variable: 'mouths_sealed', operation: 'add', value: 1 },
                { kind: 'setObjectiveStatus', objective: 'find_the_trail', status: 'active' },
                { kind: 'setInteractionState', interactable: 'clue_postern', state: 'available' },
                { kind: 'revealTiles', camp: 'patrol', target: { tiles: [CLUE_POSTERN] } },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '南口站住了。人流全压到宫墙根下——墙上有道小门，平时被酒棚挡着，现在看得见了。'
                }
            ]
        },
        {
            id: 'seal_east',
            title: '封住东街口 → 露出泥地',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'east_mouth', camp: 'patrol', op: '>=', value: 1 }],
            do: [
                { kind: 'setVariable', variable: 'mouths_sealed', operation: 'add', value: 1 },
                { kind: 'setObjectiveStatus', objective: 'find_the_trail', status: 'active' },
                { kind: 'setInteractionState', interactable: 'clue_mud', state: 'available' },
                { kind: 'revealTiles', camp: 'patrol', target: { tiles: [CLUE_MUD] } },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '东口站住了。这边人一散，侧门外那片泥地就露出来——今天下过雨，什么都印得清清楚楚。'
                }
            ]
        },
        {
            id: 'all_mouths_sealed',
            title: '三处街口全部封锁',
            enabled: true,
            once: true,
            when: [{ kind: 'variableCompare', scope: 'level', variable: 'mouths_sealed', op: '>=', value: 3 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'seal_three_mouths', status: 'completed' },
                {
                    kind: 'showStep',
                    text: '三处街口都站上了人。广场慢慢空下来，火盆一个接一个熄掉。没有人被推倒，也没有人被带走——今夜的封锁，从街上看只像一次清场。'
                }
            ]
        },

        {
            id: 'found_stable',
            title: '线索一：马厩',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'clue_stable' }],
            do: [
                { kind: 'setVariable', variable: 'clues_found', operation: 'add', value: 1 },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '少一匹马。栏是开的，草料翻过，鞍具架上空了一副。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '哪一副。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '……最旧的那副。旁边挂着三副新的，一副没动。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '记下：一马、旧鞍、无护卫。'
                }
            ]
        },
        {
            id: 'found_postern',
            title: '线索二：侧门',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'clue_postern' }],
            do: [
                { kind: 'setVariable', variable: 'clues_found', operation: 'add', value: 1 },
                // 作用域取自 variables 里的声明（triggers.js 按 variable.scope 派发），动作本身不带 scope。
                { kind: 'setVariable', variable: 'knows_postern_opened_inside', operation: 'set', value: true },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '门闩在这边。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '哪边。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '里边。……百夫长，这门是从里头开的。撬痕一道都没有。'
                },
                {
                    kind: 'showStep',
                    text: '铁闩落在门内一尺处，插销上的锈被手抹开一道亮口。没有人破门。有人开了门，然后走了出去。'
                }
            ]
        },
        {
            id: 'found_mud',
            title: '线索三：泥地与斗篷扣',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'clue_mud' }],
            do: [
                { kind: 'setVariable', variable: 'clues_found', operation: 'add', value: 1 },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '蹄印一组，出门往东北。人脚印两组——一组进门，一组出门，同一双靴。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '两组，同一双？'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '有人从外面进来过，又原路出去了。走的时候没有拖拽，没有第二个人跟着。'
                },
                {
                    kind: 'showStep',
                    text: '泥里还嵌着一枚鎏金的扣子，五瓣鸢尾。搭扣是从内侧解开的——不是被扯断的。'
                }
            ]
        },
        {
            id: 'all_clues_found',
            title: '三条线索合拢',
            enabled: true,
            once: true,
            when: [{ kind: 'variableCompare', scope: 'level', variable: 'clues_found', op: '>=', value: 3 }],
            do: [
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '百夫长。一匹旧鞍的马、从里面开的门、自己解下的扣子。这不是被人劫走。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '闭嘴。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '我只是——'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '我说闭嘴。……不是骂你。这句话今晚说出口，明天你就得替它去死。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '回执照实写：马厩少一匹马，侧门内闩开启，门外有出行足迹。写完就交，别加一个字的判断。',
                    next: '__lockdown_report'
                },
                { kind: 'setTriggerEnabled', trigger: 'lockdown_report', enabled: true }
            ]
        },
        {
            id: 'lockdown_report',
            title: '交回执，本关结束',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__lockdown_report' }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'find_the_trail', status: 'completed' },
                { kind: 'setObjectiveStatus', objective: 'keep_the_peace', status: 'completed' },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '辛苦。回执我收下了。——马库斯，明日卯时点兵，追缉劫驾者。方向北，猎宫一线。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……劫驾者。'
                },
                {
                    kind: 'showStep', speaker: SEVERUS,
                    text: '陛下不在宫里，宫门是好的。除了被劫，还能是什么？'
                },
                {
                    kind: 'showStep',
                    text: '他说这句话的时候，眼睛是看着马库斯的，语气里没有一点心虚——因为他确实不知道那道侧门是从里面开的。\n\n那份回执，他还没有看。'
                }
            ]
        },

        {
            id: 'citizen_hurt',
            title: '市民伤亡',
            enabled: true,
            once: false,
            when: [{ kind: 'unitKilled', target: { group: 'city_folk' } }],
            do: [
                { kind: 'setVariable', variable: 'citizens_hurt', operation: 'add', value: 1 },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '收刀。——都收刀！这是清街，不是攻城。'
                }
            ]
        },
        {
            id: 'lockdown_became_a_riot',
            title: '失败：封锁变成了镇压',
            enabled: true,
            once: true,
            when: [{ kind: 'variableCompare', scope: 'level', variable: 'citizens_hurt', op: '>=', value: 2 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'keep_the_peace', status: 'failed' },
                {
                    kind: 'endScenario', result: 'lose',
                    reason: '庆典夜的清街变成了流血。天亮之前，全城都会知道王宫丢了东西——而摄政要的恰恰是没有人知道。'
                }
            ]
        }
    ],

    result: {
        winText: '广场空了。马库斯把回执交上去，一个字的判断都没有加。他做对了每一件被吩咐的事——也第一次发现，做对每一件事并不等于知道自己在做什么。',
        loseText: '封锁失败。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '无一市民伤亡',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'citizens_hurt', op: '==', value: 0 }]
            },
            {
                label: '三条线索全部查清',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'clues_found', op: '>=', value: 3 }]
            },
            {
                label: '捡到那枚斗篷扣',
                when: [{ kind: 'collectibleUnlocked', collectible: 'bi06_cloak_clasp', unlocked: true }]
            }
        ]
    }
};
