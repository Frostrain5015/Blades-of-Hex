// 染血的鸢尾花 · 第二章「我心如火」
// BI-08 普通关「雪埋旧路」
//
// 猎宫以南的雪原。追缉令说北去，辙印却在三个地方分了岔。
//
// 设计意图（普通关，标准路线 10–15 分钟）：
//   大纲要求：雪原、废驿站与冻河构成三条可选追踪路线，敌军不在开局全部可见；
//   调查三处旧近卫军遗迹并在回合限制内追上离开的队伍；每处遗迹给出一条能同时
//   支持"劫驾"或"营救"的线索；调查不足则失去一条猎宫对话。
//
//   ① 三条线索，三个方向，代价各不相同：
//        中路·废驿站（0,1）  —— 顺路，不绕，但殿后队正堵在门口，得从人身上过去；
//        西路·冻河渡口(-3,0) —— 河面只有一处没塌，是个真隘口，来回多走三格；
//        东路·雪丘火堆(3,-1) —— 雪丘绕行，多走三格，步兵去不划算，骑兵刚好有余力。
//      直线到猎宫十格。全拿三条，就得把六个人拆成三股，在雾里各走各的。
//
//   ② 殿后的"无名护卫"**不是来杀人的，是来拖时间的**。接触两个回合后他们自行
//      后撤——所以每一处都有两种解法：打过去（掉血、快）或耗过去（安全、慢两回合）。
//      在一张有时限的地图上，"等"是要付账的。这是本关唯一的战斗设计，够了。
//
//   ③ 三条线索没有一条能定案。每一条都能读成"劫驾"，也都能读成"营救"——
//      提图斯按前一种读，艾利安按后一种读，妮娅只报物证，马库斯拒绝下结论。
//      结尾的战报**不给选项菜单**：你查到几条，他就只能写几条。查到两条以上，
//      他写得起"不明"；查到零到一条，他只能照令上的话往上抄。
//      玩家的选择在地图上做完了，不在对话框里。
//
// 收藏品：`bi08_burnt_strap` 烧焦的誓章系带（东路雪丘火堆，只有骑兵匀得出这一趟）。
//
// 跨关变量：clue_roster / clue_seal / clue_strap 三个 campaign 布尔量，
//   第九关猎宫对峙时逐条兑现——没查到的那条，阿德里安就不会替你说出来。
//   同时读取第七关的 saw_the_deserters：见过林中溃兵的人，看这堆火会多想一层。
//
// 数值依据：
//   特化速度 —— assaultInfantry 6（平原 3 格/回合）、garrisonInfantry 4（2 格）、
//   lightCavalry 9（4 格 + 末步豁免 = 5 格）、fieldGun 3（2 格，雾中射程 2→1）。
//   平原 2 / 森林 3 / 山地 6；浅水地块陆军不可进入，冻河因此是真隘口。
//   直线十格：马库斯 4 回合、提图斯 5 回合；绕一处 +3 格；时限第 9 回合开始判负。
//   turnLimit 运行时不裁决，写 0。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';
import { collectiblesForScenario } from './collectibles.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const TITUS = Object.freeze({ name: '提图斯', portrait: 'npcMale' });
const NIA = Object.freeze({ name: '妮娅', portrait: 'npcFemale' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });
const GUARD = Object.freeze({ name: '蒙面的护卫', portrait: 'npcMale' });

const STATION = Object.freeze({ q: 0, r: 1 });    // 废驿站：卫队名册
const FORD = Object.freeze({ q: -3, r: 0 });      // 冻河渡口：封蜡
const CAIRN = Object.freeze({ q: 3, r: -1 });     // 雪丘火堆：誓章系带

const LODGE_TILES = Object.freeze([
    { q: 0, r: -4 }, { q: 0, r: -5 }, { q: 1, r: -5 }, { q: -1, r: -4 }
]);

