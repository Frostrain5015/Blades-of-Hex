// 染血的鸢尾花 · 第二章「我心如火」
// BI-T7 教学关「雾中听令」
//
// 追缉令下达的第二天卯时。北去猎宫的林道整夜起雾，前卫按行军操典分成三列，
// 沿三条互不相望的道路并进，在旧宿营地会合。
//
// 设计意图（教学关，目标时长 5 分钟）：
//   大纲要求：雾中林道；部队被分置于彼此不可见的三段道路；依号角与路标会合；
//   雾遮蔽远处单位与地形；走错岔路触发短暂伏击；集合人数不足则失败。
//   钩子是马库斯的那句话——「看不见的时候，听命令就够了」。这一关它还像真理。
//
//   本关同时开启 weatherEffects 与 fogOfWar，是全战役第一次两者并用。教学只讲
//   三件事，各一句话，不铺陈：
//     ① 雾天远程射程 −1（妮娅的野战炮从 2 格变 1 格，等于被迫贴脸）；
//     ② 雾天骑兵伤害 +20%、每格冲锋加成从 10% 提到 15%（艾利安是本关唯一的解题工具）；
//     ③ 迷雾下你只看得见自己周围——三列人马彼此看不见，所以只能听号角、认路标。
//
//   引导只用高亮，**不用 boardLock**。boardLock 会打开 gameState.tutorialMode，
//   之后每一次移动都要过 currentAllow() 的白名单（triggers.js:649）——白名单里
//   只有终点格，而受末步豁免影响的移动往往需要玩家自己判断落点，一锁就走不到，
//   直接软锁。教学关一律只高亮、不锁盘。
//
//   真正的设计核心是一次**取舍**：东路路标背面有道朝北的新划痕。顺着划痕走出
//   林道，能捡到插在树上的那支东境断箭——也必然踩进溃兵的窝子，挨一次伏击。
//   想两样都要，就得先动马库斯读路标、再动骑兵；只想稳，就当没看见。
//   这一关的主题因此被机制说完了：**待在路上，你不会看见任何东西。**
//
// 收藏品：`bi07_broken_arrow` 插在路标上的断箭（东境制式，佩特拉溃兵）。
//
// 数值依据：
//   rules/units.js 特化速度 —— garrisonInfantry 4（平原 2 格/回合）、
//   assaultInfantry 6（3 格）、lightCavalry 9（4 格 + 末步豁免 = 5 格）、
//   fieldGun 3（2 格，射程 2）。平原 stepCost 2、森林 3。
//   rules/constants.js COMBAT_BALANCE.weather.fogArcherRangeDelta = -1；
//   cavalry.fogDamageBonus = 0.20、fogChargeDamagePerStep = 0.15（常态 0.10）。
//   三列人马到宿营地各 4–5 步，直行两回合刚好到；任何绕路都要第三回合。
//   turnLimit 运行时不裁决，写 0；真时限用 turnStarted 表达。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';
import { collectiblesForScenario } from './collectibles.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const TITUS = Object.freeze({ name: '提图斯', portrait: 'npcMale' });
const NIA = Object.freeze({ name: '妮娅', portrait: 'npcFemale' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });
const VOICE = Object.freeze({ name: '雾里的人声', portrait: 'npcMale' });

// 旧宿营地：一座半径 1 的小营，正好盖住中央七格——这七格就是集合点。
const MUSTER_TILES = Object.freeze([
    { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: -1 },
    { q: 0, r: -1 }, { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 }
]);

// 三处路标，各在本列第一回合的落脚点上——按操典走就一定会踩到。
const SIGN_WEST = Object.freeze({ q: -2, r: 0 });
const SIGN_SOUTH = Object.freeze({ q: 0, r: 2 });
const SIGN_EAST = Object.freeze({ q: 3, r: -2 });

// 断箭：在东路岔口以北一格的林子里，也就是溃兵窝子的边上。
const BROKEN_ARROW = Object.freeze({ q: 3, r: -3 });

