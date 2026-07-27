// 染血的鸢尾花 · 第二章「我心如火」
// BI-09 Boss 关「我心如火」
//
// 猎宫前庭。侧厅烧了一夜，火正从西边漫过来。阿格里乌斯站在正厅门口的石阶上，
// 三年没有人见过他。他不退。
//
// 设计意图（Boss 关，标准路线 20 分钟以上）：
//   大纲要求：猎宫前庭与燃烧的侧厅；阿格里乌斯据守中央，马库斯从雪地入口推进；
//   存活并将阿格里乌斯压至限伤阈值，不能将其击杀；同时避开扩散的火区；
//   他每回合向火堆靠，表现出他在等而不是逃；触发阈值后阿德里安现身，战斗立即结束。
//
//   ① 限伤：阿格里乌斯身上挂 `rule:'minHp', rulePercent:25` 的常驻效果。
//      你打不死他——**这不是保护他，是他还没打算结束**。玩家会先以为是 bug，
//      然后会发现每一次本该致命的一击都被同一个动作挡下来：他一直在护住身后那道门。
//
//   ② 火不是特效，是一个阵营。十三块**燃烧的梁柱与倒塌的隔扇**从开局就立在场上，
//      占格、挡路、不可选中也不可击杀（targetable:false + invulnerable），
//      对**所有人**——包括阿格里乌斯的护卫——每回合灼伤相邻单位。
//      所谓"扩散"是分三批点着（开局 / 第 4 回合 / 第 8 回合）：
//      场地不会变小，能站的地方会。第 14 回合屋顶塌，判负。
//
//   ③ 侧厅里的手抄本是一次真正的限时取舍：第 2 回合火把门烧开，第 5 回合塌。
//      三个回合的窗口，去的人拿不到打阿格里乌斯的经验，还要从火里走回来。
//
//   ④ 猎宫对话的完整度由**上一关查了几处痕迹**决定（campaign 变量 clue_roster /
//      clue_seal / clue_strap）。查全三处，阿德里安说的每一句马库斯都能当场核对；
//      一处没查，他就只能听着——大纲里"调查不足则失去一条猎宫对话"，落在这里。
//      另有一条独立支线：怀里那半片焦帛（bi05_charred_silk）拿到与否，
//      决定第三阶段马库斯是掏出东西还是空着手。
//
// 收藏品：`bi09_copied_codex` 侧厅里的手抄本（卡托的字迹，抄的是先王私录）。
//
// 数值依据：
//   阿格里乌斯 = assaultInfantry(180) + rank 3 + hpPct 150 的常驻效果，约 450 血，
//   限伤下限 25%；三个阶段阈值 70% / 45% / 26%（26 而不是 25，留一格容差保证触发）。
//   火 = infantry，atkPct −50，约每次 25–30 点灼伤，不致命但会逼你换位。
//   平原 2 / 森林 3 / 山地 6（正厅石阶是山地：骑兵冲不上去，只能仰着打）。
//   turnLimit 运行时不裁决，写 0；真时限由 turnStarted 表达。

import { BLOOD_IRIS_FACTION_PRESETS } from './chronicle.js';
import { collectiblesForScenario } from './collectibles.js';

const MARCUS = Object.freeze({ name: '马库斯', portrait: 'centurion' });
const AGRIUS = Object.freeze({ name: '阿格里乌斯', portrait: 'berserker' });
const ADRIAN = Object.freeze({ name: '阿德里安', portrait: 'npcMale' });
const TITUS = Object.freeze({ name: '提图斯', portrait: 'npcMale' });
const NIA = Object.freeze({ name: '妮娅', portrait: 'npcFemale' });
const ELIAN = Object.freeze({ name: '艾利安', portrait: 'npcMale' });

const AGRIUS_TILE = Object.freeze({ q: 0, r: -1 });   // 正厅石阶，他站了一夜的地方
const HALL_DOOR = Object.freeze({ q: 0, r: -2 });     // 他背后那道门
const SIDE_HALL = Object.freeze({ q: -3, r: -2 });    // 烧着的侧厅：手抄本在里面