export const config = {
    schemaVersion: 4,
    id: 'bi-08-trail',
    title: '雪埋旧路',
    displayId: 'BI-08',
    chronicleId: 'blood-iris',
    seed: 0x2808,
    turnLimit: 0,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '我心如火',
        scenarioSubtitle: 'BI-08 雪埋旧路'
    },

    weather: 'fog',
    localPlayerCamp: 'expedition',

    factions: [
        {
            id: 'expedition',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '奉追缉令北上的东征军前卫',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'oldGuard',
            name: '无名护卫',
            color: 'cyan',
            note: '不打旗，不应答，不追击。三年前他们的名字被人从名册上剜掉了。',
            controller: 'ai',
            participatesInTurns: true,
            active: true
        }
    ],

    turnOrder: ['expedition', 'oldGuard'],
    diplomacy: {
        expedition: { oldGuard: 'enemy' },
        oldGuard: { expedition: 'enemy' }
    },

    mechanics: {
        tacticalCards: false,
        recruitment: false,
        reinforcement: false,
        commanderSkills: true,
        airCommands: false,
        weatherEffects: true,
        morale: true,
        fortifications: false,
        fogOfWar: true,
        alliedVision: false
    },

    aiOpponentCamp: 'oldGuard',
    aiDifficulty: 0.5,
    gold: { expedition: 0, oldGuard: 0 },
    commanders: { expedition: 'centurion' },
    hands: { expedition: [], oldGuard: [] },
    storyCommanders: [{ id: 'marcus', name: '马库斯', archetype: 'centurion' }],
    collectibles: collectiblesForScenario('bi-08-trail'),

    board: {
        layout: 'borderless',
        radius: 4,
        cities: [
            // 昨夜的宿营地，就在出发线上。已经是我方的，不需要打——它只是"你从哪儿来"。
            { q: 0, r: 6, radius: 1, districtId: 1, camp: 'expedition' }
        ],
        // 冻河：一道横在西半图上的水线，只有 (-3,0) 那一段冰还没塌。
        // 陆军无法进入浅水，所以走西路的人必须从渡口过——封蜡就压在渡口的界石下。
        surface: [
            { q: -6, r: 0, kind: 'shallowWater' },
            { q: -5, r: 0, kind: 'shallowWater' },
            { q: -4, r: 0, kind: 'shallowWater' },
            { q: -2, r: 0, kind: 'shallowWater' },
            { q: -1, r: 0, kind: 'shallowWater' },
            { q: -7, r: 1, kind: 'shallowWater' },
            { q: -7, r: 0, kind: 'shallowWater' }
        ],
        terrain: [
            // ── 东侧雪丘：把火堆围在里面，步兵绕不划算，骑兵从 (3,0) 插进去 ──
            { q: 2, r: -1, type: 'mountain' }, { q: 2, r: -2, type: 'mountain' },
            { q: 3, r: -2, type: 'mountain' }, { q: 4, r: -2, type: 'mountain' },
            { q: 4, r: -3, type: 'mountain' }, { q: 5, r: -1, type: 'mountain' },
            // ── 西侧崖坎：冻河北岸不是随便哪儿都爬得上去 ──
            { q: -5, r: -2, type: 'mountain' }, { q: -6, r: -1, type: 'mountain' },
            { q: -4, r: -3, type: 'mountain' }, { q: -2, r: -1, type: 'mountain' },
            // ── 中路北段的雪松林：直线最短，也最难走 ──
            { q: 0, r: -2, type: 'forest' }, { q: 1, r: -2, type: 'forest' },
            { q: -1, r: -1, type: 'forest' }, { q: 1, r: -1, type: 'forest' },
            { q: 0, r: -3, type: 'forest' }, { q: -1, r: -3, type: 'forest' },
            { q: 1, r: -3, type: 'forest' }, { q: -2, r: -4, type: 'forest' },
            { q: 3, r: -4, type: 'forest' }, { q: 2, r: -4, type: 'forest' },
            // ── 出发地一带的疏林，纯粹是给雪原一个前景 ──
            { q: -1, r: 4, type: 'forest' }, { q: 2, r: 4, type: 'forest' },
            { q: -2, r: 3, type: 'forest' }, { q: 2, r: 2, type: 'forest' },
            { q: -2, r: 2, type: 'forest' }, { q: -3, r: 3, type: 'forest' },
            { q: -4, r: 3, type: 'forest' }, { q: 4, r: 1, type: 'forest' }
        ],
        villages: [
            { q: STATION.q, r: STATION.r, districtId: 1 },   // 废驿站
            { q: 0, r: -5, districtId: 1 }                    // 猎宫外围的哨屋
        ],
        fortifications: [],
        installations: [],
        districts: [],
        rivers: [],
        crossings: [],
        ports: []
    },

    units: [
        // ── 前卫六人。分三股才拿得全，合一股才打得动 ──
        {
            id: 'marcus_snow', type: 'infantry', camp: 'expedition', q: 0, r: 6,
            storyCommander: 'marcus', hpPct: 100, morale: 2, rank: 1, specializationKey: 'assaultInfantry', canAct: true
        },
        { id: 'titus_snow', type: 'infantry', camp: 'expedition', q: -1, r: 6, hpPct: 100, morale: 2, rank: 1, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'nia_snow', type: 'archer', camp: 'expedition', q: 1, r: 6, hpPct: 100, morale: 2, rank: 1, specializationKey: 'fieldGun', canAct: true },
        { id: 'elian_snow', type: 'cavalry', camp: 'expedition', q: 2, r: 5, hpPct: 100, morale: 2, rank: 1, specializationKey: 'lightCavalry', canAct: true },
        { id: 'snow_spear', type: 'infantry', camp: 'expedition', q: -2, r: 6, hpPct: 100, morale: 2, canAct: true },
        { id: 'snow_rider', type: 'cavalry', camp: 'expedition', q: 1, r: 5, hpPct: 100, morale: 2, canAct: true },

        // ── 殿后的无名护卫。开局全部藏在雾里，走近才看得见 ──
        // 驿站：三个人堵门，是三处里最硬的一处。
        { id: 'guard_station_a', type: 'infantry', camp: 'oldGuard', q: STATION.q, r: STATION.r, hpPct: 85, morale: 2, rank: 1, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'guard_station_b', type: 'infantry', camp: 'oldGuard', q: 1, r: 0, hpPct: 85, morale: 2, rank: 1, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'guard_station_bow', type: 'archer', camp: 'oldGuard', q: 0, r: 2, hpPct: 80, morale: 1, rank: 1, specializationKey: 'fieldGun', canAct: true },
        // 渡口：两个人守一道冰，谁也过不去。
        { id: 'guard_ford_a', type: 'infantry', camp: 'oldGuard', q: FORD.q, r: FORD.r, hpPct: 85, morale: 2, rank: 1, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'guard_ford_b', type: 'infantry', camp: 'oldGuard', q: -3, r: 1, hpPct: 80, morale: 1, canAct: true },
        // 雪丘：一个人守火堆，一骑挡路口。
        { id: 'guard_cairn_a', type: 'infantry', camp: 'oldGuard', q: CAIRN.q, r: CAIRN.r, hpPct: 80, morale: 1, canAct: true },
        { id: 'guard_cairn_rider', type: 'cavalry', camp: 'oldGuard', q: 3, r: 0, hpPct: 85, morale: 2, rank: 1, specializationKey: 'lightCavalry', canAct: true }
    ],

    unitGroups: [
        {
            id: 'the_pursuit',
            unitIds: ['marcus_snow', 'titus_snow', 'nia_snow', 'elian_snow', 'snow_spear', 'snow_rider']
        },
        { id: 'station_guard', unitIds: ['guard_station_a', 'guard_station_b', 'guard_station_bow'] },
        { id: 'ford_guard', unitIds: ['guard_ford_a', 'guard_ford_b'] },
        { id: 'cairn_guard', unitIds: ['guard_cairn_a', 'guard_cairn_rider'] }
    ],

    areas: [
        { id: 'lodge_outskirts', tiles: LODGE_TILES },
        { id: 'clue_sites', tiles: [STATION, FORD, CAIRN] },
        { id: 'station_approach', tiles: [{ q: 0, r: 3 }, { q: -1, r: 3 }, { q: 1, r: 2 }] },
        { id: 'ford_approach', tiles: [{ q: -2, r: 1 }, { q: -3, r: 2 }, { q: -4, r: 2 }] },
        { id: 'cairn_approach', tiles: [{ q: 3, r: 1 }, { q: 2, r: 1 }, { q: 4, r: 0 }] }
    ],

    interactables: [
        {
            id: 'clue_roster', q: STATION.q, r: STATION.r,
            label: '翻检驿站里的卫队名册', enabled: true,
            unitIds: ['marcus_snow', 'titus_snow', 'nia_snow', 'elian_snow', 'snow_spear', 'snow_rider']
        },
        {
            id: 'clue_seal', q: FORD.q, r: FORD.r,
            label: '查看渡口界石下的公文匣', enabled: true,
            unitIds: ['marcus_snow', 'titus_snow', 'nia_snow', 'elian_snow', 'snow_spear', 'snow_rider']
        },
        {
            id: 'clue_strap', q: CAIRN.q, r: CAIRN.r,
            label: '扒开雪丘下的火堆', enabled: true,
            unitIds: ['marcus_snow', 'titus_snow', 'nia_snow', 'elian_snow', 'snow_spear', 'snow_rider'],
            collectibleId: 'bi08_burnt_strap'
        }
    ],

    variables: [
        { id: 'snow_clues', scope: 'level', type: 'number', initial: 0 },
        { id: 'arrived', scope: 'level', type: 'boolean', initial: false },
        { id: 'slow_pursuit', scope: 'level', type: 'boolean', initial: false },
        // 跨关：三条线索各自是否到手。第九关猎宫对峙逐条兑现。
        { id: 'clue_roster', scope: 'campaign', type: 'boolean', initial: false },
        { id: 'clue_seal', scope: 'campaign', type: 'boolean', initial: false },
        { id: 'clue_strap', scope: 'campaign', type: 'boolean', initial: false },
        // 跨关（读）：第七关是否离开过道路、见过林中溃兵。
        { id: 'saw_the_deserters', scope: 'campaign', type: 'boolean', initial: false }
    ],

    objectives: {
        catch_the_column: {
            title: '追到猎宫外围',
            detail: '辙印一路向北。至少三个人走到北面的哨屋一带，才算没跟丢。',
            active: true,
            main: true,
            highlight: { area: 'lodge_outskirts' }
        },
        read_the_snow: {
            title: '查三处旧近卫的痕迹',
            detail: '废驿站、冻河渡口、雪丘火堆。查得越多，回程的战报里你能写的话越多——一条都没查，就只能照命令抄。',
            active: true,
            main: false,
            highlight: { area: 'clue_sites' }
        },
        keep_the_squad: {
            title: '别把人丢在雪里',
            detail: '殿后的人不追击，只拖时间。打不打得过是一回事，值不值得打是另一回事。',
            active: true,
            main: false
        }
    },

    triggers: [
        {
            id: 'opening_snow',
            title: '开场：辙印在三个地方分了岔',
            enabled: true,
            once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                {
                    kind: 'showStep',
                    text: '猎宫以南六十里，雪原。追缉令的抄件在马库斯怀里，纸角被汗浸软了：劫驾者携陛下北去，就地追缉，格杀勿论。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '辙印到这儿散了。一股往北进林子，一股往西下河滩，一股往东绕雪丘。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '散成三股是要甩掉我们。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '也可能本来就是三伙人。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '别猜。三处都留了东西——中间是座废驿站，西边河上有个渡口，东边雪丘底下有堆没烧透的火。走过去看，看完再说话。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '百夫长，令上写的是格杀勿论，没写调查。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '令上也没写不许看。北面三十里就是猎宫，天黑前要到。三处都想看，就得拆开走——拆开走，雾里各顾各。你们自己掂量。',
                    next: '__begin_pursuit'
                },
                { kind: 'setTriggerEnabled', trigger: 'pursuit_brief', enabled: true }
            ]
        },
        {
            id: 'pursuit_brief',
            title: '任务说明',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__begin_pursuit' }],
            do: [
                { kind: 'unlockInput' },
                { kind: 'revealTiles', camp: 'expedition', target: { area: 'lodge_outskirts' } },
                {
                    kind: 'showStep',
                    text: '雾贴着雪面走，看不出三十步以外。北面哨屋的轮廓在雾里显了一下——那是猎宫的外围。',
                    highlight: { area: 'lodge_outskirts' }
                },
                {
                    kind: 'showStep',
                    text: '直线到哨屋十格；绕西边的渡口或东边的雪丘，各要多走三格。殿后的人守在三处路口上，但他们不追击——耗得起时间的话，他们会自己走。',
                    highlight: { area: 'clue_sites' }
                }
            ]
        },

        // ── 三处接触：走近才看得见人，看见之后开始倒计时 ──
        {
            id: 'station_contact',
            title: '中路接触：驿站门口',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'station_approach', camp: 'expedition', op: '>=', value: 1 }],
            do: [
                { kind: 'revealTiles', camp: 'expedition', target: { group: 'station_guard' } },
                { kind: 'setTriggerEnabled', trigger: 'station_withdraw', enabled: true },
                {
                    kind: 'showStep',
                    text: '驿站的门板早没了，屋里没有火。三个人站在雪地里等着，没有旗，脸用布裹到眼睛下面。他们不喊话，也不后退。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '报番号！'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '别喊了。他们不会报——报得出番号的人不会站在这儿。'
                }
            ]
        },
        {
            id: 'station_withdraw',
            title: '驿站殿后队自行撤走',
            enabled: false,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'oldGuard', turn: 2 }],
            do: [
                { kind: 'removeUnits', target: { group: 'station_guard' } },
                {
                    kind: 'showStep',
                    text: '雪下大了。那几个人几乎是同时收了刀，一个跟一个退进雾里，退得很整齐——像是有人在雾那边数着数。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '不追。他们要的就是我们追。'
                }
            ]
        },
        {
            id: 'ford_contact',
            title: '西路接触：冻河渡口',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'ford_approach', camp: 'expedition', op: '>=', value: 1 }],
            do: [
                { kind: 'revealTiles', camp: 'expedition', target: { group: 'ford_guard' } },
                { kind: 'setTriggerEnabled', trigger: 'ford_withdraw', enabled: true },
                {
                    kind: 'showStep',
                    text: '河面塌了大半，只有界石那一段还结实，冰上压着两道并排的车辙。两个人守在冰口，脚下垫了草——他们准备在这儿站很久。'
                }
            ]
        },
        {
            id: 'ford_withdraw',
            title: '渡口殿后队自行撤走',
            enabled: false,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'oldGuard', turn: 2 }],
            do: [
                { kind: 'removeUnits', target: { group: 'ford_guard' } },
                {
                    kind: 'showStep',
                    text: '两个人退到北岸，把垫脚的草一把把扔进河里，然后走了。冰口空着，谁都可以过。'
                }
            ]
        },
        {
            id: 'cairn_contact',
            title: '东路接触：雪丘火堆',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'cairn_approach', camp: 'expedition', op: '>=', value: 1 }],
            do: [
                { kind: 'revealTiles', camp: 'expedition', target: { group: 'cairn_guard' } },
                { kind: 'setTriggerEnabled', trigger: 'cairn_withdraw', enabled: true },
                {
                    kind: 'showStep',
                    text: '雪丘背风的一面有堆火，还在冒烟。一个人蹲着往火里添东西，另一个骑在马上挡住路口。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '他在烧东西。'
                }
            ]
        },
        {
            id: 'cairn_withdraw',
            title: '雪丘殿后队自行撤走',
            enabled: false,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'oldGuard', turn: 2 }],
            do: [
                { kind: 'removeUnits', target: { group: 'cairn_guard' } },
                {
                    kind: 'showStep',
                    text: '蹲着的那个把最后一样东西按进火里，站起来，跟骑马的一起往北去了。火没有灭。'
                }
            ]
        },

        // ── 三条线索。每一条都能读成两种事 ──
        {
            id: 'found_roster',
            title: '线索一：被剜去名字的卫队名册',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'clue_roster' }],
            do: [
                { kind: 'setVariable', variable: 'snow_clues', operation: 'add', value: 1 },
                { kind: 'setVariable', variable: 'clue_roster', operation: 'set', value: true },
                {
                    kind: 'showStep',
                    text: '驿站柜台底下压着一本册子，是王宫卫队的旧名册。第三页到第五页，每一行的名字都被刀尖剜掉了，只剩下编号和职级。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '把名字剜了，就查不出是哪一队人劫的驾。这不明摆着吗。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '要真是他们剜的，整本烧了不更省事？为什么留着编号。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '……剜痕不是新的。刀口的边翻起来，又被压平了，压痕里积了三年的灰。剜的时候，这册子还在王宫里。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '那也可能是宫里清档。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '也可能是有人不想让这些人被认出来——三年前就不想。记编号，别记你们自己的想法。'
                }
            ]
        },
        {
            id: 'found_seal',
            title: '线索二：封蜡上残缺的鸢尾',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'clue_seal' }],
            do: [
                { kind: 'setVariable', variable: 'snow_clues', operation: 'add', value: 1 },
                { kind: 'setVariable', variable: 'clue_seal', operation: 'set', value: true },
                {
                    kind: 'showStep',
                    text: '界石底下塞着一只空的公文匣。匣口的封蜡被整片揭下来放在里面——鸢尾的印子少了两瓣，缺口很齐。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '假印。伪造王玺，用来把陛下骗出宫。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '我在佩特拉见过一模一样的缺口。摄政府发下来的军令，封蜡都缺这两瓣。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '……那说明什么。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '说明真玺本来就缺两瓣。缺两瓣的是真的，齐整的才是假的。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '那这道公文是真的。是王宫发出来的。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '匣是空的。发的是什么，我们看不到。'
                },
                {
                    kind: 'showStep',
                    text: '——王玺是三年前那一夜之后开始缺角的。这件事宫里所有人都知道，也没有一个人写下来过。'
                }
            ]
        },
        {
            id: 'found_strap',
            title: '线索三：烧焦的誓章系带',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'clue_strap' }],
            do: [
                { kind: 'setVariable', variable: 'snow_clues', operation: 'add', value: 1 },
                { kind: 'setVariable', variable: 'clue_strap', operation: 'set', value: true },
                {
                    kind: 'showStep',
                    text: '火堆里烧的是皮子。扒开浮灰，底下是七八条烧了一半的誓章系带——带子上的铜环还在，白釉的誓章一枚也没有。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '烧誓章，就是不认自己是哪一队的。逃兵才这么干。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '烧的是带子，提图斯。章呢？'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '……'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '要扔早扔了。他们把带子烧了，章摘下来收着。他们不想被认出来，可他们也不肯把那东西丢掉。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '数一数铜环。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '……七个。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '七个人，三年，一直没归籍。记下：七枚铜环，无章。'
                }
            ]
        },
        {
            id: 'deserters_echo',
            title: '（承接 T7）见过林中溃兵的人，会想起同一件事',
            enabled: true,
            once: true,
            when: [
                { kind: 'eventInteractionIs', interactable: 'clue_strap' },
                { kind: 'variableCompare', scope: 'campaign', variable: 'saw_the_deserters', op: '==', value: true }
            ],
            do: [
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '百夫长。前天夜里林子里那些人，也是名册上没有的。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '嗯。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '这个国家到底有多少人是名册上没有的。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……走了。天要黑了。'
                }
            ]
        },
        {
            id: 'clues_contradict',
            title: '两条以上：马库斯第一次拒绝替别人下结论',
            enabled: true,
            once: true,
            when: [{ kind: 'variableCompare', scope: 'level', variable: 'snow_clues', op: '>=', value: 2 }],
            do: [
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '百夫长，这些东西合起来到底说明什么？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '说明两件事都说得通。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '那就是什么都没说明。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '不。以前是只有一件事说得通——是令上那件。现在有两件。这不叫没进展。'
                }
            ]
        },

        {
            id: 'snow_thickens',
            title: '第六回合：雪把辙印埋上了',
            enabled: true,
            once: true,
            when: [
                { kind: 'turnStarted', camp: 'expedition', turn: 5 },
                { kind: 'variableCompare', scope: 'level', variable: 'arrived', op: '==', value: false }
            ],
            do: [
                { kind: 'setVariable', variable: 'slow_pursuit', operation: 'set', value: true },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '辙印快看不见了。雪一直在下，再有两三个时辰就全平了。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '收拢，往北。查不完的就不查了。'
                }
            ]
        },

        {
            id: 'reached_lodge',
            title: '抵达猎宫外围',
            enabled: true,
            once: true,
            when: [{ kind: 'unitsInArea', area: 'lodge_outskirts', camp: 'expedition', op: '>=', value: 3 }],
            do: [
                { kind: 'setVariable', variable: 'arrived', operation: 'set', value: true },
                { kind: 'setObjectiveStatus', objective: 'read_the_snow', status: 'completed' },
                { kind: 'setObjectiveStatus', objective: 'keep_the_squad', status: 'completed' },
                {
                    kind: 'showStep',
                    text: '哨屋是空的，炉膛还温。再往北一里，雾里有橙色的光在动——猎宫的侧厅着了火，烧了不止一个时辰。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '追上了。百夫长，回执怎么写？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '照我们看见的写。',
                    next: '__file_snow_report'
                },
                { kind: 'setTriggerEnabled', trigger: 'report_with_doubt', enabled: true },
                { kind: 'setTriggerEnabled', trigger: 'report_by_the_order', enabled: true }
            ]
        },
        {
            id: 'report_with_doubt',
            title: '战报（查到两条以上）：他写得起"不明"',
            enabled: false,
            once: true,
            when: [
                { kind: 'eventNextIs', value: '__file_snow_report' },
                { kind: 'variableCompare', scope: 'level', variable: 'snow_clues', op: '>=', value: 2 }
            ],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '写：沿途三处，得旧名册一本、空匣封蜡一片、烧余系带七条。所涉人员身份不明，所涉文书内容不明。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '"不明"这两个字要是送到摄政大人手里——'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '那就让它送到。我可以写我不知道。我不能替我不知道的事写一个知道。'
                },
                {
                    kind: 'showStep',
                    text: '这是马库斯第一次把"不明"两个字写进军报。三年来他签过的每一份文书，结论都是别人先定好的。'
                },
                { kind: 'setObjectiveStatus', objective: 'catch_the_column', status: 'completed' }
            ]
        },
        {
            id: 'report_by_the_order',
            title: '战报（查到零到一条）：他只能照令上抄',
            enabled: false,
            once: true,
            when: [
                { kind: 'eventNextIs', value: '__file_snow_report' },
                { kind: 'variableCompare', scope: 'level', variable: 'snow_clues', op: '<=', value: 1 }
            ],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '写：追至猎宫外围，未获实据。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '那前面那句呢？劫驾。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……照令上那句抄。'
                },
                {
                    kind: 'showStep',
                    text: '雪把三处岔口都填平了。回执上只剩下一句话，是别人替他写好的那一句——他自己没有第二句可写。'
                },
                { kind: 'setObjectiveStatus', objective: 'catch_the_column', status: 'completed' }
            ]
        },

        {
            id: 'trail_lost',
            title: '失败：辙印被雪埋掉了',
            enabled: true,
            once: true,
            when: [
                { kind: 'turnStarted', camp: 'expedition', turn: 8 },
                { kind: 'variableCompare', scope: 'level', variable: 'arrived', op: '==', value: false }
            ],
            do: [
                { kind: 'setObjectiveStatus', objective: 'catch_the_column', status: 'failed' },
                {
                    kind: 'endScenario', result: 'lose',
                    reason: '天黑了，雪把三条辙印一起埋掉。猎宫方向的火光在雾里灭下去——等这队人再被找到，已经不是这个冬天的事了。'
                }
            ]
        },
        {
            id: 'squad_shattered',
            title: '失败：前卫散在了雪原上',
            enabled: true,
            once: true,
            when: [{ kind: 'factionUnitCount', camp: 'expedition', op: '<=', value: 2 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'keep_the_squad', status: 'failed' },
                { kind: 'setObjectiveStatus', objective: 'catch_the_column', status: 'failed' },
                {
                    kind: 'endScenario', result: 'lose',
                    reason: '为了三处不肯让路的雪堆，前卫拼掉了大半。殿后的人本来就没打算赢——他们只要你把时间和人都用在他们身上。'
                }
            ]
        },
        {
            id: 'marcus_down',
            title: '失败：马库斯倒在雪里',
            enabled: true,
            once: true,
            when: [{ kind: 'unitKilled', target: { unit: 'marcus_snow' } }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'catch_the_column', status: 'failed' },
                {
                    kind: 'endScenario', result: 'lose',
                    reason: '百夫长倒在离猎宫三十里的雪原上。那份还没写的回执，最后由别人代笔——写的是令上原来那句话。'
                }
            ]
        }
    ],

    result: {
        winText: '三处痕迹，六个人，一整天的雪。马库斯带回去的不是答案，是两种都讲得通的可能——而在此之前，他的军报里从来只有一种。猎宫的火还在烧，火里站着的人，明天会替他把第二种讲完。',
        loseText: '追踪失败。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '三处痕迹全部查清',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'snow_clues', op: '>=', value: 3 }]
            },
            {
                label: '五个回合内追到猎宫外围',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'slow_pursuit', op: '==', value: false }]
            },
            {
                label: '取回那几条烧焦的系带',
                when: [{ kind: 'collectibleUnlocked', collectible: 'bi08_burnt_strap', unlocked: true }]
            }
        ]
    }
};