// 三处岔路。踩进去 = 走出了道路，伏击随之而来。
const LOST_WEST = Object.freeze([{ q: -3, r: -2 }, { q: -4, r: -3 }]);
const LOST_SOUTH = Object.freeze([{ q: -2, r: 3 }, { q: -3, r: 4 }]);
const LOST_EAST = Object.freeze([{ q: 3, r: -3 }, { q: 2, r: -4 }]);

export const config = {
    schemaVersion: 4,
    id: 'bi-t7-fog',
    title: '雾中听令',
    displayId: 'BI-T7',
    chronicleId: 'blood-iris',
    seed: 0x2707,
    turnLimit: 0,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '我心如火',
        scenarioSubtitle: 'BI-T7 雾中听令'
    },

    weather: 'fog',
    localPlayerCamp: 'expedition',

    factions: [
        {
            id: 'expedition',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '奉追缉令北上猎宫的东征军前卫',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'deserters',
            name: '林中溃兵',
            color: 'gray',
            note: '佩特拉城破后没有归籍的人。没有旗，也没有名册。',
            controller: 'ai',
            participatesInTurns: true,
            active: true
        }
    ],

    turnOrder: ['expedition', 'deserters'],
    diplomacy: {
        expedition: { deserters: 'enemy' },
        deserters: { expedition: 'enemy' }
    },

    mechanics: {
        tacticalCards: false,
        recruitment: false,
        reinforcement: false,
        commanderSkills: false,
        airCommands: false,
        weatherEffects: true,
        morale: false,
        fortifications: false,
        fogOfWar: true,
        alliedVision: false
    },

    aiOpponentCamp: 'deserters',
    aiDifficulty: 0.35,
    gold: { expedition: 0, deserters: 0 },
    commanders: { expedition: 'centurion' },
    hands: { expedition: [], deserters: [] },
    storyCommanders: [{ id: 'marcus', name: '马库斯', archetype: 'centurion' }],
    collectibles: collectiblesForScenario('bi-t7-fog'),

    board: {
        layout: 'borderless',
        radius: 4,
        cities: [
            // 林道交汇处的旧宿营地。已在我方手里，不需要打——它只是"集合点"这三个字的实体。
            { q: 0, r: 0, radius: 1, districtId: 1, camp: 'expedition' }
        ],
        surface: [],
        terrain: [
            // ── 北面林墙：把西路与东路隔开，也堵住宿营地的北向 ──
            { q: -1, r: -1, type: 'forest' }, { q: 0, r: -2, type: 'forest' },
            { q: 1, r: -2, type: 'forest' }, { q: -1, r: -2, type: 'forest' },
            { q: 0, r: -3, type: 'forest' }, { q: 1, r: -3, type: 'forest' },
            { q: -1, r: -3, type: 'forest' }, { q: -2, r: -1, type: 'forest' },
            { q: -3, r: -1, type: 'forest' }, { q: -2, r: -2, type: 'forest' },
            { q: -3, r: -2, type: 'forest' }, { q: -4, r: -2, type: 'forest' },
            { q: -4, r: -3, type: 'forest' }, { q: -5, r: -1, type: 'forest' },

            // ── 西南林墙：隔开西路与南路 ──
            { q: -2, r: 2, type: 'forest' }, { q: -3, r: 2, type: 'forest' },
            { q: -4, r: 2, type: 'forest' }, { q: -1, r: 2, type: 'forest' },
            { q: -1, r: 3, type: 'forest' }, { q: -2, r: 3, type: 'forest' },
            { q: -2, r: 4, type: 'forest' }, { q: -3, r: 4, type: 'forest' },

            // ── 东南林墙：隔开南路与东路 ──
            { q: 2, r: 0, type: 'forest' }, { q: 2, r: 1, type: 'forest' },
            { q: 2, r: 2, type: 'forest' }, { q: 3, r: 0, type: 'forest' },
            { q: 3, r: 1, type: 'forest' }, { q: 2, r: 3, type: 'forest' },

            // ── 东路北侧林子：溃兵的窝子就在这一片 ──
            { q: 2, r: -1, type: 'forest' }, { q: 3, r: -1, type: 'forest' },
            { q: 4, r: -2, type: 'forest' }, { q: 5, r: -2, type: 'forest' },
            { q: 3, r: -3, type: 'forest' }, { q: 2, r: -3, type: 'forest' },
            { q: 2, r: -4, type: 'forest' }, { q: 3, r: -4, type: 'forest' },
            { q: 4, r: -4, type: 'forest' }, { q: 4, r: -5, type: 'forest' },
            { q: 5, r: -5, type: 'forest' }, { q: 5, r: -6, type: 'forest' },
            { q: 4, r: -6, type: 'forest' },

            // ── 山脊：雾里看不见，但地图上给三条路一个尽头 ──
            { q: -6, r: 0, type: 'mountain' }, { q: -6, r: 1, type: 'mountain' },
            { q: -5, r: 2, type: 'mountain' }, { q: 0, r: 6, type: 'mountain' },
            { q: 1, r: 5, type: 'mountain' }, { q: -1, r: 6, type: 'mountain' },
            { q: 8, r: -4, type: 'mountain' }, { q: 8, r: -3, type: 'mountain' }
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
        // ── 东路：马库斯与艾利安。全关唯一一支还有余力做别的事的分队 ──
        {
            id: 'marcus_march', type: 'infantry', camp: 'expedition', q: 6, r: -3,
            storyCommander: 'marcus', hpPct: 100, morale: 2, rank: 1, specializationKey: 'assaultInfantry', canAct: true
        },
        { id: 'elian_march', type: 'cavalry', camp: 'expedition', q: 7, r: -3, hpPct: 100, morale: 2, rank: 1, specializationKey: 'lightCavalry', canAct: true },

        // ── 西路：提图斯与一名长矛手。走得最慢，一步都不能绕 ──
        { id: 'titus_march', type: 'infantry', camp: 'expedition', q: -4, r: 0, hpPct: 100, morale: 2, rank: 1, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'march_spear_w', type: 'infantry', camp: 'expedition', q: -4, r: 1, hpPct: 100, morale: 2, canAct: true },

        // ── 南路：妮娅与一名长矛手。雾里她的射程只剩一格，等于把炮当矛使 ──
        { id: 'nia_march', type: 'archer', camp: 'expedition', q: 0, r: 4, hpPct: 100, morale: 2, rank: 1, specializationKey: 'fieldGun', canAct: true },
        { id: 'march_spear_s', type: 'infantry', camp: 'expedition', q: 1, r: 4, hpPct: 100, morale: 2, canAct: true }
    ],

    unitGroups: [
        { id: 'east_file', unitIds: ['marcus_march', 'elian_march'] },
        { id: 'west_file', unitIds: ['titus_march', 'march_spear_w'] },
        { id: 'south_file', unitIds: ['nia_march', 'march_spear_s'] },
        {
            id: 'the_column',
            unitIds: ['marcus_march', 'elian_march', 'titus_march', 'march_spear_w', 'nia_march', 'march_spear_s']
        }
    ],

    areas: [
        { id: 'muster_ground', tiles: MUSTER_TILES },
        { id: 'signposts', tiles: [SIGN_WEST, SIGN_SOUTH, SIGN_EAST] },
        { id: 'lost_west', tiles: LOST_WEST },
        { id: 'lost_south', tiles: LOST_SOUTH },
        { id: 'lost_east', tiles: LOST_EAST }
    ],

    interactables: [
        {
            id: 'signpost_west', q: SIGN_WEST.q, r: SIGN_WEST.r,
            label: '摸清西路路标', enabled: true,
            unitIds: ['titus_march', 'march_spear_w']
        },
        {
            id: 'signpost_south', q: SIGN_SOUTH.q, r: SIGN_SOUTH.r,
            label: '摸清南路路标', enabled: true,
            unitIds: ['nia_march', 'march_spear_s']
        },
        {
            id: 'signpost_east', q: SIGN_EAST.q, r: SIGN_EAST.r,
            label: '摸清东路路标', enabled: true,
            unitIds: ['marcus_march', 'elian_march']
        },
        {
            id: 'broken_arrow', q: BROKEN_ARROW.q, r: BROKEN_ARROW.r,
            label: '查看林中的那道划痕', enabled: false,
            unitIds: ['marcus_march', 'elian_march'],
            collectibleId: 'bi07_broken_arrow'
        }
    ],

    variables: [
        { id: 'signs_read', scope: 'level', type: 'number', initial: 0 },
        { id: 'ambushes', scope: 'level', type: 'number', initial: 0 },
        { id: 'mustered', scope: 'level', type: 'boolean', initial: false },
        { id: 'slow_march', scope: 'level', type: 'boolean', initial: false },
        // 跨关：马库斯是否亲眼见过佩特拉溃兵还在林子里。第八关的矛盾线索会读它。
        { id: 'saw_the_deserters', scope: 'campaign', type: 'boolean', initial: false }
    ],

    objectives: {
        muster_at_the_camp: {
            title: '在旧宿营地会合',
            detail: '三列人马彼此看不见。六个人里至少五个走到中央的旧营地，这一夜的行军才算数。',
            active: true,
            main: true,
            highlight: { area: 'muster_ground' }
        },
        read_the_signposts: {
            title: '认路标',
            detail: '三条路各有一处路标，都在本列第一回合走得到的地方。摸到它，前面那段路就会从雾里显出来。',
            active: true,
            main: false,
            highlight: { area: 'signposts' }
        },
        stay_on_the_road: {
            title: '别离开道路',
            detail: '雾里认不出岔路。走出道路会撞上不该在这儿的人——那要花掉你走不起的一个回合。',
            active: true,
            main: false
        }
    },

    triggers: [
        {
            id: 'opening_march',
            title: '开场：卯时点兵，雾里分三列',
            enabled: true,
            once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                {
                    kind: 'showStep',
                    text: '追缉令的抄件昨夜就发到了各队：劫驾者北去，猎宫一线，昼夜兼程。卯时点兵时天还没亮，林道整夜起雾，十步之外只剩声音。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '道太窄，六个人挤一条路走不快。分三列：西路、南路、东路，各走各的，中间那片旧营地会合。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '百夫长，分开以后互相看不见。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '看不见就听。营地那边每隔一刻吹一次号，往号声走。路上有路标，摸到就知道下一段往哪拐。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '雾里我的射程只剩一格。够不着两格外的东西了。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '知道。所以你贴着长矛手走，别单独在前面。艾利安——雾天马占便宜，撞上去比平时疼两成，跑得越远越疼。真出事，你先上。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '看不见还敢冲？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '看不见的时候，听命令就够了。',
                    next: '__begin_march'
                },
                { kind: 'setTriggerEnabled', trigger: 'march_brief', enabled: true }
            ]
        },
        {
            id: 'march_brief',
            title: '唯一的引导步骤：西路先动',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__begin_march' }],
            do: [
                { kind: 'revealTiles', camp: 'expedition', target: { area: 'muster_ground' } },
                {
                    kind: 'showStep',
                    text: '第一声号角从东北方向传来。雾里显出中央那片旧宿营地的轮廓——那是今夜唯一确定的东西。'
                },
                {
                    kind: 'showStep',
                    text: '先走西路。把提图斯移动到高亮的路标上：卫戍步兵一回合走两格平地，刚好够。',
                    dialogLock: true,
                    highlight: {
                        unit: 'titus_march',
                        tiles: [SIGN_WEST],
                        hint: '把提图斯移动到高亮的西路路标'
                    }
                }
            ]
        },

        {
            id: 'read_signpost_west',
            title: '西路路标：解除引导',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'signpost_west' }],
            do: [
                { kind: 'unlockInput' },
                { kind: 'setVariable', variable: 'signs_read', operation: 'add', value: 1 },
                { kind: 'revealTiles', camp: 'expedition', target: { tiles: [{ q: -1, r: 0 }, { q: -1, r: 1 }] } },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '摸到了。石头上刻着两道，朝东南。前面那段路我能看清了。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '照刻痕走，别自己找近道。另外两列也一样——各自的路标都在第一段路上。'
                }
            ]
        },
        {
            id: 'read_signpost_south',
            title: '南路路标',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'signpost_south' }],
            do: [
                { kind: 'setVariable', variable: 'signs_read', operation: 'add', value: 1 },
                { kind: 'revealTiles', camp: 'expedition', target: { tiles: [{ q: 0, r: 1 }, { q: 1, r: 1 }] } },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '南路路标在。刻痕朝北——直走，不拐。'
                }
            ]
        },
        {
            id: 'read_signpost_east',
            title: '东路路标：背面那道新划痕',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'signpost_east' }],
            do: [
                { kind: 'setVariable', variable: 'signs_read', operation: 'add', value: 1 },
                { kind: 'revealTiles', camp: 'expedition', target: { tiles: [{ q: 2, r: -2 }, { q: 1, r: -1 }] } },
                { kind: 'setInteractionState', interactable: 'broken_arrow', state: 'available' },
                { kind: 'revealTiles', camp: 'expedition', target: { tiles: [BROKEN_ARROW] } },
                { kind: 'setObjectiveStatus', objective: 'stay_on_the_road', status: 'active' },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '刻痕朝西南。……背面还有一道，是新的，刀尖划的，朝北。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '谁划的？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '不知道。北面是林子，不是路。'
                },
                {
                    kind: 'showStep',
                    text: '划痕指向道路以北的林中。走过去要离开道路——离开道路，就没有人替你看着雾。'
                }
            ]
        },

        {
            id: 'ambush_west',
            title: '西路走错岔口',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'lost_west', camp: 'expedition', op: '>=', value: 1 }],
            do: [
                { kind: 'setVariable', variable: 'ambushes', operation: 'add', value: 1 },
                { kind: 'setVariable', variable: 'saw_the_deserters', operation: 'set', value: true },
                {
                    kind: 'spawnUnits', units: [
                        { id: 'lost_west_a', type: 'infantry', camp: 'deserters', q: -3, r: -3, hpPct: 65, morale: 1, canAct: true },
                        { id: 'lost_west_b', type: 'infantry', camp: 'deserters', q: -4, r: -1, hpPct: 65, morale: 1, canAct: true }
                    ]
                },
                {
                    kind: 'showStep', speaker: VOICE,
                    text: '别过来。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '……这不是路。是我走错了。'
                }
            ]
        },
        {
            id: 'ambush_south',
            title: '南路走错岔口',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'lost_south', camp: 'expedition', op: '>=', value: 1 }],
            do: [
                { kind: 'setVariable', variable: 'ambushes', operation: 'add', value: 1 },
                { kind: 'setVariable', variable: 'saw_the_deserters', operation: 'set', value: true },
                {
                    kind: 'spawnUnits', units: [
                        { id: 'lost_south_a', type: 'infantry', camp: 'deserters', q: -3, r: 3, hpPct: 65, morale: 1, canAct: true },
                        { id: 'lost_south_b', type: 'infantry', camp: 'deserters', q: -1, r: 4, hpPct: 65, morale: 1, canAct: true }
                    ]
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '有人。两个……不对，是三个，第三个在往后退。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '一格之内才打得着。退到长矛手后面去。'
                }
            ]
        },
        {
            id: 'ambush_east',
            title: '东路离开道路：溃兵的窝子',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'lost_east', camp: 'expedition', op: '>=', value: 1 }],
            do: [
                { kind: 'setVariable', variable: 'ambushes', operation: 'add', value: 1 },
                { kind: 'setVariable', variable: 'saw_the_deserters', operation: 'set', value: true },
                {
                    kind: 'spawnUnits', units: [
                        { id: 'lost_east_a', type: 'infantry', camp: 'deserters', q: 2, r: -3, hpPct: 65, morale: 1, canAct: true },
                        { id: 'lost_east_b', type: 'infantry', camp: 'deserters', q: 3, r: -4, hpPct: 65, morale: 1, canAct: true }
                    ]
                },
                {
                    kind: 'showStep',
                    text: '林子里有一圈没烧透的火塘，围着六七个铺位，只用了三个。没有帐篷，没有旗。'
                },
                {
                    kind: 'showStep', speaker: VOICE,
                    text: '我们不是劫驾的。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '百夫长，他们说他们不是——'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '他们已经拔刀了。先脱开，别缠住。'
                }
            ]
        },

        {
            id: 'found_broken_arrow',
            title: '断箭',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'broken_arrow' }],
            do: [
                {
                    kind: 'showStep',
                    text: '划痕的尽头是一棵歪树。树身上插着半支箭，箭杆齐根折断，箭羽是三片，扎法向左。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '这是东境的箭。佩特拉的箭。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '嗯。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '……城破两个月了。他们怎么会在这儿？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '归籍的名册上没有他们。名册上没有的人，就得住在名册管不着的地方。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '要写进回报吗。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '今夜的令是往北。回报里写往北的事。',
                    highlight: { area: 'muster_ground' }
                }
            ]
        },

        {
            id: 'column_mustered',
            title: '会合：本关结束',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'muster_ground', camp: 'expedition', op: '>=', value: 5 }],
            do: [
                { kind: 'setVariable', variable: 'mustered', operation: 'set', value: true },
                { kind: 'setObjectiveStatus', objective: 'muster_at_the_camp', status: 'completed' },
                { kind: 'setObjectiveStatus', objective: 'read_the_signposts', status: 'completed' },
                { kind: 'setObjectiveStatus', objective: 'stay_on_the_road', status: 'completed' },
                {
                    kind: 'showStep',
                    text: '三列人马先后从雾里走出来，谁也没听见另外两列是什么时候到的。号角停了。天开始亮，雾却更厚。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '一路上什么都看不见，居然真走到了。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '路标是去年立的，号角是今早定的。你不用看见，你只要照着走。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '休整半刻。往北还有三十里，天黑前到猎宫外围。'
                }
            ]
        },

        {
            id: 'march_dragging',
            title: '第三个回合仍未会合：失去行军速度星级',
            enabled: true,
            once: true,
            when: [
                { kind: 'turnStarted', camp: 'expedition', turn: 2 },
                { kind: 'variableCompare', scope: 'level', variable: 'mustered', op: '==', value: false }
            ],
            do: [
                { kind: 'setVariable', variable: 'slow_march', operation: 'set', value: true },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '号角已经吹了三遍。谁还在路上，走快些——雾散之前必须并成一列。'
                }
            ]
        },
        {
            id: 'march_failed',
            title: '失败：天亮了还没并成一列',
            enabled: true,
            once: true,
            when: [
                { kind: 'turnStarted', camp: 'expedition', turn: 3 },
                { kind: 'variableCompare', scope: 'level', variable: 'mustered', op: '==', value: false }
            ],
            do: [
                { kind: 'setObjectiveStatus', objective: 'muster_at_the_camp', status: 'failed' },
                {
                    kind: 'endScenario', result: 'lose',
                    reason: '号角停了，人还散在雾里。三列人马各自走到天亮也没能并成一列——猎宫那一线，今天到不了了。'
                }
            ]
        },
        {
            id: 'column_broken',
            title: '失败：折损过半，凑不齐会合人数',
            enabled: true,
            once: true,
            when: [{ kind: 'factionUnitCount', camp: 'expedition', op: '<=', value: 4 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'stay_on_the_road', status: 'failed' },
                { kind: 'setObjectiveStatus', objective: 'muster_at_the_camp', status: 'failed' },
                {
                    kind: 'endScenario', result: 'lose',
                    reason: '一次夜行军，在离猎宫三十里的林子里折了两个人。回报上会写"遭遇不明武装"——不会写他们的箭是哪儿造的。'
                }
            ]
        }
    ],

    result: {
        winText: '六个人在旧营地并成一列，谁也说不清路上错过了什么。马库斯照着路标走完了全程——今夜这证明他是对的。再过八天，他会在雪地里第一次发现：路标也是人立的。',
        loseText: '行军失败。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '两个回合内会合',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'slow_march', op: '==', value: false }]
            },
            {
                label: '六人一个不少',
                when: [{ kind: 'factionUnitCount', camp: 'expedition', op: '>=', value: 6 }]
            },
            {
                label: '取回那支断箭',
                when: [{ kind: 'collectibleUnlocked', collectible: 'bi07_broken_arrow', unlocked: true }]
            }
        ]
    }
};