export const config = {
    schemaVersion: 4,
    id: 'bi-09-halt',
    title: '我心如火',
    displayId: 'BI-09',
    chronicleId: 'blood-iris',
    seed: 0x2909,
    turnLimit: 0,

    intro: {
        campaignTitle: '染血的鸢尾花',
        chapterTitle: '我心如火',
        scenarioSubtitle: 'BI-09 我心如火'
    },

    weather: 'clear',
    localPlayerCamp: 'expedition',

    factions: [
        {
            id: 'expedition',
            ...BLOOD_IRIS_FACTION_PRESETS.aureliaKingdom,
            note: '追至猎宫的东征军前卫',
            controller: 'human',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'oldGuard',
            name: '无名护卫',
            color: 'cyan',
            note: '雪原上放你过来的那些人。他们一路让到这儿，就不再让了。',
            controller: 'ai',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'emberfall',
            name: '蔓延的火',
            color: 'orange',
            note: '烧穿了侧厅的火。它不挑人——两边一样烧。',
            controller: 'ai',
            participatesInTurns: true,
            active: true
        },
        {
            id: 'royal',
            name: '王室',
            color: 'white',
            note: '直到最后一刻才从门里走出来的人。',
            controller: 'scripted',
            participatesInTurns: false,
            active: true
        }
    ],

    turnOrder: ['expedition', 'oldGuard', 'emberfall'],
    diplomacy: {
        expedition: { oldGuard: 'enemy', emberfall: 'enemy', royal: 'neutral' },
        oldGuard: { expedition: 'enemy', emberfall: 'enemy', royal: 'neutral' },
        emberfall: { expedition: 'enemy', oldGuard: 'enemy', royal: 'neutral' },
        royal: { expedition: 'neutral', oldGuard: 'neutral', emberfall: 'neutral' }
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

    aiOpponentCamp: 'oldGuard',
    aiDifficulty: 0.75,
    gold: { expedition: 0, oldGuard: 0, emberfall: 0, royal: 0 },
    commanders: { expedition: 'centurion', oldGuard: 'berserker' },
    hands: { expedition: [], oldGuard: [], emberfall: [], royal: [] },
    storyCommanders: [
        { id: 'marcus', name: '马库斯', archetype: 'centurion' },
        { id: 'agrius', name: '阿格里乌斯', archetype: 'berserker' }
    ],
    collectibles: collectiblesForScenario('bi-09-halt'),

    board: {
        layout: 'borderless',
        radius: 4,
        cities: [
            // 前庭南口的雪地驻脚：马库斯昨夜歇脚的地方，已经是我方的。
            { q: 0, r: 5, radius: 1, districtId: 1, camp: 'expedition' }
        ],
        surface: [],
        terrain: [
            // 正厅石阶：他站在上面。骑兵冲不上去，只能仰着打。
            { q: AGRIUS_TILE.q, r: AGRIUS_TILE.r, type: 'mountain' },
            { q: 1, r: -1, type: 'mountain' },
            // 前庭的廊柱与倒地的家什
            { q: -1, r: 2, type: 'forest' }, { q: 1, r: 2, type: 'forest' },
            { q: -2, r: 1, type: 'forest' }, { q: 2, r: 1, type: 'forest' },
            { q: -4, r: 2, type: 'forest' }, { q: 3, r: 1, type: 'forest' },
            { q: -4, r: 3, type: 'forest' }, { q: 3, r: 2, type: 'forest' },
            { q: -3, r: -4, type: 'forest' }, { q: 2, r: -4, type: 'forest' }
        ],
        villages: [
            { q: HALL_DOOR.q, r: HALL_DOOR.r, districtId: 1 },   // 正厅门廊
            { q: SIDE_HALL.q, r: SIDE_HALL.r, districtId: 1 }    // 烧着的侧厅
        ],
        fortifications: [],
        installations: [],
        districts: [],
        rivers: [],
        crossings: [],
        ports: []
    },

    units: [
        // ── 前卫八人。从南面雪地进前庭 ──
        {
            id: 'marcus_lodge', type: 'infantry', camp: 'expedition', q: 0, r: 4,
            storyCommander: 'marcus', hpPct: 100, morale: 2, rank: 2, specializationKey: 'assaultInfantry', canAct: true
        },
        { id: 'titus_lodge', type: 'infantry', camp: 'expedition', q: -1, r: 4, hpPct: 100, morale: 2, rank: 2, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'nia_lodge', type: 'archer', camp: 'expedition', q: 1, r: 4, hpPct: 100, morale: 2, rank: 2, specializationKey: 'fieldGun', canAct: true },
        { id: 'elian_lodge', type: 'cavalry', camp: 'expedition', q: 2, r: 3, hpPct: 100, morale: 2, rank: 2, specializationKey: 'lightCavalry', canAct: true },
        { id: 'lodge_spear', type: 'infantry', camp: 'expedition', q: -2, r: 4, hpPct: 100, morale: 2, rank: 1, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'lodge_axe', type: 'infantry', camp: 'expedition', q: 1, r: 3, hpPct: 100, morale: 2, rank: 1, specializationKey: 'assaultInfantry', canAct: true },
        { id: 'lodge_bow', type: 'archer', camp: 'expedition', q: -1, r: 5, hpPct: 100, morale: 2, rank: 1, specializationKey: 'fieldGun', canAct: true },
        { id: 'lodge_rider', type: 'cavalry', camp: 'expedition', q: 2, r: 4, hpPct: 100, morale: 2, rank: 1, specializationKey: 'lightCavalry', canAct: true },

        // ── 阿格里乌斯。石阶上，背对着门 ──
        {
            id: 'agrius_boss', type: 'infantry', camp: 'oldGuard', q: AGRIUS_TILE.q, r: AGRIUS_TILE.r,
            storyCommander: 'agrius', hpPct: 100, morale: 3, rank: 3, specializationKey: 'assaultInfantry', canAct: true
        },

        // ── 无名护卫。雪地里放你过来的那七个人，铜环还挂在带子上 ──
        { id: 'guard_left', type: 'infantry', camp: 'oldGuard', q: -2, r: 0, hpPct: 100, morale: 2, rank: 2, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'guard_spear', type: 'infantry', camp: 'oldGuard', q: 1, r: 0, hpPct: 100, morale: 2, rank: 2, specializationKey: 'garrisonInfantry', canAct: true },
        { id: 'guard_right', type: 'infantry', camp: 'oldGuard', q: 2, r: -1, hpPct: 100, morale: 2, rank: 2, specializationKey: 'assaultInfantry', canAct: true },
        { id: 'guard_bow_l', type: 'archer', camp: 'oldGuard', q: -1, r: -2, hpPct: 100, morale: 2, rank: 2, specializationKey: 'fieldGun', canAct: true },
        { id: 'guard_bow_r', type: 'archer', camp: 'oldGuard', q: 1, r: -2, hpPct: 100, morale: 2, rank: 2, specializationKey: 'fieldGun', canAct: true },
        { id: 'guard_rider', type: 'cavalry', camp: 'oldGuard', q: -3, r: 0, hpPct: 100, morale: 2, rank: 2, specializationKey: 'lightCavalry', canAct: true },
        // 后备两人：第二阶段他喊出来的。开局不动。
        { id: 'guard_reserve_a', type: 'infantry', camp: 'oldGuard', q: -1, r: -4, hpPct: 100, morale: 2, rank: 1, specializationKey: 'garrisonInfantry', canAct: false },
        { id: 'guard_reserve_b', type: 'infantry', camp: 'oldGuard', q: 1, r: -4, hpPct: 100, morale: 2, rank: 1, specializationKey: 'garrisonInfantry', canAct: false },

        // ── 火。十三处已经烧着或就要烧着的梁柱与隔扇；不可选中、不可击杀 ──
        { id: 'fire_a1', type: 'infantry', camp: 'emberfall', q: -4, r: -2, hpPct: 100, morale: 2, canAct: true },
        { id: 'fire_a2', type: 'infantry', camp: 'emberfall', q: -4, r: -1, hpPct: 100, morale: 2, canAct: true },
        { id: 'fire_a3', type: 'infantry', camp: 'emberfall', q: -2, r: -3, hpPct: 100, morale: 2, canAct: true },
        { id: 'fire_a4', type: 'infantry', camp: 'emberfall', q: -3, r: -3, hpPct: 100, morale: 2, canAct: true },

        { id: 'fire_b1', type: 'infantry', camp: 'emberfall', q: -3, r: -1, hpPct: 100, morale: 2, canAct: false },
        { id: 'fire_b2', type: 'infantry', camp: 'emberfall', q: -2, r: -2, hpPct: 100, morale: 2, canAct: false },
        { id: 'fire_b3', type: 'infantry', camp: 'emberfall', q: -1, r: -3, hpPct: 100, morale: 2, canAct: false },
        { id: 'fire_b4', type: 'infantry', camp: 'emberfall', q: 0, r: -3, hpPct: 100, morale: 2, canAct: false },

        { id: 'fire_c1', type: 'infantry', camp: 'emberfall', q: -2, r: -1, hpPct: 100, morale: 2, canAct: false },
        { id: 'fire_c2', type: 'infantry', camp: 'emberfall', q: 2, r: -2, hpPct: 100, morale: 2, canAct: false },
        { id: 'fire_c3', type: 'infantry', camp: 'emberfall', q: 3, r: -2, hpPct: 100, morale: 2, canAct: false },
        { id: 'fire_c4', type: 'infantry', camp: 'emberfall', q: -3, r: 1, hpPct: 100, morale: 2, canAct: false },
        { id: 'fire_c5', type: 'infantry', camp: 'emberfall', q: 3, r: 0, hpPct: 100, morale: 2, canAct: false }
    ],

    unitGroups: [
        {
            id: 'vanguard',
            unitIds: ['marcus_lodge', 'titus_lodge', 'nia_lodge', 'elian_lodge', 'lodge_spear', 'lodge_axe', 'lodge_bow', 'lodge_rider']
        },
        {
            id: 'nameless_guard',
            unitIds: ['guard_left', 'guard_spear', 'guard_right', 'guard_bow_l', 'guard_bow_r', 'guard_rider']
        },
        { id: 'guard_reserve', unitIds: ['guard_reserve_a', 'guard_reserve_b'] },
        { id: 'fire_core', unitIds: ['fire_a1', 'fire_a2', 'fire_a3', 'fire_a4'] },
        { id: 'fire_wave_a', unitIds: ['fire_b1', 'fire_b2', 'fire_b3', 'fire_b4'] },
        { id: 'fire_wave_b', unitIds: ['fire_c1', 'fire_c2', 'fire_c3', 'fire_c4', 'fire_c5'] },
        {
            id: 'all_fire',
            unitIds: [
                'fire_a1', 'fire_a2', 'fire_a3', 'fire_a4',
                'fire_b1', 'fire_b2', 'fire_b3', 'fire_b4',
                'fire_c1', 'fire_c2', 'fire_c3', 'fire_c4', 'fire_c5'
            ]
        }
    ],

    areas: [
        { id: 'the_steps', tiles: [AGRIUS_TILE] },
        { id: 'side_hall', tiles: [SIDE_HALL] }
    ],

    interactables: [
        {
            id: 'copied_codex', q: SIDE_HALL.q, r: SIDE_HALL.r,
            label: '从侧厅火里抢出那本手抄本', enabled: false,
            unitIds: ['marcus_lodge', 'titus_lodge', 'nia_lodge', 'elian_lodge', 'lodge_spear', 'lodge_axe', 'lodge_bow', 'lodge_rider'],
            collectibleId: 'bi09_copied_codex'
        }
    ],

    variables: [
        { id: 'clue_score', scope: 'level', type: 'number', initial: 0 },
        { id: 'phase', scope: 'level', type: 'number', initial: 1 },
        { id: 'codex_taken', scope: 'level', type: 'boolean', initial: false },
        { id: 'halted', scope: 'level', type: 'boolean', initial: false },
        // 跨关（读）：第八关三处痕迹各自查到没有。决定猎宫对话能核对到哪一步。
        { id: 'clue_roster', scope: 'campaign', type: 'boolean', initial: false },
        { id: 'clue_seal', scope: 'campaign', type: 'boolean', initial: false },
        { id: 'clue_strap', scope: 'campaign', type: 'boolean', initial: false },
        // 跨关（写）：马库斯是否亲耳听阿德里安讲完。第三章各关据此改换称呼与立场。
        { id: 'heard_the_prince', scope: 'campaign', type: 'boolean', initial: false }
    ],

    objectives: {
        press_agrius: {
            title: '把阿格里乌斯逼到极限',
            detail: '他站在正厅石阶上。你打不倒他——每一次该致命的一击都会被同一个动作挡下来。打到他自己停手为止。',
            active: true,
            main: true,
            highlight: { area: 'the_steps' }
        },
        mind_the_fire: {
            title: '别让火把人围死',
            detail: '烧着的梁柱既挡路又灼人，两边一样烧。第 4、第 8 回合各点着一批；第 14 回合屋顶塌。',
            active: true,
            main: false
        },
        the_side_hall: {
            title: '（限时）侧厅里的东西',
            detail: '火把侧厅的门烧开了，里面有本没烧完的手抄本。三个回合，之后那间屋子就塌了。',
            active: false,
            main: false,
            highlight: { area: 'side_hall' }
        }
    },

    triggers: [
        // ── 开局：把火与限伤两条规则先立住 ──
        {
            id: 'opening_lodge',
            title: '开场：门口那个人',
            enabled: true,
            once: true,
            when: [{ kind: 'timer', value: 900 }],
            do: [
                // 火：不可选中、不可击杀、不移动、无反击，攻击力砍半。
                { kind: 'setUnitState', target: { group: 'all_fire' }, state: 'targetable', value: false },
                { kind: 'setUnitState', target: { group: 'all_fire' }, state: 'invulnerable', value: true },
                { kind: 'setUnitState', target: { group: 'all_fire' }, state: 'canMove', value: false },
                { kind: 'setUnitState', target: { group: 'all_fire' }, state: 'canCounterattack', value: false },
                {
                    kind: 'applyEffect', target: { group: 'all_fire' }, effectId: 'burning_timber',
                    name: '燃烧的梁柱', desc: '挡路，灼伤贴近的任何人。打不掉，也躲不开——只能不站在它旁边。',
                    emoji: '🔥', duration: 0, statMods: { atkPct: -50 }
                },
                // 阿格里乌斯：限伤 25%，血量与攻防按 Boss 拉起来。
                {
                    kind: 'applyEffect', target: { unit: 'agrius_boss' }, effectId: 'he_is_waiting',
                    name: '等', desc: '他不会在这场仗里倒下。每一次本该致命的一击，都被同一个护住身后的动作挡开。',
                    emoji: '🕯️', duration: 0,
                    rule: 'minHp', rulePercent: 25,
                    statMods: { hpPct: 150, atkPct: 25, defPct: 15 }
                },
                {
                    kind: 'showStep',
                    text: '猎宫的侧厅烧了一整夜。前庭的雪被烤化了一圈，露出底下的青石，石头上有拖拽的痕迹——很宽，很浅，是有人自己走出去、又被人扶着走回来的那种。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '正厅门口有人。一个。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '不止一个。廊子两侧还有六个，蒙着脸。……百夫长，他们的皮带上都少一枚章。'
                },
                {
                    kind: 'showStep',
                    text: '门口那个人没有蒙脸。他很高，甲是旧的，手里那把斧子的刃口卷了三处。他既不喊话，也不后退。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '……狂战士。三年前在王宫外门死掉的那个。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '死掉的人不站在门口。'
                },
                {
                    kind: 'showStep', speaker: AGRIUS,
                    text: '往回走。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '奉摄政令，追缉劫驾者。让开。'
                },
                {
                    kind: 'showStep', speaker: AGRIUS,
                    text: '……往回走。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '全队展开。火在西边，别贴着梁柱走。妮娅压后，艾利安别上石阶——马冲不上去。',
                    next: '__lodge_engage'
                },
                { kind: 'setTriggerEnabled', trigger: 'lodge_brief', enabled: true }
            ]
        },
        {
            id: 'lodge_brief',
            title: '规则说明：打不死的那个人',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__lodge_engage' }],
            do: [
                { kind: 'unlockInput' },
                {
                    kind: 'showStep',
                    text: '烧着的梁柱不可选中、也打不掉；它挡住格子，并灼伤每一个贴着它的人——你的人和他的人都一样。火会在第 4、第 8 回合各点着一批，第 14 回合屋顶塌。',
                    highlight: { area: 'the_steps' }
                },
                {
                    kind: 'showStep',
                    text: '门口那个人身上有一层叫「等」的效果：血量压不到两成半以下。这不是护他——是他还没打算结束。打到他自己停手为止。'
                }
            ]
        },

        // ── 开局结算上一关的调查成果（timer 100ms + 变量为真） ──
        {
            id: 'carry_clue_roster',
            title: '结算：雪原名册',
            enabled: true, once: true,
            when: [
                { kind: 'timer', value: 100 },
                { kind: 'variableCompare', scope: 'campaign', variable: 'clue_roster', op: '==', value: true }
            ],
            do: [{ kind: 'setVariable', variable: 'clue_score', operation: 'add', value: 1 }]
        },
        {
            id: 'carry_clue_seal',
            title: '结算：渡口封蜡',
            enabled: true, once: true,
            when: [
                { kind: 'timer', value: 100 },
                { kind: 'variableCompare', scope: 'campaign', variable: 'clue_seal', op: '==', value: true }
            ],
            do: [{ kind: 'setVariable', variable: 'clue_score', operation: 'add', value: 1 }]
        },
        {
            id: 'carry_clue_strap',
            title: '结算：火堆系带',
            enabled: true, once: true,
            when: [
                { kind: 'timer', value: 100 },
                { kind: 'variableCompare', scope: 'campaign', variable: 'clue_strap', op: '==', value: true }
            ],
            do: [{ kind: 'setVariable', variable: 'clue_score', operation: 'add', value: 1 }]
        },

        // ── 侧厅：三个回合的窗口 ──
        {
            id: 'side_hall_opens',
            title: '第二回合：火把侧厅的门烧开',
            enabled: true,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 1 }],
            do: [
                { kind: 'setInteractionState', interactable: 'copied_codex', state: 'available' },
                { kind: 'setObjectiveStatus', objective: 'the_side_hall', status: 'active' },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '侧厅的门板烧塌了。里头有书架——还没烧到那儿。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '谁去谁自己算清楚回来的路。那间屋子撑不了三个回合。',
                    highlight: { area: 'side_hall' }
                }
            ]
        },
        {
            id: 'side_hall_collapses',
            title: '第五回合：侧厅塌了',
            enabled: true,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 4 }],
            do: [
                { kind: 'setInteractionState', interactable: 'copied_codex', state: 'disabled' },
                { kind: 'setObjectiveStatus', objective: 'the_side_hall', status: 'hidden' },
                {
                    kind: 'showStep',
                    text: '侧厅的屋脊压了下来，火从缺口里翻出一大股，把西边那排廊柱一起吞了。里面剩下的东西，从此谁也不知道是什么。'
                }
            ]
        },
        {
            id: 'codex_taken',
            title: '抢出手抄本',
            enabled: true,
            once: true,
            when: [{ kind: 'eventInteractionIs', interactable: 'copied_codex' }],
            do: [
                { kind: 'setVariable', variable: 'codex_taken', operation: 'set', value: true },
                { kind: 'setObjectiveStatus', objective: 'the_side_hall', status: 'completed' },
                {
                    kind: 'showStep',
                    text: '书架最下一格是本手抄的册子，麻纸，线装，边角被火燎黑了半指。不是官书——是有人一笔一笔抄下来的私录。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '这字……'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '我见过。佩特拉档案厅烧剩的那半片帛书上，是同一只手。'
                }
            ]
        },

        // ── 火分三批点着 ──
        {
            id: 'fire_wave_a_ignites',
            title: '第四回合：火漫过西廊',
            enabled: true,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 3 }],
            do: [
                { kind: 'setUnitState', target: { group: 'fire_wave_a' }, state: 'canAct', value: true },
                {
                    kind: 'showStep',
                    text: '西廊的四根梁柱几乎同时着了。火没有分敌我——最先被逼退的是靠西那两个蒙面的人。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '西边不能站人了。往东挤，别让火把我们和他隔开。'
                }
            ]
        },
        {
            id: 'fire_wave_b_ignites',
            title: '第八回合：火进了前庭',
            enabled: true,
            once: true,
            when: [{ kind: 'turnStarted', camp: 'expedition', turn: 7 }],
            do: [
                { kind: 'setUnitState', target: { group: 'fire_wave_b' }, state: 'canAct', value: true },
                {
                    kind: 'showStep',
                    text: '前庭四角的隔扇一起烧起来。能站的地方剩下中间一条，两头都在缩。'
                },
                {
                    kind: 'showStep', speaker: NIA,
                    text: '他一步都没动。火都烧到他脚边了，他一步都没动。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '他不是不能动。他是不肯离开那道门。'
                }
            ]
        },

        // ── 阶段二：泣血 ──
        {
            id: 'agrius_phase2',
            title: '阶段二：泣血',
            enabled: true,
            once: true,
            when: [{ kind: 'unitHpCompare', unit: 'agrius_boss', mode: 'percent', op: '<=', value: 70 }],
            do: [
                { kind: 'setVariable', variable: 'phase', operation: 'set', value: 2 },
                {
                    kind: 'applyEffect', target: { unit: 'agrius_boss' }, effectId: 'blood_weep',
                    name: '泣血', desc: '狂战士的旧技：以自身伤势换攻势，攻击提高 35%。',
                    emoji: '🩸', duration: 0, statMods: { atkPct: 35 }
                },
                { kind: 'setUnitState', target: { group: 'guard_reserve' }, state: 'canAct', value: true },
                { kind: 'changeUnitMorale', camp: 'oldGuard', operation: 'set', value: 3 },
                {
                    kind: 'showStep',
                    text: '斧子第一次真正抡开。血从他左肩的旧疤上渗下来，顺着甲缝走——那道疤有三年了，从来没有长好过。'
                },
                {
                    kind: 'showStep', speaker: AGRIUS,
                    text: '别过门。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '他护着门！门里有东西——'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '门里有人。别射门口。压他，别绕。'
                }
            ]
        },

        // ── 阶段三：他退回门槛上 ──
        {
            id: 'agrius_phase3',
            title: '阶段三：他退回门槛，不再前进一步',
            enabled: true,
            once: true,
            when: [{ kind: 'unitHpCompare', unit: 'agrius_boss', mode: 'percent', op: '<=', value: 45 }],
            do: [
                { kind: 'setVariable', variable: 'phase', operation: 'set', value: 3 },
                {
                    kind: 'applyEffect', target: { unit: 'agrius_boss' }, effectId: 'the_threshold',
                    name: '门槛', desc: '他不再往前一步，只守身后那三尺地方：防御提高 30%。',
                    emoji: '🚪', duration: 0, statMods: { defPct: 30 }
                },
                { kind: 'setUnitState', target: { unit: 'agrius_boss' }, state: 'canMove', value: false },
                {
                    kind: 'showStep',
                    text: '他往后退了半步，脚跟抵住门槛，就再没有动过。斧子从进攻的架势换成了封挡——他不是在打这一仗，他是在守一段时间。'
                },
                {
                    kind: 'showStep', speaker: ELIAN,
                    text: '百夫长，他从头到尾没有杀过我们一个人。倒了三个，全是被打晕的。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……我知道。',
                    next: '__phase3_evidence'
                },
                { kind: 'setTriggerEnabled', trigger: 'phase3_with_silk', enabled: true },
                { kind: 'setTriggerEnabled', trigger: 'phase3_no_silk', enabled: true }
            ]
        },
        {
            id: 'phase3_with_silk',
            title: '阶段三（怀里有那半片焦帛）',
            enabled: false,
            once: true,
            when: [
                { kind: 'eventNextIs', value: '__phase3_evidence' },
                { kind: 'collectibleUnlocked', collectible: 'bi05_charred_silk', unlocked: true }
            ],
            do: [
                {
                    kind: 'showStep',
                    text: '马库斯的手在胸甲内侧停了一下。那半片焦帛从佩特拉带到这里，两个月，没给任何人看过。"君侧之人，实非忠良"——只剩这八个字。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '狂战士。三年前你在王宫外门替谁挡的刀。'
                },
                {
                    kind: 'showStep', speaker: AGRIUS,
                    text: '……'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '你不说，我就照令上写的做。'
                },
                {
                    kind: 'showStep', speaker: AGRIUS,
                    text: '你写不写，跟我挡的是谁没关系。'
                }
            ]
        },
        {
            id: 'phase3_no_silk',
            title: '阶段三（空着手）',
            enabled: false,
            once: true,
            when: [
                { kind: 'eventNextIs', value: '__phase3_evidence' },
                { kind: 'collectibleUnlocked', collectible: 'bi05_charred_silk', unlocked: false }
            ],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '狂战士。你到底在等什么。'
                },
                {
                    kind: 'showStep', speaker: AGRIUS,
                    text: '……'
                },
                {
                    kind: 'showStep',
                    text: '他没有回答。马库斯手里没有任何一样能拿出来问的东西——他这两个月一直在打胜仗，别的什么都没有收集。'
                }
            ]
        },

        // ── 阈值：他停手，门开了 ──
        {
            id: 'agrius_yields',
            title: '限伤阈值：门里的人自己走出来',
            enabled: true,
            once: true,
            when: [{ kind: 'unitHpCompare', unit: 'agrius_boss', mode: 'percent', op: '<=', value: 26 }],
            do: [
                { kind: 'setVariable', variable: 'halted', operation: 'set', value: true },
                { kind: 'setVariable', variable: 'heard_the_prince', operation: 'set', value: true },
                { kind: 'setUnitState', target: { group: 'vanguard' }, state: 'canAct', value: false },
                { kind: 'setUnitState', target: { group: 'nameless_guard' }, state: 'canAct', value: false },
                { kind: 'setUnitState', target: { group: 'guard_reserve' }, state: 'canAct', value: false },
                { kind: 'setUnitState', target: { unit: 'agrius_boss' }, state: 'canAct', value: false },
                { kind: 'setUnitState', target: { group: 'all_fire' }, state: 'canAct', value: false },
                {
                    kind: 'showStep',
                    text: '斧子落地的声音比预想的轻。他单膝跪在门槛上，一只手还撑着门框——不是撑着自己，是撑着那道门，不让它被撞开。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……结束了。让开。'
                },
                {
                    kind: 'showStep',
                    text: '门自己开了。'
                },
                {
                    kind: 'spawnUnits', units: [
                        { id: 'adrian_prince', type: 'infantry', camp: 'royal', q: HALL_DOOR.q, r: HALL_DOOR.r, hpPct: 100, morale: 2, canAct: false }
                    ]
                },
                {
                    kind: 'showStep',
                    text: '走出来的是个十七岁的少年。没有戴冠，没有佩剑，斗篷的扣子缺了一枚。他不看火，也不看倒在地上的人——他看着马库斯。'
                },
                {
                    kind: 'showStep', speaker: ADRIAN,
                    text: '住手。不是他把我带出来，是我终于从里面走出来。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……陛下。'
                },
                {
                    kind: 'showStep', speaker: ADRIAN,
                    text: '我父王死的那天，摄政替他哭了。'
                },
                {
                    kind: 'showStep', speaker: ADRIAN,
                    text: '卡托没有要我的王位。他只是不肯把它交给一个不敢看我的人。',
                    next: '__adrian_speaks'
                },
                { kind: 'setTriggerEnabled', trigger: 'ending_full', enabled: true },
                { kind: 'setTriggerEnabled', trigger: 'ending_partial', enabled: true },
                { kind: 'setTriggerEnabled', trigger: 'ending_thin', enabled: true }
            ]
        },

        {
            id: 'ending_full',
            title: '结局（雪原三处全查过）：他能一句一句核对',
            enabled: false,
            once: true,
            when: [
                { kind: 'eventNextIs', value: '__adrian_speaks' },
                { kind: 'variableCompare', scope: 'level', variable: 'clue_score', op: '>=', value: 3 }
            ],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '驿站的卫队名册，第三页到第五页，名字被剜了。是三年前剜的。'
                },
                {
                    kind: 'showStep', speaker: ADRIAN,
                    text: '那一页上有二十七个名字。二十七个人那天夜里全都"殉职"了。他们的抚恤，摄政亲手发的。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '渡口的封蜡，鸢尾缺两瓣。'
                },
                {
                    kind: 'showStep', speaker: ADRIAN,
                    text: '那是真玺。缺角是我父王死那晚磕的。三年来所有齐整的印，都是摄政府另刻的一枚。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '雪丘火堆里，七条烧了一半的系带，铜环齐全，一枚章都没有。'
                },
                {
                    kind: 'showStep', speaker: ADRIAN,
                    text: '七个人。他们烧掉了能认出自己的那一半，把另一半收着——收了三年。'
                },
                {
                    kind: 'showStep', speaker: AGRIUS,
                    text: '……八个。还有一个人的章，一直没摘。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '谁。'
                },
                {
                    kind: 'showStep', speaker: AGRIUS,
                    text: '守着城门的那个。他会杀了你。',
                    next: '__lodge_end'
                },
                { kind: 'setTriggerEnabled', trigger: 'lodge_closing', enabled: true }
            ]
        },
        {
            id: 'ending_partial',
            title: '结局（雪原查了两处）：能核对，核对不完',
            enabled: false,
            once: true,
            when: [
                { kind: 'eventNextIs', value: '__adrian_speaks' },
                { kind: 'variableCompare', scope: 'level', variable: 'clue_score', op: '==', value: 2 }
            ],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……路上有两处对得上。第三处我没去。'
                },
                {
                    kind: 'showStep', speaker: ADRIAN,
                    text: '两处够了吗。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '够我不再照令上那句话往下办。不够我把它反过来说。'
                },
                {
                    kind: 'showStep', speaker: ADRIAN,
                    text: '那就先这样。剩下的，等你自己走到那一处再说。',
                    next: '__lodge_end'
                },
                { kind: 'setTriggerEnabled', trigger: 'lodge_closing', enabled: true }
            ]
        },
        {
            id: 'ending_thin',
            title: '结局（雪原几乎没查）：他只能听着',
            enabled: false,
            once: true,
            when: [
                { kind: 'eventNextIs', value: '__adrian_speaks' },
                { kind: 'variableCompare', scope: 'level', variable: 'clue_score', op: '<=', value: 1 }
            ],
            do: [
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '……'
                },
                {
                    kind: 'showStep', speaker: ADRIAN,
                    text: '你不信。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '我信不信没有用。我手里什么都没有。'
                },
                {
                    kind: 'showStep',
                    text: '一路上他见过三处岔口，一处也没有停下来看。此刻他能拿出来的，只有一份写着"劫驾"的追缉令抄件——那是别人给他的。',
                    next: '__lodge_end'
                },
                { kind: 'setTriggerEnabled', trigger: 'lodge_closing', enabled: true }
            ]
        },
        {
            id: 'lodge_closing',
            title: '收束：把令收起来',
            enabled: false,
            once: true,
            when: [{ kind: 'eventNextIs', value: '__lodge_end' }],
            do: [
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '百夫长。令上写的是格杀勿论。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '令上写的是"劫驾者"。'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '这里没有劫驾者。收队，灭火，把伤员抬到背风的那边去。'
                },
                {
                    kind: 'showStep', speaker: TITUS,
                    text: '……那我们算什么？'
                },
                {
                    kind: 'showStep', speaker: MARCUS,
                    text: '算一支还没写完这一天回执的部队。'
                },
                { kind: 'setObjectiveStatus', objective: 'mind_the_fire', status: 'completed' },
                { kind: 'setObjectiveStatus', objective: 'press_agrius', status: 'completed' }
            ]
        },

        // ── 失败线 ──
        {
            id: 'roof_collapses',
            title: '失败：屋顶塌了',
            enabled: true,
            once: true,
            when: [
                { kind: 'turnStarted', camp: 'expedition', turn: 13 },
                { kind: 'variableCompare', scope: 'level', variable: 'halted', op: '==', value: false }
            ],
            do: [
                { kind: 'setObjectiveStatus', objective: 'mind_the_fire', status: 'failed' },
                { kind: 'setObjectiveStatus', objective: 'press_agrius', status: 'failed' },
                {
                    kind: 'endScenario', result: 'lose',
                    reason: '正厅的屋脊整条压下来，把门、门口的人和门里的人一起埋了。这一夜之后，"狂战士劫驾"成了唯一还说得出口的说法——因为再没有人能出来反驳它。'
                }
            ]
        },
        {
            id: 'vanguard_broken',
            title: '失败：前卫打光了',
            enabled: true,
            once: true,
            when: [{ kind: 'factionUnitCount', camp: 'expedition', op: '<=', value: 3 }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'press_agrius', status: 'failed' },
                {
                    kind: 'endScenario', result: 'lose',
                    reason: '为了一道谁也没解释过的命令，前卫在猎宫前庭拼掉了大半。门始终没有被撞开——门后的人，你到最后也没看见。'
                }
            ]
        },
        {
            id: 'marcus_falls',
            title: '失败：马库斯倒下',
            enabled: true,
            once: true,
            when: [{ kind: 'unitKilled', target: { unit: 'marcus_lodge' } }],
            do: [
                { kind: 'setObjectiveStatus', objective: 'press_agrius', status: 'failed' },
                {
                    kind: 'endScenario', result: 'lose',
                    reason: '百夫长倒在自己下令攻上去的石阶下。门口那个人低头看了他很久，然后把他拖到背风的地方——这一段，没有任何一份军报写过。'
                }
            ]
        }
    ],

    result: {
        winText: '火烧到天亮才小下去。马库斯没有押走任何人，也没有放走任何人；他只是坐在石阶下，把那份追缉令从怀里拿出来，看了很久，又收了回去。他一句结论也没得出——但他终于不再替别人下结论了。',
        loseText: '猎宫之战失败。',
        eliminateEnemy: false,
        starRules: [
            {
                label: '八个人一个没丢',
                when: [{ kind: 'factionUnitCount', camp: 'expedition', op: '>=', value: 8 }]
            },
            {
                label: '从火里抢出了那本手抄本',
                when: [{ kind: 'collectibleUnlocked', collectible: 'bi09_copied_codex', unlocked: true }]
            },
            {
                label: '雪原三处痕迹全带到了猎宫',
                when: [{ kind: 'variableCompare', scope: 'level', variable: 'clue_score', op: '>=', value: 3 }]
            }
        ]
    }
};
